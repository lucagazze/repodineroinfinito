import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { recentOrders } from "@/lib/admin/pulse";
import { resolveRange } from "@/lib/admin/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Últimas compras» (Inicio y el Inicio de cada oferta): las del período del
 * filtro (?desde&hasta o ?r), de todas las ofertas o de esos checkouts
 * (?checkouts=id,id), las más nuevas primero; ?limit sube de a 25 con «Ver más»;
 * ?offset pagina y ?q busca por correo, nombre, teléfono o número de pedido.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const R = resolveRange({ r: sp.get("r") ?? undefined, desde: sp.get("desde") ?? undefined, hasta: sp.get("hasta") ?? undefined });
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 25));
  // ?offset (paginar) y ?q (correo, nombre, teléfono o número de pedido): Últimos pagos de Inicio.
  const offset = Math.min(100_000, Math.max(0, Math.floor(Number(sp.get("offset")) || 0)));
  const search = sp.get("q");
  const ids = sp.get("checkouts");
  const funnelIds = ids == null ? null : ids.split(",").filter((x) => UUID.test(x));
  try {
    return NextResponse.json(await recentOrders({ since: R.since, until: R.until, funnelIds, limit, offset, search }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
