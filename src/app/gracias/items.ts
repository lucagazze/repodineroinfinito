import type { Product } from "@/lib/db";
import { downloadHref, hasDownload } from "@/lib/downloads";
import { T, type Locale } from "@/lib/i18n";
import { firstNameOf } from "@/lib/postcompra-page";
import type { TyItem } from "./ThankYouView";

const RANK: Record<string, number> = { main: 0, bump: 1, upsell: 2, included: 3, bonus: 4 };

/** Con qué rol quedó cada producto: si aparece dos veces, gana el más importante. */
export function kindMap(rows: { product_id: string; kind: string }[]) {
  const m = new Map<string, string>();
  for (const r of rows) {
    const prev = m.get(r.product_id);
    if (!prev || (RANK[r.kind] ?? 9) < (RANK[prev] ?? 9)) m.set(r.product_id, r.kind);
  }
  return m;
}

/**
 * Tarjetas de descarga: una por producto con algo para bajar (archivo propio
 * por /d/{pedido}/{producto}, o el link de Drive) más sus links extra. Los que
 * no tienen nada propio van a la lista de "incluido".
 * Sin pedido (simulación), un archivo propio no tiene link: queda "#".
 */
export function thankYouItems(products: Product[], kinds: Map<string, string>, orderId: string | null,
  opts: { sub?: (p: Product) => boolean; nota?: string; storeDomain?: string | null } = {}) {
  const { sub, nota, storeDomain } = opts;
  const sorted = [...products].sort((a, b) => (RANK[kinds.get(a.id) ?? ""] ?? 9) - (RANK[kinds.get(b.id) ?? ""] ?? 9));
  const items: TyItem[] = [];
  const included: string[] = [];
  for (const p of sorted) {
    const main = hasDownload(p) ? downloadHref(p, orderId, storeDomain) ?? "#" : null;
    const links = [
      ...(main ? [{ label: p.short_name, url: main }] : []),
      ...(p.delivery_links ?? []).filter((l) => l && /^https?:\/\//.test(l.url)),
    ];
    const archivo = p.delivery_file_name || p.delivery_file || "";
    const base = { id: p.id, slug: p.slug, name: p.short_name, image: p.image_url,
      kind: kinds.get(p.id) ?? "main", ext: archivo.split(".").pop()?.toLowerCase() };
    if (links.length) items.push({ ...base, links });
    // Una suscripcion no tiene boton y no esta «incluida»: se cobra aparte y
    // llega por mail. Va como renglon propio con lo que pasa ahora, en vez de
    // aparecer sin nada al lado -- que, justo despues de pagar, parece roto.
    else if (sub?.(p)) items.push({ ...base, links: [], note: nota ?? "" });
    else included.push(p.short_name);
  }
  return { items, included };
}

/**
 * Lo que se le dice al que acaba de pagar la suscripcion. No hay boton: la
 * entrega es el correo del domingo. Vale cualquier dia de la semana a
 * proposito -- «este domingo» seria mentira para el que compra un domingo de
 * noche.
 */
export const SUB_NOTA: Record<Locale, string> = {
  en: "No download — it arrives by email every Sunday. Your first issue is the next one out.",
  es: "No se descarga: llega por mail cada domingo. Tu primera edicion es la proxima que sale.",
  it: "Niente download: arriva via email ogni domenica. La tua prima edizione e la prossima.",
  "pt-BR": "Nao tem download: chega por e-mail todo domingo. Sua primeira edicao e a proxima.",
  fr: "Pas de telechargement : elle arrive par e-mail chaque dimanche. Votre premiere edition est la prochaine.",
  de: "Kein Download - sie kommt jeden Sonntag per E-Mail. Ihre erste Ausgabe ist die naechste.",
};

export const SUMMARY: Record<Locale, { title: string; total: string; free: string }> = {
  it: { title: "Riepilogo dell'ordine", total: "Totale", free: "Incluso" },
  en: { title: "Order summary", total: "Total", free: "Included" },
  es: { title: "Resumen de tu compra", total: "Total", free: "Incluido" },
  "pt-BR": { title: "Resumo da compra", total: "Total", free: "Incluído" },
  fr: { title: "Récapitulatif de la commande", total: "Total", free: "Inclus" },
  de: { title: "Bestellübersicht", total: "Gesamt", free: "Inklusive" },
};

/** "Thank you, Anna!" o el título propio de la tienda ({nombre} = nombre de pila). */
export function thankYouTitle(locale: Locale, custom: string | undefined, fullName: string | null) {
  const t = T[locale] ?? T.en;
  const first = firstNameOf(fullName);
  if (custom?.trim()) return custom.trim().replace(/ ?\{nombre\}/g, first ? ` ${first}` : "");
  if (!first) return t.thanksTitle;
  if (locale === "es") return `¡${t.thanksTitleNamed}, ${first}!`;
  // En francés va un espacio antes del signo.
  if (locale === "fr") return `${t.thanksTitleNamed}, ${first} !`;
  return `${t.thanksTitleNamed}, ${first}!`;
}
