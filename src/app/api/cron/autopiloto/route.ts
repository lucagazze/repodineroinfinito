import { NextRequest, NextResponse } from "next/server";
import { runAutopilot } from "@/lib/bid-pilot/autopilot";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Piloto Meta Ads, una vez por día a las 09:17 de Argentina (pg_cron «piloto-meta-ads»): guardia de
 * CBO y ganadores. A las 09:47 («piloto-meta-ads-reintento», ?retry=1) solo si la de las 09:17 no anduvo.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const retry = req.nextUrl.searchParams.get("retry") === "1";
  if (retry) {
    const { data: last } = await db.from("meta_auto_runs").select("ok,skipped,at").order("at", { ascending: false }).limit(1).maybeSingle();
    if (last?.ok && !last.skipped && Date.now() - +new Date(last.at) < 3 * 3600_000) return NextResponse.json({ skipped: "la pasada de las 09:17 anduvo" });
  }
  const r = await runAutopilot({ retry });
  return NextResponse.json({
    skipped: r.skipped ?? null, error: r.error ?? null, pressurePct: r.pressurePct, paused: r.paused, proposed: r.proposed,
    cbo: r.cbo.map((x) => ({ campaign: x.name, outcome: x.outcome, applied: x.applied, confirmed: x.confirmed, roas: x.roas, spend: x.spend, source: x.source, error: x.error })),
    winners: r.winners.filter((w) => w.verdict.qualifies).map((w) => ({ ad: w.ad, campaign: w.campaign, proposedNow: w.proposedNow })),
  });
}
