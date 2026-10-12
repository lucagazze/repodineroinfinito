import { db, type Price, type Product } from "./db";
export { toMinor, fromMinor } from "./minor";

/**
 * Monedas locales.
 *
 * Stripe elige qué métodos de pago mostrar según la moneda del cobro: Pix
 * solo existe en BRL, OXXO en MXN, BLIK en PLN, Bizum y Satispay en EUR.
 * Si un brasileño paga en USD, no ve Pix aunque esté activado en la cuenta.
 *
 * Por eso: si el país no tiene un mercado con precios cargados a mano,
 * cobramos en su moneda convirtiendo desde USD al tipo del BCE del día.
 */

/** País → moneda en la que conviene cobrarle. El resto paga en USD. */
const COUNTRY_CURRENCY: Record<string, string> = {
  // eurozona
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR",
  FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LU: "EUR",
  LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR", SM: "EUR",
  VA: "EUR", MC: "EUR",
  GB: "GBP", CH: "CHF", SE: "SEK", DK: "DKK", NO: "NOK", PL: "PLN", CZ: "CZK",
  RO: "RON", BR: "BRL", MX: "MXN", CA: "CAD", AU: "AUD", NZ: "NZD",
  IN: "INR", KR: "KRW", JP: "JPY", SG: "SGD", HK: "HKD",
};

export function countryCurrency(country?: string | null): string | null {
  return country ? COUNTRY_CURRENCY[country.toUpperCase()] ?? null : null;
}

// Respaldo si no hay tipos guardados ni proveedor (BCE del 06/10/2026): solo
// evitan que el checkout se caiga la primera vez.
const FALLBACK: Record<string, number> = {
  USD: 1, EUR: 0.8874, GBP: 0.7532, CHF: 0.8305, SEK: 9.976, DKK: 6.633, NOK: 9.564,
  PLN: 3.873, CZK: 21.66, RON: 4.748, BRL: 4.969, MXN: 17.94, CAD: 1.425, AUD: 1.432,
  NZD: 1.78, INR: 96.42, KRW: 1339, JPY: 158.1, SGD: 1.277, HKD: 7.848,
};

type Rates = Record<string, number>;

/**
 * Los tipos viven en la base (app_settings «fx_rates»), los mismos para todas
 * las instancias: así la página del checkout y /api/pi convierten igual. Antes
 * cada instancia los pedía por su cuenta; cuando el proveedor tardaba, una
 * usaba el respaldo y otra los del día, y la página mostraba 21,90 USD
 * mientras el cobro calculaba 22,90 (06/10).
 * Los renueva el cron (refreshRates), nunca una compra; `prev` son los de
 * antes del último cambio, para honrar el precio que vio quien cargó la
 * página justo antes (ver /api/pi).
 */
const KEY = "fx_rates";
const MEM_TTL = 5 * 60_000;
const STALE = 12 * 3600_000;
type Shared = { rates: Rates; prev: Rates | null; fetchedAt: number };
let cache: { at: number; shared: Shared } | null = null;

const SOURCES: { url: string; pick: (j: Record<string, unknown>) => unknown }[] = [
  { url: "https://api.frankfurter.dev/v1/latest?base=USD", pick: (j) => j.rates },
  { url: "https://open.er-api.com/v6/latest/USD", pick: (j) => (j.result === "success" ? j.rates : null) },
];

async function fetchRates(): Promise<Rates | null> {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = s.pick(await res.json()) as Rates | null;
      if (r && Number(r.EUR) > 0) return { ...r, USD: 1 };
    } catch (e) {
      console.warn("[fx]", s.url, (e as Error).message);
    }
  }
  return null;
}

async function readShared(): Promise<Shared | null> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = data?.value as { rates?: Rates; prev?: Rates | null; fetched_at?: string } | null;
  if (!v?.rates || !(Number(v.rates.EUR) > 0)) return null;
  return { rates: v.rates, prev: v.prev ?? null, fetchedAt: v.fetched_at ? +new Date(v.fetched_at) : 0 };
}

async function writeShared(rates: Rates, prev: Rates | null) {
  const value = { rates, prev, fetched_at: new Date().toISOString() };
  const { error } = await db.from("app_settings").upsert({ key: KEY, value, updated_at: value.fetched_at }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

async function shared(): Promise<Shared> {
  if (cache && Date.now() - cache.at < MEM_TTL) return cache.shared;
  try {
    const s = await readShared();
    if (s) {
      cache = { at: Date.now(), shared: s };
      return s;
    }
  } catch (e) {
    console.warn("[fx] no pude leer los tipos guardados:", (e as Error).message);
    // La base no respondió: sigo con los que ya tenía, que son los mismos que usan las otras instancias.
    if (cache) return cache.shared;
  }
  // Primera vez (no hay tipos guardados): el proveedor, y si no responde, el respaldo.
  const rates = await fetchRates();
  if (rates) await writeShared(rates, null).catch((e) => console.warn("[fx] no pude guardar:", (e as Error).message));
  const s = { rates: rates ?? FALLBACK, prev: null, fetchedAt: rates ? Date.now() : 0 };
  // Con el respaldo, reintenta en 1 min en vez de 5.
  cache = { at: rates ? Date.now() : Date.now() - MEM_TTL + 60_000, shared: s };
  return s;
}

/** Tipos de cambio desde USD (unidades de cada moneda por 1 USD). */
export async function getRates(): Promise<Rates> {
  return (await shared()).rates;
}

/** Los tipos de antes del último cambio (null si no hay). Solo para honrar un precio ya mostrado. */
export async function getPrevRates(): Promise<Rates | null> {
  return (await shared()).prev;
}

/** Cron: renueva los tipos guardados si tienen más de 12 h (o `force`). */
export async function refreshRates(force = false) {
  const cur = await readShared().catch(() => null);
  if (!force && cur && Date.now() - cur.fetchedAt < STALE) return { ok: true, refreshed: false };
  const rates = await fetchRates();
  if (!rates) return { ok: false, refreshed: false, error: "ningún proveedor de tipos respondió" };
  await writeShared(rates, cur?.rates ?? null);
  cache = null;
  return { ok: true, refreshed: true };
}

/** Precio "de vidriera": 146,43 → 146,90 · 5,43 → 5,49 · 36.720 KRW → 36.800. */
function charm(v: number, currency: string) {
  const c = currency.toUpperCase();
  if (c === "KRW") return Math.ceil(v / 100) * 100;
  if (c === "JPY") return Math.ceil(v / 10) * 10;
  if (v >= 10) return Math.ceil(v) - 0.1;
  return Math.round((Math.ceil(v * 10) / 10 - 0.01) * 100) / 100; // sin 5.890000000000001
}

/**
 * Precio de un producto en una moneda.
 *
 * Si hay precio cargado para esa moneda (un mercado), se usa tal cual. Si no,
 * se convierte desde USD o, si el producto no tiene precio en dólares (una
 * oferta solo en euros), desde el primero que tenga. Nunca devuelve el importe
 * de una moneda con la etiqueta de otra: eso cobraría 27 reales por un
 * producto de 27 dólares.
 */
export function priceFor(p: Product, currency: string, rates: Record<string, number>): Price | null {
  const want = currency.toUpperCase();
  const own = p.product_prices.find((x) => x.currency === want);
  if (own) return own;

  // rates = unidades de cada moneda por 1 USD.
  const perUsd = (c: string) => (c === "USD" ? 1 : rates[c]);
  const base = p.product_prices.find((x) => x.currency === "USD")
    ?? p.product_prices.find((x) => x.amount != null && perUsd(x.currency));
  const rate = base && perUsd(want) && perUsd(base.currency) ? perUsd(want)! / perUsd(base.currency)! : null;
  if (!base || !rate) return null;

  const conv = (n: number | null) => (n == null ? null : Number(n) * rate);
  return {
    currency: want,
    amount: base.amount == null ? null : Number(base.amount) > 0 ? charm(Number(base.amount) * rate, want) : 0,
    // El precio tachado se redondea igual que el precio: si no, el «antes» del
    // downsell (= el precio del OTO) sale distinto del que vio en el OTO (22 vs 22,90 CHF).
    compare_at: base.compare_at == null ? null : Number(base.compare_at) > 0 ? charm(conv(base.compare_at)!, want) : 0,
    display_value: base.display_value == null ? null : Math.round(conv(base.display_value)!),
  };
}
