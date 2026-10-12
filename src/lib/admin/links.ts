import { cache } from "react";
import { publicBaseUrl } from "@/lib/stripe-connect";
import { storeMetrics } from "@/lib/metrics";
import { checkoutUrl } from "@/lib/checkout-url";

/** La dirección pública de la app para los links que se copian (NEXT_PUBLIC_SITE_URL; si falta, la de Vercel). */
export const siteBase = () => (process.env.NEXT_PUBLIC_SITE_URL || publicBaseUrl()).replace(/\/+$/, "");

/**
 * Link de un checkout. Si tiene host propio (funnels.checkout_host, p. ej.
 * pay.tumarca.com, y a veces una ruta: pay.tumarca.com/en/checkout)
 * ese es el link de verdad: el que se copia, se abre y va en los anuncios.
 * Si no, la dirección pública de la app. `app` es siempre /c/ en la app.
 */
export function checkoutUrls(store: { slug: string }, f: { slug: string; checkout_host?: string | null; checkout_path?: string | null }) {
  const host = (f.checkout_host ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const app = `${siteBase()}/c/${store.slug}/${f.slug}`;
  const own = host ? checkoutUrl({ ...f, checkout_host: host }, store.slug) : null;
  return { primary: own ?? app, app, own, host: host || null };
}

/** Métricas una sola vez por request, aunque las pidan varias tarjetas. */
export const metricsFor = cache((storeId: string, days: number, funnelKey = "") =>
  storeMetrics(storeId, days, funnelKey ? funnelKey.split(",") : undefined));
