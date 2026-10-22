import { db } from "./db";
import { stripeForStore, storeIdForPaymentIntent } from "./stripe";
import { fulfill } from "./fulfill";
import { fromMinor } from "./fx";
import { conexionDe, verPago } from "./whop";
import { PREFIJO as WHOP, entregarPagoWhop, resolverPagoWhop } from "./whop-events";
import { TEST_PREFIX } from "./test-purchase";

/**
 * Busca el pedido venga de donde venga.
 *
 * El checkout propio vuelve con ?payment_intent=pi_... y el hosted con
 * ?session_id=cs_.... Con Whop vuelve con ?payment=... Los tres tienen que
 * llegar a la misma pantalla.
 *
 * `tienda` solo hace falta para el rescate de Whop: la dirección de vuelta que
 * le damos a Whop la lleva siempre.
 */
export async function findOrder(ref: string | undefined, tienda?: string | null) {
  if (!ref) return null;
  const found = await lookup(ref);

  // Whop devuelve al comprador antes de que llegue su webhook, igual que
  // Stripe. Si el pedido no está o está pendiente, se le pregunta a Whop y se
  // entrega por el mismo camino que usa el webhook (fulfill es idempotente).
  if (esWhop(ref)) {
    if (found && found.status !== "pending") return found;
    return (await rescatarWhop(ref, tienda)) ?? found;
  }
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
    completarComprador: async (email, name) => {
      if (!pi.customer) return;
      await stripe.customers.update(String(pi.customer), { email, name: name ?? undefined });
    },
    paymentId: pi.id,
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

/**
 * Un pago de Whop, por descarte. No se mira el prefijo de Whop a propósito: si
 * algún día cambia, mirar los nuestros -- que sí controlamos -- sigue andando.
 */
const esWhop = (ref: string) =>
  !ref.startsWith("pi_") && !ref.startsWith("cs_") && !ref.startsWith(TEST_PREFIX);

/**
 * Le pregunta a Whop cómo quedó el pago y lo entrega. Devuelve el pedido ya
 * guardado, o null si todavía no está cobrado.
 */
async function rescatarWhop(ref: string, tiendaSlug?: string | null) {
  if (!tiendaSlug) return null;
  const { data: st } = await db.from("stores").select("id").eq("slug", tiendaSlug).maybeSingle();
  if (!st) return null;
  const conn = await conexionDe(st.id);
  if (!conn) return null;
  try {
    const pago = await verPago(conn.apiKey, ref);
    const cobrado = pago.status === "paid" || pago.status === "succeeded";
    // Un pago que no se cobró no genera pedido: la pantalla muestra «en proceso».
    if (!cobrado && pago.status !== "processing" && pago.status !== "pending") return null;
    if (pago.metadata?.source !== "checkout-propio") return null;
    const quien = await resolverPagoWhop(st.id, pago);
    if (!quien) return null;
    await entregarPagoWhop(pago, quien, cobrado);
  } catch (e) {
    console.error("[gracias] rescate whop:", (e as Error).message);
    return null;
  }
  return lookup(ref);
}

async function lookup(ref: string) {
  // Los pedidos de Whop se guardan con el prefijo whop: en la misma columna.
  //
  // Las compras de PRUEBA del panel tambien viven en `stripe_session_id` (no
  // hay pago, asi que no hay id de pago que guardar). Sin contemplarlas aca,
  // la referencia `test_...` se buscaba en la columna equivocada y la pantalla
  // final decia «no encontramos tu pedido» con el pedido creado, las entregas
  // listas y el upsell ya registrado. Medido el 22/10/2026 sobre
  // test_DPFUxKJMpPvU: el recorrido entero funcionaba menos la ultima pagina.
  const col = ref.startsWith("cs_") || ref.startsWith(TEST_PREFIX)
    ? "stripe_session_id"
    : "stripe_payment_intent";
  const valor = esWhop(ref) ? WHOP + ref : ref;
  const { data, error } = await db
    .from("orders")
    .select("id,store_id,funnel_id,pp_funnel_id,status,locale,currency,email,name")
    .eq(col, valor)
    .maybeSingle();
  // Base caída ≠ «no existe»: con error, la página muestra «tu pago está
  // confirmado, reintentá» (error.tsx) en vez de «no encontramos tu pedido».
  if (error) throw new Error(`orders: ${error.message}`);
  return data;
}

/**
 * El identificador que llevamos de una pantalla a la otra.
 *
 * Con Whop se aceptan varios nombres: el que ponemos nosotros al navegar
 * (`payment`) y los que puede agregar Whop al devolver al comprador después de
 * una verificación del banco. Es barato aceptar los tres y caro equivocarse:
 * el que no reconoce el id ve «no encontramos tu pedido» después de pagar.
 */
export function refOf(sp: {
  session_id?: string; payment_intent?: string; payment?: string; payment_id?: string;
}) {
  return sp.payment_intent ?? sp.session_id ?? sp.payment ?? sp.payment_id;
}
