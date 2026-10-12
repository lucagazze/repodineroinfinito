import { z } from "zod";
import { aiConfigured, aiJson, AI_MISSING } from "../ai-reply";
import { brandFor } from "../brand";
import { money } from "../i18n";
import type { CatalogItem, StoreRow } from "./catalog";
import { newBlockId, type Block, type Locale, type Version } from "./types";

/**
 * «Escribir con IA»: el dueño da el objetivo («a los que compraron Uñas USA
 * ofreceles la colección completa») y la IA escribe cada idioma con SOLO los
 * productos activos de la tienda en ese idioma. Los precios, links, el
 * descuento y el pie los pone la plantilla, nunca la IA; si escribe un link o
 * un número que no está en los datos, esa versión se rechaza.
 */

const LANG: Record<Locale, string> = {
  it: "Italian", en: "English", es: "Spanish from Spain (tú, never voseo)", "pt-BR": "Brazilian Portuguese", fr: "French (tutoiement)", de: "German (du)",
};

const Out = z.object({
  subject: z.string().min(6).max(110),
  preheader: z.string().min(6).max(150),
  blocks: z.array(z.object({
    type: z.enum(["heading", "text", "product"]),
    text: z.string().max(1200).optional(),
    product_ref: z.string().max(10).optional(),
    cta: z.string().max(34).optional(),
    blurb: z.string().max(300).optional(),
  })).min(2).max(10),
});

const TOOL = {
  name: "campaign_email",
  description: "One marketing email (one language).",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "≤ 70 characters, specific and tempting. No ALL CAPS, no emojis." },
      preheader: { type: "string", description: "≤ 110 characters, complements the subject." },
      blocks: {
        type: "array",
        description: "The email body in order: a heading, 1–2 short text paragraphs, 1–3 product blocks, optionally one short closing text.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["heading", "text", "product"] },
            text: { type: "string", description: "heading: ≤ 60 characters. text: 1–3 short sentences; blank line between paragraphs; **bold** allowed. May start with the placeholder {nombre} for the first name (e.g. \"Ciao {nombre},\")." },
            product_ref: { type: "string", description: "product blocks only: the ref of one product from PRODUCTS (e.g. P2)." },
            cta: { type: "string", description: "product blocks only: button text, ≤ 26 characters, imperative." },
            blurb: { type: "string", description: "product blocks only: 1 sentence (≤ 160 characters) on what this product gives them, from its description." },
          },
          required: ["type"],
        },
      },
    },
    required: ["subject", "preheader", "blocks"],
  },
};

function system(brand: string, locale: Locale, pct: number | null) {
  return `You write ONE marketing email for past customers of the online store "${brand}". It sells digital study books in PDF, delivered instantly by email. Answer ONLY by calling the tool "campaign_email".
Rules:
- Write everything in ${LANG[locale]}. Call the store "${brand}".
- The reader already bought from the store. Follow the GOAL from el dueño (the owner).
- Use ONLY facts from PRODUCTS (names and descriptions). Never invent features, contents, page counts, numbers, testimonials, reviews, ratings, student counts, results or guarantees.
- Never write prices, currencies, dates, URLs or links: the template adds prices in each reader's currency, the buttons and the footer.
- ${pct ? `There is a real discount of ${pct}% for this email: you may mention it (only that number). The template shows the expiry.` : "There is NO discount: never mention discounts, coupons or sales."}
- No fake urgency ("last chance", "only today", "few left", "hurry"), no ALL CAPS, no emojis.
- Recommend 1 to 3 products from PRODUCTS with product blocks (product_ref). Prefer the ones the GOAL asks for.
- Tone: warm, clear, personal; short sentences; talk about what they get.`;
}

/** Números del texto que no están en los datos (la IA no puede inventar cifras). */
function invented(text: string, source: string, pct: number | null) {
  const ok = new Set([...(pct ? [String(pct)] : []), ...(source.match(/\d+(?:[.,]\d+)?/g) ?? [])]);
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => !ok.has(n));
}

export type AiResult = { versions: Partial<Record<Locale, Version>>; errors: Partial<Record<Locale, string>> };

export async function writeCampaign(opts: {
  store: StoreRow; goal: string; locales: Locale[]; catalog: CatalogItem[]; discountPct: number | null;
  /** Ofertas que el público ya compró (el «Compró» del segmento): no se le ofrecen. */
  owned?: string[];
}): Promise<AiResult> {
  if (!aiConfigured()) throw new Error(AI_MISSING);
  const out: AiResult = { versions: {}, errors: {} };
  await Promise.all(opts.locales.map(async (locale) => {
    const owned = new Set(opts.owned ?? []);
    const items = opts.catalog.filter((c) => c.active && !c.solo && c.locale === locale && !(c.offerId && owned.has(c.offerId)));
    if (!items.length) {
      out.errors[locale] = owned.size ? "no hay otros productos activos en este idioma para ofrecerles (lo único que hay ya lo compraron)" : "no hay checkouts activos en este idioma";
      return;
    }
    const brand = brandFor(opts.store, locale);
    const refs = new Map(items.map((c, i) => [`P${i + 1}`, c]));
    const data = {
      language: locale, store: brand, goal: opts.goal.slice(0, 1500), discount_percent: opts.discountPct,
      products: [...refs.entries()].map(([ref, c]) => ({
        ref, offer: c.offerName, category: c.category, market: c.market, name: c.name, short_name: c.shortName,
        description: c.description.slice(0, 600), price_hint: c.price ? money(c.price.amount, c.price.currency, locale) : null,
      })),
    };
    const source = JSON.stringify(data);
    try {
      const raw = await aiJson(system(brand, locale, opts.discountPct), `GOAL: ${opts.goal}\n\nPRODUCTS (JSON):\n${source}`, TOOL, { temperature: 0.7, maxTokens: 2500 });
      const p = Out.safeParse(raw);
      if (!p.success) { out.errors[locale] = `la IA devolvió algo inválido (${p.error.issues[0]?.path.join(".")})`; return; }
      const v = p.data;
      const texts = [v.subject, v.preheader, ...v.blocks.flatMap((b) => [b.text ?? "", b.cta ?? "", b.blurb ?? ""])].join(" ");
      if (/https?:\/\/|www\./i.test(texts)) { out.errors[locale] = "la IA escribió un link"; return; }
      // Los precios orientativos no cuentan como fuente: la IA no debe escribir precios.
      const bad = invented(texts, JSON.stringify({ ...data, products: data.products.map(({ price_hint: _, ...x }) => x) }), opts.discountPct);
      if (bad.length) { out.errors[locale] = `la IA escribió números que no están en los productos: ${[...new Set(bad)].join(", ")}`; return; }
      const blocks: Block[] = [];
      for (const b of v.blocks) {
        if (b.type === "product") {
          const c = b.product_ref ? refs.get(b.product_ref.trim().toUpperCase()) : null;
          if (!c) continue;
          if (blocks.some((x) => x.type === "product" && x.funnel === c.funnelId)) continue;
          blocks.push({ id: newBlockId(), type: "product", funnel: c.funnelId, ...(b.cta ? { cta: b.cta } : {}), ...(b.blurb ? { blurb: b.blurb } : {}) });
        } else if (b.text?.trim()) {
          blocks.push({ id: newBlockId(), type: b.type, text: b.text.trim() });
        }
      }
      if (!blocks.some((b) => b.type === "product")) { out.errors[locale] = "la IA no eligió ningún producto de la lista"; return; }
      out.versions[locale] = { subject: v.subject.trim(), preheader: v.preheader.trim(), blocks };
    } catch (e) {
      out.errors[locale] = `la IA no respondió: ${(e as Error).message.slice(0, 160)}`;
    }
  }));
  return out;
}
