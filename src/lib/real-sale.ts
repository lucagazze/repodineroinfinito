/**
 * Qué cuenta como VENTA en todo el panel (últimas compras, pedidos, KPIs,
 * gráficos, CSV, push): pagada o reembolsada, con el pago en Stripe
 * (payment_intent o sesión) y un monto mayor a 0. Un pedido «pagado» sin eso
 * (cargado a mano o por un agente) no es una venta: no aparece en ningún lado
 * y queda el aviso «Pedido sin pago en Stripe» (admin/alerts.ts).
 * Tampoco los pedidos de una tienda de PRUEBA (orders.is_test, migración 038:
 * cobra con llaves de prueba de Stripe): nunca son ventas, en ningún lado.
 */

export const SALE_STATUSES = ["paid", "refunded"] as const;
/** Filtro de PostgREST (para .or): tiene el pago en Stripe y no es de una tienda de prueba. */
export const HAS_STRIPE = "and(is_test.is.false,stripe_payment_intent.not.is.null),and(is_test.is.false,stripe_session_id.not.is.null)";

type Filterable<T> = { or(filters: string): T; gt(column: string, value: unknown): T };
/** Le agrega a una consulta de orders: con pago en Stripe y monto > 0 (el estado lo pone cada consulta). */
export const withStripePayment = <T extends Filterable<T>>(q: T): T => q.or(HAS_STRIPE).gt("amount_total", 0);

/** Lo mismo para una fila ya leída (necesita stripe_payment_intent, stripe_session_id, amount_total e is_test). */
export const isRealSale = (o: { status?: string | null; stripe_payment_intent?: string | null; stripe_session_id?: string | null; amount_total?: number | string | null; is_test?: boolean | null }) =>
  (o.status === "paid" || o.status === "refunded") && !!(o.stripe_payment_intent || o.stripe_session_id) && Number(o.amount_total ?? 0) > 0 && !o.is_test;
