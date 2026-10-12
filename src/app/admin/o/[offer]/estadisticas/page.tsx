import { Suspense, cache } from "react";
import { db } from "@/lib/db";
import AdsBlock from "@/components/admin/AdsBlock";
import { SkCard } from "@/components/admin/Skeleton";
import { scopeFor, type Scope } from "@/lib/admin/offers";
import { BarChart2 } from "lucide-react";
import { storeMetrics, usdFmt, pct } from "@/lib/metrics";
import { countryName } from "@/lib/admin-data";
import { Card, Kpi, PageHead, Empty } from "@/components/admin/ui";
import { AreaChart, BarList, FunnelSteps } from "@/components/admin/charts";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";
import { ScopeName } from "@/components/admin/OfferBlocks";
import { resolveRange, RANGE_TZ, type Range } from "@/lib/admin/range";
import RangeBar from "@/components/admin/RangeBar";

export const dynamic = "force-dynamic";

/**
 * Las métricas y los nombres de productos, una sola vez por request aunque las pidan dos
 * secciones (los números de arriba y las tablas de abajo): cada una llega por su lado.
 */
const metricsOf = cache((storeId: string, days: number, ids: string, since: string, until: string) =>
  storeMetrics(storeId, days, ids ? ids.split(",") : [], { since, until, tz: RANGE_TZ }));
const productNames = cache(async (storeId: string) => {
  const { data } = await db.from("products").select("id,short_name").eq("store_id", storeId);
  return new Map((data ?? []).map((p) => [p.id as string, p.short_name as string]));
});
const load = (sc: Scope, R: Range) => metricsOf(sc.store.id, R.days, sc.funnelIds.join(","), R.since, R.until);

export default async function Estadisticas({
  params, searchParams,
}: { params: Promise<{ offer: string }>; searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const R = resolveRange(await searchParams);
  const range = { since: R.since, until: R.until };
  const k = `${R.since}-${R.until}`;
  // Encabezado y filtro al instante; después tres partes independientes: los números, los anuncios
  // (Meta) y las tablas. Ninguna espera a otra (antes los anuncios esperaban a las métricas).
  return (
    <>
      <PageHead title="Métricas" icon={<BarChart2 className="h-[18px] w-[18px]" />} color="#8b5cf6" sub={<><ScopeName sc={sc} />, en USD al tipo de cambio del día.</>} />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />

      <Suspense key={`k-${k}`} fallback={<div data-skeleton className="ad-grid g-kpi">{[0, 1, 2, 3, 4, 5].map((i) => <SkCard key={i} rows={1} title={false} />)}</div>}>
        <MetricKpis sc={sc} R={R} />
      </Suspense>

      <div className="ad-sec"><h2>Anuncios de Meta</h2><span className="ad-small ad-muted">ROAS y CPA con lo que cobraron nuestros pedidos</span></div>
      <Suspense key={`a-${k}`} fallback={<div data-skeleton className="ad-grid g-kpi">{[0, 1, 2, 3].map((i) => <SkCard key={i} rows={1} />)}</div>}>
        <AdsBlock sc={sc} kpi={range} chart={range} kpiLabel={R.label.toLowerCase()} showCampaigns />
      </Suspense>

      <Suspense key={`t-${k}`} fallback={<div data-skeleton className="mt grid gap-4"><div className="ad-grid g-2"><SkCard rows={5} h={260} /><SkCard rows={5} h={260} /></div><SkCard rows={5} h={220} /></div>}>
        <MetricTables sc={sc} R={R} />
      </Suspense>
    </>
  );
}

async function MetricKpis({ sc, R }: { sc: Scope; R: Range }) {
  const m = await load(sc, R);
  return (
    <div className="ad-grid g-kpi">
      <Kpi label="Facturación" value={usdFmt(m.revenue)} now={m.revenue} before={m.revenuePrev} />
      <Kpi label="Visitas al checkout" value={String(m.visits)} now={m.visits} before={m.visitsPrev} />
      <Kpi label="Conversión" value={m.visits ? pct(m.conversion) : "—"} now={m.conversion} before={m.conversionPrev} />
      <Kpi label="Toman un bump" value={m.orders ? pct(m.bumpRate) : "—"} hint={`${m.ordersWithBump} de ${m.orders} pedidos`} />
      <Kpi label="Aceptan un upsell" value={m.upsellViews ? pct(m.upsellRate) : "—"} hint={m.upsellViews ? `${m.upsellAccepts} de ${m.upsellViews} ofertas vistas` : `${m.ordersWithUpsell} pedidos con upsell`} />
      <Kpi label="Reembolsos" value={String(m.refunds)} hint={m.orders ? `${pct(m.refunds / (m.orders + m.refunds || 1))} de los pedidos` : undefined} />
    </div>
  );
}

async function MetricTables({ sc, R }: { sc: Scope; R: Range }) {
  const [m, pName] = await Promise.all([load(sc, R), productNames(sc.store.id)]);
  const fName = new Map(sc.funnels.map((f) => [f.id, f.market_label ? `${f.market_label} · ${f.name}` : f.name]));
  const ordersSeries = m.series.map((s) => ({ label: s.label, value: s.orders }));
  const upsells = [...m.upsellByProduct.entries()].sort((a, b) => b[1].views - a[1].views);

  return (
    <>
      <div className="ad-grid g-2 mt">
        <Card title="Facturación por día" sub="Punteado: período anterior">
          <AreaChart points={m.series} kind="money" label="facturación" height={200} />
        </Card>
        <Card title="Pedidos por día">
          <AreaChart points={ordersSeries} kind="count" label="pedidos" height={200} />
        </Card>
      </div>

      <Card title="Embudo de conversión" sub="De cada 100 que abren el checkout, cuántos avanzan" className="mt">
        {m.visits ? (
          <FunnelSteps steps={[
            { label: "Abrieron el checkout", value: m.visits },
            { label: "Dejaron el email", value: m.leads },
            { label: "Pagaron", value: m.orders },
            { label: "Tomaron un bump", value: m.ordersWithBump },
            { label: "Compraron un upsell", value: m.ordersWithUpsell },
          ]} />
        ) : <Empty title="Sin visitas en este período">Las visitas se cuentan desde que el checkout nuevo empezó a registrarlas.</Empty>}
      </Card>

      <div className="ad-grid g-2 mt">
        <Card title="Por checkout" pad={false}>
          {m.funnels.length ? (
            <div className="ad-scroll"><table className="ad-table">
              <thead><tr><th>Checkout</th><th className="num">Visitas</th><th className="num">Pedidos</th><th className="num">Conv.</th><th className="num">Facturación</th></tr></thead>
              <tbody>
                {m.funnels.map(([id, v]) => {
                  const visits = m.visitsByFunnel.get(id) ?? 0;
                  return (
                    <tr key={id}>
                      <td>{(() => { const f = sc.funnels.find((x) => x.id === id); return f?.market_label || <Pv as="Checkout">{fName.get(id) ?? "—"}</Pv>; })()}</td>
                      <td className="num">{visits || "—"}</td>
                      <td className="num">{v.count}</td>
                      <td className="num">{visits ? pct(v.count / visits) : "—"}</td>
                      <td className="num"><b style={{ fontWeight: 600 }}>{usdFmt(v.value)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <Empty title="Sin ventas en este período" />}
        </Card>

        <Card title="Upsells post-compra" pad={false}>
          {upsells.length ? (
            <div className="ad-scroll"><table className="ad-table">
              <thead><tr><th>Oferta</th><th className="num">Vistas</th><th className="num">Compras</th><th className="num">Tasa</th></tr></thead>
              <tbody>
                {upsells.map(([id, v]) => (
                  <tr key={id}>
                    <td><Pv as={productAlias(id)}>{pName.get(id) ?? "—"}</Pv></td>
                    <td className="num">{v.views}</td>
                    <td className="num">{v.accepts}</td>
                    <td className="num"><b style={{ fontWeight: 600 }}>{v.views ? pct(v.accepts / v.views) : "—"}</b></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <Empty title="Todavía no se mostró ningún upsell" />}
        </Card>
      </div>

      <div className="ad-grid g-2 mt">
        <Card title="Productos">
          <BarList format={(n) => usdFmt(n)} rows={m.topProducts.map(([id, v]) => ({ label: pName.get(id) ?? "—", alias: productAlias(id), value: v.value, sub: `${v.count} u.` }))} />
        </Card>
        <Card title="Países">
          <BarList format={(n) => usdFmt(n)} rows={m.countries.map(([cc, v]) => ({ label: countryName(cc), value: v.value, sub: `${v.count}` }))} />
        </Card>
      </div>

      <Card title="Origen de las ventas (UTM)" sub="utm_source de los links de tus anuncios" className="mt">
        <BarList format={(n) => usdFmt(n)} rows={m.sources.map(([k, v]) => ({ label: k, value: v.value, sub: `${v.count} pedidos` }))} />
      </Card>
    </>
  );
}
