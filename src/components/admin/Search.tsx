"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink, Loader2, Search as SearchIcon, X } from "lucide-react";
import type { SearchHit } from "@/app/api/admin/buscar/route";
import { Flag } from "./RecentOrders";
import { Pv } from "./Priv";
import { PANEL_TZ } from "@/lib/admin/range";

/**
 * El buscador del panel. Se abre con ⌘K / Ctrl+K o «/» en cualquier página,
 * con la barra de arriba del Inicio o con la lupa del menú. Busca pedidos,
 * carritos y visitantes por email, nombre, #pedido, pago de Stripe, teléfono o
 * país, mientras se escribe. Enter abre el primer resultado (o el marcado con
 * las flechas). En el celular ocupa toda la pantalla.
 */

const OPEN = "ad:search";
/** Abre el buscador desde cualquier botón. */
export const openSearch = () => window.dispatchEvent(new Event(OPEN));

const TONE: Record<SearchHit["status"]["tone"], string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
  off: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
};
const GROUP: Record<SearchHit["kind"], string> = { order: "Pedidos", cart: "Carritos", visitor: "Visitantes" };
const money = (n: number, cur: string | null) => {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${cur} ${n}`; }
};
const date = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "");

/** La barra con forma de buscador (Inicio) y el botón del menú: abren el buscador. */
export function SearchTrigger({ variant = "bar" }: { variant?: "bar" | "side" | "icon" }) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  if (variant === "icon") {
    return (
      <button type="button" onClick={openSearch} aria-label="Buscar"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/10">
        <SearchIcon className="h-[18px] w-[18px]" />
      </button>
    );
  }
  const side = variant === "side";
  return (
    <button type="button" onClick={openSearch}
      className={`group flex w-full items-center gap-2.5 border border-black/[0.06] bg-white text-left text-zinc-400 shadow-sm transition-colors hover:border-violet-300 dark:border-white/[0.07] dark:bg-zinc-900 dark:hover:border-violet-500/40 ${side ? "h-9 rounded-xl px-3 text-[12px]" : "h-11 rounded-2xl px-4 text-[13px]"}`}>
      <SearchIcon className={`${side ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 text-zinc-400 group-hover:text-violet-500`} />
      <span className="min-w-0 flex-1 truncate font-medium">{side ? "Buscar…" : "Buscar pedido, persona, email, #pedido o pago de Stripe…"}</span>
      <kbd className="hidden shrink-0 rounded-md border border-zinc-200 px-1.5 py-0.5 font-sans text-[10.5px] font-bold text-zinc-400 sm:inline dark:border-zinc-700">{mac ? "⌘" : "Ctrl"} K</kbd>
    </button>
  );
}

export default function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K y «/» (si no se está escribiendo en otro lado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
      else if (e.key === "/" && !typing && !open) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN, onOpen); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 20);
    document.documentElement.style.overflow = "hidden";
    return () => { clearTimeout(t); document.documentElement.style.overflow = ""; };
  }, [open]);

  // Mientras se escribe (200 ms de pausa); la respuesta vieja no pisa a la nueva.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); setBusy(false); setErr(null); return; }
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/buscar?q=${encodeURIComponent(term)}`, { cache: "no-store", signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setHits(j.hits as SearchHit[]); setHi(0); setErr(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      } finally {
        if (!ctl.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const close = () => { setOpen(false); };
  const go = (h: SearchHit) => { close(); router.push(h.href); };
  const groups = useMemo(() => {
    const out: [SearchHit["kind"], SearchHit[]][] = [];
    for (const k of ["order", "cart", "visitor"] as const) {
      const list = (hits ?? []).filter((h) => h.kind === k);
      if (list.length) out.push([k, list]);
    }
    return out;
  }, [hits]);
  const flat = groups.flatMap(([, l]) => l);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[400] flex items-start justify-center bg-black/40 backdrop-blur-sm sm:px-4 sm:pt-[9vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Buscar"
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[78vh] sm:max-w-[680px] sm:rounded-[20px] sm:border sm:border-black/[0.08] dark:bg-zinc-900 sm:dark:border-white/[0.08]">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-white/[0.06]">
          {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" /> : <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />}
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, nombre, #pedido, pi_…, teléfono o país (US, IT…)"
            aria-label="Buscar" autoComplete="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); close(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(flat.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter" && flat[hi]) { e.preventDefault(); go(flat[hi]); }
            }}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white" />
          <button type="button" onClick={close} aria-label="Cerrar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {err && <p className="ad-flash warn m-4">No se pudo buscar: {err}</p>}
          {q.trim().length < 2 ? (
            <div className="grid gap-1 px-5 py-6 text-[12.5px] font-medium text-zinc-500">
              <p>Escribí al menos 2 letras. Busca en <b>pedidos</b> (pagados, reembolsados y sin pagar), <b>carritos</b> y <b>visitantes</b> que dejaron el email.</p>
              <p className="text-zinc-400">Ejemplos: <code>sue</code> · <code>#81324400</code> · <code>pi_3UNM…</code> · <code>ch_…</code> · <code>US</code></p>
              <p className="mt-2 hidden text-[11px] text-zinc-400 sm:block">Enter abre el primero · ↑ ↓ para moverse · Esc cierra</p>
            </div>
          ) : hits && !flat.length && !busy ? (
            <p className="px-5 py-8 text-center text-[13px] font-semibold text-zinc-400">Nada con «{q.trim()}».</p>
          ) : (
            groups.map(([k, list]) => (
              <div key={k} className="py-1.5">
                <p className="px-5 pb-1 pt-2 text-[11.5px] font-semibold text-zinc-400">{GROUP[k]}</p>
                <ul>
                  {list.map((h) => {
                    const i = flat.indexOf(h);
                    return (
                      <li key={`${h.kind}:${h.id}`} onMouseEnter={() => setHi(i)}
                        className={`mx-2 flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 ${i === hi ? "bg-violet-50 dark:bg-violet-500/10" : ""}`}>
                        <Link href={h.href} onClick={close} className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex w-5 shrink-0 justify-center">{h.country ? <Flag cc={h.country} w={18} /> : <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />}</span>
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[13px] text-zinc-900 dark:text-white">
                              {h.name ? <Pv as="Cliente ••••">{h.name}</Pv> : h.email ? <Pv as="email@••••">{h.email}</Pv> : "Sin nombre"}
                            </b>
                            <span className="block truncate text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
                              {h.ref ? <><span className="font-mono font-bold text-zinc-700 dark:text-zinc-200">{h.ref}</span> · </> : null}
                              {h.name && h.email ? <><Pv as="email@••••">{h.email}</Pv> · </> : null}
                              {h.offer ? <Pv as={h.alias ?? "Oferta"}>{h.offer}</Pv> : "Sin oferta"} · {date(h.at)}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {h.total != null && <b className={`text-[13px] tabular-nums ${h.status.tone === "bad" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-white"}`}>{money(h.total, h.currency)}</b>}
                            <span className={`rounded-md px-1.5 py-[1px] text-[10px] font-bold ring-1 ring-inset ${TONE[h.status.tone]}`}>{h.status.label}</span>
                          </span>
                        </Link>
                        <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
                          <Link href={h.href} onClick={close} title={h.kind === "visitor" ? "Ver el recorrido" : "Ver en la app"}
                            className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-white/5">
                            <span className="hidden sm:inline">{h.kind === "visitor" ? "Recorrido" : "Ver en la app"}</span><ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          {h.stripe && (
                            <a href={h.stripe} target="_blank" rel="noreferrer" title="Abrir el pago en Stripe"
                              className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11px] font-bold text-[#635bff] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-white/5">
                              <span className="hidden sm:inline">Stripe</span><ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
