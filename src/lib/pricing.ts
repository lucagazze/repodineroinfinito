import { itemsByRole, currencyForCountry, type Funnel, type Product } from "./db";
import { getRates, priceFor, toMinor, countryCurrency } from "./fx";
import { resolveSettings } from "./checkout-settings";
import { loadCheckout, type CheckoutData } from "./checkout-data";

/**
 * Cálculo del total.
 *
 * Vive en el servidor y solo acepta SLUGS del cliente, nunca importes. Si el
 * navegador pudiera mandar el precio, cualquiera compraría el kit a un
 * centavo cambiando un número en las herramientas de desarrollo.
 */

export type Line = {
  product: Product;
  role: "main" | "bump";
  amount: number;
  compareAt: number | null;
};

export type Quote = {
  funnel: Funnel;
  currency: string;
  lines: Line[];
  bonuses: { product: Product; displayValue: number | null }[];
  included: Product[];
  /** Lo que realmente se cobra, en centavos. */
  totalCents: number;
  total: number;
  /** Suma de los precios tachados, para el "Ahorrás X". */
  compareTotal: number;
  /** Descuento del mail de carrito abandonado ya aplicado (lo que se descontó, en la moneda). */
  recovery: { pct: number; amount: number } | null;
};

export async function quote(opts: {
  storeSlug: string;
  funnelSlug: string;
  currency: string;
  bumpSlugs: string[];
  /** El comprador aceptó la oferta de salida: se aplica el % guardado en el checkout. */
  exitDiscount?: boolean;
  recovery?: { pct: number; bumpSlugs: string[] } | null;
}): Promise<Quote | null> {
  const [data, rates] = await Promise.all([loadCheckout(opts.storeSlug, opts.funnelSlug), getRates()]);
  return data ? quoteFrom(data, { ...opts, rates }) : null;
}

/** El mismo cálculo, sobre datos ya cargados (sin ir a la base). */
export function quoteFrom(
  data: CheckoutData,
  opts: {
    currency: string; bumpSlugs: string[]; exitDiscount?: boolean; rates: Record<string, number>;
    /** Descuento del mail de carrito (token ya verificado): el % sobre el principal y los bumps que tenía. No se suma a la oferta de salida. */
    recovery?: { pct: number; bumpSlugs: string[] } | null;
  }
): Quote | null {
  const { funnel, main } = data;
  const exit = resolveSettings(funnel.settings).exitOffer;
  const rec = opts.recovery && opts.recovery.pct > 0 && opts.recovery.pct < 100 ? opts.recovery : null;
  const exitOn = !rec && !!opts.exitDiscount && exit.show && (exit.price > 0 || exit.discountPercent > 0);
  const off = (n: number) => Math.round(n * (100 - rec!.pct)) / 100;
  let saved = 0;
  if (!main) return null;

  const cur = opts.currency.toUpperCase();
  const rates = opts.rates;
  const mainPrice = priceFor(main, cur, rates);
  if (!mainPrice?.amount) return null;

  const full = Number(mainPrice.amount);
  let amount = full;
  if (exitOn) {
    if (exit.price > 0) {
      // Precio fijo del downsell en su moneda; en otra moneda, la misma proporción.
      const base = cur === exit.priceCurrency ? full : Number(priceFor(main, exit.priceCurrency, rates)?.amount ?? 0);
      const ratio = base > 0 ? exit.price / base : 1;
      amount = cur === exit.priceCurrency ? exit.price : Math.round(full * ratio * 100) / 100;
    } else {
      amount = Math.round(full * (100 - exit.discountPercent)) / 100;
    }
    if (!(amount > 0 && amount < full)) amount = full; // un downsell nunca sube ni regala
  }
  if (rec) {
    amount = off(full);
    saved += full - amount;
  }
  const lines: Line[] = [
    {
      product: main,
      role: "main",
      amount,
      // Con downsell o descuento de carrito, el precio de antes pasa a ser el tachado.
      compareAt: rec ? full : mainPrice.compare_at ? Number(mainPrice.compare_at) : amount < full ? full : null,
    },
  ];

  // Solo los que están declarados como bump en ESTE embudo. Mandar el slug
  // de otro producto no lo agrega.
  const offered = itemsByRole(funnel, "bump");
  const wanted = new Set(opts.bumpSlugs);
  for (const b of offered) {
    if (!wanted.has(b.slug)) continue;
    const p = priceFor(b, cur, rates);
    if (!p?.amount) continue;
    const price = Number(p.amount);
    // Con descuento de carrito, solo los bumps que ya tenía tildados.
    const disc = !!rec && rec.bumpSlugs.includes(b.slug);
    if (disc) saved += price - off(price);
    lines.push({
      product: b,
      role: "bump",
      amount: disc ? off(price) : price,
      compareAt: disc ? price : p.compare_at ? Number(p.compare_at) : null,
    });
  }

  const bonuses = itemsByRole(funnel, "bonus").map((p) => {
    const row = priceFor(p, cur, rates);
    return { product: p, displayValue: row?.display_value ? Number(row.display_value) : null };
  });

  // Redondeado a centavos: con descuentos la suma de decimales deja colas (29.520000000000003).
  const total = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const compareTotal =
    lines.reduce((a, l) => a + (l.compareAt ?? l.amount), 0) +
    bonuses.reduce((a, b) => a + (b.displayValue ?? 0), 0);

  return {
    funnel,
    currency: cur,
    lines,
    bonuses,
    included: itemsByRole(funnel, "included"),
    totalCents: toMinor(total, cur),
    total,
    compareTotal,
    recovery: rec ? { pct: rec.pct, amount: Math.round(saved * 100) / 100 } : null,
  };
}

/** Los bumps que el embudo ofrece, con su precio ya resuelto. */
export async function bumpOffers(funnel: Funnel, currency: string) {
  return bumpOffersFrom(funnel, currency, await getRates());
}

export function bumpOffersFrom(funnel: Funnel, currency: string, rates: Record<string, number>) {
  return itemsByRole(funnel, "bump").flatMap((p) => {
    const row = priceFor(p, currency, rates);
    if (!row?.amount) return [];
    const amount = Number(row.amount);
    const compareAt = row.compare_at ? Number(row.compare_at) : null;
    return [{
      slug: p.slug,
      name: p.name,
      shortName: p.short_name,
      description: p.description,
      image: p.image_url,
      amount,
      compareAt,
      off: compareAt ? Math.round((1 - amount / compareAt) * 100) : null,
      // Preventa (055): la tarjeta dice en cuántos días llega.
      presaleDays: p.presale ? p.presale_days ?? 3 : null,
    }];
  });
}

/**
 * Moneda en la que se le cobra a un comprador.
 *  1. Un mercado de la tienda que incluya su país (precios cargados a mano).
 *  2. La moneda local de su país, convertida: habilita Pix, OXXO, BLIK, etc.
 *  3. USD.
 */
export async function resolveCurrency(storeId: string, country: string | null) {
  const market = await currencyForCountry(storeId, country);
  if (market) return market;
  const local = countryCurrency(country);
  if (local && (await getRates())[local]) return local;
  return "USD";
}

/** Igual que resolveCurrency, con los mercados ya cargados. */
export function currencyFrom(markets: CheckoutData["markets"], country: string | null, rates: Record<string, number>) {
  const cc = country?.toUpperCase();
  const hit = cc ? markets.find((m) => (m.countries ?? []).includes(cc)) : null;
  if (hit) return hit.currency;
  const local = countryCurrency(country);
  if (local && rates[local]) return local;
  return "USD";
}
