import Link from "next/link";
import { scopeFor } from "@/lib/admin/offers";
import { House } from "lucide-react";
import { Suspense } from "react";
import OfferBooks from "@/components/admin/OfferBooks";
import { type AdminStore } from "@/lib/admin/store";
import { rangeDashboard, usd2 } from "@/lib/admin/inicio";
import { resolveRange, previousOf, rangeText, RANGE_TZ, PANEL_TZ, type Range } from "@/lib/admin/range";
import RangeBar from "@/components/admin/RangeBar";
import RecentOrders from "@/components/admin/RecentOrders";
import { setupSteps } from "@/lib/admin/setup";
import { addDays, dayOf, fmtDay } from "@/lib/admin/tz";
import AdsBlock, { campaignIdsOf } from "@/components/admin/AdsBlock";
import { metricSource } from "@/lib/admin/source";
import { metaKpis } from "@/lib/admin/meta-kpis";
import { freshness } from "@/lib/admin/meta-fresh";
import SourceSwitch from "@/components/admin/SourceSwitch";
import MetaStrip from "@/components/admin/MetaStrip";
import type { Scope } from "@/lib/admin/offers";
import { pct, usdFmt } from "@/lib/metrics";
import { countryName } from "@/lib/admin-data";
import { Card, Flag, Kpi, PageHead, Progress, Stat, Badge } from "@/components/admin/ui";
import OfferHero from "@/components/admin/OfferHero";
import { AreaChart, HourlyChart } from "@/components/admin/charts";
import { ICheck } from "@/components/admin/icons";
import { SkCard, SkInicio } from "@/components/admin/Skeleton";
import KeepHeight from "@/components/admin/KeepHeight";
import { glance, type Glance } from "@/lib/admin/glance";
import { ScopeName } from "@/components/admin/OfferBlocks";
import { Pv } from "@/components/admin/Priv";
import { storeAlias } from "@/lib/admin/privacy";
import MejorasCard from "@/components/admin/MejorasCard";

export const dynamic = "force-dynamic";

export default async function Inicio({
  params, searchParams,
}: { params: Promise<{ offer: string }>; searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const s = sc.store;
  const R = resolveRange(await searchParams);
  const src = await metricSource();
  const base = `${sc.base}`;
  // Un solo día: el gráfico de anuncios muestra los 14 días hasta ese día, para ver la tendencia.
  const chart = R.since === R.until ? { since: addDays(R.until, -13), until: R.until } : { since: R.since, until: R.until };

  // El encabezado sale al instante; los números se van llenando a medida que llegan.
  return (
    <>
      <PageHead title="Inicio" sub={sc.market ? <>Las ventas de <ScopeName sc={sc} /></> : sc.markets.length > 1 ? "Las ventas de esta oferta, en todos sus mercados." : "Las ventas de esta oferta."}
        icon={<House className="h-[18px] w-[18px]" />} actions={<a className="ad-btn" href={`${sc.base}/compra-prueba`}>Compra de prueba</a>} />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label}><SourceSwitch source={src} /></RangeBar>
      {/* El filtro de fechas arriba de todo (como en las demás páginas); la oferta, debajo. */}
      <OfferHero sc={sc} />
      {/* Con key por período: al cambiarlo, esqueleto con el mismo alto (sin saltar) en vez de números viejos. */}
      <KeepHeight>
        <Suspense key={`rb-${src}-${R.since}-${R.until}`} fallback={<div data-skeleton><SkInicio /></div>}>
          {src === "meta" ? <OfferMeta sc={sc} R={R} /> : <RangeBlocks s={s} R={R} base={base} funnelIds={sc.funnelIds} />}
        </Suspense>
      </KeepHeight>
      {/* Lo flojo de esta oferta según el último análisis de «Mejoras» (no aparece si no hay nada pendiente). */}
      <Suspense fallback={null}><MejorasCard offerKey={sc.offer.key} href={`${sc.base}/mejoras`} /></Suspense>
      {/* Las compras de esta oferta en el período, una fila por pedido (se actualiza sola). */}
      <div className="mt2" data-live>
        <RecentOrders since={R.since} until={R.until} label={R.label} funnelIds={sc.funnelIds} pedidosHref={`${base}/ventas`} />
      </div>
      {/* Cada libro que se ofrece (principal, bonus, bumps, post-pago) con su PDF a un toque. */}
      <Suspense fallback={null}><OfferBooks sc={sc} /></Suspense>
      {/* El gasto en anuncios, al final. */}
      <div className="ad-sec"><h2>Anuncios</h2><span className="ad-small ad-muted">{R.since === R.until ? "El día elegido y los 14 días hasta ese día" : R.label}</span></div>
      <KeepHeight>
        <Suspense key={`ads-${src}-${R.since}-${R.until}`} fallback={<div data-skeleton className="ad-grid g-kpi">{[0, 1, 2, 3].map((i) => <SkCard key={i} rows={1} />)}</div>}>
          <AdsBlock sc={sc} kpi={{ since: R.since, until: R.until }} chart={chart} kpiLabel={R.label.toLowerCase()} showCampaigns source={src} />
        </Suspense>
      </KeepHeight>
      <Suspense fallback={<div className="mt2"><SkCard rows={6} h={300} /></div>}>
        <SetupBlock s={s} base={base} />
      </Suspense>
    </>
  );
}

/** Meta Ads (por defecto): las campañas de esta oferta. */
async function OfferMeta({ sc, R }: { sc: Scope; R: Range }) {
  const ids = campaignIdsOf(sc);
  if (!ids.length) return <p className="ad-flash warn">Esta oferta no tiene campañas de Meta vinculadas: pasá a «Real (Stripe)» o pedile a Claude que las vincule.</p>;
  const mk = await metaKpis(R.since, R.until, ids.join(","));
  // La cuenta de Meta y el panel están en hora de Argentina: la aclaración solo si la cuenta está en otra zona.
  const city = mk.tz && mk.tz !== PANEL_TZ ? mk.tz.split("/").pop()!.replace(/_/g, " ") : null;
  return (
    <MetaStrip cur={mk.cur} prev={mk.prev} days={mk.days} prevDays={mk.prevDays}
      caption={<>{ids.length === 1 ? "La campaña" : `Las ${ids.length} campañas`} de esta oferta{city ? ` · días de Meta en hora de ${city}` : ""} · {freshness(mk).text}</>} />
  );
}

async function RangeBlocks({ s, R, base, funnelIds }: { s: AdminStore; R: Range; base: string; funnelIds: string[] }) {
  const prev = previousOf(R);
  const [d, g, gp] = await Promise.all([
    rangeDashboard(s.id, RANGE_TZ, R.since, R.until, funnelIds),
    glance({ storeIds: [s.id], funnelIds, since: R.since, until: R.until }),
    glance({ storeIds: [s.id], funnelIds, since: prev.since, until: prev.until }),
  ]);
  const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
  const lvl = (x: Glance, n: number, kind: "oto" | "downsell") => x.levels.find((l) => l.level === n && l.kind === kind);
  const levels = [...new Set(g.levels.map((l) => l.level))].sort();
  const delta = (now: number, before: number) => (!before ? (now ? "nuevo" : null) : `${now >= before ? "+" : ""}${(((now - before) / before) * 100).toFixed(0)}%`);
  const dv = delta(d.revenue, d.prevRevenue);
  return (
    <>
      <div className="ad-hero">
        <Card>
          <Stat size="lg" label={<>Ventas · {R.label}{dv && <span className={`ad-delta ${d.revenue >= d.prevRevenue ? "up" : "down"}`}>{dv}</span>}</>} value={usd2(d.revenue)} />
          <div className="ad-split">
            <Stat size="sm" label="Período anterior" value={usd2(d.prevRevenue)} hint={`${rangeText(prev.since, prev.until)} · ${d.prevOrders} ${d.prevOrders === 1 ? "pedido" : "pedidos"}`} />
            <Stat size="sm" label="Ventas totales" value={usd2(d.totalRevenue)}
              hint={d.firstSaleAt ? `Desde la primera venta (${fmtDay(dayOf(new Date(d.firstSaleAt), RANGE_TZ))})` : "Desde la primera venta"} />
          </div>
        </Card>
        {d.single ? (
          <Card title="Ventas por hora" action={<Link className="ad-link-a" href={`${base}/ventas`}>Ver pedidos →</Link>}>
            <HourlyChart hours={d.hours} ticks={d.ticks} nowHour={d.nowHour} />
            <p className="ad-note" style={{ marginTop: 10, fontSize: 12 }}>Cada rayita es una venta. Hora de Argentina.</p>
          </Card>
        ) : (
          <Card title="Ventas por día" action={<Link className="ad-link-a" href={`${base}/ventas`}>Ver pedidos →</Link>}>
            <AreaChart points={d.days.map((x) => ({ label: x.day, value: x.revenue }))} kind="money" label="ventas" height={190} />
          </Card>
        )}
      </div>

      <div className="ad-sec"><h2>Tus métricas</h2><span className="ad-small ad-muted">En dólares, al tipo de cambio de hoy</span></div>
      <div className="ad-grid g-kpi">
        <Kpi label="Ventas" value={String(g.orders)} now={g.orders} before={gp.orders} hint={`antes ${gp.orders}`} />
        <Kpi label="Facturado neto" value={usd2(g.revenue)} now={g.revenue} before={gp.revenue} hint="con bumps y OTOs, menos reembolsos" />
        <Kpi label="Ticket promedio" value={g.orders ? usd2(g.revenue / g.orders) : "—"} now={g.orders ? g.revenue / g.orders : 0} before={gp.orders ? gp.revenue / gp.orders : 0} />
        <Kpi label="Conversión" value={d.conversion == null ? "—" : pct(d.conversion)}
          hint={`${d.checkouts} ${d.checkouts === 1 ? "checkout abierto" : "checkouts abiertos"}`} />
        <Kpi label="Tomó el bump" value={rate(g.bumpOrders, g.orders)} now={g.orders ? g.bumpOrders / g.orders : 0} before={gp.orders ? gp.bumpOrders / gp.orders : 0}
          hint={`${g.bumpOrders} de ${g.orders} pedidos`} />
        {(levels.length ? levels : [1, 2, 3]).map((n) => {
          const o = lvl(g, n, "oto"), op = lvl(gp, n, "oto"), ds = lvl(g, n, "downsell");
          return (
            <Kpi key={n} label={`OTO ${n}`} value={o ? rate(o.accepted, o.shown) : "—"} now={o && o.shown ? o.accepted / o.shown : 0} before={op && op.shown ? op.accepted / op.shown : 0}
              hint={<>{o ? `${o.accepted} de ${o.shown}` : "sin datos"}{ds ? ` · downsell ${rate(ds.accepted, ds.shown)}` : ""}</>} />
          );
        })}
        <Kpi label="Reembolsos" value={String(g.refunds)} now={g.refunds} before={gp.refunds} invert hint={g.refunded ? `${usd2(g.refunded)} devueltos` : "ninguno"} />
      </div>

      <Card className="mt2" title={<>Ahora mismo <span className="ad-livedot">EN VIVO</span></>}>
        <div className="ad-live">
          <Stat size="md" label="en el checkout" value={d.live.inCheckout} hint="Últimos 30 minutos" />
          <Stat size="md" label="entró en la última hora" value={usd2(d.live.lastHourRevenue)} />
          <div className="ad-stat md">
            <span>países vendiendo hoy</span>
            <strong>{d.live.countriesToday.length}</strong>
            {d.live.countriesToday.length ? (
              <div className="ad-flags">
                {d.live.countriesToday.slice(0, 8).map(([cc, n]) => (
                  <span key={cc} title={`${countryName(cc)}: ${n}`}><Flag cc={cc} />{n}</span>
                ))}
              </div>
            ) : <small>Todavía no hubo ventas hoy</small>}
          </div>
        </div>
      </Card>
    </>
  );
}

async function SetupBlock({ s, base }: { s: AdminStore; base: string }) {
  const steps = await setupSteps(s, base);
  const done = steps.filter((x) => x.done).length;
  const reqLeft = steps.filter((x) => x.required && !x.done).length;
  const hot = steps.find((x) => x.required && !x.done)?.key;
  return (
    <Card className="mt2" title={<>Estado de la tienda <Pv as={storeAlias(s.id)}>{s.display_name || s.name}</Pv></>} action={<span className="ad-small ad-muted" style={{ whiteSpace: "nowrap" }}>{done} de {steps.length} listos</span>}
      sub={reqLeft ? `${reqLeft === 1 ? "Falta 1 paso" : `Faltan ${reqLeft} pasos`} para cobrar en la cuenta propia. Pedíselo a Claude.` : "Lo obligatorio está listo."}>
      <Progress value={done} max={steps.length} />
      <div className="ad-steps" style={{ marginTop: 16 }}>
        {steps.map((st) => (
          <div key={st.key} className={`ad-steprow${st.done ? " done" : ""}${st.key === hot ? " hot" : ""}`}>
            <span className="dot">{st.done && <ICheck size={13} />}</span>
            <div className="t">
              {st.title}{" "}
              {st.required && !st.done && <Badge caps>Requerido</Badge>}
              {st.optional && <Badge caps>Opcional</Badge>}
              {!st.done && <small>{st.sub}</small>}
            </div>
            <div className="go">
              {st.done
                ? <Link className="ad-link-a" href={st.href}>Ver</Link>
                : <Link className={`ad-btn sm ${st.key === hot ? "primary" : ""}`} href={st.href}>Ver →</Link>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
