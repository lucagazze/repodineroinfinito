import { db, STORE_COLS, type Store } from "../db";
import { checkoutUrl } from "../checkout-url";
import { resolveSettings } from "../checkout-settings";
import { getRates, priceFor } from "../fx";
import type { Product } from "../db";
import type { Locale } from "./types";
import { LOCALES } from "./types";

/**
 * Lo que una campaña puede ofrecer: cada checkout activo de la tienda (de una
 * oferta activa) con su producto principal, su idioma y su link. Es la única
 * fuente de productos, precios y links del editor, la IA y el render: nada se
 * escribe a mano.
 */

export type CatalogItem = {
  funnelId: string; funnelSlug: string; offerId: string | null; offerName: string | null; category: string | null;
  market: string | null; locale: Locale; active: boolean; sort: number;
  /** Checkout «-solo» de un libro suelto (para post-pago): no se recomienda solo, sí se puede elegir a mano. */
  solo: boolean;
  productId: string; name: string; shortName: string; description: string; image: string | null;
  /** Para saber si alguien ya lo tiene (igual que el post-pago): su base y lo que trae si es un pack. */
  variantOf: string | null; includes: string[];
  url: string;
  /** Precio en la moneda base del checkout (para el panel y la IA); el mail usa la del destinatario. */
  price: { amount: number; currency: string } | null;
};

export type StoreRow = Store & { is_test?: boolean | null };

export async function loadStore(storeId: string): Promise<StoreRow | null> {
  const { data } = await db.from("stores").select(`${STORE_COLS},is_test`).eq("id", storeId).maybeSingle();
  return (data as unknown as StoreRow) ?? null;
}

export async function storeCatalog(storeId: string): Promise<CatalogItem[]> {
  const [{ data: st }, { data: fu }, rates] = await Promise.all([
    db.from("stores").select("slug,default_locale").eq("id", storeId).maybeSingle(),
    db.from("funnels").select("id,slug,name,active,settings,market_label,offer_id,checkout_host,checkout_path,main_product_id,sort_order,offers(name,category,active,sort_order)")
      .eq("store_id", storeId).not("main_product_id", "is", null),
    getRates(),
  ]);
  if (!st) return [];
  const ids = [...new Set((fu ?? []).map((f) => f.main_product_id as string))];
  const { data: prods } = ids.length
    ? await db.from("products").select("id,slug,name,short_name,description,image_url,email_image_url,includes,variant_of,product_prices(currency,amount,compare_at,display_value)").in("id", ids)
    : { data: [] };
  const byId = new Map((prods ?? []).map((p) => [p.id as string, p]));
  const out: CatalogItem[] = [];
  for (const f of fu ?? []) {
    const p = byId.get(f.main_product_id as string);
    if (!p) continue;
    const o = f.offers as unknown as { name: string | null; category: string | null; active: boolean; sort_order: number | null } | null;
    const set = resolveSettings(f.settings);
    const loc = (set.locale || st.default_locale) as Locale;
    const cur = set.currency || (p.product_prices as { currency: string }[]).find((x) => x.currency === "EUR" && loc !== "en")?.currency || "USD";
    const pr = priceFor(p as unknown as Product, cur, rates);
    out.push({
      funnelId: f.id, funnelSlug: f.slug, offerId: f.offer_id, offerName: o?.name ?? f.name, category: o?.category ?? null,
      market: f.market_label || null, locale: (LOCALES as readonly string[]).includes(loc) ? loc : "en",
      active: !!f.active && (o ? !!o.active : false), solo: f.slug.endsWith("-solo"), sort: (o?.sort_order ?? 999) * 100 + (f.sort_order ?? 0),
      productId: p.id, variantOf: (p.variant_of as string | null) ?? null, includes: ((p.includes as string[] | null) ?? []).filter(Boolean), name: p.name, shortName: p.short_name || p.name, description: p.description ?? "",
      image: p.email_image_url ?? p.image_url ?? null, url: checkoutUrl(f, st.slug),
      price: pr?.amount ? { amount: Number(pr.amount), currency: cur } : null,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort || a.name.localeCompare(b.name));
}
