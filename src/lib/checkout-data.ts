import { unstable_cache, revalidateTag } from "next/cache";
import { db, getFunnel, getProductById, type Funnel, type Product } from "./db";
import { pixelsFor } from "./meta";

/**
 * Todo lo que el checkout necesita leer de la base, en una sola carga
 * cacheada (60 s, o hasta que el panel/MCP la invalide al guardar).
 *
 * Antes cada visita hacía ~10 consultas en serie y tardaba más de medio
 * segundo solo en el servidor; con esto la página sale en lo que tarda en
 * viajar. Lo que cambia por visitante (país, moneda) se calcula aparte, en
 * memoria, sobre estos datos.
 */

export type CheckoutData = {
  funnel: Funnel;
  main: Product | null;
  markets: { currency: string; countries: string[] }[];
  /** Ids de pixel de Meta que carga este checkout (nunca los tokens). */
  pixelIds: string[];
  /** Llave pública de Stripe de la tienda: cacheada con el resto, el checkout se dibuja aunque la base no responda. */
  publishableKey?: string | null;
  /** biz_...: la cuenta de Whop de la tienda, si la tiene conectada. */
  whopAccountId?: string | null;
};

async function load(storeSlug: string, funnelSlug: string): Promise<CheckoutData | null> {
  const funnel = await getFunnel(storeSlug, funnelSlug);
  if (!funnel) return null;
  const [main, markets, pixels, conn, whop] = await Promise.all([
    funnel.main_product_id ? getProductById(funnel.main_product_id) : Promise.resolve(null),
    db.from("markets").select("currency,countries").eq("store_id", funnel.stores.id).then((r) => {
      // Un error no se cachea como «sin mercados» (cambiaría la moneda): se sigue con la copia anterior.
      if (r.error) throw new Error(`markets: ${r.error.message}`);
      return r.data ?? [];
    }),
    pixelsFor(funnel.stores.id, funnel.pixel_ids),
    db.from("store_stripe").select("publishable_key").eq("store_id", funnel.stores.id).maybeSingle().then((r) => r.data),
    // La cuenta de Whop, no la llave: el navegador solo necesita saber a que
    // cuenta montar los campos. La llave de la API nunca sale del servidor.
    db.from("store_whop").select("company_id").eq("store_id", funnel.stores.id).maybeSingle().then((r) => r.data),
  ]);
  return {
    funnel, main, markets, pixelIds: pixels.map((p) => p.pixel_id),
    publishableKey: conn?.publishable_key ?? null,
    whopAccountId: whop?.company_id ?? null,
  };
}

export const checkoutTag = (storeSlug?: string) => (storeSlug ? `checkout:${storeSlug}` : "checkout");

/**
 * Última carga buena de cada checkout en esta instancia. Si la base falla
 * (caída, timeout), el checkout se sigue mostrando con estos datos en vez de
 * un error: los precios igual se vuelven a validar al cobrar (/api/pi).
 * Además, la caché de datos de Next sirve la copia vencida mientras revalida
 * y, si la revalidación falla, se queda con la anterior.
 */
const lastGood = new Map<string, { at: number; data: CheckoutData }>();

export function loadCheckout(storeSlug: string, funnelSlug: string) {
  const key = `${storeSlug}/${funnelSlug}`;
  return unstable_cache(() => load(storeSlug, funnelSlug), ["checkout-data", storeSlug, funnelSlug], {
    revalidate: 60,
    tags: [checkoutTag(), checkoutTag(storeSlug)],
  })().then(
    (data) => {
      if (data) lastGood.set(key, { at: Date.now(), data });
      return data;
    },
    (e) => {
      const lkg = lastGood.get(key);
      if (!lkg) throw e;
      console.error(`[checkout] la base falló (${(e as Error).message}); uso la copia de hace ${Math.round((Date.now() - lkg.at) / 1000)} s`);
      return lkg.data;
    }
  );
}

/** Sin caché: para el chequeo de salud, que tiene que ver la base de verdad. */
export const loadCheckoutFresh = (storeSlug: string, funnelSlug: string) => load(storeSlug, funnelSlug);

/**
 * Llamar después de guardar cualquier cosa que se vea en un checkout
 * (productos, precios, embudos, mercados, pixels, datos de la tienda).
 * Sin tienda: invalida todos.
 */
export function invalidateCheckouts(storeSlug?: string) {
  revalidateTag(checkoutTag(storeSlug));
}
