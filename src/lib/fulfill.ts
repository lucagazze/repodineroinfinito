import type Stripe from "stripe";
import { withBrand } from "./brand";
import { createHmac } from "crypto";
import { db, getFunnel, getProductById, itemsByRole, type Product } from "./db";
import { sendDelivery } from "./email";
import { getRates, priceFor } from "./fx";
import { DEFAULT_LOCALE, type Locale } from "./i18n";
import { sendOrderPurchase } from "./meta";
import { markCartRecovered } from "./cart-recovery";
import { later, pushSaleOnce } from "./push";
import { orderRef } from "./order-ref";

/**
 * Registra el pedido y entrega. Lo llaman el webhook
 * (`payment_intent.succeeded` / `.processing`) y la página de gracias, si el
 * comprador llega antes que el webhook.
 *
 * Reglas que no se negocian:
 * - Idempotente por PaymentIntent: Stripe reintenta y a veces repite eventos.
 * - El estado solo avanza (pendiente → pagado → reembolsado). Un `processing`
 *   que llega tarde no puede volver a pendiente un pedido ya pagado.
 * - Si el mail de entrega falla, se libera el reclamo y se tira error: el
 *   webhook responde 500 y Stripe reintenta hasta 3 días. Antes el reclamo
 *   quedaba tomado y ningún reintento volvía a mandar el mail.
 */

const RANK: Record<string, number> = { failed: 0, pending: 1, paid: 2, refunded: 3 };
/** Si un intento de entrega quedó colgado (timeout), otro lo puede retomar después de esto. */
const CLAIM_LEASE_MS = 2 * 60_000;

export async function fulfill(args: {
  stripe: Stripe;
  paymentIntentId: string;
  customerId: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  country: string | null;
  currency: string;
  amountTotal: number;
  metadata: Stripe.Metadata;
  sessionId?: string | null;
  paid: boolean;
}) {
  const storeSlug = args.metadata.store;
  const funnelSlug = args.metadata.funnel;
  const locale = (args.metadata.locale as Locale) ?? DEFAULT_LOCALE;
  if (!storeSlug || !funnelSlug) {
    console.error("[fulfill] sin metadata de tienda/embudo:", args.paymentIntentId);
    return { skipped: "metadata" as const };
  }

  const funnel = await getFunnel(storeSlug, funnelSlug, { anyState: true });
  if (!funnel) {
    // Pago cobrado de un embudo que ya no existe: que Stripe reintente y que
    // quede a la vista en la bitácora, no que se pierda en silencio.
    throw new Error(`embudo desconocido ${storeSlug}/${funnelSlug} (${args.paymentIntentId})`);
  }

  const key = args.sessionId ?? args.paymentIntentId;
  const { data: prev } = await db
    .from("orders")
    .select("id,status")
    .eq("stripe_session_id", key)
    .maybeSingle();

  const wanted = args.paid ? "paid" : "pending";
  const status = prev && RANK[prev.status] >= RANK[wanted] ? prev.status : wanted;

  // Solo se escriben los datos que vinieron: un evento sin nombre o teléfono
  // no borra los que trajo otro.
  const row: Record<string, unknown> = {
    store_id: funnel.stores.id,
    funnel_id: funnel.id,
    stripe_payment_intent: args.paymentIntentId,
    stripe_session_id: key,
    locale,
    currency: args.currency.toUpperCase(),
    amount_total: args.amountTotal,
    status,
  };
  for (const [k, v] of Object.entries({
    stripe_customer: args.customerId, email: args.email, name: args.name, phone: args.phone, country: args.country,
  })) if (v) row[k] = v;
  // Renuncia al desistimiento aceptada en el checkout (UE/Reino Unido): la prueba si hay reclamo.
  if (args.metadata.waiver) {
    row.consents = { withdrawal_waiver: { text: args.metadata.waiver, accepted_at: args.metadata.waiver_at ?? null } };
  }

  // Recuperado de un carrito abandonado con el descuento del mail (lo puso /api/pi, verificado).
  const recoveredFrom = /^[0-9a-f-]{36}$/.test(String(args.metadata.recovered_from ?? "")) ? String(args.metadata.recovered_from) : null;
  if (recoveredFrom) {
    row.recovered_from = recoveredFrom;
    row.discount = {
      source: "cart_recovery", pct: Number(args.metadata.recovery_pct ?? 0),
      amount: Number(args.metadata.recovery_discount ?? 0), currency: args.currency.toUpperCase(),
    };
  }
  // Descuento de una campaña de email marketing (también verificado por /api/pi).
  const campaignDiscount = /^[0-9a-f-]{36}$/.test(String(args.metadata.campaign_discount ?? "")) ? String(args.metadata.campaign_discount) : null;
  if (!recoveredFrom && campaignDiscount) {
    row.discount = {
      source: "campaign", campaign: campaignDiscount, pct: Number(args.metadata.recovery_pct ?? 0),
      amount: Number(args.metadata.recovery_discount ?? 0), currency: args.currency.toUpperCase(),
    };
  }

  // UTMs y datos de atribución que se guardaron al abrir el checkout.
  if (!prev) {
    const { data: ck } = await db
      .from("checkouts")
      .select("utm,tracking")
      .eq("stripe_payment_intent", args.paymentIntentId)
      .maybeSingle();
    if (ck) { row.utm = ck.utm ?? {}; row.tracking = ck.tracking ?? {}; }
  }

  // Un "pendiente" solo crea el pedido, nunca pisa uno existente: así ni
  // siquiera una carrera entre eventos puede bajar un pagado a pendiente.
  const { error } = await db
    .from("orders")
    .upsert(row, { onConflict: "stripe_session_id", ignoreDuplicates: wanted === "pending" });
  if (error) throw new Error(`no se pudo guardar el pedido: ${error.message}`);
  const { data: order, error: e1 } = await db
    .from("orders")
    // number: el #1001 que puso la base al crear la fila (migración 036).
    .select("id,delivered_at,status,number")
    .eq("stripe_session_id", key)
    .single();
  if (e1 || !order) throw new Error(`pedido no encontrado después de guardarlo: ${e1?.message}`);

  if (order.status === "paid") {
    await db.from("checkouts")
      .update({ status: "paid", order_id: order.id, ...(args.email ? { email: args.email } : {}) })
      .eq("stripe_payment_intent", args.paymentIntentId);
    // Aviso del pedido al panel: YA, apenas se cobra (como la plataforma anterior). Cada post-compra manda el suyo.
    const bumpCount = String(args.metadata.bumps ?? "").split(",").filter(Boolean).length;
    later(() => pushSaleOnce(order.id, bumpCount));
    // El carrito del mail queda recuperado (y el token ya no vale): push «Carrito recuperado», una vez.
    if (recoveredFrom) later(() => markCartRecovered(recoveredFrom, order.id));
  }
  if (order.status !== "paid") return { pending: order.status === "pending" } as const;
  if (order.delivered_at) return { already: true as const, orderId: order.id };

  // Reclamo con vencimiento: el webhook y la página de gracias pueden llegar
  // casi a la vez; solo uno entrega. Si el que reclamó se cayó a mitad de
  // camino, a los 2 minutos otro puede retomarlo.
  const stale = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const { data: claimed } = await db
    .from("orders")
    .update({ fulfill_claimed_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("delivered_at", null)
    .or(`fulfill_claimed_at.is.null,fulfill_claimed_at.lt.${stale}`)
    .select("id,delivery_attempts");
  // Otro intento tiene la entrega tomada (el webhook y la página de gracias a
  // la vez). Si ese intento falla, nadie lo reintentaría: se tira error para
  // que Stripe vuelva a llamar en unos minutos; si para entonces ya se
  // entregó, sale por «already».
  if (!claimed?.length) throw new Error("entrega en curso en otro intento; reintentar");
  const attempts = (claimed[0].delivery_attempts ?? 0) + 1;

  try {
    // El Customer se creó vacío al abrir el checkout; ahora que sabemos quién
    // es, lo completamos para que se entienda en el dashboard de Stripe.
    if (args.customerId && args.email) {
      await args.stripe.customers
        .update(args.customerId, { email: args.email, name: args.name ?? undefined })
        .catch((e) => console.warn("[fulfill] no se pudo completar el customer:", e.message));
    }

    const main = funnel.main_product_id ? await getProductById(funnel.main_product_id) : null;
    if (!main) throw new Error(`el embudo ${funnel.slug} no tiene producto principal`);
    if (!args.email) throw new Error("el pago no trae email del comprador");

    const extras = [...itemsByRole(funnel, "included"), ...itemsByRole(funnel, "bonus")];

    // Los bumps vienen en la metadata del PaymentIntent: es lo que el servidor
    // cobró de verdad, no lo que el navegador dijo que quería.
    const bumpSlugs = String(args.metadata.bumps ?? "").split(",").filter(Boolean);
    const bumps: Product[] = itemsByRole(funnel, "bump").filter((b) => bumpSlugs.includes(b.slug));

    const cur = args.currency.toUpperCase();
    const { count } = await db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", order.id);
    if (!count) {
      const rates = await getRates();
      const charged = new Map(
        String(args.metadata.bump_amounts ?? "").split(",").filter(Boolean)
          .map((pair) => { const [slug, amt] = pair.split(":"); return [slug, Number(amt)] as const; })
      );
      const bumpPrice = (b: Product) => charged.get(b.slug) ?? Number(priceFor(b, cur, rates)?.amount ?? 0);
      const bumpAmount = bumps.reduce((a, b) => a + bumpPrice(b), 0);
      const { error: e2 } = await db.from("order_items").insert([
        { order_id: order.id, product_id: main.id, kind: "main", amount: Math.max(args.amountTotal - bumpAmount, 0), currency: cur },
        ...extras.map((p) => ({
          order_id: order.id, product_id: p.id,
          kind: p.kind === "bonus" ? ("bonus" as const) : ("included" as const), amount: 0, currency: cur,
        })),
        ...bumps.map((b) => ({
          order_id: order.id, product_id: b.id, kind: "bump" as const, amount: bumpPrice(b), currency: cur,
          stripe_payment_intent: args.paymentIntentId,
        })),
      ]);
      if (e2) throw new Error(`no se pudieron guardar los items: ${e2.message}`);
    }

    // La compra a Meta por el servidor, antes del mail: la venta existe aunque
    // el mail falle (y el reintento no la vuelve a mandar: capi_sent_at).
    await sendOrderPurchase(order.id).catch((e) => console.warn("[fulfill] capi:", e.message));

    const res = await sendDelivery({
      to: args.email,
      name: args.name,
      store: withBrand(funnel.stores, locale),
      locale,
      main,
      extras: [...extras, ...bumps],
      currency: cur,
      orderRef: orderRef(order),
      total: args.amountTotal,
      orderId: order.id,
    });
    if ("skipped" in res) throw new Error("no hay proveedor de mail configurado (POSTMARK_TOKEN o BREVO_API_KEY)");

    await db.from("orders")
      .update({ delivered_at: new Date().toISOString(), delivery_error: null, delivery_attempts: attempts })
      .eq("id", order.id);
    console.log("[fulfill] entregado a", args.email, "· bumps:", bumpSlugs.join(",") || "ninguno");
  } catch (e) {
    // Se libera el reclamo para que el próximo reintento de Stripe lo vuelva a intentar.
    await db.from("orders")
      .update({ fulfill_claimed_at: null, delivery_error: (e as Error).message.slice(0, 500), delivery_attempts: attempts })
      .eq("id", order.id);
    throw e;
  }

  await notifySale(order.id).catch((e) => console.warn("[fulfill] webhook de ventas:", e.message));

  // Si esa persona nos escribió y todavía no le respondimos, la IA vuelve a armar su respuesta con esta compra
  // (links incluidos) y avisa de nuevo. Solo mails de las últimas 72 h.
  const buyer = args.email?.trim().toLowerCase();
  if (buyer && /^[^\s"',()]+@[^\s"',()]+$/.test(buyer)) {
    await db.from("inbox_messages").update({ ai_pilot_at: null, mail_pushed_at: null })
      .eq("store_id", funnel.stores.id).eq("direction", "in").is("replied_at", null)
      .gte("date", new Date(Date.now() - 72 * 3600_000).toISOString())
      .or(`from_email.ilike."${buyer}",reply_to.ilike."${buyer}"`)
      .then(({ error }) => { if (error) console.warn("[fulfill] rehacer borradores:", error.message); });
  }

  return { ok: true as const, orderId: order.id };
}

/**
 * Configuración › Webhooks: avisa cada venta cobrada a otro sistema (área de
 * miembros, CRM, planilla). Firma HMAC en X-Signature con salesWebhookSecret(storeId):
 * una clave derivada por tienda, que no sirve para descifrar las llaves guardadas.
 */
export async function notifySale(orderId: string) {
  const { data: o } = await db
    .from("orders")
    .select("id,store_id,created_at,email,name,phone,country,currency,amount_total,utm,stripe_payment_intent,is_test,stores(slug,sales_webhook_url),funnels(slug),order_items(kind,amount,products(slug,name))")
    .eq("id", orderId)
    .single();
  const store = o?.stores as unknown as { slug: string; sales_webhook_url: string | null } | null;
  // Una tienda de prueba (llaves de test de Stripe) no le avisa ventas a nadie.
  if (!o || o.is_test || !store?.sales_webhook_url) return;
  const body = JSON.stringify({
    event: "sale.paid",
    order_id: o.id, created_at: o.created_at, store: store.slug,
    checkout: (o.funnels as unknown as { slug: string } | null)?.slug ?? null,
    customer: { email: o.email, name: o.name, phone: o.phone, country: o.country },
    currency: o.currency, total: Number(o.amount_total), utm: o.utm, payment_intent: o.stripe_payment_intent,
    items: ((o.order_items ?? []) as unknown as { kind: string; amount: number; products: { slug: string; name: string } | null }[])
      .map((i) => ({ kind: i.kind, amount: Number(i.amount), slug: i.products?.slug, name: i.products?.name })),
  });
  const sig = createHmac("sha256", salesWebhookSecret(o.store_id)).update(body).digest("hex");
  await fetch(store.sales_webhook_url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body,
    signal: AbortSignal.timeout(8000),
  });
}

/**
 * Reembolsos: parciales o totales, del pago principal o de un upsell. El
 * pedido pasa a "reembolsado" solo si se devolvió todo el pago principal.
 */
export async function applyRefund(charge: Stripe.Charge) {
  if (!charge.payment_intent) return;
  const pi = String(charge.payment_intent);
  const refunded = charge.amount_refunded / (["jpy", "krw", "clp", "vnd"].includes(charge.currency) ? 1 : 100);

  const { data: order } = await db.from("orders").select("id,status").eq("stripe_payment_intent", pi).maybeSingle();
  if (order) {
    await db.from("orders").update({
      amount_refunded: refunded,
      ...(charge.refunded ? { status: "refunded", refunded_at: new Date().toISOString() } : {}),
    }).eq("id", order.id);
    return;
  }
  // Upsell: su propio PaymentIntent, guardado en el item.
  await db.from("order_items").update({ refunded_amount: refunded }).eq("stripe_payment_intent", pi).eq("kind", "upsell");
}

/** Clave para verificar el webhook de ventas de una tienda (se le da al sistema que lo recibe). */
export function salesWebhookSecret(storeId: string) {
  return createHmac("sha256", process.env.SECRETS_KEY ?? "").update(`sales-webhook:${storeId}`).digest("hex");
}
