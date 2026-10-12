import { db } from "./db";
import { decrypt, sha256 } from "./secrets";
import { isTestStore } from "./test-store";

/**
 * Meta: pixel en el navegador + API de Conversiones desde el servidor.
 *
 * Los dos mandan la misma compra con el mismo event_id (el id del
 * PaymentIntent), así Meta la cuenta una sola vez y no se pierden las que el
 * navegador bloquea (iOS, bloqueadores, el comprador que cierra la pestaña).
 *
 * Un pixel por oferta: cada checkout carga los pixels de la tienda marcados
 * «para todos» más los propios del embudo. Nunca los de otras ofertas, que es
 * el problema de la plataforma anterior (carga todos y ensucia la optimización).
 */

const GRAPH = "https://graph.facebook.com/v23.0";

export type PixelRow = { id: string; pixel_id: string; capi_token_enc: string | null; test_event_code: string | null };

export async function pixelsFor(storeId: string, funnelPixelIds: string[] | null | undefined): Promise<PixelRow[]> {
  const { data } = await db
    .from("pixels")
    .select("id,pixel_id,capi_token_enc,test_event_code,all_funnels")
    .eq("store_id", storeId);
  const own = new Set(funnelPixelIds ?? []);
  const rows = (data ?? []).filter((p) => p.all_funnels || own.has(p.id));
  // Un mismo pixel una sola vez aunque esté marcado de las dos formas.
  return [...new Map(rows.map((p) => [p.pixel_id, p])).values()];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const h = (s: string | null | undefined) => (norm(s) ? sha256(norm(s)) : undefined);

type Tracking = { fbp?: string; fbc?: string; ip?: string; ua?: string; url?: string };

type PurchaseInput = {
  storeId: string;
  funnelPixelIds: string[] | null | undefined;
  eventId: string;
  eventTime: Date;
  value: number;
  currency: string;
  contentIds: string[];
  orderId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  country: string | null;
  tracking: Tracking;
};

function userData(i: PurchaseInput) {
  const [fn, ...ln] = norm(i.name).split(/\s+/);
  const ud: Record<string, unknown> = {
    em: h(i.email),
    ph: i.phone ? sha256(i.phone.replace(/\D/g, "")) : undefined,
    fn: fn ? sha256(fn) : undefined,
    ln: ln.length ? sha256(ln.join(" ")) : undefined,
    country: h(i.country),
    external_id: h(i.email),
    client_ip_address: i.tracking.ip,
    client_user_agent: i.tracking.ua,
    fbp: i.tracking.fbp,
    fbc: i.tracking.fbc,
  };
  return Object.fromEntries(Object.entries(ud).filter(([, v]) => v));
}

/** Manda una compra por la API de Conversiones a cada pixel con token. Devuelve cuántos aceptaron. */
export async function sendPurchase(i: PurchaseInput): Promise<{ sent: number; total: number; errors: string[] }> {
  // Tienda de prueba (llaves de test de Stripe): nada le llega a Meta.
  if (await isTestStore(i.storeId)) return { sent: 0, total: 0, errors: [] };
  const pixels = await pixelsFor(i.storeId, i.funnelPixelIds);
  const errors: string[] = [];
  let sent = 0;
  let total = 0;
  for (const p of pixels) {
    const token = p.capi_token_enc ? decrypt(p.capi_token_enc) : process.env.META_CAPI_TOKEN;
    if (!token) continue;
    total++;
    const body = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(i.eventTime.getTime() / 1000),
        event_id: i.eventId,
        action_source: "website",
        event_source_url: i.tracking.url,
        user_data: userData(i),
        custom_data: {
          currency: i.currency.toUpperCase(),
          value: Number(i.value.toFixed(2)),
          content_ids: i.contentIds,
          content_type: "product",
          order_id: i.orderId,
        },
      }],
      ...(p.test_event_code ? { test_event_code: p.test_event_code } : {}),
    };
    try {
      const res = await fetch(`${GRAPH}/${p.pixel_id}/events?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { events_received?: number; error?: { message: string } };
      if (j.events_received) sent++;
      else errors.push(`${p.pixel_id}: ${j.error?.message ?? res.status}`);
    } catch (e) {
      errors.push(`${p.pixel_id}: ${(e as Error).message}`);
    }
  }
  if (errors.length) console.warn("[capi]", errors.join(" | "));
  return { sent, total, errors };
}

/**
 * InitiateCheckout por la API de Conversiones al abrir el checkout, con el
 * mismo event_id que el pixel del navegador (ic_{checkout}): Meta cuenta uno
 * solo, y llega aunque el navegador bloquee el pixel. Nunca tira error.
 */
export async function sendInitiateCheckout(i: {
  storeId: string; funnelPixelIds?: string[] | null; eventId: string; tracking: Tracking;
  value: number | null; currency: string | null; contentIds: string[];
}) {
  const pixels = await pixelsFor(i.storeId, i.funnelPixelIds).catch(() => [] as PixelRow[]);
  const user_data = Object.fromEntries(Object.entries({
    client_ip_address: i.tracking.ip, client_user_agent: i.tracking.ua, fbp: i.tracking.fbp, fbc: i.tracking.fbc,
  }).filter(([, v]) => v));
  await Promise.all(pixels.map(async (p) => {
    const token = p.capi_token_enc ? decrypt(p.capi_token_enc) : process.env.META_CAPI_TOKEN;
    if (!token) return;
    const body = {
      data: [{
        event_name: "InitiateCheckout",
        event_time: Math.floor(Date.now() / 1000),
        event_id: i.eventId,
        action_source: "website",
        event_source_url: i.tracking.url,
        user_data,
        custom_data: {
          content_ids: i.contentIds, content_type: "product",
          ...(i.value != null && i.currency ? { value: Number(i.value.toFixed(2)), currency: i.currency.toUpperCase() } : {}),
        },
      }],
      ...(p.test_event_code ? { test_event_code: p.test_event_code } : {}),
    };
    await fetch(`${GRAPH}/${p.pixel_id}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => r.json()).then((j: { events_received?: number; error?: { message: string } }) => {
      if (!j.events_received) console.warn("[capi ic]", p.pixel_id, j.error?.message);
    }).catch((e) => console.warn("[capi ic]", p.pixel_id, (e as Error).message));
  }));
}

/** La compra principal de un pedido. Una sola vez por pedido (capi_sent_at). */
export async function sendOrderPurchase(orderId: string) {
  const { data: o } = await db
    .from("orders")
    .select("id,store_id,funnel_id,stripe_payment_intent,email,phone,name,country,currency,amount_total,tracking,created_at,capi_sent_at,status,funnels(pixel_ids),order_items(kind,products(slug))")
    .eq("id", orderId)
    .single();
  if (!o || o.capi_sent_at || o.status !== "paid" || !o.stripe_payment_intent) return;
  const items = (o.order_items ?? []) as unknown as { kind: string; products: { slug: string } | null }[];
  const r = await sendPurchase({
    storeId: o.store_id,
    funnelPixelIds: (o.funnels as unknown as { pixel_ids?: string[] } | null)?.pixel_ids,
    eventId: o.stripe_payment_intent,
    eventTime: new Date(o.created_at),
    value: Number(o.amount_total ?? 0),
    currency: o.currency ?? "USD",
    contentIds: items.filter((x) => x.kind === "main" || x.kind === "bump").map((x) => x.products?.slug).filter((s): s is string => !!s),
    orderId: o.id,
    email: o.email, phone: o.phone, name: o.name, country: o.country,
    tracking: (o.tracking ?? {}) as Tracking,
  });
  if (r.total && r.sent === r.total) await db.from("orders").update({ capi_sent_at: new Date().toISOString() }).eq("id", o.id);
}

/** Lo que el navegador manda al abrir el checkout, para pasarlo al pedido. */
export function trackingFrom(req: Request, body: { fbp?: unknown; fbc?: unknown; url?: unknown }): Tracking {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || undefined;
  const s = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
  return {
    fbp: s(body.fbp, 120),
    fbc: s(body.fbc, 300),
    ip,
    ua: req.headers.get("user-agent")?.slice(0, 400) ?? undefined,
    url: s(body.url, 500),
  };
}
