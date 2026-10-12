import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseUA, maskIp, cityOf } from "@/lib/visitor-info";
import { botReason } from "@/lib/bots";
import { PANEL_TZ } from "@/lib/admin/range";
import { dayOf, startOfDay } from "@/lib/admin/tz";
import { isTestStore } from "@/lib/test-store";

export const runtime = "nodejs";

/**
 * Registro de eventos de las páginas públicas (landing, checkout, pos-pago,
 * gracias) en site_events (migración 015). Lo llaman public/t.js y
 * src/lib/track-client.ts con sendBeacon: responde 204 al instante y escribe
 * después (after), así nunca frena una página. Nunca devuelve un 500.
 */

const PAGES = ["landing", "checkout", "oferta", "gracias"] as const;
const EVENTS = [
  "view", "heartbeat", "leave", "lead", "pay_attempt", "pay_error", "paid",
  "oto_accept", "oto_decline", "download", "cta_click",
] as const;

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const Body = z.object({
  page: z.enum(PAGES),
  event: z.enum(EVENTS),
  vid: z.string().regex(ID).nullish(),
  sid: z.string().regex(ID).nullish(),
  /** Una por carga de página: la presencia se cuenta por esta, no por pestaña. */
  pv: z.string().regex(ID).nullish(),
  store: z.string().regex(SLUG).nullish(),
  funnel: z.string().regex(SLUG).nullish(),
  order: z.string().regex(UUID).nullish(),
  path: z.string().max(300).nullish(),
  ref: z.string().max(500).nullish(),
  utm: z.record(z.string().max(40), z.string().max(200)).nullish(),
  data: z.record(z.string().max(40), z.unknown()).nullish(),
  /** navigator.webdriver: el navegador lo maneja un programa (Playwright, Selenium…). */
  wd: z.union([z.literal(1), z.boolean()]).nullish(),
});
type Ev = z.infer<typeof Body>;

const MAX = 2048;

// ------------------------------------------------------------ límite por IP

/** Balde de fichas por IP: 40 de golpe y 1 cada 2 s (una pestaña manda ~3 por minuto). */
const CAP = 40;
const REFILL_MS = 2000;
const buckets = new Map<string, { t: number; at: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { t: CAP, at: now };
  b.t = Math.min(CAP, b.t + (now - b.at) / REFILL_MS);
  b.at = now;
  if (b.t < 1) return false;
  b.t -= 1;
  buckets.set(ip, b);
  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) if (now - v.at > 120_000) buckets.delete(k);
  }
  return true;
}

// ------------------------------------------------------ origen permitido

const hostOf = (u: string | null | undefined) => {
  if (!u) return "";
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).host.toLowerCase(); } catch { return ""; }
};

/** Mismo origen (landings y checkouts los sirve esta app) o un host propio de la app. */
function originOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const o = hostOf(origin);
  if (!o) return false;
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host"), process.env.NEXT_PUBLIC_SITE_URL, process.env.PUBLIC_BASE_URL, process.env.PANEL_HOST]
    .map(hostOf).filter(Boolean);
  if (own.includes(o)) return true;
  const bare = o.replace(/:\d+$/, "");
  return bare === "localhost" || bare === "127.0.0.1" || bare.endsWith(".vercel.app");
}

// ------------------------------------------------- slugs e ids (con caché)

type Ids = { store_id: string | null; funnel_id: string | null };
const TTL = 5 * 60_000;
type SlugMap = { at: number; stores: Map<string, string>; funnels: Map<string, Ids> };
let slugs: SlugMap | null = null;
let loading: Promise<SlugMap> | null = null;

/** Todas las tiendas y checkouts en una consulta, cada 5 minutos. */
async function slugMap(): Promise<SlugMap> {
  if (slugs && Date.now() - slugs.at < TTL) return slugs;
  loading ??= (async () => {
    const [{ data: st }, { data: fu }] = await Promise.all([
      db.from("stores").select("id,slug"),
      db.from("funnels").select("id,slug,store_id"),
    ]);
    const stores = new Map((st ?? []).map((s) => [s.slug as string, s.id as string]));
    const bySlug = new Map((st ?? []).map((s) => [s.id as string, s.slug as string]));
    const funnels = new Map<string, Ids>();
    for (const f of fu ?? []) funnels.set(`${bySlug.get(f.store_id)}/${f.slug}`, { store_id: f.store_id, funnel_id: f.id });
    // Si la base falla se sigue con el mapa anterior (o vacío) y se reintenta en 30 s.
    if (!st || !fu) return (slugs = { at: Date.now() - TTL + 30_000, stores: slugs?.stores ?? stores, funnels: slugs?.funnels ?? funnels });
    return (slugs = { at: Date.now(), stores, funnels });
  })().finally(() => { loading = null; });
  return loading;
}

/** Tienda y checkout de un pedido (pos-pago y gracias mandan solo el pedido). */
const orders = new Map<string, { at: number; ids: Ids | null }>();
async function orderIds(id: string): Promise<Ids | null> {
  const hit = orders.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.ids;
  const { data, error } = await db.from("orders").select("store_id,funnel_id").eq("id", id).maybeSingle();
  if (error) return null;
  const ids = data ? { store_id: data.store_id as string | null, funnel_id: data.funnel_id as string | null } : null;
  if (orders.size > 5000) orders.clear();
  orders.set(id, { at: Date.now(), ids });
  return ids;
}

async function resolve(e: Ev) {
  let store_id: string | null = null, funnel_id: string | null = null, order_id: string | null = null;
  if (e.store) {
    const m = await slugMap();
    const f = e.funnel ? m.funnels.get(`${e.store}/${e.funnel}`) : undefined;
    store_id = f?.store_id ?? m.stores.get(e.store) ?? null;
    funnel_id = f?.funnel_id ?? null;
  }
  if (e.order) {
    const o = await orderIds(e.order);
    if (o) {
      order_id = e.order;
      store_id ??= o.store_id;
      funnel_id ??= o.funnel_id;
    }
  }
  return { store_id, funnel_id, order_id };
}

// ------------------------------------------------- visitante que vuelve

/** ¿El visitante ya tenía eventos antes de hoy (hora del panel)? Una consulta por visitante y día. */
const seen = new Map<string, { day: string; ret: boolean }>();
async function returningOf(vid: string | null | undefined): Promise<boolean | null> {
  if (!vid) return null;
  const day = dayOf(new Date(), PANEL_TZ);
  const hit = seen.get(vid);
  if (hit?.day === day) return hit.ret;
  const { data, error } = await db.from("site_events").select("id")
    .eq("visitor_id", vid).neq("event", "heartbeat").lt("at", startOfDay(day, PANEL_TZ).toISOString()).limit(1);
  if (error) return null;
  const ret = (data?.length ?? 0) > 0;
  if (seen.size > 20_000) seen.clear();
  seen.set(vid, { day, ret });
  return ret;
}

// ------------------------------------------------------------------ resto

function deviceOf(ua: string): "mobile" | "desktop" | "tablet" {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobi)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

const empty = (status = 204) => new NextResponse(null, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: NextRequest) {
  try {
    if (!originOk(req)) return empty(403);
    if (Number(req.headers.get("content-length") ?? 0) > MAX) return empty(413);
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX) return empty(413);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "?";
    if (!allow(ip)) return empty(429);

    let json: unknown;
    try { json = JSON.parse(text); } catch { return empty(400); }
    const parsed = Body.safeParse(json);
    if (!parsed.success) return empty(400);
    const e = parsed.data;

    const country = (req.headers.get("x-vercel-ip-country") ?? "").toUpperCase().slice(0, 2) || null;
    const host = hostOf(req.headers.get("x-forwarded-host") ?? req.headers.get("host")).replace(/:\d+$/, "") || null;
    const uaText = req.headers.get("user-agent") ?? "";
    const device = deviceOf(uaText);
    const ua = parseUA(uaText);
    // La IP solo se guarda enmascarada (181.45.x.x): alcanza para ver si dos visitas son la misma red.
    const ipMasked = maskIp(ip === "?" ? null : ip);
    const city = cityOf(req.headers.get("x-vercel-ip-city"));
    const region = (req.headers.get("x-vercel-ip-country-region") ?? "").slice(0, 10) || null;
    // La posición de la ciudad (para el punto en el mapa de «Ahora»), redondeada a 1 decimal (≈ 10 km): nunca la exacta.
    const coord = (h: string, lim: number) => { const n = Number(req.headers.get(h)); return Number.isFinite(n) && Math.abs(n) <= lim && req.headers.has(h) ? Math.round(n * 10) / 10 : null; };
    const lat = coord("x-vercel-ip-latitude", 90), lon = coord("x-vercel-ip-longitude", 180);
    const data = { ...(e.data ?? {}), ...(e.pv ? { pv: e.pv } : {}) };
    // No es una persona: se guarda igual (auditoría), marcado, y el panel no lo cuenta.
    const bot = botReason({ ua: uaText, ip: ip === "?" ? null : ip, smoke: req.headers.has("x-smoke"), webdriver: !!e.wd });

    // La respuesta sale ya; resolver ids y escribir va después.
    after(async () => {
      try {
        const [ids, returning] = await Promise.all([resolve(e), bot ? Promise.resolve(null) : returningOf(e.vid)]);
        // Tienda de prueba (llaves de test de Stripe): sus visitas no existen para el panel (en vivo, recorridos, conversión).
        if (await isTestStore(ids.store_id)) return;
        const { error } = await db.from("site_events").insert({
          visitor_id: e.vid ?? null,
          session_id: e.sid ?? null,
          ...ids,
          page: e.page,
          event: e.event,
          host,
          path: e.path ?? null,
          country,
          city,
          region,
          lat,
          lon,
          device,
          browser: ua.browser,
          os: ua.os,
          device_model: ua.model,
          ip_masked: ipMasked,
          returning_visitor: returning,
          utm: e.utm && Object.keys(e.utm).length ? e.utm : null,
          referrer: e.ref || null,
          data: Object.keys(data).length ? data : null,
          is_bot: !!bot,
          bot_reason: bot,
        });
        if (error) console.warn("[ev] insert:", error.message);
      } catch (err) {
        console.warn("[ev]", (err as Error).message);
      }
    });
    return empty();
  } catch {
    return empty();
  }
}
