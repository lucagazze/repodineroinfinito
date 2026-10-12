/**
 * Importes en la unidad mínima de Stripe. Aparte de fx.ts porque el checkout
 * (navegador) también los usa, y fx.ts lee la base.
 */

/** Monedas sin centavos en Stripe: el importe va en unidades, no × 100. */
const ZERO_DECIMAL = new Set(["JPY", "KRW"]);

export const toMinor = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);

export const fromMinor = (minor: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100;
