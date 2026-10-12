import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { liveSnapshot } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foto de «En vivo» para el panel (lo pide cada 5 s la página /admin/en-vivo). ?robots=1 incluye los robots, marcados. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const robots = req.nextUrl.searchParams.get("robots") === "1";
    return NextResponse.json(await liveSnapshot({ full: true, robots }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
