import { z } from "zod";
import { LOCALES, type CampaignStatus, type Locale } from "./consts";

export { LOCALES, STATUS_ES, LOCALE_ES, TEST_TO, newBlockId } from "./consts";
export type { CampaignStatus, Locale } from "./consts";

/**
 * Formas del email marketing (campañas, bloques, segmentos), validadas con
 * zod: las usan el panel, la IA y el MCP, así ninguno puede guardar algo que
 * el render no sepa dibujar.
 */

export const LocaleZ = z.enum(LOCALES);
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const id = z.string().min(1).max(40);

export const BlockZ = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("heading"), text: z.string().max(200) }),
  z.object({ id, type: z.literal("text"), text: z.string().max(4000) }),
  /** Un checkout puntual: tapa, nombre, precio en la moneda del destinatario y botón. Si ya lo tiene, no se muestra. */
  z.object({ id, type: z.literal("product"), funnel: uuid, cta: z.string().max(40).optional(), blurb: z.string().max(400).optional() }),
  /** «Para vos»: los que NO tiene todavía, en su idioma (opcional: solo de esas categorías). */
  z.object({
    id, type: z.literal("recommend"), count: z.number().int().min(1).max(3),
    categories: z.array(z.string().max(60)).max(20).optional(), title: z.string().max(120).optional(), cta: z.string().max(40).optional(),
  }),
  // Imagen y botón se guardan aunque estén a medio escribir; el mail los muestra solo con un link https público.
  z.object({ id, type: z.literal("image"), src: z.string().trim().max(1000), href: z.string().trim().max(1000).optional(), alt: z.string().max(200).optional() }),
  z.object({ id, type: z.literal("button"), label: z.string().max(40), href: z.string().trim().max(1000) }),
]);
export type Block = z.infer<typeof BlockZ>;

export const VersionZ = z.object({
  subject: z.string().max(150),
  preheader: z.string().max(200).default(""),
  blocks: z.array(BlockZ).max(40),
});
export type Version = z.infer<typeof VersionZ>;
export type Versions = Partial<Record<Locale, Version>>;
export const VersionsZ = z.partialRecord(LocaleZ, VersionZ);

export const SegmentZ = z.object({
  offers_any: z.array(uuid).max(50).optional(),
  offers_none: z.array(uuid).max(50).optional(),
  categories: z.array(z.string().max(60)).max(30).optional(),
  categories_none: z.array(z.string().max(60)).max(30).optional(),
  markets: z.array(z.string().max(60)).max(30).optional(),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(80).optional(),
  locales: z.array(LocaleZ).max(6).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  spent_min: z.number().min(0).max(100000).optional().nullable(),
  exclude_recent_days: z.number().int().min(0).max(3650).optional().nullable(),
  engaged: z.object({ campaign: uuid, kind: z.enum(["opened", "clicked", "not_opened"]) }).optional().nullable(),
  leads: z.boolean().optional(),
});
export type Segment = z.infer<typeof SegmentZ>;

/** Quita lo vacío: así el JSON guardado es corto y la base no recibe arreglos vacíos de más. */
export function cleanSegment(s: Segment): Segment {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v == null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out as Segment;
}

export type Campaign = {
  id: string; store_id: string; kind: "broadcast" | "flow"; name: string; status: CampaignStatus;
  segment_id: string | null; segment: Segment; versions: Versions; fallback_locale: Locale | null; goal: string | null;
  discount_pct: number | null; discount_hours: number; discount_expires_at: string | null; discount_revoked_at: string | null;
  scheduled_at: string | null; confirmed_at: string | null; started_at: string | null; finished_at: string | null;
  total: number; last_error: string | null; created_at: string; updated_at: string;
  finish_pushed_at?: string | null; results_pushed_at?: string | null; created_via?: string;
};
export const CAMPAIGN_COLS =
  "id,store_id,kind,name,status,segment_id,segment,versions,fallback_locale,goal,discount_pct,discount_hours,discount_expires_at," +
  "discount_revoked_at,scheduled_at,confirmed_at,started_at,finished_at,total,last_error,created_at,updated_at,finish_pushed_at,results_pushed_at,created_via";

export type Contact = {
  id: string; store_id: string; email: string; name: string | null; locale: string | null; country: string | null;
  kind: "buyer" | "lead"; source: string; status: string; products: string[]; offers: string[]; categories: string[];
};
export const CONTACT_COLS = "id,store_id,email,name,locale,country,kind,source,status,products,offers,categories";

