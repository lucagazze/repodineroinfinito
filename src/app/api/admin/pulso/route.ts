import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { pulse } from "@/lib/admin/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lo armado hace menos de 2 s se reusa, y si ya hay uno armándose se espera ese:
 * varias pestañas o celulares abiertos (y el latido que avisa una compra) no
 * multiplican las consultas. 2 s no se notan en «en vivo» (la ventana es de 60 s).
 */
const FRESH_MS = 2000;
let last: { at: number; data: Awaited<ReturnType<typeof pulse>> } | null = null;
let inflight: Promise<Awaited<ReturnType<typeof pulse>>> | null = null;
async function cachedPulse(fresh: boolean) {
  // ?fresh=1: entró una compra (latido): se arma de nuevo, sin lo guardado.
  if (fresh) { const data = await pulse(); last = { at: Date.now(), data }; return data; }
  if (last && Date.now() - last.at < FRESH_MS) return last.data;
  inflight ??= pulse().then((data) => { last = { at: Date.now(), data }; return data; }).finally(() => { inflight = null; });
  return inflight;
}

/** El centro de control de «Todas las ofertas»: en vivo, ventas de hoy, últimas compras y eventos (cada 5 s). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await cachedPulse(req.nextUrl.searchParams.get("fresh") === "1"), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
