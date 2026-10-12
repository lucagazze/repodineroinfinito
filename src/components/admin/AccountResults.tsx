import { cache, type ReactNode } from "react";
import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { storeMetrics, usdFmt, pct } from "@/lib/metrics";
import { offerList } from "@/lib/admin/offers";
import { storeAlias } from "@/lib/admin/privacy";
import { campaignInsights } from "@/lib/admin/ads";
import { previousOf, RANGE_TZ, PANEL_TZ, type Range } from "@/lib/admin/range";
import { glance, type Glance } from "@/lib/admin/glance";
import { Pv } from "@/components/admin/Priv";
import OverviewTable, { type OverviewOffer } from "@/components/admin/OverviewTable";
import { Card, Kpi } from "@/components/admin/ui";
import { AreaChart } from "@/components/admin/charts";
import { campaignsOf, kickAutoLink } from "@/lib/admin/meta-links";
import type { Source } from "@/lib/admin/source";
import { addMeta, metaKpis, zeroMeta, type MetaKpis, type MetaNums } from "@/lib/admin/meta-kpis";
import { freshness } from "@/lib/admin/meta-fresh";
import MetaStrip from "@/components/admin/MetaStrip";

/**
 * Resultados de toda la cuenta (página «Meta Ads»): los números del período según Meta Ads o
 * cobrados en Stripe (interruptor «Meta Ads | Real (Stripe)») y la tabla de ofertas activas.
 * Antes estaban en el Inicio; el dueño los quiso en su propia página (06/10).
 */

/** «días de Meta en hora de Buenos Aires · Datos de Meta: actualizados hace 3 min». */
function metaCaption(mk: MetaKpis, scope: string) {
  const city = mk.tz ? mk.tz.split("/").pop()!.replace(/_/g, " ") : null;
  return <>{scope}{city && mk.tz !== PANEL_TZ ? ` · días de Meta en hora de ${city}` : ""} · {freshness(mk).text}</>;
}

/**
 * Los números del período y la tabla de ofertas salen de la misma pasada (cache por request):
 * arriba los números, y la tabla va más abajo, después de las campañas.
 */
const overviewOnce = cache((key: string, src: Source) => buildOverview(JSON.parse(key) as Range, src));
export async function Overview({ R, src }: { R: Range; src: Source }) {
  return (await overviewOnce(JSON.stringify(R), src)).top;
}
export async function OffersTable({ R, src }: { R: Range; src: Source }) {
  return (await overviewOnce(JSON.stringify(R), src)).table;
}

async function buildOverview(R: Range, src: Source): Promise<{ top: ReactNode; table: ReactNode }> {
  // Una sola pasada de métricas para todas las tiendas; cada oferta suma las de sus checkouts.
  const offers = await offerList();
  // Gasto de las campañas vinculadas a checkouts (a mano o solas, por el link de sus anuncios),
  // en el mismo período. La vinculación por destino corre después de responder.
  kickAutoLink();
  const auto: Record<string, string[]> = {};
  const campaignIds = [...new Set(offers.flatMap((o) => o.funnels.flatMap((f) => campaignsOf(f, auto))))];
  const P = previousOf(R);

  // Meta Ads (por defecto): lo que dice el Administrador de anuncios de toda la cuenta.
  // Solo lee lo de Meta: las métricas de Stripe (pesadas) se calculan recién con «Real (Stripe)».
  if (src === "meta") {
    const mk = await metaKpis(R.since, R.until);
    const metaOf = (fs: { id: string; meta_campaign_ids: string[] }[]): MetaNums | null => {
      const cs = [...new Set(fs.flatMap((f) => campaignsOf(f, auto)))];
      return cs.length ? cs.reduce((a, c) => (mk.byCampaign[c] ? addMeta(a, mk.byCampaign[c]) : a), zeroMeta()) : null;
    };
    const blank = { revenue: 0, orders: 0, visits: 0, last: null, spend: null };
    const metaRows: OverviewOffer[] = offers.map((o) => ({
      key: o.key, name: o.name, alias: o.alias, store: o.store.display_name || o.store.name, storeAlias: storeAlias(o.store.id), image: o.image_url, active: o.active,
      ...blank, meta: metaOf(o.funnels), funnelIds: o.funnels.map((f) => f.id),
      markets: o.markets.map((f) => ({ key: f.key, label: f.market_label || f.name, slug: f.slug, flags: f.flags, active: f.active, funnelIds: [f.id], ...blank, meta: metaOf([f]) })),
    })).sort((a, b) => (b.meta?.spend ?? -1) - (a.meta?.spend ?? -1) || a.name.localeCompare(b.name));
    return {
      top: mk.accounts
        ? <MetaStrip cur={mk.cur} prev={mk.prev} days={mk.days} prevDays={mk.prevDays} caption={metaCaption(mk, "Toda la cuenta publicitaria")} />
        : <p className="ad-flash warn">Ninguna tienda tiene cuenta publicitaria de Meta cargada.</p>,
      table: <OverviewTable offers={metaRows} period={R.label} source="meta" />,
    };
  }

  const [global, { data: recent }, ads, adsPrev, g, gp] = await Promise.all([
    storeMetrics(null, R.days, undefined, { since: R.since, until: R.until, tz: RANGE_TZ }),
    db.from("orders").select("funnel_id,created_at").eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).order("created_at", { ascending: false }).limit(2000),
    campaignInsights(campaignIds, R.since, R.until),
    campaignInsights(campaignIds, P.since, P.until),
    glance({ since: R.since, until: R.until }),
    glance({ since: P.since, until: P.until }),
  ]);
  const spendOf = new Map(ads.campaigns.map((c) => [c.id, c.spend]));
  const byFunnel = new Map(global.funnels);
  const lastByFunnel = new Map<string, string>();
  for (const r of recent ?? []) if (r.funnel_id && !lastByFunnel.has(r.funnel_id)) lastByFunnel.set(r.funnel_id, r.created_at);

  const sum = (ids: { id: string; meta_campaign_ids: string[] }[]) => {
    let revenue = 0, orders = 0, visits = 0, last: string | null = null, spend: number | null = null;
    for (const f of ids) {
      const cs = campaignsOf(f, auto);
      if (cs.length) spend = (spend ?? 0) + cs.reduce((a, id) => a + (spendOf.get(id) ?? 0), 0);
      const v = byFunnel.get(f.id);
      revenue += v?.value ?? 0;
      orders += v?.count ?? 0;
      visits += global.visitsByFunnel.get(f.id) ?? 0;
      const l = lastByFunnel.get(f.id);
      if (l && (!last || l > last)) last = l;
    }
    return { revenue, orders, visits, last, spend };
  };
  const rows: OverviewOffer[] = offers.map((o) => ({
    key: o.key, name: o.name, alias: o.alias, store: o.store.display_name || o.store.name, storeAlias: storeAlias(o.store.id), image: o.image_url, active: o.active,
    ...sum(o.funnels), funnelIds: o.funnels.map((f) => f.id),
    markets: o.markets.map((f) => ({ key: f.key, label: f.market_label || f.name, slug: f.slug, flags: f.flags, active: f.active, funnelIds: [f.id], ...sum([f]) })),
  })).sort((a, b) => b.revenue - a.revenue || (b.last ?? "").localeCompare(a.last ?? ""));

  // De un vistazo: ventas, facturado neto, ticket, bump y OTOs, reembolsos, gasto, CPA, ROAS real y beneficio.
  const spend = ads.campaigns.reduce((a, c) => a + c.spend, 0);
  const spendPrev = adsPrev.campaigns.reduce((a, c) => a + c.spend, 0);
  const linkedFunnels = new Set(offers.flatMap((o) => o.funnels.filter((f) => campaignsOf(f, auto).length).map((f) => f.id)));
  const linked = (x: Glance) => [...linkedFunnels].reduce((a, f) => ({ revenue: a.revenue + (x.byFunnel[f]?.revenue ?? 0), orders: a.orders + (x.byFunnel[f]?.orders ?? 0) }), { revenue: 0, orders: 0 });
  const lk = linked(g), lkp = linked(gp);
  const roas = spend ? lk.revenue / spend : null, roasPrev = spendPrev ? lkp.revenue / spendPrev : null;
  const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
  const lvl = (x: Glance, level: number, kind: "oto" | "downsell") => x.levels.find((l) => l.level === level && l.kind === kind);
  const otoLevels = [...new Set(g.levels.map((l) => l.level))].sort();
  const storesById = new Map(offers.map((o) => [o.store.id, o.store]));
  const roasCls = roas == null ? "" : roas >= 2 ? "text-emerald-600 dark:text-emerald-400" : roas >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return {
    table: <OverviewTable offers={rows} period={R.label} />,
    top: (
    <>
      {/* Ventas, facturado, ticket, gasto, beneficio y reembolsos ya están en la fila de plata de arriba:
          acá lo que no está ahí (ROAS y CPA reales, bump, OTOs y conversión). */}
      <div className="ad-grid g-kpi">
        <Kpi label="ROAS real" value={<span className={roasCls}>{roas == null ? "—" : `${roas.toFixed(2)}x`}</span>}
          now={roas ?? 0} before={roasPrev ?? 0} hint={spend ? `${usdFmt(lk.revenue)} de checkouts con anuncios` : undefined} />
        <Kpi label="CPA" value={lk.orders && spend ? usdFmt(spend / lk.orders) : "—"} now={lk.orders ? spend / lk.orders : 0} before={lkp.orders ? spendPrev / lkp.orders : 0} invert
          hint={lk.orders ? `${lk.orders} ${lk.orders === 1 ? "venta" : "ventas"} con anuncios` : undefined} />
        <Kpi label="Tomó el bump" value={rate(g.bumpOrders, g.orders)} now={g.orders ? g.bumpOrders / g.orders : 0} before={gp.orders ? gp.bumpOrders / gp.orders : 0}
          hint={`${g.bumpOrders} de ${g.orders} pedidos`} />
        {(otoLevels.length ? otoLevels : [1, 2, 3]).map((n) => {
          const o = lvl(g, n, "oto"), op = lvl(gp, n, "oto"), d = lvl(g, n, "downsell");
          return (
            <Kpi key={n} label={`OTO ${n}`} value={o ? rate(o.accepted, o.shown) : "—"} now={o && o.shown ? o.accepted / o.shown : 0} before={op && op.shown ? op.accepted / op.shown : 0}
              hint={<>{o ? `${o.accepted} de ${o.shown}` : "sin datos"}{d ? ` · downsell ${rate(d.accepted, d.shown)} (${d.accepted} de ${d.shown})` : ""}</>} />
          );
        })}
        <Kpi label="Conversión del checkout" value={pct(global.conversion)} now={global.conversion} before={global.conversionPrev} hint={`${global.visits} visitas al checkout`} />
      </div>

      <Card title="Facturación por día" sub="Línea punteada: el promedio del período anterior." className="mt-4">
        <AreaChart points={global.series} kind="money" label="facturación" />
      </Card>

      {Object.keys(g.byStore).length > 1 && (
        <Card title="Por tienda" sub="Cada cuenta de Stripe que cobra." className="mt-4" pad={false}>
          <div className="ad-scroll">
            <table className="ad-table">
              <thead><tr><th>Tienda</th><th className="num">Ventas</th><th className="num">Facturado neto</th><th className="num">Ticket</th><th className="num">Tomó el bump</th><th className="num">Reembolsos</th></tr></thead>
              <tbody>
                {Object.entries(g.byStore).sort((a, b) => b[1].revenue - a[1].revenue).map(([id, s]) => {
                  const st = storesById.get(id);
                  return (
                    <tr key={id}>
                      <td><b><Pv as={storeAlias(id)}>{st ? st.display_name || st.name : "Tienda"}</Pv></b></td>
                      <td className="num">{s.orders}</td>
                      <td className="num"><b>{usdFmt(s.revenue)}</b></td>
                      <td className="num">{s.orders ? usdFmt(s.revenue / s.orders) : "—"}</td>
                      <td className="num">{rate(s.bumpOrders, s.orders)}</td>
                      <td className="num">{s.refunds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!ads.ok && <p className="ad-flash warn mt-4">Meta respondió con un error al leer el gasto: {ads.error}</p>}
    </>
    ),
  };
}
