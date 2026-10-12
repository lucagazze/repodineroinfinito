import { cache } from "react";
import { db } from "@/lib/db";
import { STALE_MS } from "./meta-fresh";

/**
 * Lo que el panel lee de Meta: SOLO de la base (meta_insights_daily,
 * meta_objects, meta_sync), que llena el cron /api/cron/meta cada 15 minutos
 * (meta-sync.ts). Ninguna pantalla le pregunta a Meta.
 */

export type Obj = {
  id: string; name: string; effective_status: string; campaign_id?: string | null; adset_id?: string | null;
  /** En la moneda de la cuenta (no en centavos). */
  daily_budget?: number | null; lifetime_budget?: number | null;
  /** Límite de puja del conjunto (en la moneda de la cuenta) y estrategia de puja. */
  bid_amount?: number | null; bid_strategy?: string | null;
  thumb?: string | null; video_id?: string | null; links?: string[];
};
/** [anuncio, conjunto, campaña, gasto, impresiones, clics en el enlace, compras, valor, reproducciones de 3 s, ThruPlays] en la moneda de la cuenta. */
export type CRow = [string, string, string, number, number, number, number, number, number, number];
/** [gasto, impresiones, clics en el enlace, compras, valor] de una campaña en un día. */
export type DayRow = [number, number, number, number, number];

export type SyncState = {
  account: string; name: string | null; currency: string; timezone: string;
  /** Última sincronización buena (ms). */
  fetchedAt: number | null;
  /** El error de la última sincronización, si fue después de la última buena. */
  error: string | null;
  retryAt: number | null;
  stale: boolean;
  /** Desde qué día hay datos guardados. */
  coverageFrom: string | null;
};

export const syncState = cache(async (act: string): Promise<SyncState> => {
  const { data } = await db.from("meta_sync").select("account_id,name,currency,timezone,last_ok_at,last_error,error_at,retry_at,backfilled_from").eq("account_id", act).maybeSingle();
  const ok = data?.last_ok_at ? Date.parse(data.last_ok_at) : null;
  const errAt = data?.error_at ? Date.parse(data.error_at) : null;
  const error = data?.last_error && (ok == null || (errAt ?? 0) >= ok) ? data.last_error : null;
  return {
    account: act, name: data?.name ?? null, currency: (data?.currency || "USD").toUpperCase(), timezone: data?.timezone ?? "",
    fetchedAt: ok, error, retryAt: data?.retry_at ? Date.parse(data.retry_at) : null,
    stale: ok == null || Date.now() - ok > STALE_MS || !!error, coverageFrom: data?.backfilled_from ?? null,
  };
});

/** Campañas, conjuntos y anuncios de la cuenta con su estado de ahora. */
export const metaObjects = cache(async (act: string) => {
  const all: (Obj & { level: string })[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("meta_objects")
      .select("level,id,name,effective_status,campaign_id,adset_id,daily_budget,lifetime_budget,bid_amount,bid_strategy,thumb,video_id,links")
      .eq("account_id", act).order("id").range(i, i + 999);
    if (error) break;
    all.push(...((data ?? []) as (Obj & { level: string })[]));
    if ((data ?? []).length < 1000) break;
  }
  const by = (l: string) => all.filter((o) => o.level === l).map((o) => ({ ...o, daily_budget: o.daily_budget == null ? null : Number(o.daily_budget), lifetime_budget: o.lifetime_budget == null ? null : Number(o.lifetime_budget), bid_amount: o.bid_amount == null ? null : Number(o.bid_amount) }));
  return { campaigns: by("campaign"), adsets: by("adset"), ads: by("ad") };
});

export const rangesKey = (ranges: [string, string][]) => ranges.map((r) => r.join("|")).join(",");

/**
 * Métricas por anuncio sumadas en cada período («desde|hasta,…»), con los
 * nombres. campaigns = «*» para toda la cuenta o ids separados por coma.
 */
export const metaWindows = cache(async (act: string, key: string, campaigns = "*"): Promise<{ ranges: Record<string, CRow[]>; names: Record<string, string> }> => {
  const ranges = key.split(",").filter(Boolean).map((r) => r.split("|") as [string, string]);
  const out: Record<string, CRow[]> = Object.fromEntries(ranges.map((r) => [r.join("|"), []]));
  if (!ranges.length || !campaigns) return { ranges: out, names: {} };
  const { data, error } = await db.rpc("meta_windows", { p_account: act, p_ranges: ranges, p_campaigns: campaigns === "*" ? null : campaigns.split(",") });
  if (error) throw new Error(`meta_windows: ${error.message}`);
  const res = (data ?? { rows: [], names: {} }) as { rows: [number, string, string, string, number, number, number, number, number, number, number][]; names: Record<string, string> };
  for (const [i, ad, set, camp, ...m] of res.rows) {
    const r = ranges[i];
    if (r) out[r.join("|")].push([ad ?? "", set ?? "", camp ?? "", ...m.map((x) => Number(x) || 0)] as CRow);
  }
  return { ranges: out, names: res.names ?? {} };
});

/** Por campaña y día (campaña → día → métricas), en la moneda de la cuenta. campaigns null = toda la cuenta. */
export async function metaDaily(act: string, since: string, until: string, campaigns: string[] | null = null) {
  const daily: Record<string, Record<string, DayRow>> = {};
  const names: Record<string, string> = {};
  if (campaigns && !campaigns.length) return { daily, names };
  const { data, error } = await db.rpc("meta_daily", { p_account: act, p_since: since, p_until: until, p_campaigns: campaigns });
  if (error) throw new Error(`meta_daily: ${error.message}`);
  for (const [d, c, ...m] of (data ?? []) as [string, string, number, number, number, number, number, string | null][]) {
    (daily[c] ??= {})[d] = m.slice(0, 5).map((x) => Number(x) || 0) as DayRow;
    if (m[5]) names[c] = m[5] as string;
  }
  return { daily, names };
}

export { freshness } from "./meta-fresh";
