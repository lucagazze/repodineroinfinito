import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/secrets";
import { stripeWith } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-events";

export const runtime = "nodejs";

/**
 * Webhook de UNA tienda. Lo crea solo el panel al conectar Stripe, con su
 * propio secreto: un pago de una cuenta nunca se verifica con la llave de otra.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  const { data: conn } = await db
    .from("store_stripe")
    .select("secret_key_enc,webhook_secret_enc,stores(slug)")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!conn?.webhook_secret_enc) return NextResponse.json({ error: "Tienda sin Stripe conectado" }, { status: 404 });

  const stripe = stripeWith(decrypt(conn.secret_key_enc));
  // Cuerpo crudo: si Next lo parsea, la firma no valida.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, decrypt(conn.webhook_secret_enc));
  } catch (err) {
    console.error("[webhook]", storeId, "firma inválida:", (err as Error).message);
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  try {
    const slug = (conn.stores as unknown as { slug: string } | null)?.slug ?? null;
    const r = await handleStripeEvent(event, { stripe, storeId, storeSlug: slug });
    return NextResponse.json({ received: true, ...r });
  } catch (err) {
    // 500 a propósito: Stripe reintenta hasta 3 días. Mejor eso que perder
    // la entrega de una venta ya cobrada.
    console.error("[webhook]", storeId, "fallo procesando", event.type, err);
    return NextResponse.json({ error: "fallo" }, { status: 500 });
  }
}
