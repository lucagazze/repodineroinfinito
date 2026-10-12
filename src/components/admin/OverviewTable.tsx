"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { rangeQuery } from "@/lib/admin/range";
import { ChevronRight, Search } from "lucide-react";
import { Flags } from "./OfferSwitcher";
import { Pv } from "./Priv";
import { LiveSplit, TodaySales } from "./Pulse";
import { PANEL_TZ } from "@/lib/admin/range";
import type { MetaNums } from "@/lib/admin/meta-kpis";

type Nums = { revenue: number; orders: number; visits: number; last: string | null; spend: number | null;
  /** Según Meta Ads (las campañas de la oferta); null = sin campañas vinculadas. */
  meta?: MetaNums | null };
export type OverviewMarket = Nums & { key: string; label: string; slug: string; flags: string[]; active: boolean; funnelIds: string[] };
export type OverviewOffer = Nums & {
  key: string; name: string; alias: string; store: string; storeAlias: string; image: string | null; active: boolean; markets: OverviewMarket[];
  /** Todos sus checkouts (también los links de producto suelto): para «en vivo» y «hoy». */
  funnelIds: string[];
};

const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: PANEL_TZ })
  : "—");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const roasTone = (r: number) => (r >= 2 ? "text-emerald-600 dark:text-emerald-400" : r >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400");

const dash = <span className="text-zinc-300 dark:text-zinc-600">—</span>;
/** Las columnas de Meta Ads (lo que dice el Administrador de anuncios de las campañas de cada oferta). */
function MetaCells({ n, strong, ids }: { n: Nums; strong?: boolean; ids?: string[] }) {
  const m = n.meta;
  const roas = m && m.spend ? m.value / m.spend : null;
  return (
    <>
      <td className="num">{ids ? <LiveSplit ids={ids} /> : null}</td>
      <td className="num">{ids ? <TodaySales ids={ids} /> : null}</td>
      {!m ? <td className="num text-zinc-400" colSpan={7} title="Sus anuncios no mandan a esta oferta (o no están vinculados)">Sin campañas vinculadas</td> : <>
        <td className="num">{strong ? <b>{usd(m.spend)}</b> : usd(m.spend)}</td>
        <td className="num">{Math.round(m.purchases).toLocaleString("es-AR")}</td>
        <td className="num">{usd(m.value)}</td>
        <td className="num">{roas == null ? dash : <b className={roasTone(roas)}>{roas.toFixed(2)}x</b>}</td>
        <td className="num hide-m">{m.purchases ? usd(m.spend / m.purchases) : dash}</td>
        <td className="num hide-m">{Math.round(m.checkouts).toLocaleString("es-AR")}</td>
        <td className="num hide-m">{m.impressions ? `${((m.linkClicks / m.impressions) * 100).toFixed(2)}%` : dash}</td>
      </>}
    </>
  );
}

function Cells({ n, strong, ids }: { n: Nums; strong?: boolean; ids?: string[] }) {
  const roas = n.spend ? n.revenue / n.spend : null;
  return (
    <>
      {/* En vivo y hoy: del centro de control, se actualizan solos. */}
      <td className="num">{ids ? <LiveSplit ids={ids} /> : null}</td>
      <td className="num">{ids ? <TodaySales ids={ids} /> : null}</td>
      <td className="num">{strong ? <b>{usd(n.revenue)}</b> : usd(n.revenue)}</td>
      <td className="num">{n.orders}</td>
      <td className="num hide-m">{n.orders ? usd(n.revenue / n.orders) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}</td>
      <td className="num">{n.spend == null ? <span className="text-zinc-300 dark:text-zinc-600" title="Sin campañas vinculadas">—</span> : usd(n.spend)}</td>
      <td className="num">{roas == null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : <b className={roasTone(roas)}>{roas.toFixed(2)}x</b>}</td>
      <td className="num hide-m">{n.visits ? pct(n.orders / n.visits) : "—"}</td>
      <td className="hide-m whitespace-nowrap text-zinc-500">{when(n.last)}</td>
    </>
  );
}

/** Tabla de ofertas con sus mercados abajo, y el mismo buscador que el selector del menú. */
export default function OverviewTable({ offers, period, source = "real" }: { offers: OverviewOffer[]; period: string; source?: "meta" | "real" }) {
  const meta = source === "meta";
  const Row = meta ? MetaCells : Cells;
  const [q, setQ] = useState("");
  const rq = rangeQuery(useSearchParams());
  const to = (key: string) => `/admin/o/${key}${rq ? `?${rq}` : ""}`;
  const [showOff, setShowOff] = useState(false);
  const rows = useMemo(() => {
    const t = norm(q.trim());
    return offers.map((o) => {
      if (!t) return o;
      if (norm(`${o.name} ${o.store} ${o.alias}`).includes(t)) return o;
      const ms = o.markets.filter((m) => norm(`${m.label} ${m.slug} ${m.flags.join(" ")}`).includes(t));
      return ms.length ? { ...o, markets: ms } : null;
    }).filter((o): o is OverviewOffer => !!o);
  }, [offers, q]);
  const active = rows.filter((o) => o.active);
  const inactive = rows.filter((o) => !o.active);
  const openOff = showOff || !!q.trim();

  const total = (list: OverviewOffer[]): Nums => list.reduce<Nums>((a, o) => ({
    revenue: a.revenue + o.revenue, orders: a.orders + o.orders, visits: a.visits + o.visits,
    last: !a.last || (o.last && o.last > a.last) ? o.last : a.last,
    spend: o.spend == null ? a.spend : (a.spend ?? 0) + o.spend,
    meta: !o.meta ? a.meta : {
      spend: (a.meta?.spend ?? 0) + o.meta.spend, impressions: (a.meta?.impressions ?? 0) + o.meta.impressions, clicks: (a.meta?.clicks ?? 0) + o.meta.clicks,
      linkClicks: (a.meta?.linkClicks ?? 0) + o.meta.linkClicks, purchases: (a.meta?.purchases ?? 0) + o.meta.purchases, value: (a.meta?.value ?? 0) + o.meta.value,
      checkouts: (a.meta?.checkouts ?? 0) + o.meta.checkouts, landingViews: (a.meta?.landingViews ?? 0) + o.meta.landingViews,
    },
  }), { revenue: 0, orders: 0, visits: 0, last: null, spend: null, meta: null });

  const body = (list: OverviewOffer[]) => list.map((o) => (
    <tbody key={o.key} className="border-t border-zinc-100 first:border-t-0 dark:border-white/[0.05]">
      <tr>
        <td className="ov-name">
          <Link href={to(o.key)} className="ad-prod">
            {o.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img data-pv-img src={o.image} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-black/5 object-cover md:h-10 md:w-10" />
              : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 md:h-10 md:w-10 text-[13px] font-black text-white dark:bg-white dark:text-zinc-900"><Pv as={o.alias.replace("Oferta ", "")}>{o.name.slice(0, 1)}</Pv></span>}
            <span className="min-w-0">
              <b className="flex min-w-0 items-center gap-1.5"><span className="truncate"><Pv as={o.alias}>{o.name}</Pv></span><Flags codes={[...new Set(o.markets.flatMap((m) => m.flags))]} size={12} max={5} /></b>
              <span className="sub"><Pv as={o.storeAlias}>{o.store}</Pv></span>
            </span>
          </Link>
        </td>
        <Row n={o} strong ids={o.funnelIds} />
      </tr>
    </tbody>
  ));

  const head = (
    <thead>
      <tr>
        <th>Oferta · mercado</th><th className="num">En vivo</th><th className="num">Hoy</th>
        {meta ? <>
          <th className="num">Inversión</th><th className="num">Compras</th><th className="num">Valor</th><th className="num">ROAS</th>
          <th className="num hide-m">Costo por compra</th><th className="num hide-m">Iniciar pago</th><th className="num hide-m">CTR</th>
        </> : <>
          <th className="num">Facturación</th><th className="num">Pedidos</th><th className="num hide-m">Ticket</th>
          <th className="num">Gasto</th><th className="num">ROAS</th><th className="num hide-m">Conversión</th><th className="hide-m">Última venta</th>
        </>}
      </tr>
    </thead>
  );
  const foot = (list: OverviewOffer[], label: string) => {
    const t = total(list);
    return (
      <tfoot>
        <tr className="border-t-2 border-zinc-200 bg-zinc-50/60 font-bold dark:border-zinc-700 dark:bg-white/[0.02]">
          <td className="text-[12.5px] font-semibold text-zinc-700 dark:text-zinc-200">{label}</td>
          <Row n={t} strong ids={list.flatMap((o) => o.funnelIds)} />
        </tr>
      </tfoot>
    );
  };

  return (
    <div className="grid gap-4">
      <section className="ad-card">
        <div className="ad-card-h flex-wrap">
          <div className="min-w-0 flex-1">
            <h3>Ofertas activas <span className="font-normal text-zinc-400">· {active.length}</span></h3>
            <p>{meta
              ? <>Inversión, compras, valor y ROAS según Meta Ads (las campañas de cada oferta). En vivo y Hoy, en tiempo real.</>
              : <>Facturación, pedidos, gasto y ROAS cobrados en Stripe (ROAS = lo cobrado / lo gastado en sus campañas). En vivo y Hoy, en tiempo real.</>}</p>
          </div>
          {/* Filtro de la tabla (no es el buscador del panel): por oferta, país, tienda o checkout. */}
          <label className="flex h-8 w-full items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 focus-within:border-violet-400 sm:w-56 dark:border-zinc-700 dark:bg-zinc-900">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar ofertas" aria-label="Filtrar ofertas"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white" />
            {q && <button type="button" className="text-[11.5px] font-semibold text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => setQ("")}>Borrar</button>}
          </label>
        </div>
        {active.length
          ? <div className="ad-scroll border-t border-zinc-100 dark:border-white/[0.05]"><table className="ad-table">{head}{body(active)}{foot(active, "Total")}</table></div>
          : <p className="ad-note border-t border-zinc-100 px-5 py-4 dark:border-white/[0.05]">{q ? `Ninguna oferta activa con «${q}».` : "No hay ofertas activas. Las arma Claude por el MCP."}</p>}
      </section>

      {inactive.length > 0 && (
        <section className="ad-card">
          <button type="button" onClick={() => setShowOff((v) => !v)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-[14px] font-semibold text-zinc-900 dark:text-white">
            <ChevronRight className={`h-4 w-4 text-zinc-400 transition-transform ${openOff ? "rotate-90" : ""}`} />
            Inactivas <span className="font-normal text-zinc-400">· {inactive.length}</span>
          </button>
          {openOff && <div className="ad-scroll border-t border-zinc-100 dark:border-white/[0.05]"><table className="ad-table">{head}{body(inactive)}</table></div>}
        </section>
      )}
    </div>
  );
}
