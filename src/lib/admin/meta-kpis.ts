import { cache } from "react";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { adAccounts } from "./meta-report";
import { syncState } from "./meta-data";
import { previousOf, shift } from "./range";

/**
 * Las métricas de Meta Ads del Inicio, como las muestra el Administrador de
 * anuncios: gasto, compras, valor, ROAS, CPA, iniciar pago, CTR,
 * CPC, CPM, impresiones y clics, del período y del anterior del mismo largo,
 * con el detalle por día. Salen de meta_insights_daily (lo trae el cron cada
 * 15 min): ninguna pantalla le pregunta a Meta. Los días son los de la cuenta
 * publicitaria (Meta no deja pedir otra zona horaria). Importes en USD.
 */

export type MetaNums = {
  spend: number; impressions: number; clicks: number; linkClicks: number;
  purchases: number; value: number; checkouts: number; landingViews: number;
};
export type MetaDay = MetaNums & { date: string };
export type MetaKpis = {
  cur: MetaNums; prev: MetaNums;
  days: MetaDay[]; prevDays: MetaDay[];
  /** Por campaña, en el período (para sumar por oferta). */
  byCampaign: Record<string, MetaNums>;
  /** Zona horaria de la cuenta (la de los días de Meta). */
  tz: string;
  fetchedAt: number | null; error: string | null;
  accounts: number;
};

export const zeroMeta = (): MetaNums => ({ spend: 0, impressions: 0, clicks: 0, linkClicks: 0, purchases: 0, value: 0, checkouts: 0, landingViews: 0 });
export function addMeta(a: MetaNums, b: MetaNums) {
  a.spend += b.spend; a.impressions += b.impressions; a.clicks += b.clicks; a.linkClicks += b.linkClicks;
  a.purchases += b.purchases; a.value += b.value; a.checkouts += b.checkouts; a.landingViews += b.landingViews;
  return a;
}
const days = (since: string, until: string) => {
  const out: string[] = [];
  for (let d = since; d <= until && out.length < 400; d = shift(d, 1)) out.push(d);
  return out;
};

/** campaigns: «*» = toda la cuenta; si no, ids separados por coma (las campañas de una oferta). */
export const metaKpis = cache(async (since: string, until: string, campaigns = "*"): Promise<MetaKpis> => {
  const P = previousOf({ since, until });
  const ids = campaigns === "*" ? null : campaigns.split(",").filter(Boolean);
  const [accounts, rates] = await Promise.all([adAccounts(), getRates()]);
  const cur = zeroMeta(), prev = zeroMeta();
  const byDay = new Map<string, MetaNums>();
  const byCampaign: Record<string, MetaNums> = {};
  let tz = "", fetchedAt: number | null = null, error: string | null = null;
  if (!ids || ids.length) {
    await Promise.all(accounts.map(async (a) => {
      const [sync, { data, error: e }] = await Promise.all([
        syncState(a.id),
        db.rpc("meta_daily", { p_account: a.id, p_since: P.since, p_until: until, p_campaigns: ids }),
      ]);
      if (e) throw new Error(`meta_daily: ${e.message}`);
      tz ||= sync.timezone;
      if (sync.fetchedAt != null) fetchedAt = Math.min(fetchedAt ?? Infinity, sync.fetchedAt);
      error ||= sync.error;
      const usd = (n: unknown) => (Number(n) || 0) / (rates[sync.currency] ?? 1);
      // [fecha, campaña, gasto, impresiones, clics en el enlace, compras, valor, nombre, iniciar pago, visitas a la landing, clics]
      for (const r of (data ?? []) as unknown[][]) {
        const d = String(r[0]);
        const n: MetaNums = {
          spend: usd(r[2]), impressions: Number(r[3]) || 0, linkClicks: Number(r[4]) || 0, purchases: Number(r[5]) || 0, value: usd(r[6]),
          checkouts: Number(r[8]) || 0, landingViews: Number(r[9]) || 0, clicks: Number(r[10]) || 0,
        };
        if (d >= since && d <= until) {
          addMeta(cur, n);
          addMeta(byDay.get(d) ?? (byDay.set(d, zeroMeta()), byDay.get(d)!), n);
          addMeta(byCampaign[String(r[1])] ??= zeroMeta(), n);
        } else if (d >= P.since && d <= P.until) {
          addMeta(prev, n);
          addMeta(byDay.get(d) ?? (byDay.set(d, zeroMeta()), byDay.get(d)!), n);
        }
      }
    }));
  }
  const fill = (s: string, u: string) => days(s, u).map((date) => ({ date, ...(byDay.get(date) ?? zeroMeta()) }));
  return {
    cur, prev, days: fill(since, until), prevDays: fill(P.since, P.until), byCampaign, tz,
    fetchedAt: fetchedAt != null && Number.isFinite(fetchedAt) ? fetchedAt : null, error, accounts: accounts.length,
  };
});
