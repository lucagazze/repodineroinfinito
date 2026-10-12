import { NextRequest, NextResponse } from "next/server";
import { findOrder } from "@/lib/order-lookup";
import { resolveChain } from "@/lib/postpurchase";
import { logUpsellEvent } from "@/lib/upsell-events";

export const runtime = "nodejs";

/** Rechazo o fallo de una oferta, mandado con sendBeacon desde la pantalla. */
export async function POST(req: NextRequest) {
  const { sessionId, productSlug, event } = await req.json().catch(() => ({}));
  if (!sessionId || !productSlug || !["decline", "fail"].includes(event)) return NextResponse.json({ ok: false }, { status: 400 });
  const order = await findOrder(String(sessionId));
  if (!order || order.status !== "paid") return NextResponse.json({ ok: false }, { status: 403 });
  const chain = await resolveChain(order);
  const product = chain.steps.find((p) => p.slug === productSlug);
  if (!product) return NextResponse.json({ ok: false }, { status: 404 });
  await logUpsellEvent({ storeId: order.store_id, orderId: order.id, ppFunnelId: chain.ppFunnelId, productId: product.id, event });
  return NextResponse.json({ ok: true });
}
