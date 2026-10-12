/**
 * Las referencias con las que «Mejoras» compara cada número, y la muestra
 * mínima para decir algo. Son de infoproductos de bajo precio (10–40 USD)
 * vendidos con tráfico frío de Meta y checkout de una página: lo que se ve
 * en ofertas así, no promesas. Cambiarlas acá las cambia en todo el coach.
 *
 * min = por debajo de esa muestra el hallazgo sale como «pocos datos» y la IA
 * no recomienda nada con él (solo puede decir qué medir).
 */

export type Bench = { low: number; high: number; flag: number; bad: number; min: number; why: string };

export const BENCH = {
  /** Visitas de la landing que abren el checkout. */
  landingToCheckout: { low: 0.15, high: 0.35, flag: 0.1, bad: 0.05, min: 100, why: "15–35 % de las visitas de la landing abren el checkout (tráfico frío de Meta, producto de 20–30 USD)" },
  /** Checkout abierto → pagado (personas distintas). */
  checkoutConv: { low: 0.25, high: 0.45, flag: 0.18, bad: 0.1, min: 40, why: "25–45 % de quienes abren un checkout de una página terminan pagando" },
  /** Pedidos que suman al menos un order bump. */
  bump: { low: 0.2, high: 0.4, flag: 0.15, bad: 0.08, min: 25, why: "20–40 % de los pedidos suman el bump cuando es barato y complementa al principal" },
  oto1: { low: 0.15, high: 0.3, flag: 0.1, bad: 0.05, min: 25, why: "15–30 % aceptan el primer OTO en infoproductos de bajo precio" },
  oto2: { low: 0.1, high: 0.2, flag: 0.06, bad: 0.03, min: 20, why: "10–20 % aceptan el segundo OTO" },
  oto3: { low: 0.05, high: 0.15, flag: 0.04, bad: 0.02, min: 20, why: "5–15 % aceptan el tercer OTO" },
  downsell: { low: 0.1, high: 0.25, flag: 0.06, bad: 0.03, min: 20, why: "10–25 % de los que rechazan el OTO aceptan el downsell a mitad de precio" },
  /** Cuánto suman bumps + OTOs al precio del principal (ticket / precio principal − 1). */
  aovLift: { low: 0.3, high: 0.6, flag: 0.15, bad: 0.05, min: 25, why: "bump + post-pago bien armados suman 30–60 % al precio del producto principal" },
  /** Reembolsos sobre pedidos (más alto es peor). */
  refunds: { low: 0.01, high: 0.03, flag: 0.05, bad: 0.1, min: 25, why: "menos de 3 % de reembolsos es lo normal en un PDF de bajo precio" },
  /** Intentos de pago con error (más alto es peor). */
  payErrors: { low: 0.03, high: 0.1, flag: 0.15, bad: 0.3, min: 15, why: "hasta 10 % de los intentos fallan por tarjeta mal cargada o rechazada" },
  /** Entregas sin abrir a las 24 h (más alto es peor). */
  deliveryUnopened: { low: 0.05, high: 0.15, flag: 0.25, bad: 0.4, min: 15, why: "un mail de entrega lo abre 85–95 % de los compradores" },
  /** Visitas de la landing que se van antes de 10 segundos (más alto es peor; de los «leave» con tiempo). */
  quickExit: { low: 0.25, high: 0.45, flag: 0.55, bad: 0.7, min: 100, why: "en el navegador de Instagram/Facebook, 25–45 % se va antes de 10 segundos" },
  /** Visitas que no pasan de la primera pantalla (más alto es peor). */
  noScroll: { low: 0.25, high: 0.45, flag: 0.5, bad: 0.65, min: 50, why: "25–45 % no baja de la primera pantalla en tráfico frío" },
  /** CTR de enlace en Meta (clics en el enlace / impresiones). */
  ctr: { low: 0.01, high: 0.02, flag: 0.007, bad: 0.004, min: 10_000, why: "1–2 % de CTR de enlace es lo normal en tráfico frío de Meta" },
  /** Visitas a la landing que informa Meta / clics en el enlace: debajo, la página tarda o se pierde gente. */
  lpvRate: { low: 0.7, high: 0.9, flag: 0.6, bad: 0.45, min: 300, why: "70–90 % de los clics en el enlace llegan a cargar la landing (Meta: landing page views / clics)" },
} satisfies Record<string, Bench>;

/** CPA objetivo por región (USD), los del dueño: Europa 10, EE. UU. 15. */
export const CPA_TARGET = { eu: 10, us: 15 } as const;

/** Región de una campaña por su nombre («España | CBO | Mi Oferta», «USA | CBO | My Offer»). WW o sin país: sin objetivo. */
export function regionOf(name: string): "eu" | "us" | null {
  if (/\bww\b|worldwide|global/i.test(name)) return null;
  if (/\b(usa|us|ee\.?\s?uu\.?|estados unidos|united states|canad[aá])\b/i.test(name)) return "us";
  if (/\b(italia|italy|francia|france|alemania|germany|deutschland|uk|reino unido|united kingdom|espa[ñn]a|spain|europa|europe|portugal|irlanda|ireland|austria|belgi)/i.test(name)) return "eu";
  return null;
}

/** Región por las banderas del mercado de un checkout (us/gb/it/fr/de…). */
export function regionOfFlags(flags: string[]): "eu" | "us" | null {
  if (flags.includes("us") || flags.includes("ca")) return "us";
  if (flags.some((f) => ["gb", "it", "fr", "de", "es", "pt", "ie", "at", "be", "nl"].includes(f))) return "eu";
  return null;
}

/** Mínimos de Meta para juzgar una campaña o un anuncio. */
export const ADS_MIN = {
  /** Gasto mínimo (en múltiplos del CPA objetivo) para juzgar el CPA. */
  spendForCpa: 3,
  /** Compras mínimas para comparar CPA entre semanas o redes. */
  purchasesForTrend: 8,
  /** Anuncio sin compras: gasto (en múltiplos del CPA objetivo) para llamarlo «gasto sin ventas». */
  adNoSale: 1.5,
  /** Impresiones mínimas por semana para comparar el CPM. */
  impressionsForCpm: 20_000,
};
