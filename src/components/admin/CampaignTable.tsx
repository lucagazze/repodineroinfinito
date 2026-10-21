"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Image as ImageIcon, Pencil, Search, X } from "lucide-react";
import type { Level, Perf, PerfNode, Totals } from "@/lib/admin/meta-perf";
import { freshness } from "@/lib/admin/meta-fresh";
import { PLATFORM_LABEL } from "@/lib/admin/platforms-shared";
import { Pv } from "./Priv";

/**
 * Campañas → conjuntos → anuncios, simple: una fila por
 * campaña, un número por celda, solo el período del filtro. Gasto, ROAS,
 * Beneficio, Ventas, Valor, CPA y CTR. Con «Meta Ads» las ventas y el valor son los que
 * informa Meta; con «Real (Stripe)», lo que cobramos atribuido a cada campaña.
 * Arriba: buscar por nombre y Activas · Pausadas · Todas. Los títulos ordenan
 * (por defecto ROAS, de mayor a menor; se recuerda). Tocando una campaña se
 * ven sus conjuntos y anuncios con las mismas columnas. El interruptor de cada
 * fila prende o apaga esa campaña, conjunto o anuncio en Meta (StatusSwitch).
 *
 * En el celular (< 768 px) cada fila es una tarjeta: el nombre ENTERO arriba
 * (sin cortar) con su estado y la flecha para abrir, y abajo los números en
 * dos renglones chicos (Gasto · ROAS · Beneficio y Ventas · Valor · CPA · CTR).
 * El orden se elige con «Ordenar por».
 */

type Col = "spend" | "roas" | "profit" | "sales" | "value" | "cpa" | "ctr";
type Sort = { k: Col; dir: "asc" | "desc" } | null;
type StatusFilter = "activas" | "pausadas" | "todas";
type Source = "meta" | "real";

// ROAS y beneficio al lado del gasto: en el celular se ven sin deslizar.
const COLS: [Col, string][] = [["spend", "Gasto"], ["roas", "ROAS"], ["profit", "Beneficio"], ["sales", "Ventas"], ["value", "Valor"], ["cpa", "CPA"], ["ctr", "CTR"]];

function val(t: Totals, k: Col, src: Source): number | null {
  const sales = src === "meta" ? t.metaPurchases : t.orders;
  const value = src === "meta" ? t.metaValue : t.revenue;
  switch (k) {
    case "spend": return t.spend;
    case "sales": return sales;
    case "value": return value;
    case "roas": return t.spend ? value / t.spend : null;
    // Beneficio bruto: lo que generó menos lo gastado (con Stripe, también menos sus comisiones). Puede ser negativo.
    case "profit": return t.spend || value ? value - t.spend - (src === "real" ? t.fees : 0) : null;
    case "cpa": return sales ? t.spend / sales : null;
    case "ctr": return t.impressions ? t.clicks / t.impressions : null;
  }
}
const money = (n: number) => {
  const a = Math.abs(n);
  return `${n < 0 ? "−" : ""}$${a.toLocaleString("es-AR", { minimumFractionDigits: a < 100 ? 2 : 0, maximumFractionDigits: a < 100 ? 2 : 0 })}`;
};
function fmt(k: Col, v: number | null) {
  if (v == null) return "—";
  switch (k) {
    case "roas": return v.toFixed(2);
    case "ctr": return `${(v * 100).toFixed(2)}%`;
    case "sales": return v % 1 ? v.toFixed(1) : v.toLocaleString("es-AR");
    default: return money(v);
  }
}
/** Solo el ROAS lleva color: verde desde 1,5, ámbar entre 1 y 1,5, rojo abajo de 1. */
const roasTone = (v: number | null) => v == null ? "text-zinc-300 dark:text-zinc-600"
  : v >= 1.5 ? "text-emerald-600 dark:text-emerald-400" : v >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
/** El beneficio: verde si se ganó, rojo si se perdió, gris en cero. */
const profitTone = (v: number | null) => v == null || Math.abs(v) < 0.005 ? "text-zinc-300 dark:text-zinc-600"
  : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
const LEVEL_NAME: Record<Level, string> = { campaign: "Campaña", adset: "Conjunto", ad: "Anuncio" };

/**
 * Nombres para el modo captura: «Campaña 01», «Conjunto 03», «Anuncio 12». Únicos y
 * estables: numerados por id dentro de cada nivel (no cambian al ordenar ni filtrar).
 * Antes se usaban los últimos 4 dígitos del id, que en Meta se repiten («0114» en todas).
 */
function aliasesOf(nodes: PerfNode[]) {
  const ids: Record<Level, Set<string>> = { campaign: new Set(), adset: new Set(), ad: new Set() };
  const walk = (l: PerfNode[]) => { for (const n of l) { ids[n.level].add(n.id); walk(n.children); } };
  walk(nodes);
  const out = new Map<string, string>();
  for (const level of Object.keys(ids) as Level[]) {
    const list = [...ids[level]].sort();
    const w = Math.max(2, String(list.length).length);
    list.forEach((id, i) => out.set(`${level}:${id}`, `${LEVEL_NAME[level]} ${String(i + 1).padStart(w, "0")}`));
  }
  return out;
}

const ACTIVE = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO"]);
const PAUSED = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]);
const statusOk = (f: StatusFilter, s: string) => f === "todas" || (f === "activas" ? ACTIVE.has(s) : PAUSED.has(s));
const DOT = (s: string) => ACTIVE.has(s) ? (s === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500") : PAUSED.has(s) ? "bg-zinc-300 dark:bg-zinc-600" : "bg-zinc-200 dark:bg-zinc-700";
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa", PAUSED: "Pausada", CAMPAIGN_PAUSED: "Pausada (campaña)", ADSET_PAUSED: "Pausada (conjunto)", IN_PROCESS: "En revisión",
  PENDING_REVIEW: "En revisión", PREAPPROVED: "En revisión", WITH_ISSUES: "Con problemas", PENDING_BILLING_INFO: "Falta el pago", ARCHIVED: "Archivada", DELETED: "Borrada",
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * El interruptor de cada fila:
 * prende o apaga la campaña, el conjunto o el anuncio en Meta, con confirmación. Lo que
 * está apagado por su campaña o su conjunto se ve apagado y no se toca desde la fila.
 * Archivadas y borradas siguen con el punto de estado.
 */
function StatusSwitch({ n, status, busy, onToggle }: { n: PerfNode; status: string; busy: boolean; onToggle: (on: boolean) => void }) {
  const byParent = status === "CAMPAIGN_PAUSED" || status === "ADSET_PAUSED";
  if (!ACTIVE.has(status) && status !== "PAUSED" && !byParent) {
    return <i title={STATUS_LABEL[status] ?? status} className={`h-2 w-2 shrink-0 rounded-full ${DOT(status)}`} />;
  }
  const on = ACTIVE.has(status);
  const title = byParent ? `${STATUS_LABEL[status]}: se prende desde ${status === "CAMPAIGN_PAUSED" ? "la campaña" : "el conjunto"}`
    : `${STATUS_LABEL[status] ?? status} · tocá para ${on ? "apagar" : "prender"}`;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "Apagar" : "Prender"} ${LEVEL_NAME[n.level].toLowerCase()}`} title={title}
      disabled={busy || byParent}
      onClick={(e) => { e.stopPropagation(); onToggle(!on); }}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:cursor-default ${busy ? "opacity-50" : byParent ? "opacity-40" : ""} ${on ? (status === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500") : "bg-zinc-300 dark:bg-zinc-600"}`}>
      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[14px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

/** Presupuesto diario o puja que se puede cambiar desde la fila (en la moneda de la cuenta). */
type Edit = { level: "campaign" | "adset"; id: string; field: "daily_budget" | "bid_amount"; value: number; note?: string; many?: number };
type Fixed = { text: string; note: string };

/**
 * El presupuesto o la puja de una fila: se toca el número, se escribe el nuevo y se confirma; va a Meta al instante.
 */
function MoneyEdit({ e, show, onSave }: { e: Edit | Fixed | null; show: (n: number) => string; onSave: (e: Edit, v: number) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState("");
  if (!e) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  if ("text" in e) return <span title={e.note} className="font-semibold text-zinc-500 dark:text-zinc-400">{e.text}</span>;
  const save = async () => {
    const n = Number(v.replace(",", "."));
    if (!(n > 0)) return;
    if (Math.abs(n - e.value) < 0.005) { setEditing(false); return; }
    setBusy(true);
    const ok = await onSave(e, Math.round(n * 100) / 100);
    setBusy(false);
    if (ok) setEditing(false);
  };
  if (editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1" onClick={(x) => x.stopPropagation()}>
        <input autoFocus type="number" inputMode="decimal" step="0.01" min="0.01" value={v} disabled={busy} aria-label="Nuevo valor"
          onChange={(x) => setV(x.target.value)} onKeyDown={(k) => { if (k.key === "Enter") save(); if (k.key === "Escape") setEditing(false); }}
          className="h-7 w-[68px] rounded-md border border-violet-400 bg-white px-1.5 text-right text-[12px] font-bold tabular-nums text-zinc-900 outline-none dark:bg-zinc-900 dark:text-white" />
        <button type="button" onClick={save} disabled={busy} aria-label="Guardar" className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-600 text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancelar" className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"><X className="h-3.5 w-3.5" /></button>
      </span>
    );
  }
  return (
    <button type="button" title={`${e.note ? `${e.note} · ` : ""}Tocá para cambiarlo en Meta`}
      onClick={(x) => { x.stopPropagation(); setV(e.value.toFixed(2)); setEditing(true); }}
      className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold tabular-nums text-zinc-900 hover:bg-violet-500/10 dark:text-white">
      {show(e.value)}{e.many && e.many > 1 ? <span className="text-[10.5px] font-semibold text-zinc-400">×{e.many}</span> : null}
      <Pencil className="h-3 w-3 text-zinc-400 group-hover:text-violet-500" aria-hidden />
    </button>
  );
}

/**
 * Lo que coincide con el estado y la búsqueda, o tiene adentro algo que sí; en «reveal», lo que hay que abrir.
 * Adentro de una campaña o conjunto que pasa el filtro se ven TODOS sus conjuntos y anuncios, también
 * los pausados.
 */
function filterTree(list: PerfNode[], f: StatusFilter, q: string, parentHit: boolean, reveal: Set<string>): PerfNode[] {
  return list.flatMap((n) => {
    const hit = !q || parentHit || norm(n.name).includes(q) || n.id.includes(q);
    const ok = hit && statusOk(f, n.status);
    const children = filterTree(n.children, ok ? "todas" : f, q, !!q && hit, reveal);
    if (ok) return [{ ...n, children }];
    if (children.length) {
      if (q) reveal.add(`${n.level}:${n.id}`);
      return [{ ...n, children }];
    }
    return [];
  });
}

const LS = (k: string) => `ad-campaigns:${k}`;
const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, metaPurchases: 0, metaValue: 0, orders: 0, revenue: 0, fees: 0 });

export default function CampaignTable({ perf, pageKey, source = "meta" }: { perf: Perf; pageKey: string; currency?: string; source?: Source }) {
  const [sort, setSort] = useState<Sort>(null);
  const [status, setStatus] = useState<StatusFilter>("activas");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<string | null>(null);
  // Lo que se prendió o apagó desde acá: se ve al instante y la fila no desaparece del filtro
  // (los datos de Meta se ponen al día con la sincronización).
  const [over, setOver] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const statusOf = (n: PerfNode) => over[`${n.level}:${n.id}`] ?? n.status;
  const setStatusOf = async (n: PerfNode, on: boolean) => {
    const key = `${n.level}:${n.id}`;
    if (!window.confirm(`¿${on ? "Prender" : "Apagar"} ${LEVEL_NAME[n.level].toLowerCase()} «${n.name}» en Meta?`)) return;
    setBusy((b) => new Set(b).add(key));
    try {
      const r = await fetch("/api/admin/meta/estado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: n.level, id: n.id, on }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setOver((o) => ({ ...o, [key]: j.effective ?? (on ? "ACTIVE" : "PAUSED") }));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => { const s = new Set(b); s.delete(key); return s; });
    }
  };
  const sw = (n: PerfNode) => {
    const key = `${n.level}:${n.id}`;
    return <StatusSwitch n={n} status={statusOf(n)} busy={busy.has(key)} onToggle={(on) => setStatusOf(n, on)} />;
  };

  // Presupuesto y puja: lo cambiado desde acá se ve al instante (Meta se relee en la sincronización).
  const [edits, setEdits] = useState<Record<string, number>>({});
  const ed = (level: string, id: string, field: Edit["field"]) => edits[`${level}:${id}:${field}`];
  const acctCur = perf.account.currency || "USD";
  const show = (v: number) => acctCur === "USD" ? money(v) : new Intl.NumberFormat("es-AR", { style: "currency", currency: acctCur }).format(v);
  /** El presupuesto diario de la fila: el suyo, o el de su único conjunto (campañas sin CBO). */
  const budgetOf = (n: PerfNode): Edit | Fixed | null => {
    if (n.level === "ad") return null;
    if (n.budget?.daily) return { level: n.level, id: n.id, field: "daily_budget", value: ed(n.level, n.id, "daily_budget") ?? n.budget.daily, note: "Presupuesto diario" };
    if (n.budget?.lifetime) return { text: `${show(n.budget.lifetime)} total`, note: "Presupuesto total: se cambia en Meta" };
    const c = n.level === "campaign" && n.children.length === 1 ? n.children[0] : null;
    if (c?.budget?.daily) return { level: "adset", id: c.id, field: "daily_budget", value: ed("adset", c.id, "daily_budget") ?? c.budget.daily, note: "Presupuesto diario del conjunto" };
    return null;
  };
  /** La puja: la del conjunto; en la campaña, la de sus conjuntos si es una sola (se cambia en todos). */
  const bidOf = (n: PerfNode): Edit | Fixed | null => {
    if (n.level === "adset") return n.bid ? { level: "adset", id: n.id, field: "bid_amount", value: ed("adset", n.id, "bid_amount") ?? n.bid, note: "Límite de puja" } : null;
    if (n.level !== "campaign") return null;
    const sets = n.children.filter((c) => c.bid && (ACTIVE.has(c.status) || PAUSED.has(c.status)));
    if (!sets.length) return null;
    const vals = [...new Set(sets.map((c) => ed("adset", c.id, "bid_amount") ?? c.bid!))];
    if (vals.length > 1) return { text: "Varias", note: "Cada conjunto tiene su puja: abrí la campaña para cambiarlas" };
    return { level: "campaign", id: n.id, field: "bid_amount", value: vals[0], many: sets.length, note: sets.length > 1 ? `Límite de puja de sus ${sets.length} conjuntos` : "Límite de puja del conjunto" };
  };
  const saveEdit = async (n: PerfNode, e: Edit, value: number) => {
    const what = e.field === "daily_budget" ? "el presupuesto diario" : e.many && e.many > 1 ? `la puja de sus ${e.many} conjuntos` : "la puja";
    const jump = value > e.value * 2 || value < e.value / 2 ? "\n\nOjo: es más del doble o menos de la mitad." : "";
    if (!window.confirm(`¿Cambiar ${what} de «${n.name}» de ${show(e.value)} a ${show(value)} en Meta?${jump}`)) return false;
    try {
      const r = await fetch("/api/admin/meta/ajuste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: e.level, id: e.id, field: e.field, value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEdits((o) => {
        const next = { ...o, [`${e.level}:${e.id}:${e.field}`]: value };
        if (e.level === "campaign" && e.field === "bid_amount") for (const c of n.children) if (c.bid) next[`adset:${c.id}:bid_amount`] = value;
        return next;
      });
      return true;
    } catch (x) {
      window.alert(x instanceof Error ? x.message : String(x));
      return false;
    }
  };
  const editCells = (n: PerfNode) => [budgetOf(n), bidOf(n)].map((e, i) => (
    <td key={i ? "bid" : "budget"} className="whitespace-nowrap px-2 py-2.5 text-right text-[12px] md:px-3 md:text-[12.5px]">
      <MoneyEdit e={e} show={show} onSave={(x, v) => saveEdit(n, x, v)} />
    </td>
  ));
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS(pageKey)) ?? "{}") as { sort?: Sort; status?: StatusFilter };
      // Lo guardado por la tabla anterior (otras columnas) no sirve: solo un orden de estas columnas.
      if (s.sort && COLS.some(([k]) => k === s.sort!.k)) setSort(s.sort);
      if (s.status) setStatus(s.status);
    } catch { /* sin almacenamiento */ }
  }, [pageKey]);
  const save = (next: { sort?: Sort; status?: StatusFilter }) => {
    try { localStorage.setItem(LS(pageKey), JSON.stringify({ sort, status, ...next })); } catch { /* modo privado */ }
  };
  const q = norm(query.trim());
  const cur = (n: PerfNode) => n.w.periodo.cur;

  const order = useMemo(() => {
    // Por defecto: las que venden por ROAS (de mayor a menor), después las que gastan sin vender (por gasto), al final las sin gasto.
    const byRoas = (a: PerfNode, b: PerfNode) => {
      const g = (n: PerfNode) => { const t = cur(n); const v = val(t, "value", source) ?? 0; return t.spend > 0 && v > 0 ? 0 : t.spend > 0 ? 1 : 2; };
      const ga = g(a), gb = g(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return (val(cur(b), "roas", source) ?? 0) - (val(cur(a), "roas", source) ?? 0);
      if (ga === 1) return cur(b).spend - cur(a).spend;
      return a.name.localeCompare(b.name);
    };
    const cmp = (a: PerfNode, b: PerfNode) => {
      if (!sort) return byRoas(a, b);
      const va = val(cur(a), sort.k, source), vb = val(cur(b), sort.k, source);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.dir === "desc" ? vb - va : va - vb;
    };
    const walk = (list: PerfNode[]): PerfNode[] => list.map((n) => ({ ...n, children: walk(n.children) })).sort(cmp);
    const reveal = new Set<string>();
    return { list: walk(filterTree(perf.nodes, status, q, false, reveal)), reveal };
  }, [perf.nodes, sort, status, q, source]);
  const counts = useMemo(() => ({
    activas: filterTree(perf.nodes, "activas", "", false, new Set()).length,
    pausadas: filterTree(perf.nodes, "pausadas", "", false, new Set()).length,
    todas: perf.nodes.length,
  }), [perf.nodes]);

  const clickSort = (k: Col) => {
    const isDefault = !sort && k === "roas";
    const next: Sort = sort && sort.k === k ? { k, dir: sort.dir === "desc" ? "asc" : "desc" } : isDefault ? { k, dir: "asc" } : { k, dir: "desc" };
    setSort(next); save({ sort: next });
  };
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // «Desplegar todo»: cada campaña y conjunto que tiene algo adentro.
  const parents = useMemo(() => {
    const out: string[] = [];
    const walk = (l: PerfNode[]) => { for (const n of l) if (n.children.length) { out.push(`${n.level}:${n.id}`); walk(n.children); } };
    walk(order.list);
    return out;
  }, [order.list]);
  const allOpen = parents.length > 0 && parents.every((k) => open.has(k));
  /** «3 conjuntos» / «1 anuncio»: lo que hay adentro, para que se note que se despliega. */
  const inside = (n: PerfNode) => {
    const c = n.children.length;
    return `${c} ${n.level === "campaign" ? (c === 1 ? "conjunto" : "conjuntos") : c === 1 ? "anuncio" : "anuncios"}`;
  };
  const total = order.list.reduce<Totals>((a, n) => {
    const t = cur(n);
    return { spend: a.spend + t.spend, impressions: a.impressions + t.impressions, clicks: a.clicks + t.clicks, metaPurchases: a.metaPurchases + t.metaPurchases,
      metaValue: a.metaValue + t.metaValue, orders: a.orders + t.orders, revenue: a.revenue + t.revenue, fees: a.fees + t.fees };
  }, zero());
  const fresh = freshness(perf);
  const alias = useMemo(() => aliasesOf(perf.nodes), [perf.nodes]);

  const cells = (t: Totals, strong: boolean) => COLS.map(([k]) => {
    const v = val(t, k, source);
    return (
      <td key={k} className={`whitespace-nowrap px-2 py-2.5 text-right text-[12px] tabular-nums md:px-3 md:text-[12.5px] ${strong ? "font-black" : "font-bold"} ${k === "roas" ? roasTone(v) : k === "profit" ? profitTone(v) : v == null || v === 0 ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-900 dark:text-white"}`}>
        {fmt(k, v)}
      </td>
    );
  });

  /**
   * Al abrir una campaña: de qué red salió (Instagram, Facebook, Messenger, Audience Network), con
   * el gasto, el ROAS y las compras de cada una según Meta.
   */
  const split = (n: PerfNode) => {
    const ps = n.level === "campaign" ? perf.platforms?.[n.id] : undefined;
    if (!ps?.length) return null;
    const all = ps.reduce((a, p) => a + p.spend, 0) || 1;
    return (
      <span className="flex flex-wrap gap-1.5">
        {ps.map((p) => {
          const r = p.spend ? p.value / p.spend : null;
          return (
            <span key={p.platform} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-100 px-2 py-1 text-[11.5px] tabular-nums text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
              <b className="font-semibold text-zinc-900 dark:text-white">{PLATFORM_LABEL[p.platform]}</b>
              <span>{money(p.spend)} <span className="text-zinc-400">({Math.round((p.spend / all) * 100)} %)</span></span>
              <span className={`font-semibold ${roasTone(r)}`}>{r == null ? "—" : r.toFixed(2)}</span>
              <span>{Math.round(p.purchases)} {Math.round(p.purchases) === 1 ? "compra" : "compras"}</span>
            </span>
          );
        })}
      </span>
    );
  };

  /** Un número del celular: etiqueta chiquita arriba, valor abajo (mismos colores que la tabla). */
  const mini = (t: Totals, k: Col, big: boolean) => {
    const v = val(t, k, source);
    return (
      <span key={k} className="min-w-0">
        <span className="block text-[10.5px] font-medium text-zinc-500">{COLS.find(([c]) => c === k)![1]}</span>
        <span className={`block truncate tabular-nums ${big ? "text-[13.5px] font-semibold" : "text-[12px] font-medium"} ${k === "roas" ? roasTone(v) : k === "profit" ? profitTone(v) : v == null || v === 0 ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-900 dark:text-white"}`}>{fmt(k, v)}</span>
      </span>
    );
  };
  const nums = (t: Totals) => (
    <>
      <span className="grid grid-cols-3 gap-2">{(["spend", "roas", "profit"] as Col[]).map((k) => mini(t, k, true))}</span>
      <span className="mt-1.5 grid grid-cols-4 gap-2">{(["sales", "value", "cpa", "ctr"] as Col[]).map((k) => mini(t, k, false))}</span>
    </>
  );
  const cards = (list: PerfNode[], depth: number): React.ReactNode[] => list.flatMap((n) => {
    const key = `${n.level}:${n.id}`;
    const isOpen = open.has(key) || order.reveal.has(key);
    const kids = n.children.length > 0;
    return [
      <li key={key} className={`relative border-t border-zinc-100 dark:border-white/[0.05] ${depth ? "bg-zinc-50/70 dark:bg-white/[0.02]" : ""}`}>
        {/* El interruptor va afuera del botón de la tarjeta (un botón no puede ir adentro de otro), encima de su lugar. */}
        <span className="absolute z-[1] flex h-4 w-7 items-center" style={{ left: `${16 + depth * 14}px`, top: "13px" }}>{sw(n)}</span>
        <button type="button" onClick={kids ? () => toggle(key) : undefined} aria-expanded={kids ? isOpen : undefined}
          className={`block w-full py-3 pr-4 text-left ${kids ? "active:bg-zinc-50 dark:active:bg-white/[0.03]" : "cursor-default"}`} style={{ paddingLeft: `${16 + depth * 14}px` }}>
          <span className="flex min-w-0 items-start gap-2">
            <span className="h-4 w-7 shrink-0" aria-hidden />
            {n.level === "ad" && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {n.thumb ? <img data-pv-img src={n.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="h-3 w-3 text-zinc-400" />}
              </span>
            )}
            {/* El nombre entero, en los renglones que haga falta. */}
            <span className={`min-w-0 flex-1 break-words text-[13.5px] leading-snug text-zinc-900 dark:text-white ${depth ? "font-medium" : "font-semibold"}`}>
              <Pv as={alias.get(key) ?? LEVEL_NAME[n.level]}>{n.name}</Pv>
            </span>
            {/* A qué oferta pertenece. En una cuenta publicitaria COMPARTIDA con
                otra marca (la de Finance Study Lab es la misma que la de
                Physics Study Lab) una campaña ajena se veía igual que una
                propia: con gasto y cero ventas, porque esta app no puede ver
                las ventas de la otra marca. Sin esta etiqueta se lee como una
                campaña propia que no vende. `links` ya se calculaba y no se
                mostraba en ningún lado. */}
            {n.level === "campaign" && (
              n.links.length
                ? <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{n.links.join(" · ")}</span>
                : <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400" title="Esta campaña no está vinculada a ninguna oferta de esta app: su gasto aparece pero sus ventas no se pueden ver desde acá.">sin oferta vinculada</span>
            )}
            {kids && <span className="mt-0.5 shrink-0 whitespace-nowrap text-[11px] font-medium text-zinc-400">{inside(n)}</span>}
            {kids && <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />}
          </span>
          <span className="mt-2 block">{nums(cur(n))}</span>
        </button>
        {(budgetOf(n) || bidOf(n)) && (
          <span className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 pr-4 text-[12px]" style={{ paddingLeft: `${16 + depth * 14 + 36}px` }}>
            {budgetOf(n) && <span className="inline-flex items-center gap-1"><span className="text-[10.5px] font-medium text-zinc-500">Presupuesto</span><MoneyEdit e={budgetOf(n)} show={show} onSave={(x, v) => saveEdit(n, x, v)} /></span>}
            {bidOf(n) && <span className="inline-flex items-center gap-1"><span className="text-[10.5px] font-medium text-zinc-500">Puja</span><MoneyEdit e={bidOf(n)} show={show} onSave={(x, v) => saveEdit(n, x, v)} /></span>}
          </span>
        )}
      </li>,
      ...(isOpen && split(n) ? [
        <li key={`${key}:red`} className="border-t border-zinc-100 bg-zinc-50/70 py-2.5 pr-4 dark:border-white/[0.05] dark:bg-white/[0.02]" style={{ paddingLeft: `${30 + depth * 14}px` }}>
          <span className="mb-1.5 block text-[10.5px] font-medium text-zinc-500">Por red · según Meta</span>
          {split(n)}
        </li>,
      ] : []),
      ...(isOpen ? cards(n.children, depth + 1) : []),
    ];
  });

  const rows = (list: PerfNode[], depth: number): React.ReactNode[] => list.flatMap((n) => {
    const key = `${n.level}:${n.id}`;
    const isOpen = open.has(key) || order.reveal.has(key);
    const kids = n.children.length > 0;
    return [
      <tr key={key} onClick={kids ? () => toggle(key) : undefined}
        className={`${kids ? "cursor-pointer" : ""} ${depth ? "bg-zinc-50/70 dark:bg-white/[0.02]" : ""} border-t border-zinc-100 hover:bg-zinc-50 dark:border-white/[0.05] dark:hover:bg-white/[0.03]`}>
        <td className={`ct-namecell py-2.5 pr-2 align-middle md:sticky md:left-0 md:z-[1] md:pr-4 ${depth ? "md:bg-zinc-50 md:dark:bg-[#141416]" : "md:bg-white md:dark:bg-[#111113]"}`}
          style={{ "--pl": `${12 + depth * 22}px`, "--plm": `${8 + depth * 10}px` } as React.CSSProperties}>
          <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
            {kids
              ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
              : <span className="w-3.5 shrink-0" />}
            {n.level === "ad" && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {n.thumb ? <img data-pv-img src={n.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="h-3 w-3 text-zinc-400" />}
              </span>
            )}
            {sw(n)}
            <span className={`${full === key ? "ct-name-full" : "ct-name"} min-w-0 text-[12px] leading-snug text-zinc-800 md:text-[12.5px] dark:text-zinc-100 ${depth ? "font-medium" : "font-semibold"}`}
              title={n.name} onClick={(e) => { if (window.matchMedia("(max-width: 767px)").matches) { e.stopPropagation(); setFull((f) => (f === key ? null : key)); } }}>
              <Pv as={alias.get(key) ?? LEVEL_NAME[n.level]}>{n.name}</Pv>
            </span>
            {kids && <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-px text-[10.5px] font-semibold text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">{inside(n)}</span>}
          </div>
        </td>
        {editCells(n)}
        {cells(cur(n), false)}
      </tr>,
      ...(isOpen && split(n) ? [
        <tr key={`${key}:red`} className="border-t border-zinc-100 bg-zinc-50/70 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <td colSpan={3 + COLS.length} className="py-2 pr-3" style={{ paddingLeft: `${40 + depth * 22}px` }}>
            <span className="flex flex-wrap items-center gap-2"><span className="text-[11.5px] font-medium text-zinc-500">Por red · según Meta</span>{split(n)}</span>
          </td>
        </tr>,
      ] : []),
      ...(isOpen ? rows(n.children, depth + 1) : []),
    ];
  });

  const un = perf.unattributed.periodo.cur;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
        <label className="relative flex w-full items-center sm:w-60">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar campaña o anuncio" aria-label="Buscar campaña o anuncio"
            className="h-8 w-full rounded-full border border-zinc-200 bg-white pl-8 pr-8 text-[12px] font-semibold text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda" className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-3 w-3" />
            </button>
          )}
        </label>
        <div role="group" aria-label="Estado" className="inline-flex rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700">
          {(["activas", "pausadas", "todas"] as StatusFilter[]).map((k) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => { setStatus(k); save({ status: k }); }}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${status === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>
              {k === "activas" ? "Activas" : k === "pausadas" ? "Pausadas" : "Todas"} <span className="tabular-nums opacity-60">{counts[k]}</span>
            </button>
          ))}
        </div>
        {parents.length > 0 && (
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(parents))}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-zinc-200 px-2.5 text-[11.5px] font-bold text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-white">
            <ChevronRight className={`h-3 w-3 transition-transform ${allOpen ? "-rotate-90" : "rotate-90"}`} aria-hidden />
            {allOpen ? "Plegar todo" : "Desplegar todo"}
          </button>
        )}
        {/* En el celular no hay títulos de columna para tocar: se ordena desde acá. */}
        <label className="flex items-center gap-1.5 text-[12px] text-zinc-500 md:hidden">
          Ordenar por
          <select value={sort ? sort.k : "roas"} aria-label="Ordenar por"
            onChange={(e) => { const k = e.target.value as Col; const next: Sort = { k, dir: k === "cpa" ? "asc" : "desc" }; setSort(next); save({ sort: next }); }}
            className="h-8 rounded-full border border-zinc-200 bg-white px-2.5 text-[12px] font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button type="button" aria-label={(sort?.dir ?? "desc") === "desc" ? "De mayor a menor" : "De menor a mayor"}
            onClick={() => { const k = sort?.k ?? "roas"; const next: Sort = { k, dir: (sort?.dir ?? "desc") === "desc" ? "asc" : "desc" }; setSort(next); save({ sort: next }); }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            {(sort?.dir ?? "desc") === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </label>
        <span className={`text-[11px] sm:ml-auto ${fresh.warn ? "font-bold text-amber-600 dark:text-amber-400" : "font-medium text-zinc-400"}`} suppressHydrationWarning>
          {source === "meta" ? "Según Meta Ads" : "Ventas y valor cobrados en Stripe"} · {perf.windows.periodo.label.toLowerCase()} · {fresh.text.replace("Datos de Meta: ", "")}
        </span>
      </div>
      <ul className="m-0 list-none p-0 md:hidden">
        {order.list.length ? cards(order.list, 0) : (
          <li className="border-t border-zinc-100 px-5 py-8 text-center text-[12px] font-semibold text-zinc-400 dark:border-white/[0.05]">
            {perf.nodes.length ? (q ? `Nada coincide con «${query.trim()}».` : `Ninguna campaña ${status === "activas" ? "activa" : "pausada"} con datos.`) : perf.fetchedAt ? "Sin campañas con gasto en el período." : "Todavía no hay datos de Meta guardados."}
          </li>
        )}
        {order.list.length > 0 && (
          <li className="border-t-2 border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-white/[0.02]">
            <span className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">Total</span>
            {nums(total)}
          </li>
        )}
        {order.list.length > 0 && source === "real" && un.orders > 0 && (
          <li className="border-t border-zinc-100 px-4 py-2.5 text-[12px] text-zinc-500 dark:border-white/[0.05]">
            Ventas sin campaña: {fmt("sales", un.orders)} · {fmt("value", un.revenue)}
          </li>
        )}
      </ul>
      <div className="ad-scroll hidden border-t border-zinc-100 md:block dark:border-white/[0.05]">
        <table className="ct-table w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="ct-col-name" />
            <col className="ct-col-num ct-col-edit" /><col className="ct-col-num ct-col-edit" />
            {COLS.map(([k]) => <col key={k} className="ct-col-num" />)}
          </colgroup>
          <thead>
            <tr className="bg-zinc-50/80 dark:bg-white/[0.02]">
              <th className="ct-namecell py-2 pr-2 text-left text-[12px] font-medium text-zinc-500 md:sticky md:left-0 md:z-[2] md:bg-zinc-50 md:pr-4 md:dark:bg-[#141416]"
                style={{ "--pl": "12px", "--plm": "8px" } as React.CSSProperties}>Campaña</th>
              <th className="px-2 py-2 text-right text-[12px] font-medium text-zinc-500 md:px-3 dark:text-zinc-400" title="Presupuesto diario: tocá el número para cambiarlo en Meta">Presupuesto</th>
              <th className="px-2 py-2 text-right text-[12px] font-medium text-zinc-500 md:px-3 dark:text-zinc-400" title="Límite de puja: tocá el número para cambiarlo en Meta">Puja</th>
              {COLS.map(([k, l]) => {
                const on = sort ? sort.k === k : k === "roas";
                const dir = sort?.dir ?? "desc";
                return (
                  <th key={k} className="px-2 py-2 text-right md:px-3">
                    <button type="button" onClick={() => clickSort(k)} aria-sort={on ? (dir === "desc" ? "descending" : "ascending") : undefined}
                      className={`inline-flex items-center gap-0.5 text-[12px] hover:text-zinc-900 dark:hover:text-white ${on ? "font-semibold text-zinc-900 dark:text-white" : "font-medium text-zinc-500 dark:text-zinc-400"}`}>
                      {l}{on && (dir === "desc" ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.list.length ? rows(order.list, 0) : (
              <tr><td colSpan={3 + COLS.length} className="px-5 py-8 text-center text-[12px] font-semibold text-zinc-400">
                {perf.nodes.length ? (
                  <>
                    {q ? `Nada coincide con «${query.trim()}». ` : `Ninguna campaña ${status === "activas" ? "activa" : "pausada"} con datos. `}
                    {status !== "todas" && <button type="button" className="font-bold text-violet-600 underline dark:text-violet-400" onClick={() => { setStatus("todas"); save({ status: "todas" }); }}>Ver todas ({perf.nodes.length})</button>}
                  </>
                ) : perf.fetchedAt ? "Sin campañas con gasto en el período." : "Todavía no hay datos de Meta guardados: se sincronizan solos cada 15 minutos."}
              </td></tr>
            )}
          </tbody>
          {order.list.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-white/[0.02]">
                <td className="ct-namecell py-2.5 pr-2 text-[12.5px] font-semibold text-zinc-700 dark:text-zinc-200 md:sticky md:left-0 md:z-[1] md:bg-zinc-50 md:dark:bg-[#141416]"
                  style={{ "--pl": "12px", "--plm": "8px" } as React.CSSProperties}>Total</td>
                <td /><td />
                {cells(total, true)}
              </tr>
              {source === "real" && un.orders > 0 && (
                <tr className="text-zinc-500">
                  <td className="ct-namecell py-2 pr-2 text-[11px] font-semibold md:sticky md:left-0 md:z-[1] md:bg-white md:dark:bg-[#111113]" style={{ "--pl": "12px", "--plm": "8px" } as React.CSSProperties}>
                    Ventas sin campaña
                  </td>
                  <td /><td />
                  {COLS.map(([k]) => (
                    <td key={k} className="px-2 py-2 text-right text-[12px] font-bold tabular-nums md:px-3">
                      {k === "sales" ? fmt("sales", un.orders) : k === "value" ? fmt("value", un.revenue) : ""}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export type { Level };
