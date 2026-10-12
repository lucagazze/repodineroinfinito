import "server-only";
import { db } from "@/lib/db";

/** Un libro de un kit, como se muestra en la página del OTO. */
export type OtoBook = { name: string; description: string; cover: string | null; pages: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los libros que trae un OTO que es un kit o una biblioteca. Salen de `includes`: la tapa y la descripción de cada producto, y como páginas las
 * de la galería de su propia página de OTO (`postcompra_page.gallery.images`). Un libro suelto no tiene
 * kit: devuelve []. En el orden en que están cargados en el kit.
 */
export async function otoContents(product: { includes?: string[] | null }): Promise<OtoBook[]> {
  const ids = (product.includes ?? []).filter((x) => UUID.test(x));
  if (ids.length < 2) return [];
  const { data } = await db.from("products").select("id,short_name,name,description,image_url,postcompra_page").in("id", ids.slice(0, 40));
  const byId = new Map((data ?? []).map((p) => [p.id as string, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((p) => {
    const g = ((p!.postcompra_page as { gallery?: { images?: unknown } } | null)?.gallery?.images);
    const pages = Array.isArray(g) ? g.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 12) : [];
    return {
      name: (p!.short_name as string | null) || (p!.name as string),
      description: ((p!.description as string | null) ?? "").trim(),
      cover: (p!.image_url as string | null) ?? null,
      pages,
    };
  });
}
