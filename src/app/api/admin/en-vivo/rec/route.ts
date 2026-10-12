import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grabaciones para el reproductor del panel (migración 033).
 *  GET  ?sid=&after=   los eventos rrweb de una pestaña desde el pedazo
 *                      `after` (id), si sigue conectada y en qué página está.
 *  POST { funnelId, on }   prende o apaga la grabación de un checkout.
 */

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PER_CALL = 40;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

async function admin() {
  try { await requireAdmin(); return true; } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!(await admin())) return json({ error: "No autorizado" }, 401);
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const after = Math.max(0, Number(req.nextUrl.searchParams.get("after") ?? 0) || 0);
  if (!ID.test(sid)) return json({ error: "Falta la pestaña" }, 400);

  const [chunks, last] = await Promise.all([
    db.from("rec_chunks").select("id,at,t1,gz").eq("session_id", sid).gt("id", after).order("id", { ascending: true }).limit(PER_CALL),
    // Conectada = algo en site_events en el último minuto que no sea «se fue».
    db.from("site_events").select("event,page,path,at").eq("session_id", sid).order("at", { ascending: false }).limit(1),
  ]);
  if (chunks.error) return json({ error: chunks.error.message }, 500);

  const events: unknown[] = [];
  let lastId = after;
  // off = hora del servidor al guardar − hora del visitante en su último evento: atraso + diferencia de relojes.
  let off: number | null = null;
  for (const c of (chunks.data ?? []) as { id: number; at: string; t1: number | null; gz: string }[]) {
    lastId = Math.max(lastId, c.id);
    if (c.t1) { const o = Date.parse(c.at) - Number(c.t1); if (off === null || o < off) off = o; }
    try {
      const hex = c.gz.startsWith("\\x") ? c.gz.slice(2) : c.gz;
      const arr = JSON.parse(gunzipSync(Buffer.from(hex, "hex")).toString("utf8"));
      if (Array.isArray(arr)) events.push(...arr);
    } catch { /* un pedazo roto no frena el resto */ }
  }
  const le = last.data?.[0] as { event: string; page: string; path: string | null; at: string } | undefined;
  const live = !!le && le.event !== "leave" && Date.now() - Date.parse(le.at) < 60_000;
  return json({
    events, after: lastId, more: (chunks.data?.length ?? 0) === PER_CALL,
    live, page: le?.page ?? null, path: le?.path ?? null, server: Date.now(), off,
  });
}

export async function POST(req: NextRequest) {
  if (!(await admin())) return json({ error: "No autorizado" }, 401);
  const body = (await req.json().catch(() => ({}))) as { funnelId?: string; on?: boolean };
  if (!body.funnelId || !UUID.test(body.funnelId) || typeof body.on !== "boolean") return json({ error: "Datos inválidos" }, 400);
  const { error } = await db.from("funnels").update({ record_sessions: body.on }).eq("id", body.funnelId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, on: body.on });
}
