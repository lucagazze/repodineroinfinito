import { db } from "./db";
import { stripeForStore, storeIdForPaymentIntent } from "./stripe";
import { fulfill } from "./fulfill";
import { fromMinor } from "./fx";

/**
 * Busca el pedido venga de donde venga.
 *
 * El checkout propio vuelve con ?payment_intent=pi_... y el hosted con
 * ?session_id=cs_.... Los dos tienen que llegar a la misma pantalla.
 */
export async function findOrder(ref: string | undefined) {
  if (!ref) return null;
  const found = await lookup(ref);
  // Un pedido «pending» (el pago estaba procesando) se vuelve a mirar en
  // Stripe: apenas se cobra pasa a pagado, sin esperar al webhook.
  if ((found && found.status !== "pending") || !ref.startsWith("pi_")) return found;

  // Stripe redirige al comprador antes de que llegue el webhook. Si el
  // pedido todavía no existe, lo resolvemos nosotros preguntándole a Stripe
  // — fulfill es idempotente, así que no importa quién llegue primero.
  const storeId = await storeIdForPaymentIntent(ref);
  if (!storeId) return found;
  const { stripe } = await stripeForStore(storeId);
  const pi = await stripe.paymentIntents.retrieve(ref, { expand: ["latest_charge"] });
  if (found && pi.status !== "succeeded") return found;
  if (pi.status !== "succeeded" && pi.status !== "processing") return null;
  if (pi.metadata?.source !== "checkout-propio") return null;
  const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const bd = ch?.billing_details;
  // Si el mail falla, el webhook lo reintenta; el comprador igual ve su descarga.
  await fulfill({
    stripe,
    paymentIntentId: pi.id,
    customerId: pi.customer ? String(pi.customer) : null,
    email: bd?.email ?? pi.receipt_email ?? null,
    name: bd?.name ?? null,
    phone: bd?.phone ?? null,
    country: bd?.address?.country ?? null,
    currency: pi.currency,
    amountTotal: fromMinor(pi.status === "succeeded" ? pi.amount_received : pi.amount, pi.currency),
    metadata: pi.metadata ?? {},
    paid: pi.status === "succeeded",
  }).catch((e) => console.error("[gracias] fulfill:", (e as Error).message));
  return lookup(ref);
}

async function lookup(ref: string) {
  const col = ref.startsWith("pi_") ? "stripe_payment_intent" : "stripe_session_id";
  const { data, error } = await db
    .from("orders")
    .select("id,store_id,funnel_id,pp_funnel_id,status,locale,currency,email,name")
    .eq(col, ref)
    .maybeSingle();
  // Base caída ≠ «no existe»: con error, la página muestra «tu pago está
  // confirmado, reintentá» (error.tsx) en vez de «no encontramos tu pedido».
  if (error) throw new Error(`orders: ${error.message}`);
  return data;
}

/** El identificador que llevamos de una pantalla a la otra. */
export function refOf(sp: { session_id?: string; payment_intent?: string }) {
  return sp.payment_intent ?? sp.session_id;
}
