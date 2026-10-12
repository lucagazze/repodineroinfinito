"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Trash2, Loader2, NotebookPen } from "lucide-react";
import { Pv } from "./Priv";

export type Task = { id: string; offer_id: string | null; text: string; done: boolean; created_at: string };
export type Hint = { tone: "bad" | "warn" | "good"; text: string };
export type BoardCampaign = { id: string; name: string; status: string; budget: number | null; s1: number; s7: number; b7: number; v7: number };
export type BoardRow = {
  id: string; key: string; name: string; alias: string; store: string; category: string | null;
  active: number; campaigns: number; s1: number; s7: number; b7: number; v7: number;
  list: BoardCampaign[]; hints: Hint[]; tasks: Task[];
};
type SortK = "name" | "active" | "s1" | "s7" | "b7" | "roas" | "profit" | "hints" | "todo";
const HINT: Record<Hint["tone"], string> = {
  bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
};

const usd = (n: number) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const roasCls = (r: number | null) => r == null ? "text-zinc-400" : r >= 1.5 ? "text-emerald-600 dark:text-emerald-400" : r >= 1 ? "text-amber-600 dark:text-amber-300" : "text-red-600 dark:text-red-400";

async function api(body: unknown) {
  const r = await fetch("/api/admin/notas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/** Una lista de tareas (de una oferta o la general): agregar, tachar y borrar, al instante. */
function Tasks({ offerId, initial, hints }: { offerId: string | null; initial: Task[]; hints?: Hint[] }) {
  const [list, setList] = useState(initial);
  const note = async (t: string) => {
    try { const j = await api({ action: "add", offerId, text: t }); setList((l) => [...l, j.task]); }
    catch (e) { window.alert((e as Error).message); }
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try { const j = await api({ action: "add", offerId, text: t }); setList((l) => [...l, j.task]); setText(""); }
    catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (t: Task) => {
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try { await api({ action: "toggle", id: t.id, done: !t.done }); } catch { setList((l) => l.map((x) => (x.id === t.id ? t : x))); }
  };
  const del = async (t: Task) => {
    setList((l) => l.filter((x) => x.id !== t.id));
    try { await api({ action: "delete", id: t.id }); } catch { setList((l) => [...l, t]); }
  };
  const ordered = [...list.filter((t) => !t.done), ...list.filter((t) => t.done)];
  return (
    <div className="grid gap-1.5">
      {hints && hints.length > 0 && (
        <div className="mb-2 grid gap-1.5">
          <p className="text-[11.5px] font-semibold text-zinc-500">Sugerencias según los números</p>
          {hints.map((h, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${HINT[h.tone]}`}>
              <span className="min-w-0 flex-1">{h.text}</span>
              <button type="button" onClick={() => void note(h.text)} className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] font-bold hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20">+ anotar</button>
            </div>
          ))}
        </div>
      )}
      {hints && <p className="text-[11.5px] font-semibold text-zinc-500">Para hacer</p>}
      {ordered.map((t) => (
        <label key={t.id} className="group flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={t.done} onChange={() => toggle(t)} className="mt-[3px] h-4 w-4 shrink-0 accent-violet-600" />
          <span className={`min-w-0 flex-1 break-words ${t.done ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"}`}>{t.text}</span>
          <button type="button" onClick={(e) => { e.preventDefault(); void del(t); }} aria-label="Borrar" className="shrink-0 rounded p-0.5 text-zinc-400 opacity-60 hover:text-red-500 hover:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </label>
      ))}
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Agregar algo para hacer…" maxLength={500}
          className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12.5px] text-zinc-800 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-violet-600 px-2.5 text-[12px] font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Agregar
        </button>
      </form>
    </div>
  );
}

export default function OffersBoardClient({ rows, general }: { rows: BoardRow[]; general: Task[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Por defecto, por ROAS de 7 días (de mayor a menor); tocando un título se ordena por esa columna.
  const [sort, setSort] = useState<{ k: SortK; dir: "asc" | "desc" }>({ k: "roas", dir: "desc" });
  const val = (r: BoardRow, k: SortK): number | string => k === "name" ? r.name.toLowerCase() : k === "roas" ? (r.s7 ? r.v7 / r.s7 : -1) : k === "profit" ? r.v7 - r.s7
    : k === "hints" ? r.hints.filter((h) => h.tone !== "good").length : k === "todo" ? r.tasks.filter((t) => !t.done).length : r[k];
  const sorted = [...rows].sort((a, b) => {
    const x = val(a, sort.k), y = val(b, sort.k);
    const v = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return sort.dir === "asc" ? v : -v;
  });
  const th = (k: SortK, label: string, right = true) => (
    <th className={`px-2 py-2 font-medium ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => setSort((s) => (s.k === k ? { k, dir: s.dir === "desc" ? "asc" : "desc" } : { k, dir: k === "name" ? "asc" : "desc" }))}
        className={`inline-flex items-center gap-0.5 hover:text-zinc-900 dark:hover:text-white ${sort.k === k ? "font-bold text-zinc-900 dark:text-white" : ""}`}>
        {label}{sort.k === k && <span aria-hidden>{sort.dir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pend = (r: BoardRow) => r.tasks.filter((t) => !t.done).length;
  return (
    <section className="ad-card min-w-0 overflow-hidden">
      <div className="ad-card-h">
        <div>
          <h3 className="flex items-center gap-1.5"><NotebookPen className="h-4 w-4" /> Ofertas en Meta y lo que hay que hacer</h3>
          <p>Según Meta, ordenadas por ROAS de 7 días (tocá un título para ordenar por otra cosa). Abrí una para ver sus campañas, las sugerencias y anotar tareas.</p>
        </div>
      </div>
      <div className="border-t border-zinc-100 px-4 py-3 sm:px-5 dark:border-white/[0.05]">
        <p className="mb-2 text-[12px] font-semibold text-zinc-500">General</p>
        <Tasks offerId={null} initial={general} />
      </div>
      <div className="ad-scroll border-t border-zinc-100 dark:border-white/[0.05]">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="text-[11.5px] text-zinc-500">
              {th("name", "Oferta", false)}{th("active", "Campañas activas")}{th("s1", "Gasto hoy")}{th("s7", "Gasto 7 d")}{th("b7", "Compras 7 d")}
              {th("roas", "ROAS 7 d")}{th("profit", "Beneficio 7 d")}{th("hints", "Sugerencias")}{th("todo", "Por hacer")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isOpen = open.has(r.id);
              const roas = r.s7 ? r.v7 / r.s7 : null;
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => toggle(r.id)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-white/[0.05] dark:hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-zinc-900 dark:text-white"><Pv as={r.alias}>{r.name}</Pv></span>
                          <span className="block text-[11px] text-zinc-500">{r.store}{r.category ? ` · ${r.category}` : ""}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <span className={r.active ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}>{r.active}</span>
                      <span className="text-zinc-400"> / {r.campaigns}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{usd(r.s1)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{usd(r.s7)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Math.round(r.b7)}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${roasCls(roas)}`}>{roas == null ? "—" : roas.toFixed(2)}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${r.v7 - r.s7 >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{r.v7 - r.s7 < 0 ? "−" : ""}{usd(Math.abs(r.v7 - r.s7))}</td>
                    <td className="px-2 py-2 text-right">
                      {(() => { const bad = r.hints.filter((h) => h.tone === "bad").length, warn = r.hints.filter((h) => h.tone === "warn").length, good = r.hints.filter((h) => h.tone === "good").length;
                        return bad + warn + good ? <span className="text-[11.5px] font-bold">{bad ? <span className="text-red-600 dark:text-red-400">{bad}✕ </span> : null}{warn ? <span className="text-amber-600 dark:text-amber-400">{warn}! </span> : null}{good ? <span className="text-emerald-600 dark:text-emerald-400">{good}↑</span> : null}</span> : <span className="text-zinc-400">—</span>; })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {pend(r) ? <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11.5px] font-bold text-violet-700 dark:text-violet-300">{pend(r)}</span> : <span className="text-zinc-400">—</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-50/70 dark:bg-white/[0.02]">
                      <td colSpan={9} className="px-4 py-3 sm:px-5">
                        {r.list.length > 0 && (
                          <table className="mb-3 w-full text-[12px]">
                            <thead><tr className="text-[11px] text-zinc-500"><th className="py-1 text-left font-medium">Campaña</th><th className="py-1 text-right font-medium">Presupuesto/día</th><th className="py-1 text-right font-medium">Hoy</th><th className="py-1 text-right font-medium">Gasto 7 d</th><th className="py-1 text-right font-medium">Compras</th><th className="py-1 text-right font-medium">ROAS</th></tr></thead>
                            <tbody>
                              {r.list.map((c) => { const rr = c.s7 ? c.v7 / c.s7 : null; return (
                                <tr key={c.id} className="border-t border-zinc-100 dark:border-white/[0.05]">
                                  <td className="py-1 pr-2"><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${c.status === "ACTIVE" ? "bg-emerald-500" : "bg-zinc-400"}`} /><Pv as="Campaña">{c.name}</Pv></td>
                                  <td className="py-1 text-right tabular-nums">{c.budget == null ? "—" : usd(c.budget)}</td>
                                  <td className="py-1 text-right tabular-nums">{usd(c.s1)}</td>
                                  <td className="py-1 text-right tabular-nums">{usd(c.s7)}</td>
                                  <td className="py-1 text-right tabular-nums">{Math.round(c.b7)}</td>
                                  <td className={`py-1 text-right font-semibold tabular-nums ${roasCls(rr)}`}>{rr == null ? "—" : rr.toFixed(2)}</td>
                                </tr>); })}
                            </tbody>
                          </table>
                        )}
                        <Tasks offerId={r.id} initial={r.tasks} hints={r.hints} />
                        <Link href={`/admin/o/${r.key}`} className="mt-2 inline-block text-[12px] font-semibold text-violet-600 hover:underline dark:text-violet-400">Abrir la oferta →</Link>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
