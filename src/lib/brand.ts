/**
 * Nombre de la marca que ve el comprador, según el idioma de su compra.
 *
 * Una tienda puede vender con otro nombre en un idioma: una marca en
 * francés tiene otro nombre (stores.brand.names = { fr: "Ma Boutique" }).
 * Checkout, gracias, ofertas post-pago, mails y políticas usan este nombre;
 * los datos legales (razón social, descriptor del extracto) no cambian.
 */
type Branded = { name: string; display_name?: string | null; brand?: unknown };

export function brandFor(store: Branded, locale?: string | null): string {
  const names = (store.brand as { names?: Record<string, unknown> } | null | undefined)?.names;
  const own = locale && names && typeof names[locale] === "string" ? String(names[locale]).trim() : "";
  return own || (store.display_name ?? "").trim() || store.name;
}

/** La misma tienda con el nombre de ese idioma en display_name (para pasarla a mails y pantallas). */
export function withBrand<S extends Branded>(store: S, locale?: string | null): S {
  const name = brandFor(store, locale);
  if (name === ((store.display_name ?? "").trim() || store.name)) return store;
  // El logo del mail es el de la marca original: con otro nombre va el de ese idioma o, si no hay, el nombre en texto.
  const b = (store.brand ?? {}) as Record<string, unknown> & { logoEmailByLocale?: Record<string, string> };
  return { ...store, display_name: name, brand: { ...b, logoEmail: (locale && b.logoEmailByLocale?.[locale]) || null } };
}
