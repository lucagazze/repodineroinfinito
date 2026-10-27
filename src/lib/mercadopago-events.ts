import { db } from "@/lib/db";
import {
  clasificarPago, leerPagoAutorizado, leerPreapproval, leerPago, montoDe, pagoAcreditado,
  type PagoAutorizado, type Preapproval,
} from "@/lib/mercadopago";
import { fulfill } from "@/lib/fulfill";

/**
 * Los eventos de suscripcion de Mercado Pago.
 *
 * COMO LLEGAN
 *   La notificacion es un aviso, NO el hecho: trae `{type, action, data.id}` y
 *   nada mas. El dato real se va a buscar a la API con ese id. Eso no es
 *   ceremonia: un cuerpo de webhook se puede falsificar, y aunque la firma ya
 *   valido, leer el recurso de la fuente es lo que garantiza que el importe que
 *   se acredita es el que Mercado Pago cobro de verdad.
 *
 *   Dos tipos nos importan:
 *     subscription_preapproval          la suscripcion cambio de estado
 *     subscription_authorized_payment   se cobro (o se rechazo) el mes
 *
 * LA REGLA QUE NO SE ROMPE
 *   Nunca se da de alta una suscripcion desde un evento de preapproval: un
 *   alta sin pago no existe. Solo el cobro crea la fila. Es la misma regla que
 *   en `membresiaWhop`, y existe porque un preapproval en `pending` es alguien
 *   que empezo a suscribirse y puede no terminar nunca.
 */

export type ResultadoEvento = Record<string, unknown>;

type Aviso = {
  type?: string | null;
  topic?: string | null;
  action?: string | null;
  data?: { id?: string | number | null } | null;
};

/** El id del recurso, que puede venir en `data.id` o en `resource` segun el tipo. */
function idDelAviso(e: Aviso): string | null {
  const d = e.data?.id;
  if (typeof d === "string" && d) return d;
  if (typeof d === "number" && Number.isFinite(d)) return String(d);
  return null;
}

export async function manejarEventoMercadoPago(
  evento: Record<string, unknown>,
  ctx: { storeId: string; token: string },
): Promise<ResultadoEvento> {
  const e = evento as Aviso;
  // `topic` es la forma vieja de la misma cosa; las dos conviven segun como se
  // registro el webhook.
  const tipo = (e.type ?? e.topic ?? "").toString();
  const id = idDelAviso(e);

  if (!id) {
    await crudo(ctx.storeId, `${tipo || "sin tipo"} sin data.id`, evento);
    return { ignorado: "sin data.id" };
  }

  if (tipo === "payment") {
    return compra(ctx, id, evento);
  }
  if (tipo === "subscription_authorized_payment") {
    return cobro(ctx, id, evento);
  }
  if (tipo === "subscription_preapproval" || tipo === "preapproval") {
    return cambioDeEstado(ctx, id, evento);
  }

  // Un tipo que no manejamos no es un error: Mercado Pago manda varios y el
  // webhook puede estar suscripto a mas de los que nos importan.
  return { ignorado: tipo || "sin tipo" };
}

// ------------------------------------------------------- la compra de una vez

/**
 * `payment`: el cobro de Checkout Pro. Es lo que entrega el kit.
 *
 * El aviso trae solo un id: el pago se lee de la API. Eso no es ceremonia --
 * un cuerpo se puede falsificar, y aunque la firma ya valido, leer el recurso
 * de la fuente es lo que garantiza que el importe que se entrega es el que
 * Mercado Pago cobro de verdad.
 *
 * `fulfill` es la MISMA funcion que usa Whop: no hay una entrega por pasarela.
 * Lo unico propio de aqui es traducir el pago a sus argumentos.
 */
async function compra(
  ctx: { storeId: string; token: string }, pagoId: string, evento: unknown,
): Promise<ResultadoEvento> {
  const pago = await leerPago(ctx.token, pagoId);
  const meta = (pago.metadata ?? {}) as Record<string, string>;

  // Sin tienda ni embudo la entrega no sabe que mandar. Pasa si el pago se creo
  // fuera de nuestro checkout (un link de pago hecho a mano en el panel de
  // Mercado Pago, por ejemplo): se anota y no se inventa nada.
  if (!meta.store || !meta.funnel) {
    await crudo(ctx.storeId,
      `pago ${pagoId} sin metadata de tienda/embudo (external_reference: ${pago.external_reference ?? "—"})`,
      { evento, pago });
    return { ignorado: "pago sin metadata" };
  }

  const acreditado = pagoAcreditado(pago);
  const importe = Number(pago.transaction_amount);
  if (acreditado && !(Number.isFinite(importe) && importe > 0)) {
    // Error a proposito: Mercado Pago reintenta. Entregar con importe 0 deja
    // el balance mintiendo y no se puede corregir despues.
    throw new Error(`pago ${pagoId} aprobado y sin importe legible`);
  }

  const nombre = [pago.payer?.first_name, pago.payer?.last_name].filter(Boolean).join(" ")
    || pago.additional_info?.payer?.first_name || null;

  await fulfill({
    provider: "mercadopago",
    // Mismo prefijo que Whop por el mismo motivo: la columna se llama
    // stripe_payment_intent y es anterior a que hubiera mas de una pasarela.
    paymentId: `mercadopago:${pago.id}`,
    customerId: null,
    email: (pago.payer?.email ?? "").trim().toLowerCase() || null,
    name: nombre,
    phone: null,
    country: null,
    currency: (pago.currency_id ?? "ars").toLowerCase(),
    amountTotal: Number.isFinite(importe) ? importe : 0,
    metadata: meta,
    // `paid` decide si se entrega. Un pago en efectivo (Rapipago) entra como
    // `pending` y se vuelve `approved` cuando la persona paga en el local:
    // Mercado Pago manda OTRO aviso, y ahi si entrega.
    paid: acreditado,
  });

  return { compra: pagoId, estado: pago.status, entregado: acreditado };
}

// ------------------------------------------------------------------ el cobro

async function cobro(
  ctx: { storeId: string; token: string }, pagoId: string, evento: unknown,
): Promise<ResultadoEvento> {
  const pago = await leerPagoAutorizado(ctx.token, pagoId);
  const preapprovalId = pago.preapproval_id ?? null;
  if (!preapprovalId) {
    await crudo(ctx.storeId, `pago autorizado ${pagoId} sin preapproval_id`, evento);
    return { ignorado: "pago sin preapproval_id" };
  }

  const clase = clasificarPago(pago);
  if (clase === "desconocido") {
    // NO SE INTERPRETA. Tomar un rechazo por un cobro regala acceso; tomar un
    // cobro por un rechazo deja a alguien que pago sin lo que compro. Queda
    // crudo en la bitacora para mirarlo y se contesta 200: reintentar no va a
    // cambiar un estado que ya es el que es.
    await crudo(ctx.storeId,
      `pago autorizado ${pagoId} con estado que no se reconoce: ` +
      `status=${pago.status ?? "?"} payment.status=${pago.payment?.status ?? "?"}. ` +
      `NO se acredito ni se marco rechazado.`, { evento, pago });
    return { atencion: "estado desconocido", status: pago.status, pago: pagoId };
  }

  const quien = await suscripcionDePreapproval(ctx, preapprovalId);
  if (!quien) {
    await crudo(ctx.storeId,
      `pago autorizado ${pagoId} de un preapproval que no se pudo atribuir: ${preapprovalId}`,
      { evento, pago });
    return { ignorado: "preapproval sin producto" };
  }

  if (clase === "rechazado") {
    const { data, error } = await db.rpc("sub_fallo", {
      p_store: ctx.storeId,
      p_email: quien.email,
      p_payment: String(pago.id ?? pagoId),
      p_product: quien.productId,
      p_membership: preapprovalId,
      p_motivo: motivoDe(pago),
      p_provider: "mercadopago",
    });
    if (error) throw new Error(`sub_fallo: ${error.message}`);
    return { fallo: data };
  }

  const importe = montoDe(pago);
  if (importe === null) {
    // Error a proposito: Mercado Pago reintenta. Acreditar un cobro sin importe
    // suma 0 al total y deja el MRR mintiendo para siempre, porque el indice de
    // idempotencia impide corregirlo despues.
    throw new Error(`pago autorizado ${pagoId} sin importe legible`);
  }

  const { data, error } = await db.rpc("sub_cobro", {
    p_store: ctx.storeId,
    p_product: quien.productId,
    p_email: quien.email,
    p_payment: String(pago.id ?? pagoId),
    p_amount: importe,
    p_currency: (pago.currency_id ?? quien.moneda ?? "ars").toLowerCase(),
    p_name: null,
    p_locale: null,
    p_country: null,
    p_membership: preapprovalId,
    p_plan: null,
    p_member: quien.payerId,
    p_pm: null,
    p_period_days: quien.dias,
    // Mercado Pago dice cuando vuelve a cobrar. Vale mas que sumarle 30 dias
    // al cobro de hoy, y de esto depende hasta cuando entra alguien de baja.
    p_period_end: quien.proximoCobro,
    p_founder: false,
    p_provider: "mercadopago",
  });
  if (error) throw new Error(`sub_cobro: ${error.message}`);
  return { cobro: data };
}

function motivoDe(p: PagoAutorizado): string {
  const partes = [
    p.payment?.status_detail, p.payment?.status, p.status,
    p.retry_attempt ? `intento ${p.retry_attempt}` : null,
  ].filter((x): x is string => typeof x === "string" && !!x);
  return partes.join(" · ").slice(0, 400) || "sin motivo informado";
}

// ------------------------------------------------------- de quien es el cobro

/**
 * A que producto y a que correo corresponde este preapproval.
 *
 * Se mira primero NUESTRA base: si la suscripcion ya existe, la renovacion no
 * necesita preguntarle nada a Mercado Pago. Si no existe -- el primer cobro --
 * se lee el preapproval, y de ahi salen el correo y el `external_reference`,
 * que es el id del producto que pusimos al crearlo.
 */
async function suscripcionDePreapproval(
  ctx: { storeId: string; token: string }, preapprovalId: string,
) {
  const { data: sub } = await db
    .from("subscriptions")
    .select("product_id,email,external_customer_id,currency,billing_period_days")
    .eq("store_id", ctx.storeId).eq("provider", "mercadopago")
    .eq("external_id", preapprovalId)
    .maybeSingle();

  let pre: Preapproval | null = null;
  try {
    pre = await leerPreapproval(ctx.token, preapprovalId);
  } catch {
    // Si la suscripcion ya esta en la base, una lectura fallida no bloquea la
    // renovacion: ya sabemos de quien es.
    if (!sub) return null;
  }

  const productId = (sub?.product_id as string | undefined)
    ?? (pre?.external_reference ?? undefined);
  const email = ((sub?.email as string | undefined) ?? pre?.payer_email ?? "").trim().toLowerCase();
  if (!productId || !email) return null;

  // El producto tiene que ser de ESTA tienda y ser una suscripcion. Sin esta
  // comprobacion, un `external_reference` manipulado podria apuntar al producto
  // de otra tienda -- y `sub_cobro` crearia la fila igual.
  const { data: prod } = await db
    .from("products").select("id,billing_period_days,subscription")
    .eq("id", productId).eq("store_id", ctx.storeId).eq("subscription", true)
    .maybeSingle();
  if (!prod) return null;

  return {
    productId,
    email,
    payerId: pre?.payer_id != null ? String(pre.payer_id)
      : ((sub?.external_customer_id as string | null) ?? null),
    moneda: pre?.auto_recurring?.currency_id ?? (sub?.currency as string | undefined) ?? null,
    dias: (prod.billing_period_days as number | null)
      ?? (sub?.billing_period_days as number | null) ?? null,
    proximoCobro: pre?.next_payment_date ?? null,
  };
}

// --------------------------------------------------------- cambio de estado

/**
 * `subscription_preapproval`: la suscripcion cambio de estado.
 *
 * Lo que este evento aporta y el cobro no: la BAJA hecha desde Mercado Pago,
 * donde no llega ningun pago. Sin esto, alguien que cancela desde su cuenta de
 * Mercado Pago seguiria figurando con acceso hasta que el cobro no llegue.
 */
async function cambioDeEstado(
  ctx: { storeId: string; token: string }, preapprovalId: string, evento: unknown,
): Promise<ResultadoEvento> {
  const pre = await leerPreapproval(ctx.token, preapprovalId);
  const estado = (pre.status ?? "").toLowerCase();

  const { data: sub } = await db
    .from("subscriptions").select("id,email,status,current_period_end")
    .eq("store_id", ctx.storeId).eq("provider", "mercadopago")
    .eq("external_id", preapprovalId)
    .maybeSingle();

  if (!sub) {
    // No es un error: un preapproval en `pending` es alguien que empezo a
    // suscribirse y todavia no pago. Queda anotado y no se crea nada.
    await crudo(ctx.storeId,
      `preapproval ${preapprovalId} en «${estado}» sin suscripcion en la base`, { evento, pre });
    return { ignorado: "preapproval sin suscripcion", estado };
  }

  // Lo que Mercado Pago sabe mejor que nosotros se guarda siempre.
  const guardar: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (pre.next_payment_date) guardar.current_period_end = pre.next_payment_date;
  if (pre.payer_id != null) guardar.external_customer_id = String(pre.payer_id);
  const monto = pre.auto_recurring?.transaction_amount;
  if (typeof monto === "number" && monto > 0) guardar.amount = monto;
  await db.from("subscriptions").update(guardar).eq("id", sub.id);

  if (estado === "cancelled") {
    // El acceso se respeta hasta el fin de periodo que Mercado Pago informa:
    // `sub_baja` sin `p_ya` deja `canceled`, y la vista de acceso sigue
    // viendolo mientras ese periodo no venza. Se dio de baja, no pidio que se
    // le devuelva lo que ya pago.
    const { error } = await db.rpc("sub_baja", {
      p_id: sub.id,
      p_motivo: "baja informada por Mercado Pago (preapproval cancelled)",
      p_ya: false,
    });
    if (error) throw new Error(`sub_baja: ${error.message}`);
    return { baja: sub.id, hasta: pre.next_payment_date ?? sub.current_period_end };
  }

  await db.from("subscription_events").insert({
    store_id: ctx.storeId, subscription_id: sub.id, email: sub.email,
    kind: "desconocido", provider: "mercadopago", external_id: preapprovalId,
    detail: `preapproval en «${estado}»`, raw: evento as never,
  });
  return { visto: estado, suscripcion: sub.id };
}

// ------------------------------------------------------------------ bitacora

/** Lo que no se entiende se guarda crudo, nunca se interpreta ni se descarta. */
async function crudo(storeId: string, detalle: string, raw: unknown) {
  console.error("[mercadopago]", detalle);
  await db.from("subscription_events").insert({
    store_id: storeId, kind: "desconocido", provider: "mercadopago",
    detail: detalle.slice(0, 400), raw: raw as never,
  });
}
