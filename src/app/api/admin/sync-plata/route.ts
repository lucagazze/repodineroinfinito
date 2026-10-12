import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncStripeBalances } from "@/lib/admin/stripe-balance";
import { syncMeta } from "@/lib/admin/meta-sync";
import { ADS_TAG } from "@/lib/admin/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/**
 * Al recargar el panel: trae los cobros nuevos de Stripe (lo facturado) y el gasto de
 * Meta sin esperar al cron de 15 min. Solo lectura de Stripe y Meta. Como mucho una vez cada 2 min
 * al abrir una página; con el botón «Actualizar» (force) cada 20 s.
 *  POST { force?: boolean } → { saved: número de filas nuevas o actualizadas, skipped? }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const force = !!(await req.json().catch(() => null))?.force;
  const { data: last } = await db.from("app_settings").select("value").eq("key", "sync_plata").maybeSingle();
  const at = Number((last?.value as { at?: number } | null)?.at ?? 0);
  if (Date.now() - at < (force ? 20_000 : 120_000)) return NextResponse.json({ saved: 0, skipped: true }, { headers: NO_STORE });
  await db.from("app_settings").upsert({ key: "sync_plata", value: { at: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "key" });

  const [stripe, meta] = await Promise.all([
    syncStripeBalances().catch(() => [] as { saved?: number }[]),
    syncMeta({ budgetMs: 25_000 }).catch(() => [] as { rows?: number }[]),
  ]);
  const sSaved = stripe.reduce((a, r) => a + (("saved" in r ? Number(r.saved) : 0) || 0), 0);
  const mRows = meta.reduce((a, r) => a + (Number(r.rows) || 0), 0);
  if (mRows) revalidateTag(ADS_TAG);
  return NextResponse.json({ saved: sSaved + mRows, stripe: sSaved, meta: mRows }, { headers: NO_STORE });
}
