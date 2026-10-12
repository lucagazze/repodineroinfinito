import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db, getProductById } from "@/lib/db";
import { getRates, priceFor } from "@/lib/fx";
import type { Locale } from "@/lib/i18n";
import { OfferScreen, sampleCurrency, isLocale } from "../[step]/screen";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * Vista previa de la página post-compra de un producto, sin pedido: la misma
 * pantalla que vería el comprador (landing HTML o plantilla).
 *   /oferta/preview?store={slug}&product={slug}&lang=en[&currency=EUR][&name=]
 * Datos de muestra (nombre y número de pedido). "Sí" y "No" se simulan: no se
 * cobra ni se anota nada. `name=` vacío prueba el caso sin nombre.
 */
export default async function OfertaPreview({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; product?: string; lang?: string; currency?: string; name?: string }>;
}) {
  // Solo para el panel: sin sesión de admin nadie ve una oferta post-pago sin haber comprado.
  const allowed = await requireAdmin().then(() => true, () => false);
  if (!allowed) redirect("/entrar");

  const sp = await searchParams;
  if (!sp.store || !sp.product) notFound();

  const { data: store } = await db
    .from("stores")
    .select("id,name,display_name,guarantee_days,default_locale")
    .eq("slug", sp.store)
    .maybeSingle();
  if (!store) notFound();

  const { data: row } = await db
    .from("products")
    .select("id,postcompra_page,postcompra_html")
    .eq("store_id", store.id)
    .eq("slug", sp.product)
    .maybeSingle();
  const product = row ? await getProductById(row.id) : null;
  if (!row || !product) notFound();

  const locale: Locale = isLocale(sp.lang) ? sp.lang : isLocale(store.default_locale) ? store.default_locale : "en";
  const price = priceFor(product, sampleCurrency(sp.currency, locale), await getRates());

  return (
    <OfferScreen
      product={product}
      content={row}
      locale={locale}
      price={price}
      buyerName={sp.name !== undefined ? sp.name : "Anna"}
      orderId="3f9a7c21-0000-0000-0000-000000000000"
      orderNumber="#1001"
      store={store}
      mode={{ kind: "preview" }}
    />
  );
}
