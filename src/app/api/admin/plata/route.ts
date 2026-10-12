import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { resolveRange } from "@/lib/admin/range";
import { moneyFor } from "@/lib/admin/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La plata del período (?r= o ?desde&hasta, como el filtro del panel): la pide
 * la fila de arriba de Inicio cuando entra una compra, para actualizarse sola.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const R = resolveRange({ r: sp.get("r") ?? undefined, desde: sp.get("desde") ?? undefined, hasta: sp.get("hasta") ?? undefined });
  try {
    return NextResponse.json(await moneyFor(R.since, R.until), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
