import { z } from "zod";
import { parseShowIf } from "@/lib/postpurchase";

/**
 * Condiciones de los pasos post-compra (pp_steps.show_if) en el MCP: Claude
 * las escribe con slugs, la base las guarda con ids.
 */

export const showIfInput = z.object({
  owns_any: z.array(z.string().min(1)).max(20).optional().describe("Show only if the buyer already has ANY of these products (slugs)."),
  owns_none: z.array(z.string().min(1)).max(20).optional().describe("Show only if the buyer has NONE of these products (slugs)."),
  checkout_any: z.array(z.string().min(1)).max(20).optional().describe("Show only if ANY of these was bought IN THE CHECKOUT (main, bumps, bonuses); post-purchase acceptances don't count. Use for bump branches."),
  checkout_none: z.array(z.string().min(1)).max(20).optional().describe("Show only if NONE of these was bought in the checkout."),
}).nullable().optional()
  .describe("Condition on what the buyer already has (checkout main + bumps + OTOs accepted so far; a pack counts as its includes). null = no condition.");

const KEYS = ["owns_any", "owns_none", "checkout_any", "checkout_none"] as const;
type ShowIfSlugs = Partial<Record<(typeof KEYS)[number], string[]>> | null | undefined;

/** Slugs → ids (los productos ya se validaron con productsBySlugs). */
export function showIfIds(c: ShowIfSlugs, bySlug: Map<string, { id: string }>) {
  if (!c) return null;
  const ids = (l?: string[]) => (l ?? []).map((s) => bySlug.get(s)?.id).filter((x): x is string => !!x);
  const out: Record<string, string[]> = {};
  for (const k of KEYS) if (ids(c[k]).length) out[k] = ids(c[k]);
  return Object.keys(out).length ? out : null;
}

/** Ids guardados → slugs, para mostrarlos. */
export function showIfSlugs(raw: unknown, names: Map<string, string>): ShowIfSlugs {
  const c = parseShowIf(raw);
  if (!c) return null;
  const out: Record<string, string[]> = {};
  for (const k of KEYS) if (c[k]?.length) out[k] = c[k]!.map((id) => names.get(id) ?? id);
  return out;
}

export function showIfText(c: ShowIfSlugs) {
  if (!c) return "";
  const parts = [
    c.owns_any?.length ? `only if owns any of: ${c.owns_any.join(", ")}` : "",
    c.owns_none?.length ? `only if owns none of: ${c.owns_none.join(", ")}` : "",
    c.checkout_any?.length ? `only if bought in checkout any of: ${c.checkout_any.join(", ")}` : "",
    c.checkout_none?.length ? `only if bought in checkout none of: ${c.checkout_none.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? ` [${parts.join("; ")}]` : "";
}
