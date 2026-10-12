"use client";

import { useState, type ComponentType } from "react";
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgePercent, Coins, DollarSign, Info, Landmark, Package, Percent, Receipt, RotateCcw, Tag, TrendingUp, Wallet, Zap } from "lucide-react";
import type { Money, MoneyDay } from "@/lib/admin/money";
import { MetricChart, type ChartKind } from "./CarChart";

/**
 * Métricas, centradas en lo que te queda de verdad:
 * cada número con su ícono, ▲/▼ contra el período anterior del mismo largo,
 * una mini curva y un (i). Arriba, de dónde sale lo que queda (cobrado −
 * comisiones − reembolsos = neto; neto − gasto en Meta = te queda); abajo,
 * pedidos, ticket, ROAS real y margen. Por defecto se ve el gráfico de cada
 * día (facturado, gasto y lo que queda); tocando un número, su evolución con
 * el período anterior punteado.
 */

type Key = "gross" | "fees" | "refunded" | "net" | "spend" | "profit" | "orders" | "ticket" | "roas" | "margin";
type Def = { k: Key; label: string; icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; kind: ChartKind; better: 1 | -1; info: string; strong?: boolean };
type Totals = { gross: number; fees: number; refunded: number; net: number; spend: number; profit: number; orders: number };

const FLOW: Def[] = [
  { k: "gross", label: "Cobrado", icon: DollarSign, kind: "money", better: 1, info: "Lo cobrado en Stripe en el período: el principal, los bumps y los OTOs, antes de comisiones y reembolsos." },
  { k: "fees", label: "Comisiones", icon: Landmark, kind: "money", better: -1, info: "Lo que se queda Stripe de cada cobro (las comisiones reales de tus cuentas; si alguna todavía no llegó, estimada)." },
  { k: "refunded", label: "Reembolsos", icon: RotateCcw, kind: "money", better: -1, info: "Lo devuelto a los compradores de los pedidos del período." },
  { k: "net", label: "Neto", icon: Wallet, kind: "money", better: 1, info: "Cobrado − comisiones − reembolsos: lo que deposita Stripe." },
  { k: "spend", label: "Gasto Meta", icon: Receipt, kind: "money", better: -1, info: "Lo gastado por las campañas que mandan a estas ofertas, desde que cada oferta vende acá (no toda la cuenta publicitaria)." },
  { k: "profit", label: "Te queda", icon: Coins, kind: "money", better: 1, strong: true, info: "Neto − gasto en Meta: lo que te queda de verdad." },
];
const MORE: Def[] = [
  { k: "orders", label: "Pedidos", icon: Package, kind: "count", better: 1, info: "Compras reales cobradas en Stripe (sin las de prueba)." },
  { k: "ticket", label: "Ticket promedio", icon: Tag, kind: "money", better: 1, info: "Cobrado ÷ pedidos: cuánto deja cada compra, con bumps y OTOs." },
  { k: "roas", label: "ROAS real", icon: Zap, kind: "roas", better: 1, info: "Cobrado ÷ gasto en Meta: lo que entra por cada dólar de anuncios, con la plata de verdad (no lo que informa el pixel)." },
  { k: "margin", label: "Margen", icon: BadgePercent, kind: "percent", better: 1, info: "Te queda ÷ cobrado: qué parte de lo que cobrás termina siendo tuya." },
];

function val(t: Totals, k: Key): number {
  switch (k) {
    case "ticket": return t.orders ? t.gross / t.orders : 0;
    case "roas": return t.spend ? t.gross / t.spend : 0;
    case "margin": return t.gross ? (t.profit / t.gross) * 100 : 0;
    default: return t[k];
  }
}
const money = (v: number) => {
  const a = Math.abs(v), d = a > 0 && a < 100 ? 2 : 0;
  const s = `US$ ${a.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  return v < 0 && a >= 0.005 ? `−${s}` : s;
};
function fmt(k: Key, v: number) {
  if (k === "roas") return `${v.toFixed(2)}x`;
  if (k === "margin") return `${v.toFixed(0)} %`;
  if (k === "orders") return Math.round(v).toLocaleString("es-AR");
  // Lo que resta, con el signo menos.
  if (k === "fees" || k === "refunded" || k === "spend") return v ? `−${money(v)}` : money(0);
  return money(v);
}
const toTotals = (m: { gross: number; fees: number; refunded: number; net: number; spend: number | null; profit: number; orders: number }): Totals =>
  ({ gross: m.gross, fees: m.fees, refunded: m.refunded, net: m.net, spend: m.spend ?? 0, profit: m.profit, orders: m.orders });

function Tile({ d, cur, prev, days, active, onClick }: { d: Def; cur: Totals; prev: Totals; days: Totals[]; active: boolean; onClick: () => void }) {
  const v = val(cur, d.k), p = val(prev, d.k);
  const change = p ? ((v - p) / Math.abs(p)) * 100 : null;
  const good = change == null || Math.abs(change) < 0.05 ? null : (change > 0) === (d.better === 1);
  const Icon = d.icon;
  const color = d.strong ? (v >= 0 ? "#10b981" : "#ef4444") : "#8b5cf6";
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`group relative flex min-w-0 flex-col bg-zinc-900 px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 ${active ? "bg-violet-500/[0.08]" : "hover:bg-zinc-800/50"}`}>
      <span className="mb-2 flex w-full min-w-0 items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0" style={{ color }} />
        <span className="truncate text-[12.5px] font-medium text-zinc-400">{d.label}</span>
        <span className="relative shrink-0" tabIndex={-1}>
          <Info className="peer h-3.5 w-3.5 cursor-help text-zinc-600 hover:text-violet-400" aria-label={d.info} />
          <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-56 -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 p-3 text-[11px] font-medium leading-relaxed text-zinc-200 shadow-2xl peer-hover:block">
            <b className="mb-1 block text-[11px] font-semibold text-violet-300">{d.label}</b>{d.info}
          </span>
        </span>
      </span>
      <span className="flex w-full items-end justify-between gap-2">
        <span className="flex shrink-0 flex-col">
          <b className={`mb-1.5 text-[17px] font-bold leading-none tabular-nums sm:text-[20px] ${d.strong ? (v >= 0 ? "text-emerald-400" : "text-red-400") : "text-white"}`}>{fmt(d.k, v)}</b>
          {change != null ? (
            <span className={`flex items-center gap-1 text-[11px] font-bold sm:text-[12px] ${good == null ? "text-zinc-500" : good ? "text-emerald-500" : "text-rose-500"}`} title={`Antes: ${fmt(d.k, p)}`}>
              <TrendingUp className={`h-3 w-3 ${change < 0 ? "rotate-180" : ""}`} />{Math.abs(change).toFixed(1)}%
            </span>
          ) : <span className="text-[11px] font-bold text-zinc-600">{v ? "nuevo" : "—"}</span>}
        </span>
        {days.length > 1 && <span className="ml-1 h-8 min-w-0 max-w-[140px] flex-1 opacity-60 transition-opacity group-hover:opacity-100 sm:h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days.map((x) => ({ val: val(x, d.k) }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Area type="monotone" dataKey="val" stroke={color} fill={color} fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </span>}
      </span>
    </button>
  );
}

const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Cada día: lo que te quedó (barra verde, o roja si se perdió), lo cobrado y lo gastado en Meta (líneas). */
function ProfitChart({ days }: { days: MoneyDay[] }) {
  const data = days.map((d) => ({ date: shortDay(d.date), gross: Math.round(d.gross * 100) / 100, spend: Math.round(d.spend * 100) / 100, profit: Math.round(d.profit * 100) / 100 }));
  const tot = days.reduce((a, d) => ({ gross: a.gross + d.gross, spend: a.spend + d.spend, profit: a.profit + d.profit }), { gross: 0, spend: 0, profit: 0 });
  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <h3 className="text-[14px] font-semibold text-white">Día por día: cobrado, gasto en Meta y lo que te queda</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-violet-500" />Cobrado {money(tot.gross)}</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-sky-500" />Gasto {money(tot.spend)}</span>
          <span className="inline-flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm ${tot.profit >= 0 ? "bg-emerald-500" : "bg-red-500"}`} />Te queda {money(tot.profit)}</span>
        </div>
      </div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12, fontSize: 12 }}
              formatter={(v: number, n: string) => [money(v), n === "gross" ? "Cobrado" : n === "spend" ? "Gasto en Meta" : "Te queda"]} labelStyle={{ color: "#a1a1aa" }} />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28}>
              {data.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.75} />)}
            </Bar>
            <Line type="monotone" dataKey="gross" stroke="#8b5cf6" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="spend" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function MoneyStrip({ cur, prev, days, prevDays, label }: { cur: Money; prev: Money; days: MoneyDay[]; prevDays: MoneyDay[]; label: string }) {
  const [open, setOpen] = useState<Key | null>(null);
  const c = toTotals(cur), p = toTotals(prev);
  const ds = days.map(toTotals), pds = prevDays.map(toTotals);
  const d = [...FLOW, ...MORE].find((x) => x.k === open);
  const strip = (defs: Def[], cols: string) => (
    <div className={`grid gap-px overflow-visible rounded-[16px] border border-white/[0.06] bg-zinc-800 ${cols}`}>
      {defs.map((x) => <Tile key={x.k} d={x} cur={c} prev={p} days={ds} active={open === x.k} onClick={() => setOpen(open === x.k ? null : x.k)} />)}
    </div>
  );
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400"><Percent className="h-3 w-3" /> Plata real</span>
        {label} · cobrado en Stripe, comisiones {cur.feesSource === "real" ? "reales" : cur.feesSource === "mixed" ? "reales (alguna estimada)" : "estimadas"}, gasto de Meta de estas ofertas · contra el período anterior
      </p>
      {strip(FLOW, "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6")}
      {strip(MORE, "grid-cols-2 lg:grid-cols-4")}
      <div className="ad-card p-5">
        {d ? (
          <MetricChart label={d.label} kind={d.kind} color={d.strong ? "#10b981" : "#8b5cf6"}
            data={ds.map((x, i) => ({ date: days[i].date, val: Math.round(val(x, d.k) * 100) / 100 }))}
            prevData={pds.map((x) => ({ val: Math.round(val(x, d.k) * 100) / 100 }))} />
        ) : <ProfitChart days={days} />}
      </div>
    </div>
  );
}
