import { db } from "@/lib/db";
import { orderSteps, resolveLevels } from "@/lib/postpurchase";
import { chainProblems, type RuleProduct, type RuleStep } from "@/lib/postpurchase-rules";

/**
 * Valida una cadena post-compra (las filas de pp_steps tal como quedarían)
 * con las reglas de postpurchase-rules: máximo 3 niveles, un downsell por OTO
 * que sea la misma oferta más barata (variante de precio), y ningún libro
 * repetido entre niveles. Devuelve los problemas en castellano (vacío = se puede guardar).
 */
export type PpRow = {
  id: string; product_id: string; kind: string; downsell_of: string | null; level: number | null; sort_order: number; show_if?: unknown;
};

export async function ppProblems(rows: PpRow[]): Promise<string[]> {
  if (!rows.length) return [];
  const ordered = orderSteps(rows);
  const levels = resolveLevels(ordered);
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const { data: prods } = await db.from("products").select("id,short_name,variant_of,includes,book_count,is_library,product_prices(currency,amount)").in("id", ids);
  const byId = new Map((prods ?? []).map((p) => {
    const prices = Object.fromEntries(((p.product_prices ?? []) as { currency: string; amount: number | string | null }[])
      .filter((x) => x.amount != null).map((x) => [x.currency, Number(x.amount)]));
    return [p.id as string, { ...(p as unknown as RuleProduct), prices }];
  }));
  const refIds = [...new Set((prods ?? []).flatMap((p) => [...((p.includes as string[] | null) ?? []), ...(p.variant_of ? [p.variant_of as string] : [])]))];
  const { data: refs } = refIds.length ? await db.from("products").select("id,short_name").in("id", refIds) : { data: [] };
  const names = new Map((refs ?? []).map((r) => [r.id as string, r.short_name as string]));
  const indexOf = new Map(ordered.map((s, i) => [s.row.id, i]));
  const steps: RuleStep[] = ordered.map((s, i) => ({
    kind: s.parentRow ? "downsell" : "oto",
    level: levels[i],
    parent: s.parentRow ? indexOf.get(s.parentRow.id) ?? null : null,
    product: byId.get(s.row.product_id) ?? { id: s.row.product_id, short_name: s.row.product_id },
  }));
  return chainProblems(steps, (id) => names.get(id) ?? byId.get(id)?.short_name);
}
