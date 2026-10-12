import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/lib/checkout-settings";

/**
 * Esquema y descripción de los ajustes visuales del checkout para el MCP.
 *
 * Se arman a partir de DEFAULT_SETTINGS (checkout-settings.ts), así un campo
 * nuevo aparece solo en la herramienta. Lo que agrega este archivo son las
 * reglas estrictas (para que Claude reciba un error claro en vez de que
 * resolveSettings descarte el valor en silencio) y la explicación de cada campo.
 */

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

const hexOrEmpty = z
  .string()
  .regex(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))?$/, 'Hex color like "#005bd1", or "" for the default');

const RULES: Record<string, z.ZodType> = {
  "colors.pay": hexOrEmpty,
  "colors.accent": hexOrEmpty,
  "colors.background": hexOrEmpty,
  "payButton.color": hexOrEmpty,
  "guarantee.image": z.string().max(500).regex(/^(https:\/\/\S+)?$/, 'https:// image URL (use upload_media first), or "" for none'),
  "guarantee.days": z.number().int().min(0).max(365).nullable(),
  "countdown.minutes": z.number().int().min(1).max(120),
  "buyersBar.min": z.number().int().min(1).max(50),
  "exitOffer.discountPercent": z.number().int().min(0).max(90),
  locale: z.string().regex(/^([a-z]{2})?$/, 'Two lowercase letters ("it", "en", "es") or "" for automatic'),
  customCss: z.string().max(8000),
};

/** Qué hace cada campo, en inglés: es lo que Claude lee para elegir. */
export const FIELD_DOCS: Record<string, string> = {
  "colors.pay": "primary action color: pay button and selected/highlighted elements (hex); \"\" = the store's brand.payButton color or the built-in blue",
  "colors.accent": "accent color for headings, prices and icons (hex); \"\" = default",
  "colors.background": "page background color (hex); \"\" = default light grey",
  "logo.show": "show the store logo (stores.logo_url) at the top",
  "topBar.show": "show the thin top strip (e.g. \"Secure checkout\")",
  "topBar.text": "custom top strip text; \"\" = the translated default for the buyer's language",
  "buyersBar.show": "show the live buyers bar (REAL count of people with this checkout open in the last 30 min; never invented)",
  "buyersBar.min": "hide the buyers bar when fewer than this many people are viewing (1-50)",
  "countdown.show": "show a countdown timer (deadline stored in the buyer's browser; reload does not reset it)",
  "countdown.minutes": "countdown length in minutes (1-120)",
  "countdown.text": "text next to the countdown; \"\" = translated default",
  "offer.title": "custom headline of the offer box; \"\" = product name",
  "offer.subtitle": "line under the offer headline",
  "offer.showCompareAt": "show the struck-through compare_at price",
  "offer.showSavings": "show the \"you save X\" amount",
  "offer.showImage": "show the main product cover image",
  "bonuses.show": "show the free bonuses list (funnel items with role bonus)",
  "bonuses.title": "custom title of the bonuses block; \"\" = translated default",
  "buyer.askPhone": "show a phone field",
  "buyer.phoneRequired": "make the phone field mandatory (only if askPhone)",
  "buyer.askLastName": "ask last name as a separate field",
  "payment.express": "show Apple Pay / Google Pay / Link express buttons above the card form",
  "bumps.title": "title above the order bump cards; \"\" = translated default",
  "bumps.preselect": "order bumps start already ticked (use with care: EU consumer law)",
  "payButton.text": "pay button label; \"\" = translated default (e.g. \"Complete purchase\")",
  "payButton.color": "pay button color override; \"\" = use colors.pay",
  "guarantee.show": "show the money-back guarantee block",
  "guarantee.days": "guarantee days shown; null = the store's guarantee_days",
  "guarantee.text": "custom guarantee text; \"\" = translated default",
  "guarantee.image": "guarantee badge image (https URL); \"\" = none / store default",
  "guarantee.seals": "show the secure-payment seals (SSL, card brands)",
  "policies.show": "show links to terms / privacy / refund policies",
  "exitOffer.show": "exit-intent popup shown once when the buyer is about to leave without paying",
  "exitOffer.title": "exit popup headline",
  "exitOffer.text": "exit popup body text",
  "exitOffer.discountPercent": "integer 0-90: % off the MAIN product applied server-side if the buyer accepts the exit offer (0 = no discount, popup is just a message)",
  locale: "force the checkout language (2-letter code, e.g. \"it\", \"en\", \"es\"); \"\" = automatic from the buyer's country",
  customCss: "extra CSS appended to the page for one-off tweaks (HTML tags are stripped, max 8000 chars)",
};

function leaf(path: string, def: unknown): z.ZodType {
  if (RULES[path]) return RULES[path];
  if (typeof def === "boolean") return z.boolean();
  if (typeof def === "number") return z.number();
  if (def === null) return z.number().nullable();
  return z.string().max(600);
}

let cached: z.ZodObject | null = null;

/** Patch parcial y estricto: un campo desconocido es un error que nombra los válidos. */
export function stylePatchSchema() {
  if (cached) return cached;
  const shape: Record<string, z.ZodType> = {};
  for (const [section, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (isObj(def)) {
      const inner: Record<string, z.ZodType> = {};
      for (const [k, d] of Object.entries(def)) {
        const doc = FIELD_DOCS[`${section}.${k}`];
        const s = leaf(`${section}.${k}`, d);
        inner[k] = (doc ? s.describe(doc) : s).optional();
      }
      shape[section] = z.object(inner).strict().optional();
    } else {
      const doc = FIELD_DOCS[section];
      const s = leaf(section, def);
      shape[section] = (doc ? s.describe(doc) : s).optional();
    }
  }
  cached = z.object(shape).strict();
  return cached;
}

/** Lista legible de todos los campos con tipo y valor por defecto, para la descripción de la herramienta. */
export function styleFieldList() {
  const lines: string[] = [];
  const type = (d: unknown) => (typeof d === "boolean" ? "bool" : typeof d === "number" || d === null ? "number" : "string");
  const show = (d: unknown) => JSON.stringify(d);
  for (const [section, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (isObj(def)) {
      for (const [k, d] of Object.entries(def)) {
        lines.push(`- ${section}.${k} (${type(d)}, default ${show(d)}): ${FIELD_DOCS[`${section}.${k}`] ?? ""}`);
      }
    } else {
      lines.push(`- ${section} (${type(def)}, default ${show(def)}): ${FIELD_DOCS[section] ?? ""}`);
    }
  }
  return lines.join("\n");
}

/** Lo que el patch pidió y no quedó igual en el resultado (resolveSettings lo limpió). */
export function droppedFields(patch: Plain, resolved: Plain, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const got = resolved?.[k];
    if (isObj(v)) out.push(...droppedFields(v, isObj(got) ? got : {}, path));
    else if (JSON.stringify(v) !== JSON.stringify(got)) out.push(`${path}: asked ${JSON.stringify(v)}, saved ${JSON.stringify(got)}`);
  }
  return out;
}
