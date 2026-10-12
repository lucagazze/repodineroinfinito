"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Calendar, ChevronDown, Loader2, TrendingUp } from "lucide-react";
import { PANEL_TZ_LABEL, PRESETS, presetRange, previousOf, rangeText, resolveRange, todayIn } from "@/lib/admin/range";

/**
 * Selector de fechas: una píldora con el período, otra con
 * «vs período anterior», y al abrir los presets a la izquierda y dos meses de
 * calendario (uno en el celular) para elegir un rango propio. El rango va a la
 * URL; los presets se aplican al tocarlos, el rango propio con «Aplicar».
 */

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function MiniCal({ year, month, since, until, hovering, today, onDay, onHover, onPrev, onNext }: {
  year: number; month: number; since: string; until: string; hovering: string; today: string;
  onDay: (d: string) => void; onHover: (d: string) => void; onPrev?: () => void; onNext?: () => void;
}) {
  const days: (string | null)[] = [];
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  for (let i = 0; i < (first === 0 ? 6 : first - 1); i++) days.push(null);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let i = 1; i <= last; i++) days.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
  return (
    <div className="w-[240px]">
      <div className="mb-4 flex items-center px-1">
        <div className="flex w-8 justify-start">
          {onPrev && <button type="button" onClick={onPrev} className="group rounded-md p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes anterior"><ChevronDown className="h-4 w-4 rotate-90 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200" /></button>}
        </div>
        <span className="flex-1 text-center text-[13px] font-bold text-zinc-900 dark:text-zinc-100">{MONTHS[month]} {year}</span>
        <div className="flex w-8 justify-end">
          {onNext && <button type="button" onClick={onNext} className="group rounded-md p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes siguiente"><ChevronDown className="h-4 w-4 -rotate-90 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200" /></button>}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} className="pb-2 text-center text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{d}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const isToday = d === today;
          const future = d > today;
          const sel = d === since || d === until;
          const inRange = since && until && d > since && d < until;
          const hov = since && !until && hovering && ((d > since && d <= hovering) || (d < since && d >= hovering));
          return (
            <button key={d} type="button" disabled={future}
              onMouseEnter={() => !future && onHover(d)} onClick={() => !future && onDay(d)}
              className={`relative flex h-8 w-8 items-center justify-center text-[11px] font-bold transition-all ${sel
                ? "z-10 rounded-full bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none"
                : inRange || hov ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10"
                : future ? "cursor-default text-zinc-200 dark:text-zinc-800"
                : "rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"} ${isToday && !sel ? "text-blue-600 ring-1 ring-blue-100 dark:text-blue-500 dark:ring-blue-900/30" : ""}`}>
              {Number(d.split("-")[2])}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ since, until, preset, label, align = "right" }: { since: string; until: string; preset: string | null; label: string; align?: "left" | "right" }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [pSince, setPSince] = useState(since);
  const [pUntil, setPUntil] = useState(until);
  const [pPreset, setPPreset] = useState<string | null>(preset);
  const [hovering, setHovering] = useState("");
  const today = todayIn();
  const [ty, tm] = until.split("-").map(Number);
  // Se muestran el mes anterior y el del final del rango.
  const [cal, setCal] = useState(() => (tm === 1 ? { y: ty - 1, m: 11 } : { y: ty, m: tm - 2 }));
  const ref = useRef<HTMLDivElement>(null);
  const prev = previousOf({ since, until });
  // El período pedido («desde|hasta»): hasta que la página lo muestre, se sigue esperando.
  const [want, setWant] = useState<string | null>(null);
  const tries = useRef(0);
  const busy = pending || !!want;
  // Mientras llegan los datos del período nuevo, el contenido se atenúa (admin.css).
  useEffect(() => {
    const main = document.querySelector(".ad-main");
    main?.toggleAttribute("data-range-loading", busy);
    return () => main?.removeAttribute("data-range-loading");
  }, [busy]);
  // Un solo click tiene que alcanzar: si la página volvió con otro período
  // (una actualización que se cruzó), se pide de nuevo, hasta 2 veces.
  useEffect(() => {
    if (pending || !want) return;
    if (`${since}|${until}` === want) { setWant(null); return; }
    if (tries.current >= 2) { setWant(null); return; }
    tries.current++;
    start(() => router.refresh());
  }, [pending, want, since, until, router]);

  useEffect(() => {
    if (!open) return;
    setPSince(since); setPUntil(until); setPPreset(preset);
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open, since, until, preset]);

  const go = (q: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    for (const k of ["r", "desde", "hasta", "d", "dia", "p"]) u.delete(k);
    for (const [k, v] of Object.entries(q)) u.set(k, v);
    setOpen(false);
    const r = resolveRange({ r: u.get("r") ?? undefined, desde: u.get("desde") ?? undefined, hasta: u.get("hasta") ?? undefined });
    tries.current = 0;
    setWant(`${r.since}|${r.until}`);
    // Sin recargar ni volver arriba. router.replace(…, { scroll: false }) igual
    // le da foco al contenido de la página y el navegador salta arriba: por eso
    // se cambia la URL con history.replaceState (Next lo sincroniza con
    // useSearchParams) y se piden los datos nuevos con router.refresh, que no
    // mueve ni el scroll ni el foco. Mientras tanto la página queda atenuada.
    // Estado null a propósito: con el estado interno de Next (__NA) el router no se entera del cambio.
    window.history.replaceState(null, "", `${path}${u.toString() ? `?${u}` : ""}`);
    start(() => router.refresh());
  };
  const onDay = (d: string) => {
    setPPreset(null);
    if (!pSince || (pSince && pUntil)) { setPSince(d); setPUntil(""); }
    else if (d < pSince) { setPUntil(pSince); setPSince(d); }
    else setPUntil(d);
  };
  const next = cal.m === 11 ? { y: cal.y + 1, m: 0 } : { y: cal.y, m: cal.m + 1 };

  return (
    <div ref={ref} className="relative z-20 flex h-9 w-full items-center justify-between rounded-full border border-black/[0.06] bg-white px-1 py-0.5 shadow-sm md:h-10 md:w-auto md:justify-start md:py-1 dark:border-white/[0.06] dark:bg-zinc-900">
      <div className="relative flex-1 md:flex-none">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={PANEL_TZ_LABEL}
          className="group flex h-7 w-full items-center justify-center gap-1.5 rounded-full px-3 text-[11px] transition-all hover:bg-zinc-50 md:h-8 md:justify-start md:text-[12.5px] dark:hover:bg-zinc-800">
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : <Calendar className="h-4 w-4 text-zinc-400 transition-colors group-hover:text-blue-500" />}
          <span className="whitespace-nowrap text-[11px] font-bold text-zinc-700 md:text-[13px] dark:text-zinc-200">{busy ? "Filtrando…" : label}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className={`absolute left-0 top-full z-30 mt-3 flex w-[290px] flex-col overflow-hidden rounded-[20px] border border-black/[0.08] bg-white shadow-2xl sm:w-[320px] md:w-auto md:flex-row dark:border-white/[0.08] dark:bg-zinc-900 ${align === "right" ? "md:left-auto md:right-0" : ""}`}>
            <div className="flex w-full flex-row gap-1 overflow-x-auto border-b border-zinc-50 p-2 md:w-[180px] md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:p-3 dark:border-zinc-800">
              {PRESETS.map(([id, l]) => (
                <button key={id} type="button"
                  onClick={() => { const r = presetRange(id, today)!; setPPreset(id); setPSince(r.since); setPUntil(r.until); go(id === "7d" ? {} : { r: id }); }}
                  className={`shrink-0 whitespace-nowrap rounded-[10px] px-2.5 py-1 text-center text-[12px] font-bold transition-all md:px-3 md:py-1.5 md:text-left ${pPreset === id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex flex-col items-center px-1.5 py-3 md:items-stretch md:p-5">
              <div className="flex flex-col gap-4 md:flex-row md:gap-8">
                <MiniCal year={cal.y} month={cal.m} since={pSince} until={pUntil} hovering={hovering} today={today} onDay={onDay} onHover={setHovering}
                  onPrev={() => setCal((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}
                  onNext={() => setCal((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))} />
                <div className="hidden md:block">
                  <MiniCal year={next.y} month={next.m} since={pSince} until={pUntil} hovering={hovering} today={today} onDay={onDay} onHover={setHovering}
                    onNext={() => setCal((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))} />
                </div>
              </div>
              <div className="mt-4 flex w-full items-center justify-end gap-2 border-t border-zinc-50 pt-4 dark:border-zinc-800">
                <span className="mr-auto text-[11px] font-semibold text-zinc-400">{pSince ? rangeText(pSince, pUntil || pSince) : "Elegí el primer día"}<span className="block text-[10px] text-zinc-300 dark:text-zinc-600">{PANEL_TZ_LABEL}</span></span>
                <button type="button" onClick={() => setOpen(false)}
                  className="flex h-9 items-center justify-center rounded-xl px-4 text-[13px] font-medium text-zinc-500 transition-all hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">Cancelar</button>
                <button type="button" disabled={!pSince}
                  onClick={() => (pPreset ? go(pPreset === "7d" ? {} : { r: pPreset }) : go({ desde: pSince, hasta: pUntil || pSince }))}
                  className="flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-4 text-[13px] font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-zinc-900">Aplicar</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mx-1 hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-800" />
      <div className="hidden items-center justify-center gap-2 rounded-full bg-blue-50/80 px-4 py-1.5 sm:flex dark:bg-blue-500/10">
        <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
        <span className="whitespace-nowrap text-[11px] font-bold text-blue-600 dark:text-blue-400">vs {rangeText(prev.since, prev.until)}</span>
      </div>
    </div>
  );
}
