import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { stripeForStore } from "@/lib/stripe";
import { db } from "@/lib/db";
import { recordUpsell } from "@/lib/upsell";
import { LIB_COOKIE, readLibrary } from "@/lib/library-auth";

export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store" };

/**
 * Un pago de la biblioteca confirmado en el navegador (3DS, la hoja, una redirección): se mira en Stripe y,
 * si está cobrado y es de un pedido de este comprador, se registra (entrega incluida). { pi }
 */
export async function POST(req: NextRequest) {
  const { pi } = (await req.json().catch(() => ({}))) as { pi?: string };
  const auth = readLibrary((await cookies()).get(LIB_COOKIE)?.value);
  if (!auth || auth.admin) return NextResponse.json({ error: "auth" }, { status: 401, headers: NO_STORE });
  if (!pi || !/^pi_[A-Za-z0-9]+$/.test(pi)) return NextResponse.json({ error: "pi" }, { status: 400, headers: NO_STORE });
  const { stripe } = await stripeForStore(auth.storeId);
  const intent = await stripe.paymentIntents.retrieve(pi).catch(() => null);
  if (!intent || intent.metadata?.source !== "biblioteca" || !intent.metadata.order) return NextResponse.json({ error: "pi" }, { status: 404, headers: NO_STORE });
  const { data: order } = await db.from("orders").select("id,email,store_id").eq("id", intent.metadata.order).maybeSingle();
  if (!order || order.store_id !== auth.storeId || String(order.email ?? "").toLowerCase() !== auth.email) {
    return NextResponse.json({ error: "pi" }, { status: 403, headers: NO_STORE });
  }
  if (intent.status === "processing") return NextResponse.json({ ok: false, processing: true }, { headers: NO_STORE });
  if (intent.status !== "succeeded") return NextResponse.json({ ok: false, status: intent.status }, { headers: NO_STORE });
  await recordUpsell(order.id, intent, { stripe });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
