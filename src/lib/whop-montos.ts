/**
 * Importes de Whop, sin dependencias.
 *
 * Vive aparte para poder probarse sin base ni red: la forma de estos campos
 * es exactamente lo que rompio la primera venta real (20/10/2026) y no puede
 * volver a romperse en silencio.
 */

/**
 * Un importe de Whop. NO es un numero: es un objeto, y `amount` viene como
 * CADENA en unidades mayores ("1.00"). Tratarlo como numero guarda el objeto
 * entero en una columna numerica y Postgres rechaza la fila entera -- con el
 * pago ya cobrado y el comprador esperando.
 */
export type MontoWhop = {
  currency: string;
  amount: string | number;
  decimals?: number;
  display_decimals?: number;
};

/** Un importe de Whop a numero, venga como objeto, cadena o numero. */
export function aNumero(m: MontoWhop | number | string | null | undefined): number | null {
  if (m == null) return null;
  if (typeof m === "number") return Number.isFinite(m) ? m : null;
  if (typeof m === "string") { const n = Number(m); return Number.isFinite(n) ? n : null; }
  const n = Number(m.amount);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lo que efectivamente se le cobro al comprador, en unidades mayores.
 *
 * Se prueban los tres en orden porque NO siempre estan los tres: medido el
 * 20/10/2026 contra un pago real, `settlement_amount` directamente no venia y
 * `total`/`subtotal` llegaban como objetos de dinero, no como numeros.
 */
/** Lo minimo que necesita montoCobrado. El Payment completo lo cumple. */
export type ConImportes = {
  settlement_amount?: MontoWhop | number | string | null;
  total?: MontoWhop | number | string | null;
  subtotal?: MontoWhop | number | string | null;
};

export function montoCobrado(p: ConImportes): number {
  return aNumero(p.settlement_amount) ?? aNumero(p.total) ?? aNumero(p.subtotal) ?? 0;
}