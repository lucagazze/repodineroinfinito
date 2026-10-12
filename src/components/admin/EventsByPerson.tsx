"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Zap } from "lucide-react";
import type { PersonEvents } from "@/lib/live";
import type { Tone } from "@/lib/event-labels";
import { Flag, Pv, ago, hhmmss, placeOf, DeviceLine, SourceLine, IpTag, LineRow } from "@/app/admin/en-vivo/parts";
import { RecButton } from "@/app/admin/en-vivo/Player";
import { usePoll, SALE_EVENT } from "./poll";
import { useKeepInPlace } from "./keep-in-place";
import NetChip from "./NetChip";

/**
 * Inicio › Últimos eventos, agrupados por persona (pestaña): una fila con la
 * oferta, lo último que hizo y lo que gastó; al tocarla se abre todo lo que
 * hizo en orden (mismas líneas que En vivo: «Compró» solo con cobro real),
 * con el recorrido completo y la grabación si hay. Se actualiza cada 5 s, y
 * enseguida si el latido de Inicio avisa que entró una compra.
 *
 * Con una persona abierta el orden queda quieto y la actividad nueva espera
 * en la barra de arriba, salvo una COMPRA (pago u OTO cobrado): esa entra
 * siempre arriba al momento, resaltada, y la fila abierta sigue abierta en su
 * lugar (keep-in-place).
 */

const POLL_MS = 5000;
/** Personas a la vista: las 10 con actividad más reciente, una fila cada una. */
const MAX_ROWS = 10;
const BADGE: Record<Tone, string> = { "": "", muted: "", ok: "ok", bad: "bad", warn: "warn", brand: "brand" };
type Data = { at: string; v?: string; groups: PersonEvents[] };
/** Las compras de una persona: líneas con cobro real (las mismas que suman «Gastó»). */
const buysOf = (g: PersonEvents) => g.lines.filter((l) => l.cats.includes("compras") && l.value).map((l) => l.key);

export default function EventsByPerson() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const frozen = useRef<string[] | null>(null);
  const busy = useRef(false);
  const [, force] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  // Compras ya vistas (null hasta la primera respuesta: lo que ya estaba no se resalta).
  const seenBuys = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const freshT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const mark = useKeepInPlace(listRef, open, data);

  const ver = useRef<string | null>(null);
  // El reloj compartido del panel (poll.ts). Con ?v= el servidor contesta 204 si no cambió nada:
  // sin cuerpo y sin volver a dibujar. busy queda en true después de un 401.
  usePoll(async (signal) => {
    if (busy.current) return;
    try {
      const r = await fetch(`/api/admin/eventos${ver.current ? `?v=${encodeURIComponent(ver.current)}` : ""}`, { cache: "no-store", signal });
      if (r.status === 401) { busy.current = true; setErr("Se cerró la sesión del panel: volvé a entrar."); return; }
      if (r.status === 204) { setErr(null); return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const j = (await r.json()) as Data;
      ver.current = j.v ?? null;
      // Personas con una compra nueva: arriba de todo ya, aunque haya alguien abierto.
      const seen = seenBuys.current;
      const bought = seen ? j.groups.filter((g) => buysOf(g).some((k) => !seen.has(k))).map((g) => g.key) : [];
      seenBuys.current = new Set([...(seen ?? []), ...j.groups.flatMap(buysOf)]);
      if (bought.length) {
        if (frozen.current) {
          const up = bought.filter((k) => k !== openRef.current);
          frozen.current = [...up, ...frozen.current.filter((k) => !up.includes(k))];
        }
        setFresh(new Set(bought));
        if (freshT.current) clearTimeout(freshT.current);
        freshT.current = setTimeout(() => setFresh(new Set()), 4000);
      }
      mark();
      setData(j);
      setErr(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(`No se pudo actualizar (${(e as Error).message}).`);
    }
  }, POLL_MS, [], SALE_EVENT);
  useEffect(() => () => { if (freshT.current) clearTimeout(freshT.current); }, []);
  // «hace X» con el reloj del navegador (cada 30 s: va en minutos), así una respuesta igual no hace falta redibujarla.
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const t = setInterval(() => setNow(new Date().toISOString()), 30_000); return () => clearInterval(t); }, []);

  const groups = (data?.groups ?? []).slice(0, MAX_ROWS);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  // Sin saltos: con alguien abierto se mantiene el orden que estaba a la vista.
  const shown = open && frozen.current ? frozen.current.map((k) => byKey.get(k)).filter((g): g is PersonEvents => !!g) : groups;
  const pending = open && frozen.current ? groups.filter((g) => !frozen.current!.includes(g.key)).length : 0;

  const toggle = (k: string) => {
    if (open === k) { setOpen(null); frozen.current = null; return; }
    frozen.current = shown.map((g) => g.key);
    setOpen(k);
  };
  const unfreeze = () => { frozen.current = groups.map((g) => g.key); force((n) => n + 1); };

  return (
    <section className="ad-card flex min-w-0 flex-col">
      <div className="ad-card-h">
        <div className="min-w-0">
          <h3><Zap className="h-4 w-4 text-zinc-400" /> Últimos eventos</h3>
          <p>Las últimas 10 personas: lo último que hizo y cuánto gastó. Tocá una para ver todo.</p>
        </div>
        <span className="ad-livedot shrink-0 pt-1">En vivo</span>
      </div>

      {pending > 0 && (
        <button type="button" onClick={unfreeze}
          className="border-t border-zinc-100 bg-violet-50 px-4 py-2 text-left text-[12px] font-semibold text-violet-700 dark:border-white/[0.05] dark:bg-violet-500/10 dark:text-violet-300">
          {pending === 1 ? "1 persona más con actividad nueva" : `${pending} personas más con actividad nueva`} · mostrar
        </button>
      )}

      {!data && !err && <p className="ad-note border-t border-zinc-100 px-4 py-4 dark:border-white/[0.05]">Cargando…</p>}
      {err && <p className="ad-note border-t border-zinc-100 px-4 py-3 text-amber-600 dark:border-white/[0.05]">{err}</p>}
      {data && !groups.length && <p className="ad-note border-t border-zinc-100 px-4 py-4 dark:border-white/[0.05]">Todavía no hay eventos.</p>}

      {shown.length > 0 && (
        <ul ref={listRef} className="m-0 min-h-0 flex-1 list-none divide-y divide-zinc-100 border-t border-zinc-100 p-0 [overflow-anchor:none] dark:divide-white/[0.05] dark:border-white/[0.05]">
          {shown.map((g) => {
            const isOpen = open === g.key;
            const s = g.status;
            return (
              <li key={g.key} data-row={g.key} className={`${isOpen ? "bg-zinc-50/70 dark:bg-white/[0.02]" : ""} ${fresh.has(g.key) ? "ad-fresh" : ""}`}>
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.key)}
                  className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]">
                  {/* A la izquierda, el punto verde de quien está ahora en la página (el lugar queda reservado: las banderas no se corren). */}
                  <span className="flex w-1.5 shrink-0 justify-center">{g.live && <span className="ad-pulsedot" title="Ahora en la página" />}</span>
                  <span className="shrink-0"><Flag cc={g.country} /></span>
                  <span className="min-w-[4.5rem] flex-[1_1_0] truncate text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100">
                    {g.offer ? <Pv as={g.alias ?? "Oferta"}>{g.offer}</Pv> : placeOf(g)}
                    {g.market ? <span className="hidden font-medium text-zinc-400 sm:inline"> · {g.market}</span> : null}
                  </span>
                  {s && (
                    <span className={`ad-badge ${BADGE[s.tone]} min-w-0 max-w-[45%] shrink`}>
                      <span className="min-w-0 truncate">{s.title}{s.amount ? ` · ${s.amount}` : ""}</span>
                    </span>
                  )}
                  {g.spent && <span className="shrink-0 text-[11.5px] font-bold text-emerald-600 dark:text-emerald-400"><span className="hidden sm:inline">Gastó </span>{g.spent}</span>}
                  <NetChip n={g.network} />
                  <span className="shrink-0 text-[11px] font-semibold text-zinc-400" style={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning
                    title={hhmmss(g.lastAt)}>
                    <span className="sm:hidden">{ago(now, g.lastAt).replace(/^hace /, "")}</span>
                    <span className="hidden sm:inline">{ago(now, g.lastAt)}</span>
                  </span>
                  <ChevronDown className={`hidden h-4 w-4 shrink-0 text-zinc-400 transition-transform sm:block ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="px-4 pb-3 pl-[42px]">
                    <div className="ad-muted flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
                      <span className="min-w-0 truncate">{placeOf(g)}</span>
                      <span className="flex min-w-0"><DeviceLine w={g} /></span>
                      <span className="flex min-w-0"><SourceLine s={g.source} /></span>
                      <span className="ad-faint"><IpTag ip={g.ip} /></span>
                    </div>
                    <ol className="m-0 mt-1.5 list-none p-0">
                      {g.lines.map((l) => <LineRow key={l.key} l={l} time={hhmmss(l.at).slice(0, 5)} />)}
                    </ol>
                    {(g.rec || g.vid) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {g.rec && (
                          <RecButton sid={g.key} className="ad-btn sm primary" label={g.live ? "Ver en vivo" : "Ver grabación"}
                            title={<span className="inline-flex items-center gap-1.5"><Flag cc={g.country} />{placeOf(g)}</span>}
                            sub={<span className="flex min-w-0 flex-wrap items-center gap-x-3"><DeviceLine w={g} /><SourceLine s={g.source} /></span>} />
                        )}
                        {g.vid && (
                          <Link href={`/admin/en-vivo/recorrido?v=${encodeURIComponent(g.vid)}`} className="ad-btn sm ghost">
                            Ver recorrido completo <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

    </section>
  );
}
