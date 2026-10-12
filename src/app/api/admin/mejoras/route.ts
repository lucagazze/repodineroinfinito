import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { executeRun, startRun } from "@/lib/coach/run";
import { COACH_TAG, runState } from "@/lib/coach/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// «Analizar ahora» corre la misma corrida que el cron, después de responder.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "no-store" };
const STATUSES = ["nueva", "hecha", "descartada"] as const;

/**
 * «Mejoras» desde el panel, con fetch común (no server actions: una acción en
 * curso al tocar un link hace que Next pida la página entera otra vez).
 *  GET  → la corrida más nueva (para saber si terminó «Analizar ahora»).
 *  POST { action: "run" }          → arranca un análisis (responde enseguida).
 *  POST { id, status }             → Hecha / Descartada / Nueva (deshacer).
 */
async function admin() {
  try { await requireAdmin(); return true; } catch { return false; }
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ run: await runState() }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { action?: string; id?: string; status?: string } | null;

  if (body?.action === "run") {
    try {
      const s = await startRun("manual");
      if ("skipped" in s) return NextResponse.json({ skipped: s.skipped, run: await runState() }, { headers: NO_STORE });
      after(async () => {
        await executeRun(s.id);
        try { revalidateTag(COACH_TAG); } catch { /* la caché vence sola */ }
      });
      return NextResponse.json({ started: s.id, run: await runState() }, { headers: NO_STORE });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE });
    }
  }

  const id = body?.id ?? "";
  const status = STATUSES.find((s) => s === body?.status);
  if (!UUID.test(id) || !status) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const { error } = await db.from("coach_recs").update({ status, status_at: status === "nueva" ? null : new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  revalidateTag(COACH_TAG);
  return NextResponse.json({ ok: true, id, status }, { headers: NO_STORE });
}
