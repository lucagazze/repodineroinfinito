import type { Locale } from "../i18n";

/**
 * Lo del email marketing que también usa el navegador (sin zod ni nada del
 * servidor, para que el panel cargue liviano).
 */

/** Los mismos idiomas que i18n.ts (copiados para no cargar todos los textos del checkout en el panel). */
export const LOCALES = ["it", "en", "es", "pt-BR", "fr", "de"] as const satisfies readonly Locale[];

export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "sent" | "cancelled";

export const STATUS_ES: Record<CampaignStatus, string> = {
  draft: "Borrador", scheduled: "Programada", sending: "Enviando", paused: "Pausada", sent: "Enviada", cancelled: "Cancelada",
};

export const LOCALE_ES: Record<Locale, string> = { it: "Italiano", en: "Inglés", es: "Español", "pt-BR": "Portugués", fr: "Francés", de: "Alemán" };

/** El único destino posible de una prueba (regla del dueño: nunca a un cliente real). */
export const TEST_TO = process.env.TEST_EMAIL ?? "";

export const newBlockId = () => Math.random().toString(36).slice(2, 10);

export type { Locale };
