import { cache } from "react";
import { db } from "@/lib/db";
import { orderSteps, parseShowIf, pickFunnel, resolveLevels } from "@/lib/postpurchase";
import { idsOrNone } from "./offers";
import { marketFlags } from "./markets";
import { getRates, priceFor, countryCurrency } from "@/lib/fx";
import { resolveSettings } from "@/lib/checkout-settings";
import type { Product } from "@/lib/db";

/**
 * Cómo está armado cada checkout, en el orden en que lo vive el comprador:
 * Principal → Upsells en el checkout (order bumps) → Post-pago por niveles
 * (OTO 1, 2, 3) → Bonos.
 *
 * El post-pago sale del mismo motor que el checkout (pickFunnel, orderSteps,
 * resolveLevels): la cadena que ve quien compró solo el principal, de a un
 * renglón por nivel. Lo que cambia según lo que agregó en el checkout
 * (show_if) y el downsell de cada OTO van como «variantes» de ese nivel.
 */

/** `amount`/`currency`: el precio en la moneda del mercado de ese checkout (euros en Italia), como lo ve el comprador de ahí. */
export type SP = { id: string; short_name: string; kind: string; image: string | null; usd: number | null; amount: number | null; currency: string };
export type PPVariant = { label: string; p: SP };
export type PPLevel = { level: number; main: SP; variants: PPVariant[] };
export type Structure = { main: SP | null; upsells: SP[]; levels: PPLevel[]; bonus: SP[] };

type Raw = { id: string; short_name: string; kind: string; image_url: string | null; email_image_url: string | null; variant_of?: string | null; product_prices: { currency: string; amount: number | null }[] };
const PCOLS = "id,short_name,kind,image_url,email_image_url,variant_of,product_prices(currency,amount,compare_at,display_value)";
/** Moneda y tipos con que se muestran los precios de un checkout. */
type Cur = { currency: string; rates: Record<string, number> };
const sp = (p: Raw, c: Cur): SP => {
  // El mismo cálculo que el checkout: el precio cargado en esa moneda o, si no hay, convertido.
  const pr = priceFor({ product_prices: p.product_prices ?? [] } as unknown as Product, c.currency, c.rates);
  return {
    id: p.id, short_name: p.short_name, kind: p.kind, image: p.email_image_url ?? p.image_url,
    usd: p.product_prices?.find((x) => x.currency === "USD")?.amount ?? null,
    amount: pr?.amount == null ? null : Number(pr.amount), currency: c.currency,
  };
};
export type Market = { store_id: string; currency: string; countries: string[] | null };
/**
 * La moneda del mercado, con el mismo orden que el checkout (currencyFrom) para un comprador de
 * ese país: la fija del checkout; si no, la del mercado de la tienda que tiene ese país; si no,
 * la local del país («Italia» → EUR); si no, USD.
 */
export const currencyOf = (f: { store_id: string; settings: unknown; market_label: string | null }, markets: Market[], rates: Record<string, number>) => {
  const fixed = resolveSettings(f.settings).currency;
  if (fixed) return fixed.toUpperCase();
  const cc = marketFlags(f.market_label)[0]?.toUpperCase();
  const hit = cc ? markets.find((m) => m.store_id === f.store_id && (m.countries ?? []).some((c) => c.toUpperCase() === cc)) : null;
  if (hit) return hit.currency.toUpperCase();
  const local = countryCurrency(cc);
  return local && rates[local] ? local : "USD";
};
const uniq = (list: SP[]) => [...new Map(list.map((p) => [p.id, p])).values()];
const money = (p: SP) => (p.amount == null ? "" : new Intl.NumberFormat("es-AR", { style: "currency", currency: p.currency, maximumFractionDigits: 2 }).format(p.amount));

type Step = { id: string; sort_order: number; product_id: string; kind: string | null; downsell_of: string | null; show_if: unknown; level: number | null; products: Raw | null };

/** Los niveles de una cadena de post-pago: un renglón por nivel, con sus variantes y downsells. */
async function levelsOf(ppId: string, c: Cur): Promise<PPLevel[]> {
  const { data } = await db.from("pp_steps").select(`id,sort_order,product_id,kind,downsell_of,show_if,level,products(${PCOLS})`).eq("pp_funnel_id", ppId);
  const rows = ((data ?? []) as unknown as Step[]).filter((r) => r.products);
  const ordered = orderSteps(rows);
  const lv = resolveLevels(ordered);
  // Nombres de los productos que nombran las condiciones («si agregó X»).
  const condIds = [...new Set(rows.flatMap((r) => { const s = parseShowIf(r.show_if); return s ? Object.values(s).flat() : []; }))];
  const { data: named } = condIds.length ? await db.from("products").select("id,short_name").in("id", condIds) : { data: [] as { id: string; short_name: string }[] };
  const nameOf = new Map((named ?? []).map((p) => [p.id, p.short_name]));
  const names = (ids?: string[]) => (ids ?? []).map((id) => nameOf.get(id) ?? "otro producto").join(" o ");
  const cond = (raw: unknown) => {
    const s = parseShowIf(raw);
    if (!s) return "";
    const parts = [
      s.checkout_any?.length ? `si agregó ${names(s.checkout_any)}` : "",
      s.owns_any?.length ? `si ya tiene ${names(s.owns_any)}` : "",
      s.checkout_none?.length ? `si no agregó ${names(s.checkout_none)}` : "",
      s.owns_none?.length ? `si no tiene ${names(s.owns_none)}` : "",
    ].filter(Boolean);
    return parts.join(" y ");
  };
  const out = new Map<number, PPLevel>();
  ordered.forEach((s, i) => {
    const level = lv[i];
    const p = sp(s.row.products!, c);
    const L = out.get(level);
    if (!s.parentRow) {
      // El OTO sin condición es el que ve la mayoría; los condicionales, variantes.
      const c = cond(s.row.show_if);
      if (!L) out.set(level, { level, main: p, variants: c ? [{ label: c, p }] : [] });
      else if (!c && L.variants.some((v) => v.p.id === L.main.id)) {
        L.variants = L.variants.filter((v) => v.p.id !== L.main.id).concat({ label: cond(rows.find((r) => r.product_id === L.main.id)?.show_if) || "otra rama", p: L.main });
        L.main = p;
      } else L.variants.push({ label: c || "otra rama", p });
    } else {
      const parent = s.parentRow.products ? sp(s.parentRow.products, c) : null;
      const base = (x: Raw | null) => x?.variant_of ?? x?.id;
      const same = base(s.row.products) === base(s.parentRow.products) || (parent && p.short_name === parent.short_name);
      const label = same ? `downsell: el mismo a ${money(p) || "otro precio"}` : `downsell: ${p.short_name}${money(p) ? ` a ${money(p)}` : ""}`;
      (L ?? out.set(level, { level, main: parent ?? p, variants: [] }).get(level)!).variants.push({ label, p });
    }
  });
  return [...out.values()].sort((a, b) => a.level - b.level).slice(0, 3);
}

export const structuresFor = cache(async (key: string): Promise<Map<string, Structure>> => {
  const ids = key ? key.split(",") : [];
  const [{ data: fs }, { data: items }, rates] = await Promise.all([
    db.from("funnels").select(`id,store_id,main_product_id,settings,market_label,main:products!funnels_main_product_id_fkey(${PCOLS})`).in("id", idsOrNone(ids)),
    db.from("funnel_items").select(`funnel_id,role,sort_order,products(${PCOLS})`).in("funnel_id", idsOrNone(ids)).order("sort_order"),
    getRates(),
  ]);
  const out = new Map<string, Structure>();
  const funnels = (fs ?? []) as unknown as { id: string; store_id: string; main_product_id: string | null; settings: unknown; market_label: string | null; main: Raw | null }[];
  const storeIds = [...new Set(funnels.map((f) => f.store_id))];
  const { data: mk } = storeIds.length ? await db.from("markets").select("store_id,currency,countries").in("store_id", storeIds) : { data: [] };
  const curs = new Map(funnels.map((f) => [f.id, { currency: currencyOf(f, (mk ?? []) as Market[], rates), rates } as Cur]));
  const curOf = (id: string) => curs.get(id) ?? { currency: "USD", rates };
  for (const f of funnels) out.set(f.id, { main: f.main ? sp(f.main, curOf(f.id)) : null, upsells: [], levels: [], bonus: [] });
  const st = (id: string) => out.get(id) ?? out.set(id, { main: null, upsells: [], levels: [], bonus: [] }).get(id)!;
  const legacy = new Map<string, SP[]>();
  for (const it of (items ?? []) as unknown as { funnel_id: string; role: string; products: Raw | null }[]) {
    if (!it.products) continue;
    const s = st(it.funnel_id);
    const p = sp(it.products, curOf(it.funnel_id));
    if (it.role === "bump") s.upsells.push(p);
    else if (it.role === "upsell") legacy.set(it.funnel_id, [...(legacy.get(it.funnel_id) ?? []), p]);
    else s.bonus.push(p); // bonus e included
  }
  // La cadena que ve quien compró solo el principal (la misma elección que hace el checkout).
  await Promise.all(funnels.map(async (f) => {
    const s = st(f.id);
    const pp = f.main_product_id ? await pickFunnel(f.store_id, f.id, new Set([f.main_product_id])).catch(() => null) : null;
    if (pp) s.levels = await levelsOf(pp, curOf(f.id));
    else s.levels = (legacy.get(f.id) ?? []).slice(0, 3).map((p, i) => ({ level: i + 1, main: p, variants: [] }));
  }));
  for (const s of out.values()) { s.upsells = uniq(s.upsells); s.bonus = uniq(s.bonus); }
  return out;
});

/** La estructura de varios checkouts juntos (la oferta entera): por nivel, los OTO de cada mercado como variantes. */
export function mergeStructures(list: Structure[]): Structure & { mains: SP[] } {
  const mains = uniq(list.map((s) => s.main).filter((p): p is SP => !!p));
  const byLevel = new Map<number, PPLevel>();
  for (const s of list) for (const l of s.levels) {
    const cur = byLevel.get(l.level);
    if (!cur) { byLevel.set(l.level, { level: l.level, main: l.main, variants: [...l.variants] }); continue; }
    const seen = new Set([cur.main.id, ...cur.variants.map((v) => v.p.id)]);
    if (!seen.has(l.main.id)) cur.variants.push({ label: "en otro mercado", p: l.main });
    for (const v of l.variants) if (!seen.has(v.p.id)) cur.variants.push(v);
  }
  return {
    main: mains[0] ?? null, mains,
    upsells: uniq(list.flatMap((s) => s.upsells)),
    levels: [...byLevel.values()].sort((a, b) => a.level - b.level).slice(0, 3),
    bonus: uniq(list.flatMap((s) => s.bonus)),
  };
}
