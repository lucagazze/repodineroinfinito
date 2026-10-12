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
 * Prender o apagar una campaña, un conjunto o un anuncio desde la tabla de
 * campañas del panel. Solo objetos que la
 * sincronización ya conoce (meta_objects): no sirve para tocar cualquier id.
 * Escribe el estado propio en Meta, lo vuelve a leer para confirmar, lo deja
 * en la base para que la tabla se vea al instante (el resto de la jerarquía
 * se pone al día con la sincronización de cada 15 min) y queda en el
 * historial del piloto.
 */
const Body = z.object({
  level: z.enum(["campaign", "adset", "ad"]),
  id: z.string().regex(/^\d{6,25}$/),
  on: z.boolean(),
});
const LEVEL = { campaign: "Campaña", adset: "Conjunto", ad: "Anuncio" } as const;

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const { level, id, on } = parsed.data;

  const { data: obj } = await db.from("meta_objects").select("name,account_id,campaign_id").eq("level", level).eq("id", id).maybeSingle();
  if (!obj) return NextResponse.json({ error: "No está en las campañas sincronizadas." }, { status: 404, headers: NO_STORE });

  const want = on ? "ACTIVE" : "PAUSED";
  let back: { status?: string; effective_status?: string };
  try {
    await metaPost(id, { status: want });
    back = await metaGet<{ status?: string; effective_status?: string }>(id, { fields: "status,effective_status" });
  } catch (e) {
    return NextResponse.json({ error: `Meta no lo cambió: ${metaError(e)}` }, { status: 502, headers: NO_STORE });
  }
  if (back.status !== want) {
    return NextResponse.json({ error: `Meta aceptó el cambio pero sigue ${back.status ?? "sin estado"}.` }, { status: 502, headers: NO_STORE });
  }

  const effective = back.effective_status ?? want;
  await db.from("meta_objects").update({ status: want, effective_status: effective, updated_at: new Date().toISOString() }).eq("level", level).eq("id", id);
  await logActivity({
    kind: "manual_status", accountId: obj.account_id, campaignId: level === "campaign" ? id : obj.campaign_id, campaignName: obj.name,
    title: `${on ? "▶️ Prendida" : "⏸️ Apagada"} a mano · ${obj.name}`,
    body: `${LEVEL[level]} ${on ? "prendida" : "apagada"} desde la tabla de campañas del panel.`,
  });
  return NextResponse.json({ ok: true, status: want, effective }, { headers: NO_STORE });
}
