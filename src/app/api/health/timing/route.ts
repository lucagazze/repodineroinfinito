import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { loadCheckout } from "@/lib/checkout-data";
import { stripeForStore } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuánto tarda cada pieza del checkout en el servidor. Protegido con CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "no" }, { status: 401 });
  }
  const store = req.nextUrl.searchParams.get("store") ?? "";
  const funnel = req.nextUrl.searchParams.get("funnel") ?? "kit-completo";
  const t: Record<string, number> = {};
  const lap = async <T,>(k: string, f: () => Promise<T>) => { const s = performance.now(); const r = await f(); t[k] = Math.round(performance.now() - s); return r; };
  const data = await lap("loadCheckout", () => loadCheckout(store, funnel));
  await lap("loadCheckout_again", () => loadCheckout(store, funnel));
  await lap("getRates", () => getRates());
  await lap("stripeForStore", () => stripeForStore(data!.funnel.stores.id));
  await lap("buyersCount", async () => db.from("checkouts").select("id", { count: "exact", head: true }).eq("funnel_id", data!.funnel.id));
  await lap("simpleSelect", async () => db.from("stores").select("id").limit(1));
  return NextResponse.json({ region: process.env.VERCEL_REGION, t });
}
