import { NextRequest, NextResponse, after } from "next/server";
import { findOrder } from "@/lib/order-lookup";
import { stripeForStore } from "@/lib/stripe";
import { orderChargeable, recordUpsell } from "@/lib/upsell";

export const runtime = "nodejs";

/**
 * Cierra un upsell que se pagó en el navegador: después del 3DS, de la hoja de
 * pago (Elements) o al volver de una redirección. Registra solo lo que Stripe
 * dice cobrado y solo si el PaymentIntent es de este pedido.
 *   200 { ok }                    cobrado y registrado
 *   202 { ok, processing: true }  Stripe lo está procesando: lo registra el webhook
 *   409 { reason: "declined" }    no se cobró
 */
export async function POST(req: NextRequest) {
  const { sessionId, pi } = await req.json().catch(() => ({}));
  if (!sessionId || !pi || !/^pi_[A-Za-z0-9]+$/.test(String(pi))) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const order = await findOrder(String(sessionId));
  if (!order) return NextResponse.json({ error: "Pedido no válido" }, { status: 403 });
  const { stripe, livemode } = await stripeForStore(order.store_id);
  if (!orderChargeable(order.status, livemode)) {
    return NextResponse.json({ error: "Pedido no válido" }, { status: 403 });
  }

  const intent = await stripe.paymentIntents.retrieve(String(pi)).catch(() => null);
  if (!intent || intent.metadata?.order !== order.id || intent.metadata?.kind !== "upsell") {
    return NextResponse.json({ reason: "declined" }, { status: 409 });
  }
  if (intent.status === "processing") {
    return NextResponse.json({ ok: true, processing: true }, { status: 202 });
  }

  const ok = await recordUpsell(order.id, intent, { stripe, defer: (task) => after(task) });
  return ok
    ? NextResponse.json({ ok: true, product: intent.metadata.product })
    : NextResponse.json({ reason: "declined", status: intent.status }, { status: 409 });
}
