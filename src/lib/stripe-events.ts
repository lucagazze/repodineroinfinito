import type Stripe from "stripe";
import { db } from "./db";
import { fulfill, applyRefund } from "./fulfill";
import { fromMinor } from "./fx";
import { recordUpsell } from "./upsell";
import { orderLink, raiseAlert } from "./alerts";

/**
 * Procesa un evento de Stripe ya verificado. Lo usan el webhook por tienda
 * (/api/stripe/webhook/[storeId]) y el viejo de una sola cuenta (/api/webhook).
 *
 * Devuelve el estado para la respuesta HTTP; si algo falla tira error y el
 * webhook responde 500 para que Stripe reintente.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  ctx: { stripe: Stripe; storeId: string | null; storeSlug: string | null }
): Promise<{ ignored?: string; duplicate?: boolean }> {
  // Bitácora + idempotencia: un evento ya procesado no se vuelve a procesar.
  const { data: seen } = await db.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return { duplicate: true };
  if (!seen) await db.from("stripe_events").insert({ id: event.id, store_id: ctx.storeId, type: event.type });
  if (ctx.storeId) {
    await db.from("store_stripe").update({ last_event_at: new Date().toISOString() }).eq("store_id", ctx.storeId);
  }

  try {
    const res = await process(event, ctx);
    await db.from("stripe_events").update({ processed_at: new Date().toISOString(), error: res.ignored ?? null }).eq("id", event.id);
    return res;
  } catch (e) {
    await db.from("stripe_events").update({ error: (e as Error).message.slice(0, 500) }).eq("id", event.id);
    throw e;
  }
}

async function process(
  event: Stripe.Event,
  { stripe, storeSlug }: { stripe: Stripe; storeSlug: string | null }
): Promise<{ ignored?: string }> {
  // Las cuentas son compartidas con la plataforma anterior (cobra por Connect en la misma
  // cuenta): sus pagos también llegan acá. Solo tocamos lo que creó este checkout.
  const obj = event.data.object as { metadata?: Stripe.Metadata; payment_intent?: unknown };
  let meta = obj.metadata ?? {};
  if (meta.source !== "checkout-propio" && obj.payment_intent && event.type.startsWith("charge.")) {
    meta = (await stripe.paymentIntents.retrieve(String(obj.payment_intent))).metadata ?? {};
  }
  if (meta.source !== "checkout-propio") return { ignored: "no es de este checkout" };
  // El webhook de una tienda no procesa pagos de otra (los upsells llevan la orden, no la tienda).
  if (storeSlug && meta.store && meta.store !== storeSlug) return { ignored: `es de la tienda ${meta.store}` };

  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      // Upsell de 1 clic: normalmente ya lo registró /api/upsell. Si el
      // comprador pasó el 3DS y cerró la pestaña antes de confirmar, lo
      // registramos acá (es idempotente) para que no quede cobrado y sin entregar.
      if (pi.metadata?.kind === "upsell") {
        if (pi.metadata.order) await recordUpsell(pi.metadata.order, pi, { stripe });
        return {};
      }
      const ch = pi.latest_charge ? await stripe.charges.retrieve(String(pi.latest_charge)) : null;
      const bd = ch?.billing_details;
      await fulfill({
        completarComprador: async (email, name) => {
          if (!pi.customer) return;
          await stripe.customers.update(String(pi.customer), { email, name: name ?? undefined });
        },
        paymentId: pi.id,
        customerId: pi.customer ? String(pi.customer) : null,
        email: bd?.email ?? pi.receipt_email ?? null,
        name: bd?.name ?? null,
        phone: bd?.phone ?? null,
        country: bd?.address?.country ?? null,
        currency: pi.currency,
        amountTotal: fromMinor(pi.amount_received, pi.currency),
        metadata: pi.metadata ?? {},
        paid: true,
      });
      return {};
    }

    case "payment_intent.processing": {
      // Pagos que tardan en acreditarse (SEPA, Multibanco…): se anota el
      // pedido como pendiente, sin entregar.
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.kind === "upsell") return {};
      await fulfill({
        completarComprador: async (email, name) => {
          if (!pi.customer) return;
          await stripe.customers.update(String(pi.customer), { email, name: name ?? undefined });
        },
        paymentId: pi.id,
        customerId: pi.customer ? String(pi.customer) : null,
        email: pi.receipt_email ?? null,
        name: null, phone: null, country: null,
        currency: pi.currency,
        amountTotal: fromMinor(pi.amount, pi.currency),
        metadata: pi.metadata ?? {},
        paid: false,
      });
      return {};
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.warn("[webhook] pago fallido:", pi.id, pi.last_payment_error?.message);
      return {};
    }

    case "charge.refunded":
      {
        // La conversion a unidades mayores vivia dentro de applyRefund, que
        // ahora no sabe de Stripe: la hace quien conoce el formato del cobro.
        const ch = event.data.object as Stripe.Charge;
        if (ch.payment_intent) {
          const sinDecimales = ["jpy", "krw", "clp", "vnd"].includes(ch.currency);
          await applyRefund({
            paymentId: String(ch.payment_intent),
            refunded: ch.amount_refunded / (sinDecimales ? 1 : 100),
            total: !!ch.refunded,
          });
        }
      }
      return {};

    case "charge.dispute.created": {
      // Queda en la bitácora (stripe_events) y el panel lo muestra en Diagnóstico.
      const d = event.data.object as Stripe.Dispute;
      console.warn("[webhook] contracargo:", d.payment_intent, d.reason, d.amount);
      // Y en Avisos, con el pedido si es nuestro.
      const { data: o } = d.payment_intent
        ? await db.from("orders").select("id,store_id,email").eq("stripe_payment_intent", String(d.payment_intent)).maybeSingle()
        : { data: null };
      await raiseAlert({
        kind: "stripe_dispute", severity: "error", ref: d.id, storeId: o?.store_id ?? null, link: o ? orderLink(o.id) : null,
        title: `Contracargo${o?.email ? ` · ${o.email}` : ""} · ${fromMinor(d.amount, d.currency)} ${d.currency.toUpperCase()}`,
        body: `Motivo: ${d.reason}. Hay que responder la disputa en Stripe antes del vencimiento (${d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString().slice(0, 10) : "ver Stripe"}).`,
      }).catch(() => {});
      return {};
    }
  }
  return { ignored: `evento ${event.type} sin manejo` };
}
