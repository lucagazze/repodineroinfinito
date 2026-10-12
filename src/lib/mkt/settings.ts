import { db } from "../db";

/**
 * Ajustes del email marketing.
 *  · Generales (app_settings 'mkt'): el interruptor general (APAGADO de
 *    fábrica: con él apagado no sale ningún mail de campaña), el tope de mails
 *    por día (por debajo del plan de Brevo) y cuántos manda el cron por minuto.
 *  · Por tienda (mkt_store_settings): el remitente de marketing, de un
 *    subdominio propio autenticado en Brevo (nunca la casilla de la tienda).
 */

export type MktSettings = { enabled: boolean; daily_cap: number; batch: number };
const DEFAULTS: MktSettings = { enabled: false, daily_cap: 250, batch: 25 };

export async function mktSettings(): Promise<MktSettings> {
  const { data } = await db.from("app_settings").select("value").eq("key", "mkt").maybeSingle();
  const v = (data?.value ?? {}) as Partial<MktSettings>;
  return {
    enabled: v.enabled === true,
    daily_cap: Number.isFinite(v.daily_cap) ? Math.max(0, Math.min(100_000, Number(v.daily_cap))) : DEFAULTS.daily_cap,
    batch: Number.isFinite(v.batch) ? Math.max(1, Math.min(200, Number(v.batch))) : DEFAULTS.batch,
  };
}

export async function saveMktSettings(patch: Partial<MktSettings>) {
  const cur = await mktSettings();
  const value = { ...cur, ...patch };
  const { error } = await db.from("app_settings").upsert({ key: "mkt", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return value;
}

export type StoreSender = { from: string; replyTo: string; suggested: boolean; synced_at: string | null };

/** news@news.{dominio del soporte}: el subdominio de marketing que se cargó en Brevo. */
export const suggestedFrom = (supportEmail: string) => {
  const d = supportEmail.split("@")[1]?.toLowerCase();
  return d ? `news@news.${d}` : "";
};

export async function storeSender(store: { id: string; support_email: string }): Promise<StoreSender> {
  const { data } = await db.from("mkt_store_settings").select("from_email,reply_to,synced_at").eq("store_id", store.id).maybeSingle();
  const from = data?.from_email?.trim() || suggestedFrom(store.support_email);
  return { from, replyTo: data?.reply_to?.trim() || store.support_email, suggested: !data?.from_email, synced_at: data?.synced_at ?? null };
}

export async function saveStoreSender(storeId: string, from: string, replyTo: string) {
  const { error } = await db.from("mkt_store_settings").upsert(
    { store_id: storeId, from_email: from.trim().toLowerCase() || null, reply_to: replyTo.trim().toLowerCase() || null, updated_at: new Date().toISOString() },
    { onConflict: "store_id" },
  );
  if (error) throw new Error(error.message);
}

/** Mails de campaña (no pruebas) que salieron en las últimas 24 h: lo que cuenta para el tope diario. */
export async function sentLast24h() {
  const { count } = await db.from("mkt_sends").select("id", { count: "exact", head: true })
    .eq("is_test", false).gte("sent_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return count ?? 0;
}
