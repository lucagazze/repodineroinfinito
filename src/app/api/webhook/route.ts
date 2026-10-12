import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeWith } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-events";

export const runtime = "nodejs";

/**
 * Webhook viejo, de una sola cuenta (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET).
 * Queda para el modo test en local (`stripe listen`). Las tiendas conectadas
 * desde el panel usan /api/stripe/webhook/[storeId].
 */
export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) return NextResponse.json({ error: "Webhook global sin configurar" }, { status: 404 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  const stripe = stripeWith(key);
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("[webhook] firma inválida:", (err as Error).message);
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  try {
    const slug = (event.data.object as { metadata?: Stripe.Metadata }).metadata?.store ?? null;
    const { data: store } = slug
      ? await db.from("stores").select("id").eq("slug", slug).maybeSingle()
      : { data: null };
    const r = await handleStripeEvent(event, { stripe, storeId: store?.id ?? null, storeSlug: null });
    return NextResponse.json({ received: true, ...r });
  } catch (err) {
    console.error("[webhook] fallo procesando", event.type, err);
    return NextResponse.json({ error: "fallo" }, { status: 500 });
  }
}
