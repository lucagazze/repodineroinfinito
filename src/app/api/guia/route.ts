import { NextRequest, NextResponse } from "next/server";
import { verifyApiToken } from "@/lib/api-tokens";
import { buildPrompt } from "@/lib/guia-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El link para compartir la guía: /api/guia?k=cp_… devuelve, en texto plano,
 * el prompt entero con esa misma clave y la guía. Solo con una clave válida y sin revocar: revocarla
 * apaga el link. Nunca se indexa.
 */
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("k") ?? "";
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
  if (!(await verifyApiToken(`Bearer ${k}`))) {
    return new NextResponse("Link vencido o inválido. Pedile al dueño uno nuevo (Guía de la app → «Crear link para compartir»).", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  }
  return new NextResponse(buildPrompt(k), { headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
}
