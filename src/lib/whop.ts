import { db } from "@/lib/db";
import { decrypt } from "@/lib/secrets";

/**
 * Cobrar con Whop, en paralelo a Stripe.
 *
 * Lo que cambia respecto de Stripe y condiciona todo lo demas:
 *  - Todo lo que se cobra es una VARIANTE ya creada en Whop (el campo sigue
 *    llamandose plan_id), asi que cada producto nuestro lleva su whop_plan_id.
 *    Varias variantes entran en un mismo cobro con `line_items`: con eso los
 *    order bumps funcionan sin inventar una variante por combinacion.
 *  - Cobrar con la tarjeta guardada es ASINCRONO: `payments.create` contesta
 *    enseguida con el pago abierto y el resultado llega despues por webhook.
 *    El post-pago de 1 clic no puede dar por buena la respuesta inmediata.
 */

export { verificarFirma, TOLERANCIA_SEGUNDOS } from "@/lib/whop-firma";

const API = "https://api.whop.com/api/v1";

// ---------------------------------------------------------------- cliente

export class WhopError extends Error {
  status: number;
  body: unknown;
  // Campos declarados aparte y no como propiedades del constructor: las pruebas
  // del repo corren con el modo "solo quitar tipos" de Node, que no las admite.
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function pedir<T>(apiKey: string, ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const texto = await r.text();
  let cuerpo: unknown = texto;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { /* dejar el texto */ }
  if (!r.ok) {
    const msg = (cuerpo as { error?: { message?: string } })?.error?.message ?? r.statusText;
    throw new WhopError(`Whop ${r.status}: ${msg}`, r.status, cuerpo);
  }
  return cuerpo as T;
}

/** La conexion de una tienda, con la llave ya descifrada. */
export async function conexionDe(storeId: string) {
  const { data } = await db
    .from("store_whop")
    .select("company_id,api_key_enc,webhook_secret_enc,webhook_id,livemode")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data) return null;
  return {
    companyId: data.company_id as string,
    apiKey: decrypt(data.api_key_enc as string),
    webhookSecret: data.webhook_secret_enc ? decrypt(data.webhook_secret_enc as string) : null,
    webhookId: (data.webhook_id as string | null) ?? null,
    livemode: !!data.livemode,
  };
}

// ------------------------------------------------------------ operaciones

/** Comprueba que la llave sirve y de que cuenta es. */
export function verCuenta(apiKey: string) {
  return pedir<{ id: string; name?: string; title?: string }>(apiKey, "/me");
}

/**
 * Cobra con una tarjeta ya guardada: el 1 clic del post-pago.
 *
 * `offSession: false` NO es un detalle. El comprador esta presente -- acaba de
 * apretar el boton del upsell -- y asi el cobro se procesa como iniciado por el
 * cliente con tarjeta en archivo, que aprueba mejor. Ademas, si el banco pide
 * autenticacion, el pago vuelve con status `requires_action` y un `next_action`
 * a donde mandarlo; con off_session en true esa compra simplemente se cae.
 * Por eso `returnUrl` es obligatorio en ese modo.
 *
 * Devuelve el pago ABIERTO: el resultado real llega por webhook.
 */
export function cobrarGuardada(apiKey: string, args: {
  accountId: string;
  planId?: string;
  /** Varias variantes en un mismo cobro (principal + bumps). */
  lineItems?: Array<{ plan_id: string }>;
  memberId: string;
  paymentMethodId: string;
  /** A donde vuelve el comprador tras un 3D Secure. Obligatoria si esta presente. */
  returnUrl?: string;
  /** true solo para cobros sin el comprador delante (renovaciones). */
  offSession?: boolean;
  metadata?: Record<string, string>;
  /** Misma clave = mismo cobro: reintentar no cobra dos veces. */
  idempotencyKey?: string;
}) {
  const presente = args.offSession !== true;
  if (presente && !args.returnUrl) {
    throw new Error("cobrarGuardada: falta returnUrl (obligatoria con off_session false)");
  }
  if (!args.planId && !args.lineItems?.length) {
    throw new Error("cobrarGuardada: hace falta planId o lineItems");
  }
  return pedir<{ id: string; status: string; next_action?: unknown }>(apiKey, "/payments", {
    method: "POST",
    ...(args.idempotencyKey ? { headers: { "idempotency-key": args.idempotencyKey } } : {}),
    body: JSON.stringify({
      account_id: args.accountId,
      ...(args.lineItems?.length ? { line_items: args.lineItems } : { plan_id: args.planId }),
      member_id: args.memberId,
      payment_method_id: args.paymentMethodId,
      off_session: !presente,
      ...(args.returnUrl ? { return_url: args.returnUrl } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    }),
  });
}

/** Medios de pago guardados de un comprador. */
export function mediosDe(apiKey: string, memberId: string) {
  return pedir<{ data: Array<{ id: string; type?: string }> }>(
    apiKey, `/payment_methods?member_id=${encodeURIComponent(memberId)}`);
}

// ------------------------------------------------------------- el pago

/** Los campos del objeto Payment que realmente usamos. */
export type PagoWhop = {
  id: string;
  status: string;
  currency: string;
  subtotal?: number;
  total?: number;
  settlement_amount?: number;
  refunded_amount?: number;
  metadata?: Record<string, string> | null;
  user?: { id?: string; email?: string | null; name?: string | null } | null;
  member?: { id?: string } | null;
  plan?: { id?: string } | null;
  product?: { id?: string } | null;
  payment_method?: { id?: string } | null;
};

/**
 * Lo que efectivamente se le cobro al comprador, en unidades mayores.
 *
 * `settlement_amount` es el unico que la documentacion define como el total
 * cobrado con impuestos y despues de descuentos; `total` es lo que ve el
 * vendedor y `subtotal` excluye las comisiones del comprador. Para reconciliar
 * contra lo que entro, el que vale es settlement_amount.
 */
export function montoCobrado(p: PagoWhop): number {
  return p.settlement_amount ?? p.total ?? p.subtotal ?? 0;
}
