import { siteUrl } from "./recovery";

type F = { slug: string; checkout_host?: string | null; checkout_path?: string | null };

/**
 * Dirección pública de un checkout.
 * Con checkout_path: el subdominio de la oferta (pay.tumarca.com/en/checkout).
 * Sin él: /c/{tienda}/{embudo} en checkout_host (pay.*) o, si no hay, en la app.
 */
export function checkoutUrl(f: F, storeSlug: string) {
  const host = (f.checkout_host ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const base = host ? `https://${host}` : siteUrl();
  return f.checkout_path && host ? `${base}${f.checkout_path}` : `${base}/c/${storeSlug}/${f.slug}`;
}
