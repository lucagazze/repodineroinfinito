import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { checkoutHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/health/checkout?k=HEALTH_SECRET → { ok, checks[] }, 200 si todo
 * anda y 503 si algo no. Sin efectos (solo lecturas). Lo llaman el monitor
 * (pg_cron cada 2 min) y scripts/deploy-safe.sh antes y después de publicar.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.HEALTH_SECRET ?? "";
  const k = req.nextUrl.searchParams.get("k") ?? req.headers.get("x-health-key") ?? "";
  const a = Buffer.from(k);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const started = Date.now();
  const res = await checkoutHealth().catch((e) => ({ ok: false, checks: [{ name: "health", ok: false, detail: (e as Error).message }] }));
  return NextResponse.json(
    { ...res, ms: Date.now() - started, at: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { status: res.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
