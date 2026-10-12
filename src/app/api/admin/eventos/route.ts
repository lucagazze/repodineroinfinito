import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { eventsByPersonCached } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inicio › Últimos eventos, por persona (lo pide EventsByPerson cada 5 s).
 * Liviano (eventsByPersonCached): reusa lo armado y rehace solo lo que cambió.
 * ?v= (opcional) lo que el panel ya tiene: si no cambió nada, 204 sin cuerpo.
 * Sin ?v= responde siempre { at, v, groups }, como antes.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const r = await eventsByPersonCached(req.nextUrl.searchParams.get("v"));
    if (r.same) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
    return NextResponse.json({ at: r.at, v: r.v, groups: r.groups }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
