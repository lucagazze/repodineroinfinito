import { NextRequest, NextResponse } from "next/server";
import { runPilot } from "@/lib/bid-pilot/run";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Cada hora, a los 7 minutos (pg_cron «piloto-pujas»): una pasada del piloto de pujas; a los 37, reintento si falló. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Reintento (pg_cron «piloto-pujas-reintento», a los 37): solo si la pasada de los 7 no anduvo
  // (Meta limitó las consultas: el token lo comparten otras sesiones). Si anduvo, no hace nada.
  if (req.nextUrl.searchParams.get("retry") === "1") {
    const { data: last } = await db.from("bid_pilot_runs").select("ok,at").order("at", { ascending: false }).limit(1).maybeSingle();
    if (last?.ok && Date.now() - +new Date(last.at) < 40 * 60_000) return NextResponse.json({ skipped: "la pasada de los 7 anduvo" });
  }
  const r = await runPilot();
  return NextResponse.json({
    runId: r.runId, skipped: r.skipped ?? null, error: r.error ?? null, pressurePct: r.pressurePct, changes: r.changes,
    rows: r.rows.map((x) => ({ campaign: x.campaign, adset: x.adsetId, bid: x.bid, action: x.decision.action, newBid: x.decision.newBid, applied: x.applied, confirmed: x.confirmedBid, error: x.error })),
  });
}
