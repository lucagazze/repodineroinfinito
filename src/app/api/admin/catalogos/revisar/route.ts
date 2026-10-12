import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runCatalogStatus } from "@/lib/admin/catalog-status";

export const runtime = "nodejs";
export const maxDuration = 120;

/** «Revisar ahora» de Catálogos y Stripe. */
export async function POST() {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401 }); }
  const st = await runCatalogStatus();
  return NextResponse.json({ ok: true, at: st?.at ?? null }, { headers: { "cache-control": "no-store" } });
}
