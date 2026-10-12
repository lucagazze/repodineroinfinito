import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { executeRun, startRun } from "@/lib/coach/run";
import { COACH_TAG } from "@/lib/coach/read";

export const runtime = "nodejs";
// La corrida (hallazgos + una llamada a la IA por oferta con movimiento + el resumen) tarda 1–3 minutos.
export const maxDuration = 300;

/**
 * Una vez por día, 07:00 de Argentina (pg_cron «analizar-mejoras», migración
 * 046): «Mejoras» analiza todas las ofertas y la cuenta de anuncios. Responde
 * enseguida (pg_net corta a los 55 s) y analiza después. Solo escribe en
 * coach_runs / coach_recs. ?days=14 para otra ventana.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const days = Math.min(30, Math.max(3, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const s = await startRun("cron", days);
  if ("skipped" in s) return NextResponse.json({ skipped: s.skipped });
  after(async () => {
    const r = await executeRun(s.id, { days });
    try { revalidateTag(COACH_TAG); } catch { /* la caché vence sola */ }
    if (r.status === "error") console.warn("[coach]", r.error);
  });
  return NextResponse.json({ started: s.id, days });
}
