import { NextRequest, NextResponse } from "next/server";
import { gzipSync, gunzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { originOk, clientIp, isBot, bucket } from "@/lib/req-guard";
import { isTestStore } from "@/lib/test-store";

export const runtime = "nodejs";

/**
 * Grabación de sesión (rrweb) de las páginas públicas, para verla en vivo en
 * el panel. La mandan public/t.js (landings) y src/lib/track-client.ts
 * (checkout, pos-pago, gracias), con el mismo visitante y pestaña que
 * site_events. Migración 033.
 *
 *  GET  /api/rec?c=1&store=&funnel=&order=   ¿se graba? → { on }
 *         (no si el checkout tiene la grabación apagada, si es un robot o si
 *         ya se llegó al tope del día)
 *  POST /api/rec?s=&v=&p=&q=&pg=&store=&funnel=&order=&path=&z=1
 *         cuerpo: JSON de eventos (z=0) o el mismo JSON en gzip (z=1).
 *         204 guardado · 409 tope (sesión o día: el navegador deja de grabar)
 *         · 403 grabación apagada · 413 muy grande · 429 demasiados pedidos.
 */

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGES = new Set(["landing", "checkout", "oferta", "gracias"]);

const MAX_BODY = 512 * 1024;            // comprimido, por pedido
const MAX_RAW = 8 * 1024 * 1024;        // descomprimido, por pedido
const MAX_EVENTS = 5000;
const SESSION_CAP = 3 * 1024 * 1024;    // por pestaña (comprimido)
const DAY_CAP = Math.max(10, Number(process.env.REC_DAY_CAP_MB) || 250) * 1024 * 1024;

/** Un pedido cada ~3 s por pestaña; 40 de golpe y 1 cada 1,5 s por IP alcanza para varias pestañas. */
const allow = bucket(40, 1500);

const empty = (status: number, extra?: Record<string, string>) =>
  new NextResponse(null, { status, headers: { "cache-control": "no-store", ...extra } });

// ------------------------------------------------------ checkout y su interruptor

type Fu = { id: string; store_id: string; on: boolean };
const TTL = 60_000;
let fmap: { at: number; bySlug: Map<string, Fu>; byId: Map<string, Fu>; stores: Map<string, string> } | null = null;
async function funnels() {
  if (fmap && Date.now() - fmap.at < TTL) return fmap;
  const [{ data: fu, error }, { data: st }] = await Promise.all([
    db.from("funnels").select("id,slug,store_id,record_sessions"),
    db.from("stores").select("id,slug"),
  ]);
  if (error || !fu) return fmap ?? { at: 0, bySlug: new Map(), byId: new Map(), stores: new Map() };
  const slugOf = new Map((st ?? []).map((s) => [s.id as string, s.slug as string]));
  const bySlug = new Map<string, Fu>();
  const byId = new Map<string, Fu>();
  for (const f of fu) {
    const x = { id: f.id as string, store_id: f.store_id as string, on: f.record_sessions !== false };
    bySlug.set(`${slugOf.get(f.store_id as string)}/${f.slug}`, x);
    byId.set(x.id, x);
  }
  const stores = new Map((st ?? []).map((s) => [s.slug as string, s.id as string]));
  return (fmap = { at: Date.now(), bySlug, byId, stores });
}

const orderFunnel = new Map<string, { at: number; id: string | null }>();
async function funnelOfOrder(order: string) {
  const hit = orderFunnel.get(order);
  if (hit && Date.now() - hit.at < TTL) return hit.id;
  const { data } = await db.from("orders").select("funnel_id").eq("id", order).maybeSingle();
  if (orderFunnel.size > 5000) orderFunnel.clear();
  orderFunnel.set(order, { at: Date.now(), id: (data?.funnel_id as string | null) ?? null });
  return (data?.funnel_id as string | null) ?? null;
}

async function where(q: URLSearchParams) {
  const m = await funnels();
  const store = q.get("store"), funnel = q.get("funnel"), order = q.get("order");
  let f: Fu | undefined;
  if (store && funnel && SLUG.test(store) && SLUG.test(funnel)) f = m.bySlug.get(`${store}/${funnel}`);
  if (!f && order && UUID.test(order)) {
    const id = await funnelOfOrder(order);
    if (id) f = m.byId.get(id);
  }
  const storeId = f?.store_id ?? (store && SLUG.test(store) ? m.stores.get(store) ?? null : null);
  return { funnel: f ?? null, storeId };
}

let today: { at: number; day: string; bytes: number } | null = null;
async function dayBytes() {
  const day = new Date().toISOString().slice(0, 10);
  if (today && today.day === day && Date.now() - today.at < TTL) return today.bytes;
  const { data } = await db.from("rec_daily").select("bytes").eq("day", day).maybeSingle();
  today = { at: Date.now(), day, bytes: Number(data?.bytes ?? 0) };
  return today.bytes;
}

// ------------------------------------------------------------------ rutas

export async function GET(req: NextRequest) {
  const no = () => NextResponse.json({ on: false }, { headers: { "cache-control": "no-store" } });
  try {
    if (!originOk(req) || isBot(req)) return no();
    const q = req.nextUrl.searchParams;
    const [{ funnel, storeId }, used] = await Promise.all([where(q), dayBytes()]);
    if (funnel && !funnel.on) return no();
    // Tienda de prueba (llaves de test de Stripe): no se graba.
    if (await isTestStore(storeId)) return no();
    if (used >= DAY_CAP) return no();
    return NextResponse.json({ on: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return no();
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!originOk(req)) return empty(403);
    if (isBot(req)) return empty(204); // a un robot no se le avisa nada
    if (!allow(clientIp(req))) return empty(429);
    const q = req.nextUrl.searchParams;
    const sid = q.get("s") ?? "", vid = q.get("v"), pv = q.get("p"), page = q.get("pg") ?? "";
    const seq = Number(q.get("q") ?? "0");
    if (!ID.test(sid) || (vid && !ID.test(vid)) || (pv && !ID.test(pv)) || !PAGES.has(page) || !Number.isInteger(seq) || seq < 0 || seq > 100_000) return empty(400);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return empty(413);

    const body = Buffer.from(await req.arrayBuffer());
    if (!body.length) return empty(400);
    if (body.length > MAX_BODY) return empty(413);
    let raw: Buffer;
    try {
      raw = q.get("z") === "1" ? gunzipSync(body, { maxOutputLength: MAX_RAW }) : body;
    } catch { return empty(400); }
    if (raw.length > MAX_RAW) return empty(413);

    // Tiene que ser un array de eventos rrweb (type + timestamp).
    let events: unknown;
    try { events = JSON.parse(raw.toString("utf8")); } catch { return empty(400); }
    if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) return empty(400);
    let t0 = Infinity, t1 = 0;
    for (const e of events as { type?: unknown; timestamp?: unknown }[]) {
      if (!e || typeof e !== "object" || typeof e.type !== "number" || typeof e.timestamp !== "number") return empty(400);
      if (e.timestamp < t0) t0 = e.timestamp;
      if (e.timestamp > t1) t1 = e.timestamp;
    }

    const { funnel, storeId } = await where(q);
    if (funnel && !funnel.on) return empty(403);
    if (await isTestStore(storeId)) return empty(403);

    const gz = q.get("z") === "1" ? body : gzipSync(raw);
    const path = (q.get("path") ?? "").slice(0, 300) || null;
    const { data, error } = await db.rpc("rec_put", {
      p_session: sid, p_visitor: vid || null, p_store: storeId, p_funnel: funnel?.id ?? null,
      p_pv: pv || null, p_seq: seq, p_page: page, p_path: path,
      p_t0: Math.round(t0), p_t1: Math.round(t1), p_n: events.length, p_gz: `\\x${gz.toString("hex")}`,
      p_session_cap: SESSION_CAP, p_day_cap: DAY_CAP,
    });
    if (error) {
      console.warn("[rec]", error.message);
      return empty(503);
    }
    if (data === "ok") {
      if (today) today.bytes += gz.length;
      return empty(204);
    }
    return empty(409); // tope de la sesión o del día: el navegador deja de grabar
  } catch (e) {
    console.warn("[rec]", (e as Error).message);
    return empty(503);
  }
}
