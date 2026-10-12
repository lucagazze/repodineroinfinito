/**
 * Esqueletos para los loading.tsx y los <Suspense> del panel. Con ellos el
 * clic responde al instante: el menú queda y aparece la forma de la página
 * mientras llegan los datos.
 *
 *  Sk            { w?, h?, r?, style? }        un bloque gris animado
 *  SkPage        { variant: list|cards|form|inicio|detail, title? }   página entera dentro del menú
 *  SkCard        { rows?, h? }                 una tarjeta con renglones
 *  SkShell       { children }                  menú lateral + contenido (para /admin/loading.tsx)
 */

import type { CSSProperties, ReactNode } from "react";

export function Sk({ w = "100%", h = 14, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

function Head({ actions = true }: { actions?: boolean }) {
  return (
    <div className="ad-head" aria-busy="true" aria-label="Cargando">
      <div style={{ display: "grid", gap: 10 }}>
        <Sk w={190} h={30} r={10} />
        <Sk w={280} h={14} />
      </div>
      {actions && <Sk w={150} h={40} r={10} />}
    </div>
  );
}

export function SkCard({ rows = 3, h, title = true }: { rows?: number; h?: number; title?: boolean }) {
  return (
    <div className="ad-card" style={{ padding: 22, display: "grid", gap: 14, minHeight: h }}>
      {title && <Sk w="40%" h={18} />}
      {Array.from({ length: rows }, (_, i) => <Sk key={i} w={i % 3 === 2 ? "70%" : "100%"} h={i === 0 && !title ? 44 : 14} />)}
    </div>
  );
}

function SkTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="ad-card" style={{ overflow: "hidden" }}>
      <div className="bg-zinc-50/60 dark:bg-white/[0.015]" style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)", display: "flex", gap: 24 }}>
        <Sk w={120} h={11} /><Sk w={80} h={11} /><Sk w={60} h={11} style={{ marginLeft: "auto" }} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ padding: "15px 18px", borderBottom: i < rows - 1 ? "1px solid var(--line2)" : 0, display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ flex: 1, display: "grid", gap: 7 }}><Sk w="45%" h={13} /><Sk w="30%" h={11} /></div>
          <Sk w={70} h={13} /><Sk w={64} h={22} r={11} />
        </div>
      ))}
    </div>
  );
}

export function SkInicio() {
  return (
    <>
      <div className="ad-hero">
        <div className="ad-card" style={{ padding: 22, display: "grid", gap: 14 }}>
          <Sk w="45%" h={14} /><Sk w="60%" h={52} r={12} />
          <div className="ad-split"><div style={{ display: "grid", gap: 8 }}><Sk w="50%" h={12} /><Sk w="70%" h={22} /></div><div style={{ display: "grid", gap: 8 }}><Sk w="50%" h={12} /><Sk w="70%" h={22} /></div></div>
        </div>
        <div className="ad-card" style={{ padding: 22, display: "grid", gap: 14 }}><Sk w="35%" h={16} /><Sk h={150} r={10} /><Sk h={14} /></div>
      </div>
      <div className="ad-sec"><Sk w={140} h={18} /></div>
      <SkKpis />
      <div className="mt2"><SkCard rows={2} h={150} /></div>
    </>
  );
}

function SkKpis({ n = 4 }: { n?: number }) {
  return (
    <div className="ad-grid g-kpi">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="ad-card" style={{ padding: 20, display: "grid", gap: 10 }}><Sk w="50%" h={12} /><Sk w="65%" h={28} /></div>
      ))}
    </div>
  );
}

export function SkPage({ variant = "list" }: { variant?: "list" | "cards" | "form" | "inicio" | "detail" }) {
  return (
    <div>
      <Head actions={variant !== "form"} />
      {variant === "inicio" && <SkInicio />}
      {variant === "list" && (
        <>
          <div className="ad-card" style={{ padding: 12, display: "flex", gap: 8, marginBottom: 16 }}><Sk h={44} r={12} /><Sk w={110} h={44} r={10} /></div>
          <SkTable />
        </>
      )}
      {variant === "cards" && (
        <>
          <SkKpis />
          <div className="ad-grid g-2 mt"><SkCard rows={6} h={260} /><SkCard rows={6} h={260} /></div>
        </>
      )}
      {variant === "form" && <div className="ad-grid"><SkCard rows={5} /><SkCard rows={4} /></div>}
      {variant === "detail" && <div className="ad-grid g-21"><SkCard rows={8} /><SkCard rows={5} /></div>}
    </div>
  );
}

export function SkShell({ children }: { children: ReactNode }) {
  return (
    <div className="ad">
      <aside className="ad-side" aria-hidden="true">
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "2px 6px 18px" }}><Sk w={30} h={30} r={9} /><div style={{ display: "grid", gap: 6, flex: 1 }}><Sk w="70%" h={16} /><Sk w="50%" h={10} /></div></div>
        <Sk h={48} r={12} style={{ marginBottom: 16 }} />
        <div style={{ display: "grid", gap: 14, padding: "0 8px" }}>{Array.from({ length: 11 }, (_, i) => <Sk key={i} w={`${55 + ((i * 17) % 35)}%`} h={14} />)}</div>
      </aside>
      <div className="ad-body"><main className="ad-main">{children}</main></div>
    </div>
  );
}
