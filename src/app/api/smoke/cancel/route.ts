import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Solo para scripts/smoke.mjs (header x-smoke = SMOKE_SECRET): anula el
 * PaymentIntent que la prueba acaba de crear con /api/pi y borra su fila de
 * checkouts, así no queda como carrito abandonado ni dispara mails.
 *
 * Nunca toca un pago real: solo un PI de este checkout, creado hace menos de
 * 10 minutos, sin confirmar (sin medio de pago) y cuyo checkout no tiene email.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SMOKE_SECRET ?? "";
  const got = Buffer.from(req.headers.get("x-smoke") ?? "");
  if (!secret || got.length !== Buffer.from(secret).length || !timingSafeEqual(got, Buffer.from(secret))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { pi, store } = await req.json().catch(() => ({}));
  if (!/^pi_[A-Za-z0-9]+$/.test(String(pi ?? "")) || !store) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const { data: st } = await db.from("stores").select("id").eq("slug", String(store)).maybeSingle();
  if (!st) return NextResponse.json({ error: "Tienda inexistente" }, { status: 404 });
  const { data: ck } = await db.from("checkouts").select("id,email").eq("stripe_payment_intent", pi).eq("store_id", st.id).maybeSingle();
  if (ck?.email) return NextResponse.json({ error: "Ese checkout tiene email: no es de la prueba" }, { status: 409 });

  const { stripe } = await stripeForStore(st.id);
  const intent = await stripe.paymentIntents.retrieve(String(pi));
  const fresh = Date.now() / 1000 - intent.created < 600;
  if (intent.metadata?.source !== "checkout-propio" || !fresh || intent.payment_method || intent.status !== "requires_payment_method") {
    return NextResponse.json({ error: "No es un pago de prueba anulable", status: intent.status }, { status: 409 });
  }
  const canceled = await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "abandoned" });
  if (ck) await db.from("checkouts").delete().eq("id", ck.id);
  // El Customer vacío que /api/pi creó para este intento (sin email: nadie real).
  if (typeof intent.customer === "string") {
    const c = await stripe.customers.retrieve(intent.customer).catch(() => null);
    if (c && !c.deleted && !c.email) await stripe.customers.del(c.id).catch(() => null);
  }
  return NextResponse.json({ ok: true, status: canceled.status, amount: canceled.amount, currency: canceled.currency });
}
