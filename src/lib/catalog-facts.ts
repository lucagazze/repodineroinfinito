import { db } from "./db";
import { resolveSettings } from "./checkout-settings";

/**
 * Los datos del texto del negocio en el catálogo, calculados de lo que de verdad se vende. El texto guardado usa marcas que se reemplazan en vivo:
 * {languages} {topics} {audiences} {countries} {price_range}. Así, cuando se suma una oferta (otro idioma, otro
 * tema, otro precio), el catálogo lo dice solo.
 *
 * Temas y públicos salen de la categoría de cada oferta. Una categoría que no está acá se marca en
 * «Catálogos» para agregarla (nunca se inventa el texto).
 */
export const TOPICS: Record<string, { topic: string; who: string }> = {
  // "Categoría": { topic: "lo que enseña (en inglés)", who: "para quién es (en inglés)" },
};
/** Los del código + los cargados desde el MCP (`set_catalog_topic`, app_settings «catalog_topics»): una categoría nueva se arregla sin deploy. */
export async function topicsMap(): Promise<Record<string, { topic: string; who: string }>> {
  const { data } = await db.from("app_settings").select("value").eq("key", "catalog_topics").maybeSingle();
  return { ...TOPICS, ...((data?.value as Record<string, { topic: string; who: string }> | null) ?? {}) };
}

/** Categorías que agrupan otras (no son un tema propio). */
const AGGREGATE = new Set(["Biblioteca"]);
const COUNTRY: Record<string, string> = { it: "Italy", fr: "France", de: "Germany", es: "Spain", pt: "Portugal and Brazil" };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const isTest = (s: string | null | undefined) => /\bprueba\b|\btest\b/i.test(s ?? "");

export type CatalogFacts = {
  languages: string[]; topics: string[]; audiences: string[]; countries: string[];
  /** Categorías de ofertas que no tienen texto en TOPICS (hay que agregarlas). */
  unknown: string[];
  /** Ofertas sin categoría (no suman tema). */
  uncategorized: string[];
};

export async function catalogFacts(store: { id: string; default_locale?: string | null }): Promise<CatalogFacts> {
  const [{ data: offers }, { data: funnels }] = await Promise.all([
    db.from("offers").select("id,name,category").eq("store_id", store.id),
    db.from("funnels").select("offer_id,settings,main_product_id,products!funnels_main_product_id_fkey(active,name)").eq("store_id", store.id),
  ]);
  type F = { offer_id: string | null; settings: unknown; products: { active: boolean | null; name: string } | null };
  // Lo que se vende: ofertas con algún checkout cuyo principal está activo (también las que todavía cobra la plataforma anterior).
  const selling = ((funnels ?? []) as unknown as F[]).filter((f) => f.products?.active !== false && !isTest(f.products?.name));
  const offerIds = new Set(selling.map((f) => f.offer_id).filter(Boolean));
  const sold = (offers ?? []).filter((o) => offerIds.has(o.id) && !isTest(o.name as string));

  const langs = [...new Set(selling.map((f) => resolveSettings(f.settings).locale || store.default_locale || "").map((l) => l.slice(0, 2)).filter(Boolean))];
  const order = ["it", "en", "fr", "de", "es", "pt"];
  langs.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const name = new Intl.DisplayNames(["en"], { type: "language" });
  const cats = [...new Set(sold.map((o) => (o.category as string | null)?.trim()).filter((c): c is string => !!c && !AGGREGATE.has(c)))];
  const T = await topicsMap();
  const known = cats.filter((c) => T[c]);
  const enCountries = store.default_locale === "en" ? ["the United States", "the United Kingdom", "Canada", "Australia"] : ["the United States"];
  return {
    languages: langs.map((l) => name.of(l) ?? l),
    topics: known.map((c) => T[c].topic),
    audiences: [...new Set(known.map((c) => T[c].who))],
    countries: [...new Set(langs.flatMap((l) => (l === "en" ? enCountries : COUNTRY[l] ? [COUNTRY[l]] : [])))],
    unknown: cats.filter((c) => !T[c]),
    uncategorized: sold.filter((o) => !(o.category as string | null)?.trim()).map((o) => o.name as string),
  };
}

/** Reemplaza las marcas del texto guardado con los datos de hoy. */
export function fillFacts(text: string | null | undefined, f: CatalogFacts, priceRange: string | null): string {
  return (text ?? "")
    .replaceAll("{languages}", list(f.languages))
    .replaceAll("{topics}", list(f.topics))
    .replaceAll("{audiences}", f.audiences.join("; "))
    .replaceAll("{countries}", list(f.countries))
    .replaceAll("{price_range}", priceRange ?? "");
}
