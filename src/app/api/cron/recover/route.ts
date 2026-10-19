import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runCartRecovery } from "@/lib/cart-recovery";
import { stripeForStore } from "@/lib/stripe";
import { fulfill } from "@/lib/fulfill";
import { fromMinor } from "@/lib/fx";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Recuperación automática, cada 10 minutos (pg_cron «recuperar-carritos», con
 * el CRON_SECRET): el mail de carrito abandonado con IA y descuento a los
 * carritos con email de las últimas 48 h (ver cart-recovery.ts), y el repaso
 * de entregas que no salieron.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Carritos abandonados: el mail con IA y el descuento (cart-recovery.ts). Deja tiempo para el repaso de entregas.
  const results = await runCartRecovery(35_000).catch((e) => ({ error: (e as Error).message }));
  // Repaso de entregas: pedidos pagados hace más de 10 minutos que todavía no
  // recibieron el mail (proveedor caído, IP bloqueada, etc.). Se reintentan
  // hasta 3 días; fulfill es idempotente y no duplica nada.
  const { data: pend } = await db
    .from("orders")
    .select("id,store_id,stripe_payment_intent,delivery_attempts")
    .eq("status", "paid")
    .is("delivered_at", null)
    .lt("delivery_attempts", 30)
    .gte("created_at", new Date(Date.now() - 72 * 3600_000).toISOString())
    .lte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(50);
  let entregados = 0, fallidos = 0;
  for (const o of pend ?? []) {
    try {
      const { stripe } = await stripeForStore(o.store_id);
      const pi = await stripe.paymentIntents.retrieve(o.stripe_payment_intent!, { expand: ["latest_charge"] });
      const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const bd = ch?.billing_details;
      await fulfill({
        paymentId: pi.id, customerId: pi.customer ? String(pi.customer) : null,
        email: bd?.email ?? pi.receipt_email ?? null, name: bd?.name ?? null, phone: bd?.phone ?? null,
        country: bd?.address?.country ?? null, currency: pi.currency,
        amountTotal: fromMinor(pi.amount_received, pi.currency), metadata: pi.metadata ?? {}, paid: pi.status === "succeeded",
      });
      entregados++;
    } catch {
      fallidos++;
    }
  }
  return NextResponse.json({ carritos: results, entregas_reintentadas: entregados, entregas_fallidas: fallidos });
}
