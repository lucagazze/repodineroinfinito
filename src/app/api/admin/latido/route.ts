import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El latido de Inicio (cada 3 s): ¿entró una compra? Dos conteos chicos, sin
 * armar nada: pedidos pagados y OTOs cobrados (cada OTO es un renglón «upsell»
 * del pedido). Si la huella cambia, el panel pide enseguida el pulso, los
 * últimos pagos y los eventos, en vez de esperar su turno de 5 s.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const [paid, otos] = await Promise.all([
    db.from("orders").select("*", { count: "exact", head: true }).eq("status", "paid").eq("is_test", false),
    db.from("order_items").select("*", { count: "exact", head: true }).eq("kind", "upsell"),
  ]);
  const err = paid.error ?? otos.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ s: `${paid.count ?? 0}:${otos.count ?? 0}` }, { headers: { "cache-control": "no-store" } });
}
