"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Los gráficos del panel,
 * portados tal cual: línea gruesa con puntos blancos, grilla punteada solo
 * horizontal, ejes sin líneas en gris #9ca3af, promedio actual (ámbar) y del
 * período anterior (gris) punteados, máximo en índigo, y la tarjeta de vidrio
 * al pasar el mouse. Recharts.
 */

const GREEN = "#10b981";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const ORANGE = "#f97316";

export type ChartKind = "money" | "count" | "percent" | "roas";

const fmtVal = (v: number, kind: ChartKind) => {
  if (v === null || v === undefined || isNaN(v)) return "0";
  if (kind === "percent") return `${v.toFixed(2)}%`;
  if (kind === "money") return `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`;
  if (kind === "roas") return v.toFixed(1);
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return v.toFixed(v < 10 && v % 1 ? 2 : 0);
};
const fmtTooltip = (v: number, kind: ChartKind) => {
  if (typeof v !== "number") return String(v ?? "—");
  if (kind === "money") return `$ ${v.toLocaleString("es-AR", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
  if (kind === "percent") return `${v.toFixed(2)}%`;
  if (kind === "roas") return v.toFixed(2);
  return v.toLocaleString("es-AR", { maximumFractionDigits: 2 });
};

/** «2026-10-05» → «05/10», como el eje del gráfico. Si viene una etiqueta ya armada, se deja. */
const tick = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split("-").slice(1).reverse().join("/") : d);

function Glass({ title, rows }: { title: string; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="min-w-[150px] rounded-2xl border border-black/[0.06] bg-white/70 p-3.5 shadow-xl backdrop-blur-md dark:border-white/[0.06] dark:bg-zinc-950/80">
      <p className="mb-2.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{r.label}</span>
            </div>
            <span className="text-[12px] font-black text-zinc-900 dark:text-white">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const dot = (color: string, dim: boolean) => {
  const Dot = (p: { cx?: number; cy?: number; value?: number; index?: number }) =>
    (p.value ?? 0) > 0
      ? <circle key={`dot-${p.index}-${p.cx}`} cx={p.cx} cy={p.cy} r={4} fill={color} stroke="#fff" strokeWidth={2} fillOpacity={dim ? 0.1 : 1} strokeOpacity={dim ? 0.1 : 1} />
      : <path key={`empty-${p.index}-${p.cx}`} d="" />;
  Dot.displayName = "Dot";
  return Dot;
};

/**
 * La evolución de una métrica: `data` del período, `prevData` del
 * anterior (mismo largo) para el promedio anterior. `date` en AAAA-MM-DD o
 * una etiqueta lista.
 */
export function MetricChart({ label, data, prevData = [], color, kind = "money", height = 220, title = true }: {
  label: string; data: { date: string; val: number }[]; prevData?: { val: number }[]; color?: string; kind?: ChartKind; height?: number;
  /** true: «Evolución de …» y la leyenda; "legend": solo la leyenda (la tarjeta ya tiene título). */
  title?: boolean | "legend";
}) {
  const [hoveredLine, setHoveredLine] = useState<"curr" | "prev" | null>(null);
  const merged = data.map((d, i) => ({ ...d, prevVal: prevData[i]?.val ?? null }));
  const nonZero = data.map((d) => d.val).filter((v) => v > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  const prevNonZero = prevData.map((d) => d.val).filter((v) => v > 0);
  const prevAvg = prevNonZero.length ? prevNonZero.reduce((a, b) => a + b, 0) / prevNonZero.length : 0;
  const maxVal = Math.max(...data.map((d) => d.val), 0);
  const minVal = nonZero.length ? Math.min(...nonZero) : 0;
  const yMin = minVal > 0 ? Math.max(0, minVal * 0.75) : 0;
  const trend = prevAvg > 0 ? ((avg - prevAvg) / prevAvg) * 100 : 0;
  const chartColor = color || (trend > 5 ? GREEN : trend < -5 ? RED : BLUE);
  const gradientId = `grad-${label.replace(/\W+/g, "-")}`;

  return (
    <div>
      {title && (
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          {title === true ? <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-white">Evolución de {/^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLowerCase() + label.slice(1) : label}</h3> : <span />}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: chartColor }} />
              <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Actual</span>
            </div>
            {avg > 0 && (
              <div className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap transition-all ${hoveredLine === "curr" ? "scale-110" : hoveredLine === "prev" ? "opacity-30" : ""}`}
                onMouseEnter={() => setHoveredLine("curr")} onMouseLeave={() => setHoveredLine(null)}>
                <div className="h-0.5 w-3 flex-shrink-0 bg-amber-500" />
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-500">Med. Act: {fmtVal(avg, kind)}</span>
              </div>
            )}
            {prevAvg > 0 && (
              <div className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap transition-all ${hoveredLine === "prev" ? "scale-110" : hoveredLine === "curr" ? "opacity-30" : ""}`}
                onMouseEnter={() => setHoveredLine("prev")} onMouseLeave={() => setHoveredLine(null)}>
                <div className="h-0.5 w-3 flex-shrink-0 bg-slate-400" />
                <span className="text-[11px] font-bold text-slate-500">Med. Ant: {fmtVal(prevAvg, kind)}</span>
              </div>
            )}
            {maxVal > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap border-l border-zinc-100 pl-2 dark:border-zinc-800">
                <span className="text-[11px] font-semibold text-zinc-400">Máx:</span>
                <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200">{fmtVal(maxVal, kind)}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={merged} margin={{ left: -30, right: 8, top: 12, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor} stopOpacity={0.15} />
                <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-zinc-100 dark:text-zinc-800" />
            <XAxis dataKey="date" tickFormatter={tick} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[yMin, maxVal > 0 ? maxVal * 1.1 : "auto"]}
              ticks={maxVal > 0 ? Array.from(new Set([Math.round(avg), Math.round(prevAvg), Math.round(maxVal)])).filter((v) => v > 0).sort((a, b) => a - b) : undefined}
              tickFormatter={(v) => fmtVal(v, kind)} tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={35} />
            <Tooltip cursor={{ stroke: "#9ca3af", strokeWidth: 1, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const curr = payload.find((p) => p.dataKey === "val");
                if (!curr) return null;
                const row = curr.payload as { date: string; prevVal: number | null };
                return <Glass title={tick(row.date)} rows={[
                  { color: chartColor, label: "Valor", value: fmtTooltip(Number(curr.value), kind) },
                  ...(row.prevVal != null && prevData.length ? [{ color: "#94a3b8", label: "Anterior", value: fmtTooltip(row.prevVal, kind) }] : []),
                ]} />;
              }} />
            {avg > 0 && (
              <ReferenceLine y={avg} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={hoveredLine === "curr" ? 1 : hoveredLine === "prev" ? 0.1 : 0.8}
                strokeWidth={hoveredLine === "curr" ? 4 : 2} className="transition-all duration-300" />
            )}
            {prevAvg > 0 && (
              <ReferenceLine y={prevAvg} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={hoveredLine === "prev" ? 1 : hoveredLine === "curr" ? 0.1 : 0.6}
                strokeWidth={hoveredLine === "prev" ? 4 : 2} className="transition-all duration-300" />
            )}
            {maxVal > 0 && (
              <ReferenceLine y={maxVal} stroke="#6366f1" strokeOpacity={hoveredLine ? 0.2 : 0.5} strokeWidth={2} strokeDasharray="4 4"
                label={{ value: `Máx. ${fmtVal(maxVal, kind)}`, position: "insideTopRight", fontSize: 11, fontWeight: 600, fill: "#6366f1", opacity: hoveredLine ? 0.2 : 1 }} />
            )}
            <Area type="monotone" dataKey="val" stroke={chartColor} strokeWidth={hoveredLine ? 1 : 3} strokeOpacity={hoveredLine ? 0.1 : 1}
              fillOpacity={0} fill="none" dot={dot(chartColor, !!hoveredLine)} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Gasto en Meta contra lo que cobramos: dos
 * líneas (facturado en verde, gasto en naranja) y el ROAS del día en la tarjeta.
 */
export function SpendVsRevenueChart({ data, height = 240 }: { data: { date: string; spend: number; revenue: number }[]; height?: number }) {
  const [hover, setHover] = useState<"revenue" | "spend" | null>(null);
  const maxVal = Math.max(0, ...data.flatMap((d) => [d.spend, d.revenue]));
  const totalS = data.reduce((a, d) => a + d.spend, 0);
  const totalR = data.reduce((a, d) => a + d.revenue, 0);
  const avgS = data.length ? totalS / data.length : 0;
  const line = (key: "revenue" | "spend", color: string) => (
    <Area type="monotone" dataKey={key} stroke={color} strokeWidth={hover && hover !== key ? 1 : 3} strokeOpacity={hover && hover !== key ? 0.15 : 1}
      fillOpacity={1} fill={`url(#sv-${key})`} dot={dot(color, !!hover && hover !== key)} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
  );
  const chip = (key: "revenue" | "spend", color: string, label: string, total: number) => (
    <div className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap transition-all ${hover === key ? "scale-110" : hover ? "opacity-30" : ""}`}
      onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
      <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200">{fmtVal(total, "money")}</span>
    </div>
  );
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {chip("revenue", GREEN, "Cobrado", totalR)}
        {chip("spend", ORANGE, "Gasto en Meta", totalS)}
        {totalS > 0 && (
          <div className="flex items-center gap-1.5 whitespace-nowrap border-l border-zinc-100 pl-2 dark:border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400">ROAS:</span>
            <span className={`text-[11px] font-bold ${totalR / totalS >= 2 ? "text-emerald-600" : totalR / totalS >= 1 ? "text-amber-600" : "text-red-600"}`}>{(totalR / totalS).toFixed(2)}x</span>
          </div>
        )}
      </div>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -30, right: 8, top: 12, bottom: 0 }}>
            <defs>
              <linearGradient id="sv-revenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={GREEN} stopOpacity={0.15} /><stop offset="95%" stopColor={GREEN} stopOpacity={0} /></linearGradient>
              <linearGradient id="sv-spend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ORANGE} stopOpacity={0.12} /><stop offset="95%" stopColor={ORANGE} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-zinc-100 dark:text-zinc-800" />
            <XAxis dataKey="date" tickFormatter={tick} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, maxVal > 0 ? maxVal * 1.1 : "auto"]} tickFormatter={(v) => fmtVal(v, "money")} tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip cursor={{ stroke: "#9ca3af", strokeWidth: 1, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as { date: string; spend: number; revenue: number };
                return <Glass title={tick(row.date)} rows={[
                  { color: GREEN, label: "Cobrado", value: fmtTooltip(row.revenue, "money") },
                  { color: ORANGE, label: "Gasto", value: fmtTooltip(row.spend, "money") },
                  { color: "#6366f1", label: "ROAS", value: row.spend ? `${(row.revenue / row.spend).toFixed(2)}x` : "—" },
                ]} />;
              }} />
            {avgS > 0 && <ReferenceLine y={avgS} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} strokeWidth={2} />}
            {line("spend", ORANGE)}
            {line("revenue", GREEN)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
