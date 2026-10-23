import { siteUrl } from "./recovery";
import type { Product } from "./db";

/**
 * A dónde lleva el botón «Descargar» de un producto en un pedido.
 * Con archivo propio (delivery_file): /d/{pedido}/{producto}, que verifica el
 * pedido y baja el PDF directo, como las descargas digitales de Shopify.
 * Sin archivo: el link de siempre (Drive u otro).
 */
export function downloadHref(
  p: Pick<Product, "slug" | "delivery_url"> & { delivery_file?: string | null },
  orderId?: string | null,
  /** Dominio de la tienda (stores.domain). Sin esto cae en el global, que es
   *  el de una sola marca: el comprador de otra recibe links ajenos. */
  storeDomain?: string | null,
) {
  if (p.delivery_file && orderId) {
    const base = storeDomain ? `https://${storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : siteUrl();
    return `${base}/d/${orderId}/${p.slug}`;
  }
  return p.delivery_url ?? null;
}

/** ¿Tiene algo para descargar? */
export const hasDownload = (p: { delivery_url?: string | null; delivery_file?: string | null }) =>
  !!(p.delivery_file || p.delivery_url);
