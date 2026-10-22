import type Stripe from "stripe";
import { withBrand } from "./brand";
import { stripeForStore } from "./stripe";
import { db, getProductById, STORE_COLS, type Store } from "./db";
import { sendDelivery } from "./email";
import { DEFAULT_LOCALE, type Locale } from "./i18n";
import { fromMinor } from "./fx";
import { logUpsellEvent } from "./upsell-events";
import { sendPurchase } from "./meta";
import { later, pushUpsell } from "./push";
import { orderRef } from "./order-ref";

/**
 * ¿Se le puede cobrar una oferta post-compra a este pedido? Los pagados; y los
 * de prueba (status 'test') solo si la tienda cobra con una llave de TEST de
 * Stripe, para probar el cobro sin plata real y sin que aparezcan en ventas.
 */
export function orderChargeable(status: string | null | undefined, livemode: boolean) {
  return status === "paid" || (status === "test" && !livemode);
}

/**
 * Registra el upsell a partir del PaymentIntent, no de lo que diga el
 * navegador: el importe y el producto salen de la metadata que puso el
 * servidor al crearlo. Idempotente por PaymentIntent.
 */
export async function recordUpsell(
  orderId: string,
  paymentIntent: string | Stripe.PaymentIntent,
  opts: {
    stripe?: Stripe;
    /** Para mandar el email después de responder (next/server `after`). */
    defer?: (task: () => Promise<void>) => void;
  } = {}
) {
  const defer = opts.defer ?? ((t) => void t());
  // Si ya tenemos el PaymentIntent recién creado, no se lo volvemos a pedir
  // a Stripe: son cientos de milisegundos que el comprador espera mirando.
  let intent: Stripe.PaymentIntent;
  if (typeof paymentIntent === "string") {
    let stripe = opts.stripe;
    if (!stripe) {
      const { data: o } = await db.from("orders").select("store_id").eq("id", orderId).maybeSingle();
      if (!o) return false;
      stripe = (await stripeForStore(o.store_id)).stripe;
    }
    intent = await stripe.paymentIntents.retrieve(paymentIntent);
  } else intent = paymentIntent;
  if (intent.status !== "succeeded") return false;
  if (intent.metadata?.order !== orderId || intent.metadata?.kind !== "upsell") return false;

  const { data: dup } = await db
    .from("order_items")
    .select("id")
    .eq("stripe_payment_intent", intent.id)
    .maybeSingle();
  if (dup) return true;

  const { data: order } = await db
    .from("orders")
    .select("number,status,store_id,funnel_id,email,name,phone,country,locale,tracking,funnels(pixel_ids)")
    .eq("id", orderId)
    .single();
  const { data: prod } = await db
    .from("products")
    .select("id")
    .eq("store_id", order!.store_id)
    .eq("slug", intent.metadata.product)
    .maybeSingle();

  const { error: insErr } = await db.from("order_items").insert({
    order_id: orderId,
    product_id: prod?.id ?? null,
    kind: "upsell",
    amount: fromMinor(intent.amount_received, intent.currency),
    currency: intent.currency.toUpperCase(),
    stripe_payment_intent: intent.id,
  });
  // Otro camino (la página, /confirm o el webhook) lo registró al mismo
  // tiempo: el índice único lo frenó. Ese ya manda el email: acá no se repite.
  if (insErr?.code === "23505") return true;
  if (insErr) console.error("[upsell] order_items:", insErr.message);
  // Compra desde la biblioteca de un libro de otra oferta: sus regalos (bonus del checkout) van al pedido, sin cobrar.
  const bonusIds = intent.metadata?.source === "biblioteca" && !insErr ? (intent.metadata.bonus ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : [];
  const { data: bonusProds } = bonusIds.length
    ? await db.from("products").select("id").eq("store_id", order!.store_id).in("id", bonusIds)
    : { data: [] as { id: string }[] };
  if (bonusProds?.length) {
    const { error } = await db.from("order_items").insert(bonusProds.map((b) => ({
      order_id: orderId, product_id: b.id, kind: "bonus", amount: 0, currency: intent.currency.toUpperCase(),
    })));
    if (error) console.error("[upsell] regalos:", error.message);
  }
  // Push «Upsell» al panel, solo si este intento fue el que lo registró.
  if (!insErr) later(() => pushUpsell(orderId, {
    amount: fromMinor(intent.amount_received, intent.currency), currency: intent.currency,
    productId: prod?.id ?? null, paymentIntent: intent.id,
  }));

  if (prod?.id) {
    const { data: o } = await db.from("orders").select("pp_funnel_id").eq("id", orderId).single();
    await logUpsellEvent({ storeId: order!.store_id, orderId, ppFunnelId: o?.pp_funnel_id ?? null, productId: prod.id, event: "accept" });
  }

  // El email de entrega del pago principal ya salió: sin este, lo que compró
  // con 1 clic solo existiría en la página de gracias.
  if (prod?.id && order?.email) defer(async () => {
    const product = await getProductById(prod.id);
    if (!product) return;
    const { data: store } = await db.from("stores").select(STORE_COLS).eq("id", order.store_id).single();
    try {
      const sent = await sendDelivery({
        to: order.email!,
        name: order.name,
        store: withBrand(store as unknown as Store, (order.locale as string | null) ?? null),
        locale: (order.locale as Locale) ?? DEFAULT_LOCALE,
        main: product,
        extras: (await Promise.all((bonusProds ?? []).map((b) => getProductById(b.id)))).filter((p): p is NonNullable<typeof p> => !!p),
        currency: intent.currency.toUpperCase(),
        orderRef: orderRef({ id: orderId, number: order.number, status: order.status }),
        total: fromMinor(intent.amount_received, intent.currency),
        orderId,
        kind: "upsell",
      });
      console.log("[upsell] email de entrega:", "skipped" in sent ? "SIN PROVEEDOR" : sent.messageId, product.slug);
    } catch (e) {
      // El cobro ya está hecho y registrado; el fallo queda en email_log y el
      // panel permite reenviarlo.
      console.error("[upsell] email de entrega falló:", e);
    }
    // El upsell es otra compra para Meta, con su propio event_id.
    await sendPurchase({
      storeId: order.store_id,
      funnelPixelIds: (order.funnels as unknown as { pixel_ids?: string[] } | null)?.pixel_ids,
      eventId: intent.id,
      eventTime: new Date(intent.created * 1000),
      value: fromMinor(intent.amount_received, intent.currency),
      currency: intent.currency,
      contentIds: [product.slug],
      orderId,
      email: order.email, phone: order.phone, name: order.name, country: order.country,
      tracking: (order.tracking ?? {}) as Record<string, string>,
    }).catch((e) => console.warn("[upsell] capi:", e.message));
  });
  return true;
}

/**
 * El mismo upsell, pero cobrado con Whop.
 *
 * Vive aparte de `recordUpsell` en vez de generalizarla porque las dos mitades
 * NO son simétricas y mezclarlas escondería la diferencia que importa:
 *
 *   Stripe  el cobro se confirma en la misma llamada; el navegador ya sabe si
 *           entró y la página puede mostrar el resultado.
 *   Whop    `payments.create` contesta con el pago ABIERTO. Lo que entra lo
 *           dice el webhook `payment.succeeded`, nunca la respuesta. Por eso
 *           esta función la llama el webhook y no la ruta del botón.
 *
 * El importe sale del pago de Whop, no de lo que pidió el navegador. Es
 * idempotente por pago: `order_items.stripe_payment_intent` guarda el id con
 * el prefijo `whop:`, igual que la compra principal, y el índice único frena
 * el segundo intento cuando Whop reintenta el webhook.
 */
export async function registrarUpsellWhop(
  orderId: string,
  pago: { id: string; metadata?: Record<string, string> | null },
  cobrado: { amount: number; currency: string; at: Date },
  opts: { defer?: (task: () => Promise<void>) => void } = {},
): Promise<boolean> {
  const defer = opts.defer ?? ((t) => void t());
  const slug = pago.metadata?.product;
  if (!slug) return false;
  const pagoRef = `whop:${pago.id}`;

  const { data: dup } = await db
    .from("order_items").select("id").eq("stripe_payment_intent", pagoRef).maybeSingle();
  if (dup) return true;

  const { data: order } = await db
    .from("orders")
    .select("number,status,store_id,funnel_id,pp_funnel_id,email,name,phone,country,locale,tracking,funnels(pixel_ids)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return false;

  const { data: prod } = await db
    .from("products").select("id")
    .eq("store_id", order.store_id).eq("slug", slug).maybeSingle();

  const divisa = cobrado.currency.toUpperCase();
  const { error: insErr } = await db.from("order_items").insert({
    order_id: orderId,
    product_id: prod?.id ?? null,
    kind: "upsell",
    amount: cobrado.amount,
    currency: divisa,
    stripe_payment_intent: pagoRef,
  });
  // 23505: lo registró otro reintento del webhook al mismo tiempo. Ese manda
  // el email; acá se sale sin repetirlo.
  if (insErr?.code === "23505") return true;
  if (insErr) { console.error("[upsell whop] order_items:", insErr.message); return false; }

  later(() => pushUpsell(orderId, {
    amount: cobrado.amount, currency: divisa.toLowerCase(),
    productId: prod?.id ?? null, paymentIntent: pagoRef,
  }));
  if (prod?.id) {
    await logUpsellEvent({
      storeId: order.store_id, orderId, ppFunnelId: order.pp_funnel_id ?? null,
      productId: prod.id, event: "accept",
    });
  }

  // El mail del pago principal ya salió: sin este, lo que compró con un clic
  // solo existiría en la página de gracias.
  if (prod?.id && order.email) defer(async () => {
    const product = await getProductById(prod.id);
    if (!product) return;
    const { data: store } = await db.from("stores").select(STORE_COLS).eq("id", order.store_id).single();
    try {
      const sent = await sendDelivery({
        to: order.email!,
        name: order.name,
        store: withBrand(store as unknown as Store, (order.locale as string | null) ?? null),
        locale: (order.locale as Locale) ?? DEFAULT_LOCALE,
        main: product,
        extras: [],
        currency: divisa,
        orderRef: orderRef({ id: orderId, number: order.number, status: order.status }),
        total: cobrado.amount,
        orderId,
        kind: "upsell",
      });
      console.log("[upsell whop] email:", "skipped" in sent ? "SIN PROVEEDOR" : sent.messageId, product.slug);
    } catch (e) {
      console.error("[upsell whop] email de entrega falló:", e);
    }
    // Para Meta es otra compra, con su propio event_id (el id del pago de Whop).
    await sendPurchase({
      storeId: order.store_id,
      funnelPixelIds: (order.funnels as unknown as { pixel_ids?: string[] } | null)?.pixel_ids,
      eventId: pagoRef,
      eventTime: cobrado.at,
      value: cobrado.amount,
      currency: divisa,
      contentIds: [product.slug],
      orderId,
      email: order.email, phone: order.phone, name: order.name, country: order.country,
      tracking: (order.tracking ?? {}) as Record<string, string>,
    }).catch((e) => console.warn("[upsell whop] capi:", (e as Error).message));
  });

  return true;
}
