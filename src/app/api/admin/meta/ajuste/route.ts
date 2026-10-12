import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { metaError, metaGet, metaPost } from "@/lib/admin/meta-conn";
import { logActivity } from "@/lib/bid-pilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Cambiar el presupuesto diario o la puja desde la tabla de campañas.
 * - Presupuesto: el de la campaña (CBO) o el del conjunto, solo si es diario (el total se cambia en Meta).
 * - Puja: la del conjunto; desde la fila de la campaña, a todos sus conjuntos con límite de puja.
 * Solo objetos que la sincronización conoce. Escribe en Meta, lo vuelve a leer para confirmar,
 * lo deja en la base (la tabla se ve al instante) y queda en el historial del piloto.
 */
const Body = z.object({
  level: z.enum(["campaign", "adset"]),
  id: z.string().regex(/^\d{6,25}$/),
  field: z.enum(["daily_budget", "bid_amount"]),
  value: z.number().positive().max(100_000),
});
const LEVEL = { campaign: "Campaña", adset: "Conjunto" } as const;
const LIVE = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED"];

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const { level, id, field, value } = parsed.data;
  const err = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

  const { data: obj } = await db.from("meta_objects").select("name,account_id,campaign_id,daily_budget,lifetime_budget,bid_amount").eq("level", level).eq("id", id).maybeSingle();
  if (!obj) return err("No está en las campañas sincronizadas.", 404);

  // A qué objetos de Meta se le escribe.
  let targets: { id: string; name: string; old: number | null }[];
  if (field === "daily_budget") {
    if (obj.lifetime_budget) return err("Tiene presupuesto total, no diario: cambialo en Meta.");
    if (!obj.daily_budget) return err(`El presupuesto no está en ${level === "campaign" ? "la campaña sino en sus conjuntos" : "el conjunto sino en la campaña"}.`);
    targets = [{ id, name: obj.name ?? id, old: Number(obj.daily_budget) }];
  } else if (level === "adset") {
    if (obj.bid_amount == null) return err("Este conjunto no tiene límite de puja.");
    targets = [{ id, name: obj.name ?? id, old: Number(obj.bid_amount) }];
  } else {
    const { data: sets } = await db.from("meta_objects").select("id,name,bid_amount").eq("level", "adset").eq("campaign_id", id).in("effective_status", LIVE).not("bid_amount", "is", null);
    if (!sets?.length) return err("Ningún conjunto de esta campaña tiene límite de puja.");
    targets = sets.map((s) => ({ id: s.id as string, name: (s.name as string) ?? s.id, old: Number(s.bid_amount) }));
  }

  const minor = String(Math.round(value * 100));
  const done: string[] = [];
  for (const t of targets) {
    try {
      await metaPost(t.id, { [field]: minor });
      const back = await metaGet<Record<string, string | number | undefined>>(t.id, { fields: field });
      if (String(back[field] ?? "") !== minor) return err(`Meta aceptó el cambio pero quedó en ${Number(back[field] ?? 0) / 100}.${done.length ? ` (${done.length} ya cambiados)` : ""}`, 502);
    } catch (e) {
      return err(`Meta no lo cambió: ${metaError(e)}${done.length ? ` (${done.length} ya cambiados)` : ""}`, 502);
    }
    await db.from("meta_objects").update({ [field]: value, updated_at: new Date().toISOString() }).eq("level", field === "bid_amount" ? "adset" : level).eq("id", t.id);
    done.push(t.id);
  }

  const what = field === "daily_budget" ? "Presupuesto diario" : "Puja";
  const olds = [...new Set(targets.map((t) => t.old))];
  await logActivity({
    kind: "manual_edit", accountId: obj.account_id, campaignId: level === "campaign" ? id : obj.campaign_id, campaignName: obj.name,
    title: `✏️ ${what} a mano · ${obj.name}`,
    body: `${LEVEL[level]}: ${what.toLowerCase()} ${olds.length === 1 && olds[0] != null ? `de ${olds[0]} ` : ""}a ${value}${targets.length > 1 ? ` (${targets.length} conjuntos)` : ""}, desde la tabla de campañas del panel.`,
  });
  return NextResponse.json({ ok: true, value, count: done.length }, { headers: NO_STORE });
}
