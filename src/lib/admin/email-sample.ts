import { db, getFunnel, getProductById, itemsByRole, STORE_COLS, type Product, type Store } from "@/lib/db";
import { renderDelivery, renderRecovery } from "@/lib/email";
import { LOCALES, type Locale } from "@/lib/i18n";
import { publicBaseUrl } from "@/lib/stripe-connect";
import { checkoutUrl } from "@/lib/checkout-url";

/**
 * Los mails de la tienda tal como salen hoy, con un pedido de muestra y un
 * producto real (el principal de su primer checkout activo). Para las vistas
 * previas de Configuración › Entrega.
 */
export async function sampleEmails(storeId: string, slug: string) {
  const { data: st } = await db.from("stores").select(STORE_COLS).eq("id", storeId).single();
  const store = st as unknown as Store;
  const locale = ((LOCALES as readonly string[]).includes(store.default_locale) ? store.default_locale : "en") as Locale;

  const { data: funnels } = await db.from("funnels").select("slug,checkout_host,checkout_path").eq("store_id", storeId).eq("active", true)
    .not("main_product_id", "is", null).order("sort_order").limit(1);
  const f = funnels?.[0] ? await getFunnel(slug, funnels[0].slug) : null;
  let main: Product | null = f?.main_product_id ? await getProductById(f.main_product_id) : null;
  let extras: Product[] = f ? [...itemsByRole(f, "included"), ...itemsByRole(f, "bonus")] : [];
  if (!main) {
    const { data: p } = await db.from("products").select("id").eq("store_id", storeId).eq("kind", "main").order("sort_order").limit(1);
    main = p?.[0] ? await getProductById(p[0].id) : null;
    extras = [];
  }
  if (!main) {
    main = {
      id: "ejemplo", slug: "ejemplo", name: "Tu producto", short_name: "Tu producto", description: "Así se ve un producto en el mail.",
      kind: "main", delivery_url: "https://example.com/descarga", image_url: null, email_image_url: null, sort_order: 0, product_prices: [],
    };
  }
  const want = locale === "it" ? "EUR" : "USD";
  const price = main.product_prices.find((p) => p.currency === want) ?? main.product_prices.find((p) => p.currency === "USD") ?? main.product_prices[0];
  const currency = price?.currency ?? want;
  const amount = Number(price?.amount ?? 27);
  return {
    delivery: renderDelivery({
      to: store.support_email, name: "Giulia Rossi", store, locale, main, extras, currency, orderRef: "#1001", total: amount,
    }),
    recovery: renderRecovery({
      to: store.support_email, name: "Giulia Rossi", store, locale, product: main, amount, currency,
      url: funnels?.[0] ? checkoutUrl(funnels[0], slug) : `${publicBaseUrl()}/c/${slug}/`,
    }),
  };
}
