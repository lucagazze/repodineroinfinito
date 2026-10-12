import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { autopilotSettings, runAutopilot } from "@/lib/bid-pilot/autopilot";
import { dismissWinner, planBidCap, promoteWinner } from "@/lib/bid-pilot/bidcap";
import { metaError } from "@/lib/admin/meta-conn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/**
 * El Piloto Meta Ads desde el panel (fetch común, no server actions). Todo pide sesión de admin.
 *  GET ?simular=1 → la pasada diaria SIN escribir nada (ni en Meta ni en la base): qué haría ahora.
 *  GET ?plan=<adId> → la BID CAP que se armaría con ese anuncio (solo lecturas de Meta, no crea nada).
 *  POST { action: "settings", cboGuard?, winners? } → los interruptores generales.
 *  POST { action: "cbo", campaignId, guard } → sacar (o volver a poner) una CBO de la guardia.
 *  POST { action: "winner", adId, decision: "accept" | "dismiss" } → «Pasar a BID CAP» o «Ahora no».
 */
const Id = z.string().regex(/^\d{6,25}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), cboGuard: z.boolean().optional(), winners: z.boolean().optional() }),
  z.object({ action: z.literal("cbo"), campaignId: Id, guard: z.boolean() }),
  z.object({ action: z.literal("winner"), adId: Id, decision: z.enum(["accept", "dismiss"]) }),
]);

async function denied() {
  try { await requireAdmin(); return null; } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
}

export async function GET(req: NextRequest) {
  const no = await denied(); if (no) return no;
  const planFor = req.nextUrl.searchParams.get("plan");
  if (planFor) {
    if (!Id.safeParse(planFor).success) return NextResponse.json({ error: "Anuncio inválido" }, { status: 400, headers: NO_STORE });
    const { data: row } = await db.from("meta_auto_winners").select("ad_id,account_id,campaign_id,campaign_name,adset_id,ad_name,target").eq("ad_id", planFor).maybeSingle();
    try { return NextResponse.json(await planBidCap(planFor, row), { headers: NO_STORE }); }
    catch (e) { return NextResponse.json({ error: metaError(e) }, { status: 502, headers: NO_STORE }); }
  }
  if (req.nextUrl.searchParams.get("simular") !== "1") return NextResponse.json({ error: "Falta ?simular=1" }, { status: 400, headers: NO_STORE });
  return NextResponse.json(await runAutopilot({ dryRun: true }), { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const no = await denied(); if (no) return no;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const b = parsed.data;
  const at = new Date().toISOString();

  if (b.action === "settings") {
    const cur = await autopilotSettings();
    const value = { cbo_guard: b.cboGuard ?? cur.cbo_guard, winners: b.winners ?? cur.winners };
    const { error } = await db.from("app_settings").upsert({ key: "meta_autopilot", value, updated_at: at }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ ok: "Guardado", settings: value }, { headers: NO_STORE });
  }
  if (b.action === "cbo") {
    const { data, error } = await db.from("meta_auto_campaigns").update({ cbo_guard: b.guard, updated_at: at }).eq("campaign_id", b.campaignId).select("campaign_id").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    if (!data) return NextResponse.json({ error: "Esa campaña todavía no la vio la guardia." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: b.guard ? "La guardia la vuelve a cuidar" : "La guardia no la toca más" }, { headers: NO_STORE });
  }
  const r = b.decision === "accept" ? await promoteWinner(b.adId) : await dismissWinner(b.adId);
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: NO_STORE });
}
