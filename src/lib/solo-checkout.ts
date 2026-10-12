import { db } from "./db";
import { checkoutUrl } from "./checkout-url";
import { mergeSettings } from "./checkout-settings";
import { invalidateEverything } from "./cache-bust";
import { SOLO_SUFFIX } from "./admin/offers";

/**
 * El checkout de un libro suelto (lo mismo que «Crear link» en Productos, sin el permiso de administrador): si ya
 * hay un checkout activo de ese producto solo (sin bumps ni post-pago), ese; si no, lo crea copiando el aspecto, los
 * píxeles, el mercado y el host del checkout de su oferta, sin bumps, sin post-pago y sin oferta de salida. Lo usa la
 * biblioteca
 * cuando al comprador no se le puede cobrar con un clic. El precio es el del producto: nada gratis.
 */
export async function soloCheckoutUrl(storeId: string, offerId: string, productId: string): Promise<string | null> {
  const { data: p } = await db.from("products").select("id,slug,short_name,store_id,product_prices(currency,amount),stores!inner(slug,domain)")
    .eq("id", productId).eq("store_id", storeId).maybeSingle();
  if (!p || !(p.product_prices ?? []).some((x) => Number(x.amount) > 0)) return null;
  const storeSlug = (p.stores as unknown as { slug: string }).slug;
  // Un checkout suelto no tiene ruta propia en el sitio de la oferta: va en el dominio de pago de la tienda (pay.*).
  // Copiar el host de la oferta (pay.tumarca.com) sin su ruta da un link que no abre.
  const payHost = (p.stores as unknown as { domain: string | null }).domain ?? null;

  const { data: same } = await db.from("funnels").select("id,slug,checkout_host,checkout_path").eq("store_id", storeId).eq("main_product_id", productId).eq("active", true);
  const sids = (same ?? []).map((f) => f.id as string);
  if (sids.length) {
    const [{ data: its }, { data: pps }] = await Promise.all([
      db.from("funnel_items").select("funnel_id").in("funnel_id", sids).in("role", ["bump", "upsell"]),
      db.from("pp_funnels").select("checkout_funnel_id").in("checkout_funnel_id", sids),
    ]);
    const busy = new Set([...(its ?? []).map((x) => x.funnel_id as string), ...(pps ?? []).map((x) => x.checkout_funnel_id as string)]);
    const clean = (same ?? []).find((f) => !busy.has(f.id as string));
    // Uno viejo sin ruta propia va igual en pay.* (el host de la oferta sin su ruta no abre).
    if (clean) return checkoutUrl((clean.checkout_path ? clean : { ...clean, checkout_host: payHost }) as never, storeSlug);
  }

  // El aspecto, los píxeles y el host: del primer checkout activo de la oferta (un mercado, no otro link suelto).
  const { data: srcs } = await db.from("funnels").select("id,slug,settings,pixel_ids,market_label,checkout_host,active,sort_order")
    .eq("offer_id", offerId).eq("store_id", storeId).order("sort_order");
  const src = (srcs ?? []).find((f) => f.active && !(f.slug as string).endsWith(SOLO_SUFFIX)) ?? (srcs ?? [])[0];
  if (!src) return null;
  const settings = mergeSettings(src.settings, { exitOffer: { show: false } });

  const { data: taken } = await db.from("funnels").select("slug").eq("store_id", storeId).like("slug", `${p.slug}%`);
  const used = new Set((taken ?? []).map((f) => f.slug as string));
  let fslug = `${p.slug}${SOLO_SUFFIX}`;
  for (let i = 2; used.has(fslug); i++) fslug = `${p.slug}-${i}${SOLO_SUFFIX}`;
  const { data: nf, error } = await db.from("funnels").insert({
    store_id: storeId, offer_id: offerId, slug: fslug, name: p.short_name, main_product_id: productId, active: true, sort_order: 900,
    settings, pixel_ids: src.pixel_ids ?? [], market_label: src.market_label ?? "", checkout_host: payHost, checkout_path: null,
  }).select("id,slug,checkout_host,checkout_path").single();
  if (error || !nf) {
    console.error("[biblioteca] checkout suelto:", error?.message);
    return null;
  }
  await invalidateEverything().catch(() => {});
  return checkoutUrl(nf as never, storeSlug);
}
