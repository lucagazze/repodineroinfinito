import { db } from "./db";

/**
 * Lo que un producto entrega adentro suyo.
 *
 * `products.includes` esta documentado como «los productos que se entregan
 * dentro», y The Analyst's Shelf lo usa con sus cuatro libros -- pero nadie lo
 * expandia al armar el pedido: ni el checkout (fulfill) ni el OTO (upsell).
 * Se leia solo para la biblioteca y para la pagina del OTO, asi que el pack se
 * veia completo en pantalla y el mail de entrega salia con un solo link.
 *
 * La compra de PRUEBA si lo hacia, por otro campo (postcompra_page.incluye),
 * y por eso el test pasaba mientras la entrega real quedaba corta. Las dos
 * fuentes se leen aca, para que no vuelva a haber dos verdades.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function incluidosDe(storeId: string, productIds: string[]): Promise<string[]> {
  const ids = productIds.filter((id) => UUID.test(id));
  if (!ids.length) return [];
  const { data, error } = await db
    .from("products")
    .select("id,includes,postcompra_page")
    .eq("store_id", storeId)
    .in("id", ids);
  if (error) { console.error("[incluidos]", error.message); return []; }

  const porId: string[] = [];
  const porSlug: string[] = [];
  for (const p of data ?? []) {
    for (const x of ((p.includes ?? []) as unknown[])) {
      if (typeof x === "string" && UUID.test(x)) porId.push(x);
    }
    const inc = (p.postcompra_page as { incluye?: unknown } | null)?.incluye;
    if (Array.isArray(inc)) for (const s of inc) if (typeof s === "string" && s) porSlug.push(s);
  }

  // Los que vinieron por slug hay que resolverlos a id.
  if (porSlug.length) {
    const { data: ps } = await db.from("products").select("id")
      .eq("store_id", storeId).in("slug", [...new Set(porSlug)].slice(0, 20));
    for (const p of ps ?? []) porId.push(p.id);
  }

  // Sin el producto mismo (un pack que se incluya a si mismo seria un bucle) y
  // sin repetidos: dos productos del pedido pueden incluir lo mismo.
  const fuera = new Set(ids);
  return [...new Set(porId)].filter((id) => !fuera.has(id));
}
