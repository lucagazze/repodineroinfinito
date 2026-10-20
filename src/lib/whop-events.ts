import { db } from "@/lib/db";
import { applyRefund, fulfill } from "@/lib/fulfill";
import { DEFAULT_LOCALE, pickLocale } from "@/lib/i18n";
import { aNumero, montoCobrado, type PagoWhop } from "@/lib/whop";

/**
 * Qué hacer con cada evento de Whop.
 *
 * Aparte de `src/app/api/whop/webhook/[storeId]/route.ts` para que la ruta se
 * quede solo con verificar la firma, y esto se pueda leer (y probar) sin
 * levantar un servidor.
 */

/** Prefijo en `orders.stripe_payment_intent` para que un id de Whop no se confunda con uno de Stripe. */
export const PREFIJO = "whop:";

type Evento = { action?: string; type?: string; data?: unknown };

/**
 * De qué embudo y producto es este pago.
 *
 * Primero la metadata que pusimos al crear la variante en Whop; si no vino
 * —un pago hecho desde el propio Whop, por ejemplo—, se resuelve por el plan.
 * Sin ninguno de los dos no se puede saber qué archivo entregar.
 */
async function resolver(storeId: string, pago: PagoWhop) {
  const meta = pago.metadata ?? {};
  if (meta.embudo && meta.tienda) {
    return { tienda: meta.tienda, embudo: meta.embudo, via: "metadata" as const };
  }

  const planId = pago.plan?.id;
  if (!planId) return null;

  // Por el plan del producto principal del embudo.
  const { data: f } = await db
    .from("funnels")
    .select("slug,stores(slug)")
    .eq("store_id", storeId)
    .eq("whop_plan_id", planId)
    .maybeSingle();
  if (f) {
    const s = (f.stores as unknown as { slug: string } | null)?.slug;
    if (s) return { tienda: s, embudo: f.slug as string, via: "funnel.whop_plan_id" as const };
  }

  // O por el producto, buscando después a qué embudo pertenece.
  const { data: p } = await db
    .from("products")
    .select("id,slug,stores(slug)")
    .eq("store_id", storeId)
    .eq("whop_plan_id", planId)
    .maybeSingle();
  if (!p) return null;
  const { data: f2 } = await db
    .from("funnels")
    .select("slug")
    .eq("store_id", storeId)
    .eq("main_product_id", p.id)
    .maybeSingle();
  const s = (p.stores as unknown as { slug: string } | null)?.slug;
  if (!f2 || !s) return null;
  return { tienda: s, embudo: f2.slug as string, via: "products.whop_plan_id" as const };
}

/**
 * Convierte un pago de Whop en un pedido entregado.
 *
 * Vive aparte porque la llaman DOS caminos: el webhook `payment.succeeded` y la
 * página de gracias cuando el comprador llega antes que el webhook. Tiene que
 * ser una sola función: si cada camino armara el pedido a su manera, un día
 * entregarían cosas distintas por el mismo pago. `fulfill` es idempotente, así
 * que no importa quién llegue primero.
 */
export async function entregarPagoWhop(
  pago: PagoWhop,
  quien: { tienda: string; embudo: string },
  cobrado: boolean,
) {
  // El id del medio de pago guardado llega acá y en ningún otro lado: es lo
  // que después permite cobrar el upsell de 1 clic sin pedir la tarjeta.
  // En la RAIZ del pago, no anidados. Medido el 20/10/2026 contra un pago real:
  // `member.id` y `payment_method.id` no existen, y leerlos de ahi dejaba los
  // dos campos en null -- o sea, sin la tarjeta guardada no hay upsell de 1
  // clic, que es justo para lo que pedimos setup_future_usage.
  const guardar: Record<string, unknown> = {};
  const miembro = pago.member_id ?? pago.member?.id;
  const medio = pago.payment_method_id ?? pago.payment_method?.id;
  if (miembro) guardar.whop_member_id = miembro;
  if (medio) guardar.whop_payment_method_id = medio;
  // Lo que de verdad entra al balance, despues de las comisiones de Whop.
  const neto = aNumero(pago.amount_after_fees);
  if (neto !== null) guardar.net_amount = neto;

  // El correo NO viene en el pago: Whop solo da id, username y name. Y sin
  // correo `fulfill` tira error y el comprador, que ya pago, no recibe nada.
  // El dato esta en la fila del checkout, enlazada por metadata.checkout.
  const correo = await correoDe(pago);

  await fulfill({
    provider: "whop",
    paymentId: PREFIJO + pago.id,
    customerId: pago.user?.id ?? null,
    email: correo,
    name: pago.user?.name ?? null,
    phone: null,
    country: pago.billing_address?.country ?? null,
    currency: pago.currency ?? "usd",
    amountTotal: montoCobrado(pago),
    metadata: { ...(pago.metadata ?? {}), store: quien.tienda, funnel: quien.embudo,
                locale: idiomaDe(pago) },
    paid: cobrado,
  });

  if (Object.keys(guardar).length) {
    await db.from("orders").update(guardar).eq("stripe_payment_intent", PREFIJO + pago.id);
  }
}

/**
 * En que idioma se le escribe al comprador.
 *
 * Primero el pais de la TARJETA (`billing_address.country`): es el dato mas
 * fiable de donde esta esa persona. La IP que se capturo al abrir el checkout
 * queda de respaldo -- sirve, pero una VPN o un viaje la corren de lugar.
 *
 * El pais manda sobre el idioma del navegador a proposito: alguien con el
 * telefono en ingles comprando desde Mexico prefiere leer en espanol.
 */
function idiomaDe(pago: PagoWhop) {
  const pais = pago.billing_address?.country;
  if (pais) {
    const porPais = pickLocale({ country: pais });
    if (porPais) return porPais;
  }
  return (pago.metadata ?? {}).locale ?? DEFAULT_LOCALE;
}

/**
 * El correo del comprador.
 *
 * Whop NO lo manda en el pago (medido el 20/10/2026: `user` trae id, username
 * y name, nada mas). Se saca de la fila del checkout, que lo guarda apenas el
 * comprador lo escribe -- el mismo dato que alimenta la recuperacion de carrito.
 *
 * Si falta, se devuelve null y `fulfill` falla a proposito: es preferible que
 * el webhook de error y Whop reintente, a registrar una venta entregada que no
 * se entrego a nadie.
 */
async function correoDe(pago: PagoWhop): Promise<string | null> {
  // `customer_email` es el que llega de verdad; `user.email` no viene.
  const directo = pago.customer_email?.trim() || pago.user?.email?.trim();
  if (directo) return directo;
  const ck = pago.metadata?.checkout;
  if (!ck) return null;
  const { data } = await db.from("checkouts").select("email").eq("id", ck).maybeSingle();
  return (data?.email as string | undefined)?.trim() || null;
}

/** Resuelve a qué tienda/embudo corresponde un pago. Expuesto para la página de gracias. */
export const resolverPagoWhop = resolver;

export async function manejarEventoWhop(ev: Evento, ctx: { storeId: string }) {
  const tipo = ev.action ?? ev.type ?? "";
  const dato = (ev.data ?? {}) as PagoWhop & { payment?: PagoWhop; amount?: number; total?: boolean };

  // --------------------------------------------------------------- cobros
  if (tipo === "payment.succeeded" || tipo === "payment.pending") {
    const pago = (dato.payment ?? dato) as PagoWhop;
    if (!pago?.id) return { ignorado: "pago sin id" };

    const quien = await resolver(ctx.storeId, pago);
    if (!quien) {
      // Se tira error a propósito: Whop reintenta y queda a la vista. Un pago
      // cobrado que no se sabe entregar no puede perderse en silencio.
      throw new Error(`pago ${pago.id} sin embudo: ni metadata ni plan conocido (plan=${pago.plan?.id ?? "-"})`);
    }

    await entregarPagoWhop(pago, quien, tipo === "payment.succeeded");
    return { entregado: pago.id, via: quien.via };
  }

  // ----------------------------------------------------------- reembolsos
  if (tipo === "refund.created" || tipo === "refund.updated") {
    const pagoId = (dato as { payment_id?: string; payment?: { id?: string } }).payment_id
      ?? (dato as { payment?: { id?: string } }).payment?.id;
    if (!pagoId) return { ignorado: "reembolso sin pago" };
    const devuelto = Number((dato as { amount?: number }).amount ?? 0);

    // Para saber si se devolvió TODO hay que comparar contra lo cobrado: Whop
    // no manda una bandera equivalente al `refunded` de Stripe.
    const { data: o } = await db
      .from("orders").select("amount_total")
      .eq("stripe_payment_intent", PREFIJO + pagoId).maybeSingle();
    const total = !!o && devuelto >= Number(o.amount_total) - 0.01;

    await applyRefund({ paymentId: PREFIJO + pagoId, refunded: devuelto, total });
    return { reembolsado: pagoId, total };
  }

  // Lo demás se registra y se contesta 200: un evento que no manejamos no es
  // un fallo, y devolver error haría que Whop reintente para siempre.
  return { ignorado: tipo };
}
