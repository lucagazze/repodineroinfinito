import type { Price, Product } from "@/lib/db";
import { LOCALES, money, type Locale } from "@/lib/i18n";
import { buildOfferView, firstNameOf, offerUi, orderNumberOf } from "@/lib/postcompra-page";
import { renderOtoHtml } from "@/lib/postcompra-html";
import { otoContents } from "@/lib/oto-contents";
import OfferClient from "./OfferClient";
import HtmlOffer from "./HtmlOffer";
import type { OfferMode } from "./useOffer";

export const isLocale = (l?: string | null): l is Locale => !!l && (LOCALES as readonly string[]).includes(l);

/** «Ahorrás» en el idioma del comprador, para la etiqueta de ahorro junto al precio. */
const SAVE: Record<string, string> = { it: "Risparmi", en: "You save", es: "Ahorras", "pt-BR": "Você economiza", fr: "Vous économisez", de: "Du sparst" };

/** Moneda de muestra para vistas previas: la pedida, o la del idioma (euro para it/fr/de). */
export function sampleCurrency(param: string | undefined, locale: Locale) {
  if (/^[A-Za-z]{3}$/.test(param ?? "")) return param!.toUpperCase();
  return ["it", "fr", "de"].includes(locale) ? "EUR" : "USD";
}

/**
 * La pantalla de una oferta post-compra, igual para el pedido real, la vista
 * previa y la simulación: la landing HTML del producto si tiene una, o el
 * diseño con plantilla si no.
 */
export async function OfferScreen(i: {
  product: Product;
  content: { postcompra_page?: unknown; postcompra_html?: string | null } | null;
  locale: Locale;
  /** Precio en la moneda del pedido (priceFor). null solo en vista previa sin precio. */
  price: Price | null;
  buyerName: string | null;
  orderId: string;
  /** «#1001» (orderRef). Sin él, la referencia vieja del id. */
  orderNumber?: string;
  store: { name?: string | null; display_name?: string | null; guarantee_days?: number | null };
  mode: OfferMode;
  pillDetail?: string;
}) {
  const amount = Number(i.price?.amount ?? 0);
  const compareAt = Number(i.price?.compare_at ?? 0);
  const fmt = (n: number) => (i.price ? money(n, i.price.currency, i.locale) : "—");
  const price = fmt(amount);
  const compare = i.price && compareAt > amount ? fmt(compareAt) : null;
  const storeName = i.store.display_name || i.store.name || "";
  const guaranteeDays = Number(i.store.guarantee_days ?? 0);

  const html = i.content?.postcompra_html?.trim();
  if (html) {
    const page = renderOtoHtml(html, {
      price,
      compare,
      firstName: firstNameOf(i.buyerName),
      guaranteeDays,
      storeName,
      productName: i.product.short_name || i.product.name,
      orderNumber: i.orderNumber ?? `#${orderNumberOf(i.orderId)}`,
      savings: compare ? fmt(Math.round((compareAt - amount) * 100) / 100) : null,
      discount: compare ? `${Math.round((1 - amount / compareAt) * 100)}%` : null,
    });
    // Preventa (055): la landing propia de la OTO no sabe que el libro llega después; la franja arriba lo dice.
    // Sin franja de preventa: el plazo no se dice en el post-pago, solo en el documento de Drive.
    const banner = "";
    return (
      <HtmlOffer html={banner + page.html} title={page.title} locale={i.locale} ui={offerUi(i.locale)}
        mode={i.mode} pillDetail={i.pillDetail} />
    );
  }

  // Kit o biblioteca: cada libro por separado, con su tapa, su descripción y sus páginas.
  const contents = await otoContents(i.product).catch(() => []);
  const view = buildOfferView({
    contents,
    page: i.content?.postcompra_page,
    product: i.product,
    locale: i.locale,
    price,
    compare,
    buyerName: i.buyerName,
    orderId: i.orderId,
    orderNumber: i.orderNumber,
    guaranteeDays,
    storeName,
  });
  // Lo que ahorra, junto al precio de la primera pantalla.
  const pct = compare ? Math.round((1 - amount / compareAt) * 100) : 0;
  const save = compare && pct >= 5 ? `−${pct} % · ${SAVE[i.locale] ?? SAVE.en} ${fmt(Math.round((compareAt - amount) * 100) / 100)}` : null;
  return <OfferClient view={view} mode={i.mode} pillDetail={i.pillDetail} save={save} />;
}
