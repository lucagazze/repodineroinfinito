import type Stripe from "stripe";
import { db } from "./db";
import { decrypt } from "./secrets";
import { stripeWith } from "./stripe";
import { handleStripeEvent } from "./stripe-events";
import { raiseAlert } from "./alerts";
import { fromMinor } from "./fx";

/**
 * Auto-reparación de entregas (cron cada 10 min): todo pago de este checkout
 * cobrado en Stripe en las últimas 48 h tiene que estar registrado.
 *
 *  - pago principal sin pedido pagado → se procesa igual que el webhook
 *    (fulfill: pedido, mail de entrega, push);
 *  - upsell sin su fila en order_items → recordUpsell (entrega del upsell).
 *
 * Es el mismo camino que el webhook (handleStripeEvent con el PI), así que
 * es idempotente: si el webhook llegó tarde o llega después, no se duplica
 * nada (guardas de fulfill/recordUpsell + índice único por PI).
 */

export type ReconcileResult = { store: string; checked: number; repaired: { pi: string; kind: string; amount: number; currency: string }[]; errors: string[] };

export async function reconcileStores(hours = 48, opts: { dryRun?: boolean } = {}): Promise<ReconcileResult[]> {
  const { data: rows, error } = await db.from("store_stripe").select("store_id,secret_key_enc,stores!inner(slug,name)");
  if (error) throw new Error(`store_stripe: ${error.message}`);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const out: ReconcileResult[] = [];

  for (const r of rows ?? []) {
    const st = r.stores as unknown as { slug: string; name: string };
    const key = decrypt(r.secret_key_enc);
    // Una tienda con llave de PRUEBA de Stripe no tiene ventas reales que reparar (y sus pedidos de prueba se borran).
    if (/^(sk|rk)_test_/.test(key)) continue;
    const stripe = stripeWith(key);
    const res: ReconcileResult = { store: st.slug, checked: 0, repaired: [], errors: [] };
    try {
      const paid: Stripe.PaymentIntent[] = [];
      for await (const pi of stripe.paymentIntents.list({ created: { gte: since }, limit: 100 })) {
        if (pi.status !== "succeeded" || pi.metadata?.source !== "checkout-propio") continue;
        if (pi.metadata.store && pi.metadata.store !== st.slug && pi.metadata.kind !== "upsell") continue;
        paid.push(pi);
      }
      res.checked = paid.length;
      if (!paid.length) { out.push(res); continue; }

      // De a 100: con cientos de pagos en 48 h, un solo .in() arma una URL demasiado larga, la consulta falla y,
      // sin datos, todos los pagos parecían «sin registrar» (11/10: «841 pagos cobrados que no se habían registrado»).
      // Si una tanda falla, se corta acá: nunca se reprocesa un pago por no haber podido leer la base.
      const ids = paid.map((p) => p.id);
      const hasOrder = new Set<string>(), hasItem = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        const [o, it] = await Promise.all([
          db.from("orders").select("stripe_payment_intent,status").in("stripe_payment_intent", part),
          db.from("order_items").select("stripe_payment_intent").in("stripe_payment_intent", part),
        ]);
        if (o.error || it.error) throw new Error(`no se pudo leer la base: ${(o.error ?? it.error)!.message}`);
        for (const r of o.data ?? []) if (r.status === "paid" || r.status === "refunded") hasOrder.add(r.stripe_payment_intent as string);
        for (const r of it.data ?? []) hasItem.add(r.stripe_payment_intent as string);
      }

      for (const pi of paid) {
        const upsell = pi.metadata.kind === "upsell";
        // Pagos de hace menos de 3 minutos: el webhook todavía puede estar en camino.
        if (Date.now() / 1000 - pi.created < 180) continue;
        if (upsell ? hasItem.has(pi.id) : hasOrder.has(pi.id)) continue;
        if (opts.dryRun) {
          res.repaired.push({ pi: pi.id, kind: `${upsell ? "upsell" : "venta"} (sin registrar)`, amount: fromMinor(pi.amount_received, pi.currency), currency: pi.currency.toUpperCase() });
          continue;
        }
        try {
          const event = {
            id: `reconcile_${pi.id}`, object: "event", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
            data: { object: pi }, livemode: pi.livemode, api_version: null, pending_webhooks: 0, request: null,
          } as unknown as Stripe.Event;
          await handleStripeEvent(event, { stripe, storeId: r.store_id, storeSlug: st.slug });
          // ¿Quedó registrado de verdad?
          const ok = upsell
            ? !!(await db.from("order_items").select("id").eq("stripe_payment_intent", pi.id).maybeSingle()).data
            : !!(await db.from("orders").select("id").eq("stripe_payment_intent", pi.id).in("status", ["paid", "refunded"]).maybeSingle()).data;
          if (ok) res.repaired.push({ pi: pi.id, kind: upsell ? "upsell" : "venta", amount: fromMinor(pi.amount_received, pi.currency), currency: pi.currency.toUpperCase() });
          else res.errors.push(`${pi.id}: sigue sin registrarse`);
        } catch (e) {
          res.errors.push(`${pi.id}: ${(e as Error).message.slice(0, 200)}`);
        }
      }
    } catch (e) {
      res.errors.push((e as Error).message.slice(0, 200));
    }
    out.push(res);

    if (!opts.dryRun && (res.repaired.length || res.errors.length)) {
      await raiseAlert({
        kind: "reconciled",
        severity: "error",
        title: res.repaired.length
          ? `${st.name}: ${res.repaired.length} pago(s) cobrados que no se habían registrado; ya se registraron y entregaron`
          : `${st.name}: hay pagos cobrados que no se pudieron registrar`,
        body: [...res.repaired.map((x) => `${x.kind} ${x.amount} ${x.currency} · ${x.pi}`), ...res.errors].join("\n"),
        ref: `${st.slug}:${new Date().toISOString().slice(0, 13)}`, // uno por tienda por hora
        storeId: r.store_id,
        link: "/admin/avisos",
      });
    }
  }
  return out;
}
