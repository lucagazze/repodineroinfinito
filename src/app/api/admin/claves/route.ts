import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createApiToken } from "@/lib/api-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Crea una clave de MCP nueva para conectar otra IA o computadora (botón «Copiar prompt con clave
 * nueva» de la Guía). Se guarda solo el hash; el token vuelve una sola vez. Se revoca sola desde la base.
 *  POST { name?: string } → { token }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const b = (await req.json().catch(() => null)) as { name?: string } | null;
  const day = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  const name = (b?.name?.trim() || "Prompt de la guía").slice(0, 60) + ` (${day})`;
  try {
    return NextResponse.json({ token: await createApiToken(name), name }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE });
  }
}
