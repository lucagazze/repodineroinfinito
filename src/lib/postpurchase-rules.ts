import { baseOf } from "./postpurchase";

/**
 * Reglas de una cadena post-compra, para validar antes de guardar (MCP) y
 * para avisar en el panel y en la simulación. Mensajes en castellano: los lee
 * el dueño.
 *
 *  1. Como máximo 3 niveles de OTO.
 *  2. Cada OTO tiene a lo sumo un downsell.
 *  3. El downsell es LA MISMA oferta que su OTO, más barata (en torno a la
 *     mitad): una variante de precio (variant_of = el OTO o su base), con un
 *     motivo verdadero en la página. Nunca el mismo producto (mismo id), ni
 *     otro libro distinto, ni más caro.
 *  4. Una misma oferta (el mismo producto, o una variante de precio suya) no
 *     es OTO en dos niveles distintos. Los LIBROS sí pueden repetirse entre
 *     niveles (p. ej. la colección completa en el nivel 1 y el par de libros
 *     nuevos en el nivel 2): el motor nunca ofrece algo que ya tiene, así que
 *     quien compró la colección no ve el par.
 */

export type RuleProduct = {
  id: string; short_name: string; variant_of?: string | null; includes?: string[] | null; book_count?: number | null;
  /** «Toda la biblioteca»: puede repetir libros de otros niveles (es el superconjunto). */
  is_library?: boolean | null;
  /** Precio por moneda (unidades mayores), para comprobar que el downsell sea más barato. */
  prices?: Record<string, number>;
};
export type RuleStep = { kind: "oto" | "downsell"; level: number; parent: number | null; product: RuleProduct };

/** Cuántos libros trae un producto: el número cargado, o lo que incluye, o 1. */
export const bookCount = (p: RuleProduct) => p.book_count ?? ((p.includes ?? []).filter(Boolean).length || 1);

export function chainProblems(steps: RuleStep[], nameOf: (id: string) => string | undefined = () => undefined): string[] {
  const out: string[] = [];
  const name = (p: RuleProduct) => `«${p.short_name}»`;
  const label = (id: string) => `«${nameOf(id) ?? steps.find((s) => baseOf(s.product) === id || s.product.id === id)?.product.short_name ?? id}»`;

  const levels = [...new Set(steps.filter((s) => s.kind === "oto").map((s) => s.level))].sort((a, b) => a - b);
  if (levels.length > 3) out.push(`Máximo 3 niveles de OTO por checkout: esta cadena tendría ${levels.length}.`);

  steps.forEach((s, i) => {
    if (s.kind !== "oto") return;
    const ds = steps.filter((d) => d.kind === "downsell" && d.parent === i);
    if (ds.length > 1) out.push(`${name(s.product)} tiene ${ds.length} downsells: cada OTO tiene uno solo.`);
  });

  for (const d of steps) {
    if (d.kind !== "downsell" || d.parent === null || !steps[d.parent]) continue;
    const parent = steps[d.parent].product;
    if (d.product.id === parent.id) {
      out.push(`El downsell de ${name(parent)} es el mismo producto: tiene que ser una variante más barata (otro producto con variant_of = ${name(parent)}).`);
      continue;
    }
    if (baseOf(d.product) !== baseOf(parent)) {
      out.push(`El downsell ${name(d.product)} tiene que ser la misma oferta que su OTO ${name(parent)}, más barata: `
        + `una variante de precio (variant_of = ${name(parent)}), no otro producto.`);
      continue;
    }
    const pricier = Object.entries(d.product.prices ?? {}).filter(([cur, amt]) => {
      const p = parent.prices?.[cur];
      return p != null && amt >= p;
    });
    if (pricier.length) out.push(`El downsell ${name(d.product)} no es más barato que ${name(parent)} en ${pricier.map(([c]) => c).join(", ")}.`);
  }

  const where = new Map<string, Set<number>>();
  for (const s of steps) {
    if (s.kind !== "oto") continue;
    const id = baseOf(s.product);
    where.set(id, new Set([...(where.get(id) ?? []), s.level]));
  }
  for (const [id, lv] of where) {
    if (lv.size > 1) out.push(`${label(id)} es OTO en los niveles ${[...lv].sort().join(" y ")}: la misma oferta no se repite en dos niveles (los libros sí pueden estar en ofertas de distintos niveles).`);
  }
  return out;
}
