"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AUDIT_COLS, type AuditCell, type CellStatus, type OfferAuditRow } from "@/lib/admin/offer-audit-types";
import { Pv } from "./Priv";

/**
 * Inicio › «Diagnóstico de ofertas»: una fila por oferta activa y mercado, con
 * ✓ / ⚠ / ✕ por cada cosa que hace falta para vender (landing, checkout,
 * pixel, eventos, bumps, post-pago, entrega…). Tocar una fila muestra el
 * detalle de cada celda. Se revisa al abrir si lo último tiene más de 15 min,
 * y con «Revisar ahora» cuando se quiera.
 */

type Data = { at: string; rows: OfferAuditRow[] };
const KEY = "ad-offer-audit-v1";
const STALE_MS = 15 * 60_000;

const ICON: Record<CellStatus, string> = { ok: "✓", warn: "!", bad: "✕", off: "–" };
const TONE: Record<CellStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
  off: "bg-zinc-50 text-zinc-400 ring-zinc-200 dark:bg-white/[0.03] dark:text-zinc-500 dark:ring-white/10",
};
const DOT: Record<CellStatus, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", off: "bg-zinc-300 dark:bg-zinc-600" };

function Cell({ c }: { c: AuditCell }) {
  return (
    <span title={c.detail ?? c.label}
      className={`inline-flex max-w-[150px] items-center gap-1 truncate rounded-md px-1.5 py-[2px] text-[11px] font-bold ring-1 ring-inset ${TONE[c.status]}`}>
      <span aria-hidden>{ICON[c.status]}</span><span className="truncate">{c.label}</span>
    </span>
  );
}

const agoText = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? "recién" : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
};

/** Cuánto le falta a una fila: cada ✕ pesa 10 y cada ! pesa 1 (para ordenar de la que más le falta). */
const score = (r: OfferAuditRow) => Object.values(r.cells).reduce((a, c) => a + (c.status === "bad" ? 10 : c.status === "warn" ? 1 : 0), 0);
const CELL_RANK: Record<CellStatus, number> = { bad: 0, warn: 1, ok: 2, off: 3 };
type SortK = "falta" | "offer" | (typeof AUDIT_COLS)[number][0];

/**
 * `active`: las ofertas (offerKey) con alguna campaña activa en Meta hoy. Por defecto se ven solo esas
 * Ordenadas de la que más le falta a la que menos; los títulos ordenan.
 */
export default function OfferAudit({ active }: { active?: string[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);
  // Ancho visible de la tabla: el detalle de una fila se queda en pantalla aunque la tabla se desplace de costado.
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/diagnostico-ofertas", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j); setNow(Date.now());
      try { localStorage.setItem(KEY, JSON.stringify(j)); } catch { /* sin almacenamiento: igual se muestra */ }
    } catch (e) {
      setError((e as Error).message || "No se pudo revisar");
    } finally {
      running.current = false; setBusy(false);
    }
  }, []);

  useEffect(() => {
    let saved: Data | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { saved = null; }
    if (saved?.rows) setData(saved);
    if (!saved?.at || Date.now() - new Date(saved.at).getTime() > STALE_MS) void run();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [run]);

  const [onlyActive, setOnlyActive] = useState(true);
  const [sort, setSort] = useState<{ k: SortK; dir: "asc" | "desc" }>({ k: "falta", dir: "desc" });
  const clickSort = (k: SortK) => setSort((s) => (s.k === k ? { k, dir: s.dir === "desc" ? "asc" : "desc" } : { k, dir: k === "offer" ? "asc" : "desc" }));
  const activeSet = active ? new Set(active) : null;
  const all = data?.rows ?? [];
  const rows = all
    .filter((r) => !onlyActive || !activeSet || activeSet.has(r.offerKey))
    .sort((a, b) => {
      // «desc» en una columna = lo peor primero (✕, después !, después ✓).
      const v = sort.k === "falta" ? score(a) - score(b) : sort.k === "offer" ? b.offer.localeCompare(a.offer) : CELL_RANK[b.cells[sort.k].status] - CELL_RANK[a.cells[sort.k].status];
      return (sort.dir === "desc" ? -v : v) || score(b) - score(a);
    });
  const bad = rows.filter((r) => r.status === "bad").length;
  const warn = rows.filter((r) => r.status === "warn").length;

  return (
    <section className="ad-card mt-4" aria-label="Diagnóstico de ofertas">
      <div className="ad-card-h">
        <div style={{ minWidth: 0 }}>
          <h3>Diagnóstico de ofertas</h3>
          <p>
            {busy && !data ? "Revisando landings, checkouts, pixels, post-pago y entregas…"
              : data ? <>{rows.length} {rows.length === 1 ? "mercado" : "mercados"} · {bad || warn ? <><b className="text-red-600 dark:text-red-400">{bad} para arreglar</b> · <b className="text-amber-600 dark:text-amber-400">{warn} para mirar</b></> : <b className="text-emerald-600 dark:text-emerald-400">todo en orden</b>} · revisado {agoText(data.at, now)}</>
                : "Cada oferta activa, por mercado."}
          </p>
        </div>
        {activeSet && (
          <div role="group" className="inline-flex rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700">
            {([[true, `Con campañas hoy · ${all.filter((r) => activeSet.has(r.offerKey)).length}`], [false, `Todas · ${all.length}`]] as const).map(([v, l]) => (
              <button key={String(v)} type="button" aria-pressed={onlyActive === v} onClick={() => setOnlyActive(v)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${onlyActive === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>{l}</button>
            ))}
          </div>
        )}
        <button type="button" className="ad-btn sm" onClick={run} disabled={busy}>
          {busy ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> Revisando…</> : "Revisar ahora"}
        </button>
      </div>
      {error && <p className="ad-res bad" style={{ padding: "8px 20px" }}>{error}</p>}
      {!!rows.length && (
        <div ref={box} className="ad-scroll" style={{ opacity: busy ? 0.55 : 1 }}>
          <table className="ad-table">
            <thead>
              <tr>
                {([["offer", "Oferta"], ["falta", "Le falta"], ...AUDIT_COLS] as [SortK, string][]).map(([k, label]) => (
                  <th key={k}>
                    <button type="button" onClick={() => clickSort(k)} className={`inline-flex items-center gap-0.5 ${sort.k === k ? "font-bold text-zinc-900 dark:text-white" : ""}`}>
                      {label}{sort.k === k && <span aria-hidden>{sort.dir === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.key}>
                  <tr onClick={() => setOpen(open === r.key ? null : r.key)} style={{ cursor: "pointer" }} aria-expanded={open === r.key}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="flex items-center gap-2">
                        <i className={`block h-2 w-2 shrink-0 rounded-full ${DOT[r.status]}`} aria-hidden />
                        <span className="min-w-0">
                          <b className="block max-w-[200px] truncate text-[12.5px]"><Pv as={r.alias}>{r.offer}</Pv></b>
                          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{r.market}</span>
                        </span>
                      </span>
                    </td>
                    <td className="tabular-nums">{(() => { const n = Object.values(r.cells); const b = n.filter((c) => c.status === "bad").length, w = n.filter((c) => c.status === "warn").length;
                      return b || w ? <span className="text-[11.5px] font-bold">{b ? <span className="text-red-600 dark:text-red-400">{b} ✕</span> : null}{b && w ? " · " : ""}{w ? <span className="text-amber-600 dark:text-amber-400">{w} !</span> : null}</span> : <span className="text-[11.5px] font-bold text-emerald-600 dark:text-emerald-400">nada</span>; })()}</td>
                    {AUDIT_COLS.map(([k]) => <td key={k}><Cell c={r.cells[k]} /></td>)}
                  </tr>
                  {open === r.key && (
                    <tr>
                      <td colSpan={AUDIT_COLS.length + 2} className="bg-zinc-50/70 dark:bg-white/[0.02]">
                        <ul className="m-0 grid list-none gap-1.5 p-0 text-[12px]" style={{ position: "sticky", left: 16, width: w ? Math.max(w - 32, 200) : undefined, whiteSpace: "normal" }}>
                          {AUDIT_COLS.map(([k, label]) => {
                            const c = r.cells[k];
                            return (
                              <li key={k} className="flex min-w-0 gap-2" style={{ whiteSpace: "normal" }}>
                                <span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden />
                                <span className="min-w-0"><b>{label}:</b> {c.label}{c.detail ? <span className="text-zinc-500 dark:text-zinc-400"> — {c.detail}</span> : null}</span>
                              </li>
                            );
                          })}
                          <li className="flex flex-wrap gap-3 pt-1">
                            <Link className="ad-link-a font-bold" href={`/admin/o/${r.key}`}>Abrir la oferta →</Link>
                            <Link className="ad-link-a font-bold" href={`/admin/o/${r.key}/post-compra`}>Post-pago →</Link>
                            {r.landingUrl && <a className="ad-link-a font-bold" href={r.landingUrl} target="_blank" rel="noreferrer">Landing ↗</a>}
                            <a className="ad-link-a font-bold" href={r.checkoutUrl} target="_blank" rel="noreferrer">Checkout ↗</a>
                          </li>
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!rows.length && !busy && data && <p className="ad-note" style={{ padding: "12px 20px" }}>No hay ofertas activas.</p>}
    </section>
  );
}
