import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import type { PlatformKey, PlatformNums } from "./platforms-shared";
export { PLATFORM_LABEL, type PlatformKey, type PlatformNums } from "./platforms-shared";

/**
 * Meta por red social (Instagram, Facebook, Threads, Messenger, WhatsApp, Audience Network), de
 * meta_platform_daily (lo trae el cron de Meta). En USD, por campaña y en total.
 */
// Las que informa Meta hoy (además de las cuatro clásicas: Threads, WhatsApp y «unknown»).
const ORDER: PlatformKey[] = ["instagram", "facebook", "threads", "messenger", "whatsapp", "audience_network", "unknown"];

export async function platformSplit(campaigns: string[] | null, since: string, until: string) {
  const byCampaign: Record<string, PlatformNums[]> = {};
  const total = new Map<PlatformKey, PlatformNums>();
  if (campaigns && !campaigns.length) return { byCampaign, total: [] as PlatformNums[] };
  const [rates, { data: accs }] = await Promise.all([getRates(), db.from("meta_sync").select("account_id,currency")]);
  const curOf = new Map((accs ?? []).map((a) => [a.account_id as string, String(a.currency ?? "USD").toUpperCase()]));
  const rows: Record<string, unknown>[] = [];
  const ids = campaigns ? [...new Set(campaigns)] : [null];
  for (let i = 0; i < ids.length; i += 150) {
    for (let off = 0; ; off += 1000) {
      let q = db.from("meta_platform_daily").select("account_id,campaign_id,platform,spend,impressions,link_clicks,purchases,purchase_value")
        .gte("date", since).lte("date", until).range(off, off + 999);
      if (campaigns) q = q.in("campaign_id", ids.slice(i, i + 150) as string[]);
      const { data, error } = await q;
      if (error) throw new Error(`meta_platform_daily: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    if (!campaigns) break;
  }
  const per = new Map<string, Map<PlatformKey, PlatformNums>>();
  for (const r of rows) {
    const raw = String(r.platform) as PlatformKey;
    const p: PlatformKey = ORDER.includes(raw) ? raw : "unknown";
    const usd = (n: unknown) => (Number(n) || 0) / (rates[curOf.get(r.account_id as string) ?? "USD"] ?? 1);
    const add = (m: Map<PlatformKey, PlatformNums>) => {
      const t = m.get(p) ?? { platform: p, spend: 0, purchases: 0, value: 0, impressions: 0, linkClicks: 0 };
      t.spend += usd(r.spend); t.value += usd(r.purchase_value); t.purchases += Number(r.purchases) || 0;
      t.impressions += Number(r.impressions) || 0; t.linkClicks += Number(r.link_clicks) || 0;
      m.set(p, t);
    };
    const c = String(r.campaign_id);
    add(per.get(c) ?? (per.set(c, new Map()), per.get(c)!));
    add(total);
  }
  const sorted = (m: Map<PlatformKey, PlatformNums>) => ORDER.map((k) => m.get(k)).filter((x): x is PlatformNums => !!x && (x.spend > 0 || x.purchases > 0));
  for (const [c, m] of per) byCampaign[c] = sorted(m);
  return { byCampaign, total: sorted(total) };
}
