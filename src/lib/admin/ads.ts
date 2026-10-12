import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { idsOrNone } from "./offers";
import { addDays, dayOf, startOfDay } from "./tz";
import { metaConfigured } from "./meta-conn";
import { metaDaily, metaObjects, syncState } from "./meta-data";
import { adAccounts } from "./meta-report";

/**
 * Gasto en Meta Ads por campaña, para los checkouts que tienen campañas
 * vinculadas (funnels.meta_campaign_ids). No se le pregunta a Meta acá: sale
 * de meta_insights_daily, que llena el cron cada 15 minutos (meta-sync.ts).
 * Importes en USD al tipo del día.
 */

export const ADS_TAG = "meta-ads";

export type AdsDay = { date: string; spend: number; impressions: number; clicks: number; purchases: number; value: number };
export type Campaign = {
  id: string; name: string; status: string; currency: string;
  /** Presupuesto en la moneda de la cuenta; null = va en los conjuntos. */
  dailyBudget: number | null; lifetimeBudget: number | null;
  /** Totales del período, en USD. */
  spend: number; impressions: number; clicks: number; purchases: number; value: number;
  days: AdsDay[];
  error?: string;
};
export type AdsResult = { ok: true; campaigns: Campaign[]; fetchedAt?: number | null; note?: string | null } | { ok: false; error: string; campaigns: Campaign[]; fetchedAt?: number | null };

/** Hay token de Meta (del panel o de entorno). */
export const adsConfigured = () => metaConfigured();

/** Métricas de esas campañas entre dos fechas (AAAA-MM-DD, inclusive), de lo guardado. */
export async function campaignInsights(ids: string[], since: string, until: string): Promise<AdsResult> {
  const want = new Set(ids.filter(Boolean));
  if (!want.size) return { ok: true, campaigns: [] };
  const rates = await getRates();
  const out: Campaign[] = [];
  let error: string | null = null, fetchedAt: number | null = null;
  for (const a of await adAccounts()) {
    if (!want.size) break;
    const [sync, objs, d] = await Promise.all([syncState(a.id), metaObjects(a.id), metaDaily(a.id, since, until, [...want])]);
    if (sync.error) error = sync.error;
    if (sync.fetchedAt != null) fetchedAt = Math.min(fetchedAt ?? Infinity, sync.fetchedAt);
    const usd = (n: number) => n / (rates[sync.currency] ?? 1);
    const meta = new Map(objs.campaigns.map((c) => [c.id, c]));
    for (const id of [...want]) {
      const m = meta.get(id);
      const days: AdsDay[] = Object.entries(d.daily[id] ?? {}).sort(([x], [y]) => x.localeCompare(y))
        .map(([date, r]) => ({ date, spend: usd(r[0]), impressions: r[1], clicks: r[2], purchases: r[3], value: usd(r[4]) }));
      if (!m && !days.length) continue;
      const sum = (k: keyof Omit<AdsDay, "date">) => days.reduce((x, v) => x + v[k], 0);
      out.push({
        id, name: m?.name ?? d.names[id] ?? id, status: m?.effective_status ?? "ARCHIVED", currency: sync.currency,
        dailyBudget: m?.daily_budget || null, lifetimeBudget: m?.lifetime_budget || null,
        spend: sum("spend"), impressions: sum("impressions"), clicks: sum("clicks"), purchases: sum("purchases"), value: sum("value"),
        days,
      });
      want.delete(id);
    }
  }
  const at = fetchedAt != null && Number.isFinite(fetchedAt) ? fetchedAt : null;
  // Nunca se sincronizó y la última vez falló: se avisa; si hay filas guardadas, se muestran.
  if (!out.length && error && at == null) return { ok: false, error, campaigns: [], fetchedAt: at };
  return { ok: true, campaigns: out, fetchedAt: at, note: error };
}

export type AdsTotals = { spend: number; impressions: number; clicks: number; purchases: number; value: number };
export const totals = (cs: Campaign[]): AdsTotals => cs.reduce(
  (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, purchases: a.purchases + c.purchases, value: a.value + c.value }),
  { spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 },
);

/** Gasto por día sumando todas las campañas. */
export function spendByDay(cs: Campaign[]) {
  const m = new Map<string, number>();
  for (const c of cs) for (const d of c.days) m.set(d.date, (m.get(d.date) ?? 0) + d.spend);
  return m;
}

/**
 * Lo que facturaron NUESTROS pedidos (pagados, con sus upsells) por día local,
 * en USD, para cruzar con el gasto. Es la base del ROAS y del CPA: lo que
 * cobró Stripe, no lo que Meta dice que vendió.
 */
export async function revenueByDay(storeId: string, funnelIds: string[], tz: string, since: string, until: string) {
  const rates = await getRates();
  const from = startOfDay(since, tz).toISOString();
  const to = startOfDay(addDays(until, 1), tz).toISOString();
  const byDay = new Map<string, number>();
  let orders = 0;
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("orders")
      .select("created_at,currency,amount_total,order_items(amount,currency)")
      .eq("store_id", storeId).eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).in("funnel_id", idsOrNone(funnelIds))
      .eq("order_items.kind", "upsell")
      .gte("created_at", from).lt("created_at", to)
      .range(i, i + 999);
    if (error) throw new Error(`orders: ${error.message}`);
    for (const o of data ?? []) {
      const usd = (n: unknown, c: string | null) => Number(n ?? 0) / (rates[(c ?? "USD").toUpperCase()] ?? 1);
      const v = usd(o.amount_total, o.currency) + ((o.order_items ?? []) as { amount: number; currency: string | null }[]).reduce((a, it) => a + usd(it.amount, it.currency ?? o.currency), 0);
      const d = dayOf(new Date(o.created_at), tz);
      byDay.set(d, (byDay.get(d) ?? 0) + v);
      orders++;
    }
    if ((data ?? []).length < 1000) break;
  }
  return { byDay, orders, revenue: [...byDay.values()].reduce((a, b) => a + b, 0) };
}

/** Los días entre dos fechas, inclusive. */
export function daysBetween(since: string, until: string) {
  const out: string[] = [];
  for (let d = since; d <= until && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
