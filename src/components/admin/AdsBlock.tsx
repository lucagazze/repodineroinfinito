import { Suspense } from "react";
import { Megaphone } from "lucide-react";
import { campaignPerf } from "@/lib/admin/meta-perf";
import CampaignTable from "./CampaignTable";
import { platformSplit, PLATFORM_LABEL } from "@/lib/admin/meta-platform";
import type { Scope } from "@/lib/admin/offers";
import { adsConfigured, campaignInsights, daysBetween, revenueByDay, spendByDay, totals, type Campaign } from "@/lib/admin/ads";
import { campaignAlias, checkoutAlias } from "@/lib/admin/privacy";
import { usd2 } from "@/lib/admin/inicio";
import { usdFmt } from "@/lib/metrics";
import { fmtDay } from "@/lib/admin/tz";
import { SpendRevenueChart } from "./charts";
import { Badge, Card, Stat, Table } from "./ui";
import { Pv } from "./Priv";
import { MarketChip } from "./OfferBlocks";
import { RANGE_TZ } from "@/lib/admin/range";
import { campaignsOf, kickAutoLink } from "@/lib/admin/meta-links";

/**
 * Gasto en Meta contra nuestras ventas, para una oferta o un mercado:
 * Gasto, ROAS (facturado / gasto), CPA (gasto / pedidos pagados), CPC y el
 * gráfico por día. Los KPIs pueden ser de un rango más corto que el gráfico
 * (en el Inicio: el día elegido; el gráfico, los 14 días hasta ese día).
 */

type Range = { since: string; until: string };

const roasTone = (r: number | null) => (r == null ? "" : r >= 2 ? "text-emerald-600 dark:text-emerald-400" : r >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400");

/** Las campañas de la oferta o el mercado: las guardadas y las que se vincularon solas por el link de sus anuncios. */
export function campaignIdsOf(sc: Scope, auto: Record<string, string[]> = {}) {
  return [...new Set(sc.funnels.flatMap((f) => campaignsOf(f, auto)))];
}

export function NoCampaigns() {
  return (
    <Card title={<><Megaphone className="h-4 w-4 text-orange-500" /> Anuncios de Meta</>}>
      <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-3 text-[12.5px] font-semibold text-zinc-500 dark:border-zinc-700">
        Sin campañas vinculadas — pedile a Claude que las vincule.
      </p>
    </Card>
  );
}

export default async function AdsBlock({ sc, kpi, chart, kpiLabel, showCampaigns, source = "real" }: {
  sc: Scope; kpi: Range; chart: Range; kpiLabel: string; showCampaigns?: boolean;
  /** «meta»: los números de Meta ya están arriba (MetaStrip); acá quedan las campañas. */
  source?: "meta" | "real";
}) {
  kickAutoLink();
  const auto: Record<string, string[]> = {};
  const ids = campaignIdsOf(sc, auto);
  if (!ids.length) return <NoCampaigns />;
  if (!(await adsConfigured())) {
    return <Card title="Anuncios de Meta"><p className="ad-note">No hay conexión con Meta: cargá el token en Configuración › Conexión con Meta.</p></Card>;
  }
  const campaignsCard = showCampaigns && (
    <Card title="Campañas" sub="Las de esta oferta. Tocá una para ver sus conjuntos y anuncios." pad={false}>
      <Suspense fallback={<div data-skeleton className="p-5"><span className="sk block h-[220px] w-full rounded-xl" /></div>}>
        <OfferCampaigns sc={sc} ids={ids} period={{ since: kpi.since, until: kpi.until, label: kpiLabel }} source={source} />
      </Suspense>
    </Card>
  );
  // De qué red social salen los anuncios (Instagram, Facebook…): aparte, llega por su lado.
  const platformsCard = (
    <Suspense fallback={<div data-skeleton><span className="sk block h-[150px] w-full rounded-2xl" /></div>}>
      <PlatformCard ids={ids} since={kpi.since} until={kpi.until} label={kpiLabel} />
    </Suspense>
  );
  // Con «Meta Ads» los números ya están arriba (MetaStrip): solo las campañas, sin calcular lo de Stripe.
  if (source === "meta") return <div className="grid gap-4">{platformsCard}{campaignsCard}</div>;
  const tz = RANGE_TZ;
  const [ads, rev] = await Promise.all([
    campaignInsights(ids, chart.since, chart.until),
    revenueByDay(sc.store.id, sc.funnelIds, tz, chart.since, chart.until),
  ]);

  const inKpi = (d: string) => d >= kpi.since && d <= kpi.until;
  const kc: Campaign[] = ads.campaigns.map((c) => {
    const days = c.days.filter((d) => inKpi(d.date));
    const s = (k: "spend" | "impressions" | "clicks" | "purchases" | "value") => days.reduce((a, d) => a + d[k], 0);
    return { ...c, days, spend: s("spend"), impressions: s("impressions"), clicks: s("clicks"), purchases: s("purchases"), value: s("value") };
  });
  const t = totals(kc);
  const { orders, revenue } = kpi.since === chart.since && kpi.until === chart.until
    ? rev
    : await revenueByDay(sc.store.id, sc.funnelIds, tz, kpi.since, kpi.until);
  const roas = t.spend ? revenue / t.spend : null;
  const spendDay = spendByDay(ads.campaigns);
  const series = daysBetween(chart.since, chart.until).map((d) => ({
    date: d, spend: spendDay.get(d) ?? 0, revenue: rev.byDay.get(d) ?? 0,
  }));
  const chartSpend = [...spendDay.values()].reduce((a, b) => a + b, 0);
  const chartRoas = chartSpend ? rev.revenue / chartSpend : null;
  const marketOf = new Map(sc.funnels.flatMap((f) => campaignsOf(f, auto).map((id) => [id, f] as const)));

  return (
    <div className="grid gap-4">
      {!ads.ok && <p className="ad-flash warn mb-0">Meta: {ads.error}. Todavía no hay datos guardados; se sincroniza solo cada 15 minutos.</p>}
      {source === "real" && <><div className="ad-grid g-kpi">
        <Card><Stat size="md" label={<>Gasto · {kpiLabel}</>} value={usd2(t.spend)} hint={`${ids.length} ${ids.length === 1 ? "campaña" : "campañas"}`} /></Card>
        <Card><Stat size="md" label="ROAS" value={<span className={roasTone(roas)}>{roas == null ? "—" : `${roas.toFixed(2)}x`}</span>} hint={`Facturado ${usd2(revenue)} / gasto`} /></Card>
        <Card><Stat size="md" label="CPA" value={orders ? usd2(t.spend / orders) : "—"} hint={`${orders} ${orders === 1 ? "pedido pagado" : "pedidos pagados"}`} /></Card>
        <Card><Stat size="md" label="CPC" value={t.clicks ? usd2(t.spend / t.clicks) : "—"} hint={`${t.clicks.toLocaleString("es-AR")} clics · ${t.impressions.toLocaleString("es-AR")} impresiones`} /></Card>
      </div>

      <Card title={<><Megaphone className="h-4 w-4 text-orange-500" /> Gasto contra facturado</>}
        sub={`${fmtDay(chart.since, { day: "numeric", month: "short" })} – ${fmtDay(chart.until, { day: "numeric", month: "short" })} · gasto ${usd2(chartSpend)} · ROAS ${chartRoas == null ? "—" : `${chartRoas.toFixed(2)}x`} · Meta cuenta ${Math.round(totals(ads.campaigns).purchases)} compras`}>
        <SpendRevenueChart days={series} />
      </Card></>}

      {platformsCard}
      {campaignsCard}
    </div>
  );
}

/** La tabla de campañas de la oferta (o del mercado): solo sus campañas y solo sus pedidos. */
async function OfferCampaigns({ sc, ids, period, source }: { sc: Scope; ids: string[]; period: { since: string; until: string; label: string }; source: "meta" | "real" }) {
  const act = sc.store.meta_ad_account_id ? `act_${sc.store.meta_ad_account_id.replace(/^act_/, "")}` : null;
  if (!act) return <p className="ad-note px-5 pb-5">La tienda no tiene cuenta publicitaria cargada (meta_ad_account_id).</p>;
  const perf = await campaignPerf({
    act, storeIds: [sc.store.id], campaigns: ids, funnelIds: sc.funnelIds,
    funnelCampaigns: Object.fromEntries(sc.funnels.map((f) => [f.id, f.meta_campaign_ids])),
    funnelLabels: Object.fromEntries(sc.funnels.map((f) => [f.id, f.market_label || f.name])),
    period: { ...period, label: period.label.charAt(0).toUpperCase() + period.label.slice(1) },
  });
  if (!perf.fetchedAt && !perf.nodes.length) return <p className="ad-flash warn m-5">{perf.error ? `Meta: ${perf.error}. ` : ""}Todavía no hay datos de Meta guardados: se sincronizan solos cada 15 minutos.</p>;
  return <CampaignTable perf={perf} pageKey={`oferta:${sc.offer.key}`} source={source} />;
}

/** Por red social, las campañas de la oferta en el período: gasto (con su parte), compras, valor y ROAS según Meta. */
async function PlatformCard({ ids, since, until, label }: { ids: string[]; since: string; until: string; label: string }) {
  const { total } = await platformSplit(ids, since, until).catch(() => ({ total: [] as Awaited<ReturnType<typeof platformSplit>>["total"] }));
  const all = total.reduce((a, p) => a + p.spend, 0);
  return (
    <Card title="Por red social" sub={`De dónde salen los anuncios de esta oferta · ${label} · según Meta.`} pad={false}>
      {!total.length ? <p className="ad-note px-5 pb-5">Todavía no hay datos por red de este período (se traen solos cada 15 minutos).</p> : (
        <div className="ad-scroll">
          <table className="ad-table">
            <thead><tr><th>Red</th><th className="num">Gasto</th><th className="num">Compras</th><th className="num hide-m">Valor</th><th className="num">ROAS</th></tr></thead>
            <tbody>
              {total.map((p) => {
                const r = p.spend ? p.value / p.spend : null;
                const pct = all ? Math.round((p.spend / all) * 100) : 0;
                return (
                  <tr key={p.platform}>
                    <td>
                      <b className="font-semibold">{PLATFORM_LABEL[p.platform]}</b>
                      <span className="mt-1 block h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></span>
                    </td>
                    <td className="num">{usd2(p.spend)} <span className="text-zinc-400">{pct} %</span></td>
                    <td className="num">{Math.round(p.purchases).toLocaleString("es-AR")}</td>
                    <td className="num hide-m">{usd2(p.value)}</td>
                    <td className={`num font-semibold ${roasTone(r)}`}>{r == null ? "—" : `${r.toFixed(2)}x`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
