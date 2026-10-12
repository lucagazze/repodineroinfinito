import { NextRequest, NextResponse } from "next/server";
import { reconcileStores } from "@/lib/reconcile";
import { refreshRates } from "@/lib/fx";
import { db } from "@/lib/db";
import { sendOrderPurchase } from "@/lib/meta";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cada 10 min (pg_cron «reconciliar-pagos»): pagos cobrados en Stripe en las
 * últimas 48 h que no estén registrados (pedido o upsell) se registran y
 * entregan por el mismo camino que el webhook. Avisa si tuvo que reparar algo.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const hours = Math.min(72, Math.max(1, Number(req.nextUrl.searchParams.get("hours") ?? 48) || 48));
  // De paso, los tipos de cambio compartidos (si tienen más de 12 h): así nunca los pide una compra.
  const fx = await refreshRates().catch((e) => ({ ok: false, refreshed: false, error: (e as Error).message }));
  const res = await reconcileStores(hours, { dryRun: req.nextUrl.searchParams.get("dry") === "1" });
  // Compras que no llegaron a Meta por la API de Conversiones (token sin permiso, Meta caído…): se reintentan hasta 7
  // días (Meta acepta eventos de hasta 7 días). Una sola vez por pedido (capi_sent_at); el event_id es el del pago,
  // así Meta no la cuenta dos veces con la del navegador.
  const { data: pend } = await db.from("orders").select("id").eq("status", "paid").is("capi_sent_at", null).not("stripe_payment_intent", "is", null)
    .gte("created_at", new Date(Date.now() - 7 * 864e5 + 3600_000).toISOString()).lte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .order("created_at", { ascending: false }).limit(40);
  let capi = 0;
  for (const o of pend ?? []) { await sendOrderPurchase(o.id as string).then(() => capi++).catch((e) => console.warn("[capi reintento]", o.id, (e as Error).message)); }
  return NextResponse.json({
    fx,
    ok: res.every((r) => !r.errors.length),
    repaired: res.reduce((a, r) => a + r.repaired.length, 0),
    capi_retried: capi,
    stores: res,
  });
}
