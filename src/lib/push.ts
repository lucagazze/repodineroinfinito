import webpush from "web-push";
import { after } from "next/server";
import { db } from "./db";
import { HAS_STRIPE } from "./real-sale";
import { flag } from "./admin-data";
import { orderRef } from "./order-ref";
import { stepTags } from "./postpurchase";

/**
 * Notificaciones push del panel (Web Push con VAPID): a cada dispositivo
 * donde se tocó «Activar notificaciones» (tabla push_subscriptions).
 *
 * Nunca tira error ni frena a quien la llama: una notificación que no sale
 * no puede trabar una venta, un webhook ni un aviso.
 */

/**
 * «names» no es un tipo de aviso: es la opción de ver el nombre de la oferta en vez de solo «Panel».
 * mail = mail nuevo de un comprador · refund = pide reembolso o amenaza con contracargo · dispute =
 * contracargo en Stripe · delivery = no salió la entrega · oto = fallan los cobros de upsells ·
 * unpaid = pedido sin pago en Stripe · ai_reply = la IA respondió sola · bid = el piloto cambió una puja ·
 * meta_auto = el Piloto Meta Ads apagó una CBO, propone un ganador o creó una BID CAP (llega siempre) ·
 * alert = el resto de los errores.
 */
export type PushKind = "sale" | "alert" | "names" | "mail" | "refund" | "dispute" | "delivery" | "oto" | "unpaid" | "ai_reply" | "checkout_down" | "bid" | "meta_auto";
/** Avisos que llegan a TODOS los dispositivos, sin importar qué tipos eligió cada uno. */
const ALWAYS: PushKind[] = ["checkout_down", "meta_auto"];
export type PushMsg = {
  title: string; body?: string; url?: string; tag?: string; named?: { title: string; body?: string };
  /** Botones (Chrome, Android, escritorio; el iPhone no los muestra): cada uno abre su url. */
  actions?: { action: string; title: string; url: string }[];
};

// Mismo link que orderLink (alerts.ts): la página resuelve la oferta del pedido.
const orderUrl = (id: string) => `/admin/avisos/pedido/${id}`;

let ready: boolean | null = null;
function setup() {
  if (ready !== null) return ready;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn("[push] faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
    return (ready = false);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  return (ready = true);
}

/** Lo que entra en una línea de la notificación del iPhone (cuerpo) y en el título (iOS corta el resto con «…»). */
export const PUSH_BODY_MAX = 40;
export const PUSH_TITLE_MAX = 38;
export function oneLine(s: string, n: number) {
  const t = s.replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/**
 * A todos los dispositivos que reciben ese tipo (o a uno solo, con `endpoint`:
 * el botón «Probar»). Los que el servicio da por muertos (404/410) se borran.
 */
export async function sendPush(kind: PushKind, msg: PushMsg, opts: { endpoint?: string } = {}) {
  const res = { sent: 0, failed: 0, removed: 0, error: null as string | null };
  try {
    if (!setup()) return { ...res, error: "faltan las claves VAPID" };
    const q = db.from("push_subscriptions").select("id,endpoint,p256dh,auth,fail_count,kinds");
    // Pruebas locales: PUSH_TEST_ONLY_ENDPOINT manda solo a esa suscripción (nunca a los celulares reales).
    const only = process.env.PUSH_TEST_ONLY_ENDPOINT?.trim();
    const { data: subs, error } = await (only ? q.eq("endpoint", only).contains("kinds", [kind])
      : opts.endpoint ? q.eq("endpoint", opts.endpoint) : ALWAYS.includes(kind) ? q : q.contains("kinds", [kind]));
    if (error) throw new Error(error.message);
    // Máximo 3 líneas en el iPhone: título, «from Panel» (lo pone iOS) y el texto
    // en UNA línea. Todo lo que manda la app pasa por acá: sin saltos y cortado con «…» si no entra.
    const fit = (m: { title: string; body?: string }) => ({ title: oneLine(m.title, PUSH_TITLE_MAX), body: m.body ? oneLine(m.body, PUSH_BODY_MAX) : undefined });
    const { named: rawNamed, ...rawPlain } = msg;
    const plain = { ...rawPlain, ...fit(rawPlain) };
    const named = rawNamed ? fit(rawNamed) : undefined;
    await Promise.all((subs ?? []).map(async (s) => {
      // Por defecto sin nombres (solo «Panel»); con la opción «names», el de la oferta.
      const withNames = !!named && ((s.kinds ?? []) as string[]).includes("names");
      const payload = JSON.stringify({ ...plain, ...(withNames ? named : {}), kind });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          // urgency high: Android e iOS la entregan al toque aunque el celular esté en reposo.
          { TTL: 24 * 3600, urgency: "high", timeout: 8000 },
        );
        res.sent++;
        await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Se desinstaló la app o se revocó el permiso: ese dispositivo ya no existe.
          res.removed++;
          await db.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          res.failed++;
          res.error = `${code ?? ""} ${(e as Error).message}`.trim().slice(0, 300);
          console.warn("[push]", res.error);
          await db.from("push_subscriptions").update({ fail_count: (s.fail_count ?? 0) + 1 }).eq("id", s.id);
        }
      }
    }));
  } catch (e) {
    res.error = (e as Error).message;
    console.warn("[push]", res.error);
  }
  return res;
}

/** Sin esperar: después de responder (after) y, fuera de un pedido HTTP, en segundo plano. */
export function later(task: () => Promise<unknown>) {
  const run = () => task().then(() => undefined, (e) => console.warn("[push]", (e as Error)?.message));
  try {
    after(run);
  } catch {
    void run();
  }
}

export const queuePush = (kind: PushKind, msg: PushMsg) => later(() => sendPush(kind, msg));

type OrderInfo = {
  id: string; number: number | null; amount_total: number | null; currency: string | null; country: string | null; status: string;
  pp_funnel_id: string | null; is_test: boolean | null;
  funnels: { name: string | null; offers: { name: string | null } | null } | null;
};
const offerName = (o: OrderInfo) => o.funnels?.offers?.name || o.funnels?.name || "";
const ORDER_COLS = "id,number,amount_total,currency,country,status,pp_funnel_id,is_test,funnels(name,offers(name))";

/** «USD 36,90», «GBP 17»: el código y el monto, como en el aviso de la plataforma anterior. */
export function codeMoney(n: number | string | null | undefined, currency: string | null | undefined) {
  const v = Number(n ?? 0);
  const d = Math.abs(v - Math.round(v)) < 0.005 ? 0 : 2;
  return `${(currency || "USD").toUpperCase()} ${v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/**
 * «Pedido #1001» · «USD 36,90 · 2 bumps», una sola vez por pedido: webhook,
 * página de gracias y reintentos pueden llegar juntos, avisa solo el que marca
 * sale_pushed_at. Solo pedidos pagados (nunca los de prueba ni los pendientes).
 * Con la opción «names»: la oferta y la bandera al final.
 */
export async function pushSaleOnce(orderId: string, bumps: number) {
  const { data: won, error } = await db.from("orders")
    .update({ sale_pushed_at: new Date().toISOString() })
    .eq("id", orderId).eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).is("sale_pushed_at", null)
    .select("id");
  if (error) throw new Error(`push venta: ${error.message}`);
  if (!won?.length) return null;
  const msg = await saleMessage(orderId, bumps);
  return msg ? sendPush("sale", msg) : null;
}

/** El texto del push de venta, sin mandarlo (también para probarlo). */
export async function saleMessage(orderId: string, bumps: number): Promise<PushMsg | null> {
  const { data } = await db.from("orders").select(ORDER_COLS).eq("id", orderId).single();
  const o = data as unknown as OrderInfo | null;
  if (!o) return null;
  const title = `Pedido ${orderRef(o)}`;
  const body = `${codeMoney(o.amount_total, o.currency)} · ${bumps ? `${bumps} bump${bumps > 1 ? "s" : ""}` : "sin bumps"}`;
  const who = [offerName(o), o.country ? flag(o.country) : ""].filter(Boolean).join(" ");
  return {
    title, body,
    named: { title, body: [body, who].filter(Boolean).join(" · ") },
    url: orderUrl(orderId),
    tag: `sale:${orderId}`,
  };
}

/**
 * Un solo aviso por pedido, con el total: «Pedido #1020» ·
 * «Total EUR 49,80 · 1 post-compra (OTO1) · sin bumps». Sale cuando el comprador termina el post-pago (llega a la
 * página de gracias) o, si cerró antes, a los SALE_PUSH_DELAY_MIN de pagar (cron «avisar-pedidos»,
 * cada minuto). Una vez por pedido: lo marca sale_pushed_at. Un OTO cobrado después de este aviso
 * manda el suyo (pushUpsell).
 */
export const SALE_PUSH_DELAY_MIN = 10;

/** Al cobrar el pago principal: agenda el aviso (no lo manda todavía). */
export async function scheduleSalePush(orderId: string) {
  await db.from("orders").update({ sale_push_due_at: new Date(Date.now() + SALE_PUSH_DELAY_MIN * 60_000).toISOString() })
    .eq("id", orderId).is("sale_push_due_at", null).is("sale_pushed_at", null);
}

export async function pushOrderSummaryOnce(orderId: string) {
  const { data: won, error } = await db.from("orders")
    .update({ sale_pushed_at: new Date().toISOString() })
    .eq("id", orderId).eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).is("sale_pushed_at", null)
    .select("id");
  if (error) throw new Error(`push pedido: ${error.message}`);
  if (!won?.length) return null;
  const msg = await orderSummaryMessage(orderId);
  return msg ? sendPush("sale", msg) : null;
}

/** El texto del aviso único del pedido, sin mandarlo (también para probarlo). */
export async function orderSummaryMessage(orderId: string): Promise<PushMsg | null> {
  const [{ data }, { data: items }] = await Promise.all([
    db.from("orders").select(ORDER_COLS).eq("id", orderId).single(),
    db.from("order_items").select("product_id,kind,amount,created_at").eq("order_id", orderId).in("kind", ["bump", "upsell"]).order("created_at"),
  ]);
  const o = data as unknown as OrderInfo | null;
  if (!o || o.status === "test" || o.is_test) return null;
  const its = items ?? [];
  const bumps = its.filter((i) => i.kind === "bump").length;
  const ups = its.filter((i) => i.kind === "upsell");
  const tags = ups.length ? await stepTags(o.pp_funnel_id) : new Map<string, string>();
  const total = Number(o.amount_total ?? 0) + ups.reduce((a, i) => a + Number(i.amount ?? 0), 0);
  // El total abajo, primero (como el aviso de la plataforma anterior): «Pedido #1026» / «Total USD 27 · sin post-compra · sin bumps».
  const title = `Pedido ${orderRef(o)}`;
  // Una línea: «Total EUR 62,70 · OTO1+DS2 · 4 bumps» / «Total USD 27 · sin OTO · sin bumps».
  const body = [
    codeMoney(total, o.currency),
    ups.length ? ups.map((i) => (tags.get(i.product_id ?? "") ?? "OTO").replace(" ", "")).join("+") : "sin OTO",
    bumps ? `${bumps} bump${bumps > 1 ? "s" : ""}` : "sin bumps",
  ].join(" · ");
  const who = [offerName(o), o.country ? flag(o.country) : ""].filter(Boolean).join(" ");
  return { title, body, named: { title, body: [body, who].filter(Boolean).join(" · ") }, url: orderUrl(orderId), tag: `sale:${orderId}` };
}

/**
 * Cada OTO o downsell cobrado (recordUpsell ya garantiza uno por PaymentIntent):
 * «Upsell aceptado #1001 · OTO 1» · «EUR 12,90 (post-compra) · total EUR 48,60».
 * El total es el del pedido hasta ahora (principal, bumps y todo lo cobrado
 * después). Si ya tomó más de uno, el resumen: «… · OTO1 ✓ · DS2 ✓ · total …».
 * Con la opción «names»: el nombre corto del producto al final.
 */
export async function pushUpsell(orderId: string, u: UpsellPush) {
  const msg = await upsellMessage(orderId, u);
  return msg ? sendPush("sale", msg) : null;
}

type UpsellPush = { amount: number; currency: string; productId: string | null; paymentIntent: string };

/** El texto del push de un OTO/downsell, sin mandarlo (también para probarlo). */
export async function upsellMessage(orderId: string, u: UpsellPush): Promise<PushMsg | null> {
  const [{ data }, { data: prod }, { data: ups }] = await Promise.all([
    db.from("orders").select(ORDER_COLS).eq("id", orderId).maybeSingle(),
    u.productId ? db.from("products").select("name,short_name").eq("id", u.productId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("order_items").select("product_id,amount,stripe_payment_intent,created_at").eq("order_id", orderId).eq("kind", "upsell").order("created_at"),
  ]);
  const o = data as unknown as OrderInfo | null;
  // Ni las compras de prueba del panel ni las de una tienda de prueba (llaves de test).
  if (!o || o.status === "test" || o.is_test) return null;
  const tags = await stepTags(o.pp_funnel_id);
  const tag = (pid: string | null) => tags.get(pid ?? "") ?? "OTO";
  const taken = (ups ?? []).map((i) => ({ tag: tag(i.product_id), amount: Number(i.amount), pi: i.stripe_payment_intent as string | null }));
  // Por si el item todavía no se ve (no debería: se inserta antes del push).
  if (!taken.some((i) => i.pi === u.paymentIntent)) taken.push({ tag: tag(u.productId), amount: Number(u.amount), pi: u.paymentIntent });
  const name = (prod as { name?: string; short_name?: string | null } | null);
  return {
    ...upsellText({ ref: orderRef(o), tag: tag(u.productId), amount: u.amount, currency: u.currency, base: Number(o.amount_total ?? 0), orderCurrency: o.currency, taken, product: name?.short_name || name?.name || null }),
    url: orderUrl(orderId),
    tag: `upsell:${u.paymentIntent}`,
  };
}

/**
 * Solo el texto (sin base), como el de referencia pero diciendo cuál tomó:
 * «Upsell aceptado #1001 · OTO 1» · «EUR 12,90 (post-compra) · total EUR 48,60»;
 * un downsell: «Downsell aceptado #1001 · DS 2».
 */
export function upsellText(a: {
  ref: string; tag: string; amount: number; currency: string; base: number; orderCurrency: string | null;
  /** Todo lo cobrado después de pagar, en orden, incluido este. */
  taken: { tag: string; amount: number }[]; product: string | null;
}) {
  // Igual que la plataforma anterior: «Upsell aceptado #1026» y abajo «US$ 6,79 (post-compra)». Sin total.
  const title = `Upsell aceptado ${a.ref}`;
  const amount = new Intl.NumberFormat("es-AR", { style: "currency", currency: (a.currency || "USD").toUpperCase() }).format(a.amount).replace(/ /g, " ");
  const body = `${amount} (post-compra)`;
  return { title, body, named: { title, body: [body, a.product].filter(Boolean).join(" · ") } };
}
