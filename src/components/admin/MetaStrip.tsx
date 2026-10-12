"use client";

import { useState, type ComponentType } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { BarChart2, Coins, DollarSign, Info, Target, TrendingUp, Wallet } from "lucide-react";
import type { MetaDay, MetaNums } from "@/lib/admin/meta-kpis";
import { MetricChart, type ChartKind } from "./CarChart";

/**
 * Las métricas de Meta Ads cada una con su ícono, el
 * valor, ▲/▼ contra el período anterior del mismo largo, una mini curva y un
 * (i) con qué es. Tocando una se abre su evolución día por día (con el
 * período anterior punteado). Verde = mejoró, rojo = empeoró (en los costos,
 * bajar es mejorar). Solo las cinco que importan: inversión, compras,
 * ROAS, valor generado y beneficio; costo por compra, iniciar pago, CTR, CPC,
 * CPM, impresiones, clics y visitas a la landing ya no se muestran.
 */

type Key = "spend" | "purchases" | "roas" | "value" | "profit" | "cpa" | "checkouts" | "ctr" | "cpc" | "cpm" | "impressions" | "linkClicks" | "landingViews";
type Def = { k: Key; label: string; icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; kind: ChartKind; better: 1 | -1; info: string };

const MAIN: Def[] = [
  { k: "spend", label: "Inversión", icon: DollarSign, kind: "money", better: 1, info: "Lo gastado en Meta Ads en el período (como «Importe gastado» en el Administrador de anuncios)." },
  { k: "purchases", label: "Compras", icon: Target, kind: "count", better: 1, info: "Compras que Meta atribuye a tus anuncios (evento Purchase del pixel / API de Conversiones)." },
  { k: "roas", label: "ROAS", icon: BarChart2, kind: "roas", better: 1, info: "Retorno de la inversión según Meta: valor de las compras atribuidas dividido por la inversión." },
  { k: "value", label: "Valor generado", icon: Wallet, kind: "money", better: 1, info: "Valor de las compras que Meta atribuye a tus anuncios (lo que informa el pixel)." },
  { k: "profit", label: "Beneficio", icon: Coins, kind: "money", better: 1, info: "Valor generado menos la inversión. No descuenta comisiones ni reembolsos: eso está en «Real (Stripe)»." },
];

function val(n: MetaNums, k: Key): number {
  switch (k) {
    case "spend": return n.spend;
    case "purchases": return n.purchases;
    case "roas": return n.spend ? n.value / n.spend : 0;
    case "value": return n.value;
    case "profit": return n.value - n.spend;
    case "cpa": return n.purchases ? n.spend / n.purchases : 0;
    case "checkouts": return n.checkouts;
    case "ctr": return n.impressions ? (n.linkClicks / n.impressions) * 100 : 0;
    case "cpc": return n.linkClicks ? n.spend / n.linkClicks : 0;
    case "cpm": return n.impressions ? (n.spend / n.impressions) * 1000 : 0;
    case "impressions": return n.impressions;
    case "linkClicks": return n.linkClicks;
    case "landingViews": return n.landingViews;
  }
}
const int = (n: number) => Math.round(n).toLocaleString("es-AR");
function fmt(k: Key, v: number) {
  switch (k) {
    case "roas": return `${v.toFixed(2)}x`;
    case "ctr": return `${v.toFixed(2)}%`;
    case "purchases": case "checkouts": case "impressions": case "linkClicks": case "landingViews": return int(v);
    default: return `${v < 0 ? "-" : ""}US$ ${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: Math.abs(v) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}`;
  }
}

function Tile({ d, cur, prev, days, active, onClick }: { d: Def; cur: MetaNums; prev: MetaNums; days: MetaDay[]; active: boolean; onClick: () => void }) {
  const v = val(cur, d.k), p = val(prev, d.k);
  const change = p ? ((v - p) / Math.abs(p)) * 100 : null;
  const good = change == null || Math.abs(change) < 0.05 ? null : (change > 0) === (d.better === 1);
  const Icon = d.icon;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`group relative flex min-w-0 flex-col bg-white px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 dark:bg-zinc-900 ${active ? "bg-blue-50/70 dark:bg-blue-500/[0.07]" : "hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50"}`}>
      <span className="mb-2 flex w-full min-w-0 items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} />
        <span className="truncate text-[12.5px] font-medium text-zinc-500 dark:text-zinc-400">{d.label}</span>
        <span className="relative shrink-0" tabIndex={-1}>
          <Info className="peer h-3.5 w-3.5 cursor-help text-zinc-300 hover:text-violet-500 dark:text-zinc-600" aria-label={d.info} />
          <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-56 -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 p-3 text-[11px] font-medium normal-case leading-relaxed tracking-normal text-zinc-200 shadow-2xl peer-hover:block">
            <b className="mb-1 block text-[11px] font-semibold text-violet-300">{d.label}</b>{d.info}
          </span>
        </span>
        {active && <i className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />}
      </span>
      <span className="flex w-full items-end justify-between gap-2">
        <span className="flex shrink-0 flex-col">
          <b className={`mb-1.5 text-[17px] font-bold leading-none tabular-nums sm:text-[20px] ${d.k === "profit" ? (v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : "text-zinc-900 dark:text-white"}`}>{fmt(d.k, v)}</b>
          {change != null ? (
            <span className={`flex items-center gap-1 text-[11px] font-bold sm:text-[12px] ${good == null ? "text-zinc-400" : good ? "text-emerald-500" : "text-rose-500"}`} title={`Antes: ${fmt(d.k, p)}`}>
              <TrendingUp className={`h-3 w-3 ${change < 0 ? "rotate-180" : ""}`} />{Math.abs(change).toFixed(1)}%
            </span>
          ) : <span className="text-[11px] font-bold text-zinc-300 dark:text-zinc-600">{v ? "nuevo" : "—"}</span>}
        </span>
        {/* La mini curva necesita al menos dos días (con uno solo sería un punto suelto). */}
        {days.length > 1 && <span className="ml-1 h-8 min-w-0 max-w-[160px] flex-1 opacity-60 transition-opacity group-hover:opacity-100 sm:h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days.map((x) => ({ val: val(x, d.k) }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Area type="monotone" dataKey="val" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </span>}
      </span>
    </button>
  );
}

export default function MetaStrip({ cur, prev, days, prevDays, caption }: {
  cur: MetaNums; prev: MetaNums; days: MetaDay[]; prevDays: MetaDay[];
  /** «según Meta · toda la cuenta · días de Meta en hora de Buenos Aires · actualizado hace 3 min». */
  caption: React.ReactNode;
}) {
  const [open, setOpen] = useState<Key | null>("spend");
  const d = MAIN.find((x) => x.k === open);
  const strip = (defs: Def[], cols: string) => (
    <div className={`grid gap-px overflow-visible rounded-[16px] border border-black/[0.06] bg-zinc-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:border-white/[0.06] dark:bg-zinc-800 ${cols} [&>button:first-child]:rounded-tl-[15px] [&>button]:overflow-visible`}>
      {defs.map((x) => <Tile key={x.k} d={x} cur={cur} prev={prev} days={days} active={open === x.k} onClick={() => setOpen(open === x.k ? null : x.k)} />)}
    </div>
  );
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1877f2]/10 px-2 py-0.5 text-[11px] font-semibold text-[#1877f2] dark:text-[#5aa0ff]">Según Meta Ads</span>
        {caption}
      </p>
      {strip(MAIN, "grid-cols-2 lg:grid-cols-5 max-lg:[&>button:last-child]:col-span-2")}
      {d && (
        <div className="ad-card p-5">
          <MetricChart label={d.label} kind={d.kind} color="#3b82f6"
            data={days.map((x) => ({ date: x.date, val: Math.round(val(x, d.k) * 100) / 100 }))}
            prevData={prevDays.map((x) => ({ val: Math.round(val(x, d.k) * 100) / 100 }))} />
        </div>
      )}
    </div>
  );
}
