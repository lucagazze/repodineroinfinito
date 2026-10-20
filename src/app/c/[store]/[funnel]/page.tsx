import type { Metadata } from "next";
import { brandFor } from "@/lib/brand";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { quoteFrom, bumpOffersFrom, currencyFrom } from "@/lib/pricing";
import { pickLocale, T, type Locale } from "@/lib/i18n";
import { db, legalOf } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { loadCheckout } from "@/lib/checkout-data";
import { resolveSettings } from "@/lib/checkout-settings";
import { stripeForStore } from "@/lib/stripe";
import CheckoutClient from "./CheckoutClient";
import { resolveCartDiscount } from "@/lib/cart-discount";
import { formatUntil, recoveryTexts } from "@/lib/cart-recovery-texts";

export const dynamic = "force-dynamic";

/** Pestaña del navegador: «Checkout seguro · Producto · Marca», en el idioma del checkout, con el ícono de la marca. */
export async function generateMetadata({ params }: { params: Promise<{ store: string; funnel: string }> }): Promise<Metadata> {
  const { store, funnel } = await params;
  // Si la base falla, el título no puede tirar la página entera (los errores de
  // metadata no los ataja error.tsx): título genérico y la página sigue.
  const [data, h] = await Promise.all([loadCheckout(store, funnel).catch(() => null), headers()]);
  if (!data) return { robots: { index: false, follow: false } };
  const s = data.funnel.stores;
  const locale = pickLocale({
    fixed: resolveSettings(data.funnel.settings).locale, acceptLanguage: h.get("accept-language"),
    country: h.get("x-vercel-ip-country"), storeDefault: s.default_locale,
  });
  const brand = brandFor(s, locale);
  const product = data.main?.short_name || data.main?.name || data.funnel.name;
  return {
    title: [T[locale].ckSecure, product, brand].filter(Boolean).join(" · "),
    description: product ? `${product} — ${brand}` : brand,
    robots: { index: false, follow: false },
    ...(s.logo_url ? { icons: { icon: s.logo_url, apple: s.logo_url } } : {}),
  };
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string; funnel: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { store, funnel } = await params;
  const sp = await searchParams;
  // UTMs del anuncio: se guardan con el checkout y el pedido para saber qué vende.
  const utm = Object.fromEntries(
    Object.entries(sp).filter(([k, v]) => k.startsWith("utm_") && v).map(([k, v]) => [k, String(v).slice(0, 120)])
  );

  // Una sola carga cacheada + lo que cambia por visitante, en paralelo.
  const [data, rates, h] = await Promise.all([loadCheckout(store, funnel), getRates(), headers()]);
  if (!data) notFound();
  const s = data.funnel.stores;

  // El editor del panel muestra el checkout en un iframe con ?preview=1: no se
  // crea ningún pago y los ajustes llegan por postMessage mientras se editan.
  // Solo en vista previa ?pais gana sobre el país real (el cobro siempre usa el real).
  const preview = sp.preview === "1";
  const forced = sp.pais ? sp.pais.toUpperCase().slice(0, 2) : null;
  const country = preview ? forced ?? h.get("x-vercel-ip-country") : h.get("x-vercel-ip-country") ?? forced;
  const settings = resolveSettings(data.funnel.settings);
  const locale: Locale = pickLocale({
    fixed: settings.locale, acceptLanguage: h.get("accept-language"), country, storeDefault: s.default_locale,
  });

  // Moneda fija de la oferta (settings.currency) o la del país del comprador.
  const currency = settings.currency || currencyFrom(data.markets, country, rates);
  // Descuento del mail de carrito abandonado (?r=…): se verifica acá para mostrarlo y otra vez en /api/pi al cobrar.
  const disc = !preview ? await resolveCartDiscount(sp.r, data.funnel.id) : null;
  const recovery = disc?.ok ? { pct: disc.pct, bumpSlugs: disc.bumps } : null;
  const q = quoteFrom(data, { currency, bumpSlugs: [], rates, recovery });
  if (!q) notFound();
  const rt = recoveryTexts(locale);
  const recoveryProp = disc?.ok
    ? { token: sp.r!, pct: disc.pct, bumps: disc.bumps, banner: rt.bannerOn(disc.pct, formatUntil(disc.expiresAt, locale, country)) }
    : disc ? { notice: disc.reason === "expired" ? rt.bannerExpired : disc.reason === "used" ? rt.bannerUsed : rt.bannerInvalid } : null;
  // Los bumps que ya tenía en el carrito, con el mismo descuento (los que agregue ahora, a precio normal).
  const off = (n: number) => Math.round(n * (100 - (disc?.ok ? disc.pct : 0))) / 100;
  const offers = bumpOffersFrom(data.funnel, currency, rates).map((o) =>
    disc?.ok && disc.bumps.includes(o.slug) ? { ...o, amount: off(o.amount), compareAt: o.amount, off: disc.pct } : o);
  const exitQ = settings.exitOffer.show && (settings.exitOffer.discountPercent > 0 || settings.exitOffer.price > 0)
    ? quoteFrom(data, { currency, bumpSlugs: [], exitDiscount: true, rates })
    : null;

  const [conn, { count: buyersNow }] = await Promise.all([
    // La llave pública viene con los datos cacheados del checkout: sin otra consulta (y anda aunque la base falle).
    // Con Whop no se consulta Stripe: una consulta menos y una llave menos al navegador.
    s.gateway === "whop"
      ? Promise.resolve({ publishableKey: "" })
      : data.publishableKey ? Promise.resolve({ publishableKey: data.publishableKey }) : stripeForStore(s.id),
    // Barra de compradores con el número real: checkouts de esta oferta
    // abiertos en los últimos 30 minutos.
    settings.buyersBar.show
      ? db.from("checkouts").select("id", { count: "exact", head: true })
        .eq("funnel_id", data.funnel.id).gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
      : Promise.resolve({ count: 0 }),
  ]);

  const brand = (s.brand ?? {}) as { payButton?: string; guaranteeImage?: string };
  const legal = legalOf(s);

  // Con qué cobra esta tienda. Es un dato de la tienda y no se deduce de qué
  // conexión existe: durante una migración las dos conviven y adivinar por
  // presencia haría cobrar a la que se conectó último.
  const gateway: "stripe" | "whop" = s.gateway === "whop" ? "whop" : "stripe";

  return (
    <>
      {/* Se precalienta solo la pasarela que esta tienda va a montar. */}
      {gateway === "whop" ? (
        <link rel="preconnect" href="https://js.whop.com" />
      ) : (
        <>
          {/* Stripe.js se baja mientras el navegador arma la página. */}
          <link rel="preconnect" href="https://js.stripe.com" />
          <link rel="preconnect" href="https://api.stripe.com" />
          <link rel="preconnect" href="https://m.stripe.network" />
        </>
      )}
      <CheckoutClient
        store={store}
        funnel={funnel}
        settings={settings}
        preview={preview}
        buyersNow={(buyersNow ?? 0) + 1 /* quien lo está mirando */}
        logoUrl={s.logo_url ?? null}
        policyUrls={{
          terms: `/catalogo/${store}/terms?lang=${locale}`,
          privacy: `/catalogo/${store}/privacy?lang=${locale}`,
          refund: `/catalogo/${store}/refund-policy?lang=${locale}`,
        }}
        exitPrice={exitQ ? exitQ.lines[0].amount : null}
        locale={locale}
        country={country}
        currency={currency}
        publishableKey={conn.publishableKey}
        gateway={gateway}
        whopAccountId={data.whopAccountId ?? null}
        pmc={s.stripe_pmc ?? null}
        pixels={preview ? [] : data.pixelIds}
        storeName={brandFor(s, locale)}
        legalName={legal.name}
        legalAddress={legal.address}
        statementName={legal.statement}
        supportEmail={s.support_email}
        payColor={brand.payButton || "#005bd1"}
        guaranteeDays={s.guarantee_days}
        guaranteeImage={brand.guaranteeImage ?? null}
        main={{
          name: q.lines[0].product.name,
          shortName: q.lines[0].product.short_name,
          image: q.lines[0].product.image_url,
          amount: q.lines[0].amount,
          compareAt: q.lines[0].compareAt,
        }}
        included={q.included.map((p) => ({ name: p.short_name }))}
        bonuses={q.bonuses.map((b) => ({ name: b.product.short_name, displayValue: b.displayValue }))}
        offers={offers}
        recovery={recoveryProp}
        baseCompareTotal={q.compareTotal}
        utm={utm}
        prefillEmail={/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sp.email ?? "") ? sp.email!.slice(0, 200) : ""}
        notice={sp.pago === "no" ? T[locale].ckPayNotDone : null}
      />
    </>
  );
}
