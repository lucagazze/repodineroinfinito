import { cache } from "react";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { adminStore, type AdminStore } from "./store";
import { marketFlags } from "./markets";

/**
 * Ofertas: la unidad con la que el dueño mira el negocio (migración 007). Una
 * oferta vive en una tienda (la cuenta de Stripe que cobra) y agrupa sus
 * checkouts por mercado (país). Todo lo que el panel muestra se filtra por
 * los checkouts del alcance elegido: toda la oferta o un solo mercado.
 *
 * En la URL el alcance va en un solo segmento, así todas las secciones lo
 * heredan sin parámetros extra:
 *   /admin/o/mitienda~my-offer                          toda la oferta
 *   /admin/o/mitienda~my-offer~my-offer-kit    un mercado (su checkout)
 */

export const OFFERS_TAG = "offers";

export type OfferFunnel = {
  id: string; slug: string; name: string; market_label: string; landing_url: string | null; active: boolean;
  main_product_id: string | null; key: string; flags: string[];
  /** Campañas de Meta que traen tráfico a este checkout (migración 013). */
  meta_campaign_ids: string[];
  /** Host público donde se sirve este checkout (migración 014), p. ej. pay.tumarca.com. */
  checkout_host: string | null;
  /** Ruta en ese host (migración 018), p. ej. /en/checkout. Sin ella: /c/{tienda}/{embudo}. */
  checkout_path: string | null;
  /**
   * Link para comprar un producto suelto («Crear link» en Productos): slug
   * terminado en -solo. Cuenta para las ventas de la oferta pero no es un
   * mercado, así que no aparece en el selector ni en la lista de mercados.
   */
  solo: boolean;
};
export type OfferItem = {
  id: string; key: string; slug: string; name: string; image_url: string | null; notes: string; active: boolean; sort_order: number;
  created_at: string;
  /** «Uñas»: agrupa la misma oferta en varios países en el selector (migración 041). */
  category: string | null;
  /** «Oferta 3»: el nombre que se muestra en modo captura. Fijo por oferta (orden de creación). */
  alias: string;
  store: { id: string; slug: string; name: string; display_name: string | null; domain: string | null };
  funnels: OfferFunnel[];
  /** Los checkouts que son mercados (sin los links de producto suelto). */
  markets: OfferFunnel[];
};

export const SOLO_SUFFIX = "-solo";

export const offerKey = (storeSlug: string, offerSlug: string) => `${storeSlug}~${offerSlug}`;

/** Todas las ofertas con su tienda y sus checkouts. Cambia poco: caché con etiqueta, se invalida desde cache-bust. */
export const offerList = cache(() =>
  unstable_cache(
    async () => {
      const cols = (host: boolean) =>
        `id,slug,name,image_url,notes,active,sort_order,created_at${host ? ",category" : ""},stores!inner(id,slug,name,display_name,domain),` +
        `funnels(id,slug,name,market_label,landing_url,active,main_product_id,sort_order,meta_campaign_ids${host ? ",checkout_host,checkout_path" : ""})`;
      let { data, error } = await db.from("offers").select(cols(true)).order("sort_order");
      // Si las columnas todavía no existen (migraciones 014/018/041 sin correr), sin ellas: el panel no se cae.
      if (error && /checkout_(host|path)|category/.test(error.message)) ({ data, error } = await db.from("offers").select(cols(false)).order("sort_order"));
      if (error) throw new Error(`offers: ${error.message}`);
      type F = Omit<OfferFunnel, "key" | "flags" | "solo"> & { sort_order: number };
      type Row = Omit<OfferItem, "key" | "store" | "funnels" | "markets" | "alias"> & { stores: OfferItem["store"]; funnels: F[] };
      const rows = (data ?? []) as unknown as Row[];
      const order = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map((o) => o.id);
      return rows
        .map((o) => {
          const key = offerKey(o.stores.slug, o.slug);
          const funnels: OfferFunnel[] = [...(o.funnels ?? [])].sort((a, b) => a.sort_order - b.sort_order)
            .map(({ sort_order: _s, ...f }) => ({
              ...f, market_label: f.market_label ?? "", landing_url: f.landing_url || null, meta_campaign_ids: f.meta_campaign_ids ?? [],
              checkout_host: f.checkout_host || null, checkout_path: f.checkout_path || null,
              key: `${key}~${f.slug}`, flags: marketFlags(f.market_label), solo: f.slug.endsWith(SOLO_SUFFIX),
            }));
          return {
            id: o.id, slug: o.slug, name: o.name, image_url: o.image_url, notes: o.notes ?? "", active: o.active, sort_order: o.sort_order, created_at: o.created_at,
            category: o.category?.trim() || null,
            key, alias: `Oferta ${order.indexOf(o.id) + 1}`,
            store: o.stores,
            funnels,
            markets: funnels.filter((f) => !f.solo),
          };
        })
        .sort((a, b) => Number(b.active) - Number(a.active) || a.store.name.localeCompare(b.store.name) || a.sort_order - b.sort_order);
    },
    ["admin-offers-v7"],
    { tags: [OFFERS_TAG], revalidate: 10 },
  )()
);

/** Mercados de la oferta (las etiquetas de sus checkouts), sin repetir. */
export const marketsOf = (o: OfferItem) => [...new Set(o.markets.map((f) => f.market_label).filter(Boolean))];

/** Lo que necesita cada página del panel: la oferta, el mercado (si se eligió uno) y los checkouts a mirar. */
export type Scope = {
  key: string; base: string; offerBase: string;
  offer: OfferItem; market: OfferFunnel | null;
  /** Todos los checkouts del alcance (para ventas y métricas), con los links de producto suelto. */
  funnels: OfferFunnel[]; funnelIds: string[];
  /** Solo los mercados del alcance (para mostrar landings, estructura y selector). */
  markets: OfferFunnel[];
  store: AdminStore;
  /** "My Offer · EE. UU." o solo el nombre de la oferta. */
  label: string;
};

export const scopeFor = cache(async (raw: string): Promise<Scope> => {
  const [storeSlug, offerSlug, funnelSlug] = decodeURIComponent(raw).split("~");
  const offer = (await offerList()).find((o) => o.key === offerKey(storeSlug, offerSlug ?? ""));
  if (!offer) notFound();
  const market = funnelSlug ? offer.funnels.find((f) => f.slug === funnelSlug) ?? null : null;
  if (funnelSlug && !market) notFound();
  const funnels = market ? [market] : offer.funnels;
  const markets = market ? [market] : offer.markets;
  const store = await adminStore(offer.store.slug);
  const key = market ? market.key : offer.key;
  return {
    key, base: `/admin/o/${key}`, offerBase: `/admin/o/${offer.key}`,
    offer, market, funnels, funnelIds: funnels.map((f) => f.id), markets, store,
    label: market ? `${offer.name} · ${market.market_label || market.name}` : offer.name,
  };
});

/**
 * Para filtrar con .in(): PostgREST no acepta una lista vacía, y una oferta
 * sin checkouts no tiene que traer los pedidos de toda la tienda.
 */
/** Cierra una frase con punto sin duplicarlo («… de EE. UU.»). */
export const dot = (s: string) => (s.endsWith(".") ? s : `${s}.`);

export const idsOrNone = (ids: string[]) => (ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

/** La oferta de un checkout (para los links que cruzan de una oferta a otra). */
export async function offerKeyOfFunnel(funnelId: string) {
  return (await offerList()).find((o) => o.funnels.some((f) => f.id === funnelId))?.key ?? null;
}
