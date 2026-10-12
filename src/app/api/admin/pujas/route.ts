import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { pilotSettings, runPilot } from "@/lib/bid-pilot/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/**
 * El piloto de pujas desde el panel (fetch común, no server actions):
 *  GET ?simular=1 → una pasada SIN escribir nada (ni en Meta ni en la base): qué haría ahora.
 *  POST { action: "global", enabled } → el interruptor general.
 *  POST { action: "ceiling", pct } → el tope de puja como % del precio del front (70 de fábrica):
 *       desde la próxima pasada, para todas las campañas sin tope a mano.
 *  POST { action: "campaign", campaignId, enabled?, target?, max?, auto? } → una campaña (el piso
 *       queda en 0,3 × objetivo). Con `max` el tope queda a mano (el piloto no lo pisa); con
 *       `auto: true` vuelve a ser el % del precio del front de la oferta (o 1,5 × objetivo sin oferta vinculada).
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("global"), enabled: z.boolean() }),
  z.object({ action: z.literal("ceiling"), pct: z.number().int().min(30).max(100) }),
  z.object({
    action: z.literal("campaign"), campaignId: z.string().regex(/^\d{6,25}$/),
    enabled: z.boolean().optional(),
    target: z.number().min(1).max(500).optional(),
    max: z.number().min(0.5).max(1000).optional(),
    auto: z.boolean().optional(),
  }),
]);

async function denied() {
  try { await requireAdmin(); return null; } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
}

export async function GET(req: NextRequest) {
  const no = await denied(); if (no) return no;
  if (req.nextUrl.searchParams.get("simular") !== "1") return NextResponse.json({ error: "Falta ?simular=1" }, { status: 400, headers: NO_STORE });
  const r = await runPilot({ dryRun: true });
  return NextResponse.json(r, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const no = await denied(); if (no) return no;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const b = parsed.data;
  const cfg = await pilotSettings();
  if (b.action === "global" || b.action === "ceiling") {
    // Los dos ajustes viven en la misma fila: se guarda uno sin perder el otro.
    const value = { enabled: b.action === "global" ? b.enabled : cfg.enabled, ceiling_pct: b.action === "ceiling" ? b.pct : cfg.ceilingPct };
    const { error } = await db.from("app_settings").upsert({ key: "bid_pilot", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    if (b.action === "ceiling") return NextResponse.json({ ok: `Tope de puja = ${b.pct} % del precio del libro (desde la próxima pasada)`, ceilingPct: b.pct }, { headers: NO_STORE });
    return NextResponse.json({ ok: b.enabled ? "Piloto encendido" : "Piloto apagado: no cambia ninguna puja", enabled: b.enabled }, { headers: NO_STORE });
  }
  const { data: cur } = await db.from("bid_pilot_campaigns").select("target_cpa,max_bid,max_manual,front_usd").eq("campaign_id", b.campaignId).maybeSingle();
  if (!cur) return NextResponse.json({ error: "Esa campaña todavía no la vio el piloto." }, { status: 404, headers: NO_STORE });
  const target = b.target ?? Number(cur.target_cpa);
  // El tope: a mano si lo mandó; si no, el % del precio del front (hacia abajo a 0,05) o 1,5 × objetivo sin oferta vinculada.
  const manual = b.max != null ? true : b.auto ? false : !!cur.max_manual;
  const auto = cur.front_usd != null ? Math.floor(Number(cur.front_usd) * (cfg.ceilingPct / 100) * 20 + 1e-9) / 20 : Math.round(target * 1.5 * 100) / 100;
  const max = b.max ?? (manual ? Number(cur.max_bid) : auto);
  if (max < target * 0.3) return NextResponse.json({ error: "El tope no puede ser menor que el piso (0,3 × objetivo)." }, { status: 400, headers: NO_STORE });
  const patch = {
    ...(b.enabled != null ? { enabled: b.enabled } : {}),
    target_cpa: target, max_bid: max, max_manual: manual, floor_bid: Math.round(target * 0.3 * 100) / 100, updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("bid_pilot_campaigns").update(patch).eq("campaign_id", b.campaignId).select("campaign_id,enabled,target_cpa,max_bid,floor_bid").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ ok: "Guardado", campaign: data }, { headers: NO_STORE });
}
