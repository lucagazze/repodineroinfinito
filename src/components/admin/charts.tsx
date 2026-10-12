import { Pv } from "./Priv";
import { MetricChart, SpendVsRevenueChart, type ChartKind } from "./CarChart";

/**
 * Gráficos del panel. Los de evolución y gasto contra cobrado son los de
 * CarChart (Recharts); los demás, SVG/HTML dibujado en el servidor.
 */

type Point = { label: string; value: number; prev?: number };

/**
 * La evolución de una métrica: CarChart › MetricChart.
 * `kind` dice cómo se escriben los números (las funciones no pasan del
 * servidor al navegador); `format` queda por compatibilidad y no se usa.
 */
export function AreaChart({
  points, kind = "money", label = "facturación", height = 220,
}: { points: Point[]; format?: (n: number) => string; kind?: ChartKind; label?: string; height?: number }) {
  const hasPrev = points.some((p) => p.prev);
  return (
    <MetricChart label={label} kind={kind} height={height} title="legend"
      data={points.map((p) => ({ date: p.label, val: Math.round(p.value * 100) / 100 }))}
      prevData={hasPrev ? points.map((p) => ({ val: Math.round((p.prev ?? 0) * 100) / 100 })) : []} />
  );
}

export function BarList({
  rows, format, empty = "Sin datos en este período",
}: { rows: { label: string; value: number; sub?: string; alias?: string }[]; format: (n: number) => string; empty?: string }) {
  if (!rows.length) return <p style={{ margin: 0, color: "#9a9aa5", fontSize: 13 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="ad-bars">
      {rows.map((r) => (
        <div key={r.label} className="ad-bar">
          <span>{r.alias ? <Pv as={r.alias}>{r.label}</Pv> : r.label}{r.sub && <span style={{ color: "#9a9aa5" }}> · {r.sub}</span>}</span>
          <b>{format(r.value)}</b>
          <div><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function FunnelSteps({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <div className="ad-funnel">
      {steps.map((s, i) => {
        const pct = (s.value / top) * 100;
        const fromPrev = i > 0 && steps[i - 1].value ? (s.value / steps[i - 1].value) * 100 : null;
        return (
          <div key={s.label} className="ad-step">
            <span>{s.label}</span>
            <div className="track"><i style={{ width: `${Math.max(pct, 4)}%` }}>{s.value}</i></div>
            <span className="pct">{i === 0 ? "100%" : `${pct.toFixed(1)}%`}{fromPrev != null && <small style={{ display: "block", fontSize: 11 }}>{fromPrev.toFixed(0)}% del paso anterior</small>}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Ventas por hora del Inicio. Las líneas van en un SVG estirado (con trazo que
 * no se deforma) y las etiquetas y las rayitas en HTML: así se lee igual en
 * un celular de 390 px que en una pantalla grande.
 */
export function HourlyChart({ hours, ticks, nowHour }: { hours: number[]; ticks: number[]; nowHour: number | null }) {
  const max = Math.max(1, ...hours);
  const last = nowHour == null ? 23 : Math.min(23, Math.floor(nowHour));
  const pts = hours.slice(0, last + 1).map((v, h) => [((h + 0.5) / 24) * 100, 100 - (v / max) * 92] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(2)},100 L${pts[0][0].toFixed(2)},100 Z` : "";
  return (
    <div style={{ paddingLeft: 22 }}>
      <div style={{ position: "relative", height: 150, borderLeft: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <span style={{ position: "absolute", left: -2, top: -2, transform: "translateX(-100%)", paddingRight: 6, fontSize: 11, color: "#9a9aa5" }}>{max}</span>
        <span style={{ position: "absolute", left: -2, bottom: -6, transform: "translateX(-100%)", paddingRight: 6, fontSize: 11, color: "#9a9aa5" }}>0</span>
        <div style={{ position: "absolute", inset: "8% 0 auto", borderTop: "1px dashed var(--line)" }} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: "block", overflow: "visible" }} aria-hidden="true">
          <defs>
            <linearGradient id="adHour" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--chart)" }} stopOpacity=".2" />
              <stop offset="1" style={{ stopColor: "var(--chart)" }} stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#adHour)" />}
          {line && <path d={line} fill="none" style={{ stroke: "var(--chart)" }} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {nowHour != null && <line x1={(nowHour / 24) * 100} x2={(nowHour / 24) * 100} y1="0" y2="100" style={{ stroke: "var(--chart)" }} strokeOpacity=".4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hours.map((v, h) => v > 0 && (
          <span key={h} title={`${String(h).padStart(2, "0")} h: ${v} ${v === 1 ? "venta" : "ventas"}`}
            style={{ position: "absolute", left: `calc(${((h + 0.5) / 24) * 100}% - 4px)`, top: `calc(${100 - (v / max) * 92}% - 4px)`, width: 8, height: 8, borderRadius: 4, background: "var(--chart)", boxShadow: "0 0 0 2px var(--panel)" }} />
        ))}
      </div>
      <div style={{ position: "relative", height: 14, margin: "10px 0 0", background: "var(--fill)", borderRadius: 7 }} aria-label={`${ticks.length} ventas`}>
        {ticks.map((t, i) => (
          <i key={i} style={{ position: "absolute", left: `calc(${(t / 24) * 100}% - 1px)`, top: 2, bottom: 2, width: 2, borderRadius: 1, background: "var(--chart)" }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", marginTop: 6, fontSize: 11, color: "#9a9aa5" }}>
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h}>{String(h).padStart(2, "0")} h</span>)}
      </div>
    </div>
  );
}

/** Gasto en Meta contra lo que cobramos. `date` en AAAA-MM-DD o etiqueta. */
export function SpendRevenueChart({ days }: { days: { label?: string; date?: string; spend: number; revenue: number }[]; format?: (n: number) => string }) {
  return <SpendVsRevenueChart data={days.map((d) => ({ date: d.date ?? d.label ?? "", spend: Math.round(d.spend * 100) / 100, revenue: Math.round(d.revenue * 100) / 100 }))} />;
}
