import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { syncMeta } from "@/lib/admin/meta-sync";
import { ADS_TAG } from "@/lib/admin/ads";
import { syncUnpaidOrders } from "@/lib/admin/alerts";
import { syncStripeBalances } from "@/lib/admin/stripe-balance";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Cada 15 minutos (pg_cron «sincronizar-meta»): trae Meta a meta_insights_daily. El panel solo lee de ahí. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const results = await syncMeta();
  if (results.some((r) => r.rows)) revalidateTag(ADS_TAG);
  // De paso (es barato): pedidos «pagados» sin pago en Stripe → Avisos.
  // Y los movimientos de saldo de Stripe (comisiones reales de la fila de plata de Inicio). Solo lectura.
  const [unpaid, stripe] = await Promise.all([
    syncUnpaidOrders(),
    syncStripeBalances().catch((e: Error) => [{ error: e.message }]),
  ]);
  return NextResponse.json({ results, unpaid, stripe });
}
