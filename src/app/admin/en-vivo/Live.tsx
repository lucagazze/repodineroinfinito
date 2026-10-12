"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CirclePlay, Monitor, Smartphone, Tablet } from "lucide-react";
import type { ActivityGroup, Devices, LivePage, LiveSnapshot, Person } from "@/lib/live";
import { FILTERS, type Cat } from "@/lib/event-labels";
import { PANEL_TZ } from "@/lib/admin/range";
import {
  PAGE_TONE, Flag, Pv, countryName, hhmmss, dur, ago, placeOf, DeviceLine, IpTag, ReturnBadge, SourceLine, JourneyChips, LineRow,
} from "./parts";
import { RecPlayer } from "./Player";

/**
 * Pantalla «En vivo»: pide /api/admin/en-vivo cada 5 s mientras la pestaña
 * está a la vista (sin websockets). Usa las clases .ad-* del panel tal cual
 * (admin.css), sin importar el kit, para no depender de sus cambios.
 */

const PAGES: [LivePage, string][] = [["landing", "Landing"], ["checkout", "Checkout"], ["oferta", "Post-pago"], ["gracias", "Gracias"]];
const POLL_MS = 5000;
const GROUP_LINES = 8;
const MAX_GROUPS = 25;

const journeyHref = (vid: string) => `/admin/en-vivo/recorrido?v=${encodeURIComponent(vid)}`;

/** «21:05» de hoy, «5 oct 21:05» de otro día (hora de Argentina, la del panel). */
const clock = (iso: string, now: string) => {
  const day = (x: string) => new Date(x).toLocaleDateString("en-CA", { timeZone: PANEL_TZ });
  const hm = hhmmss(iso).slice(0, 5);
  return day(iso) === day(now) ? hm : `${new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: PANEL_TZ })} ${hm}`;
};

/**
 * Actividad agrupada por persona: lo último de cada pestaña, la más reciente
 * arriba, con filtros. Cada línea dice qué pasó en castellano (OTO 1 ·
 * producto · monto, el medio de pago o el motivo del error).
 */
function Activity({ groups, now }: { groups: ActivityGroup[]; now: string }) {
  const [f, setF] = useState<Cat | "todo">("todo");
  const count = (c: Cat | "todo") => groups.reduce((a, g) => a + (c === "todo" ? g.lines.length : g.lines.filter((l) => l.cats.includes(c)).length), 0);
  const shown = groups
    .map((g) => ({ g, lines: f === "todo" ? g.lines : g.lines.filter((l) => l.cats.includes(f)) }))
    .filter((x) => x.lines.length)
    .slice(0, MAX_GROUPS);
  return (
    <section className="ad-card mt2">
      <div className="ad-card-h">
        <div style={{ minWidth: 0 }}>
          <h3>Actividad</h3>
          <p>Cada persona con lo que hizo, en orden. La que se movió último, arriba. Últimas 24 h, horas de Argentina.</p>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 sm:px-6" role="tablist" aria-label="Filtrar actividad">
        {FILTERS.map(([k, label]) => {
          const n = count(k);
          const on = f === k;
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setF(k)}
              className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors ${on
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
              {label}<span className={on ? "opacity-70" : "text-zinc-400"}>{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length ? (
        <ul className="m-0 list-none divide-y divide-zinc-100 border-t border-zinc-100 p-0 dark:divide-white/[0.06] dark:border-white/[0.06]">
          {shown.map(({ g, lines }) => (
            <li key={g.key} className="px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-zinc-900 dark:text-white">
                    <Flag cc={g.country} /><span className="truncate">{placeOf(g)}</span>
                    {g.live && <span className="ad-livedot ml-1 shrink-0">ahora</span>}
                    {g.bot && <span className="ad-badge warn ml-1 shrink-0">🤖 {g.bot}</span>}
                  </div>
                  <div className="ad-muted mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
                    <span className="flex min-w-0"><DeviceLine w={g} /></span>
                    <span className="flex min-w-0"><SourceLine s={g.source} /></span>
                  </div>
                  {g.offer && <div className="ad-faint mt-0.5 truncate text-[11.5px]"><Pv as={g.alias ?? "—"}>{g.offer}</Pv>{g.market ? ` · ${g.market}` : ""}</div>}
                </div>
                <div className="shrink-0 text-right text-[11.5px] leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200">{ago(now, g.lastAt)}</div>
                  <div className="ad-faint">{clock(g.lastAt, now)}</div>
                </div>
              </div>
              {lines.length > GROUP_LINES && <p className="ad-faint m-0 mt-1.5 text-[11.5px]">+{lines.length - GROUP_LINES} antes</p>}
              <ol className="m-0 mt-1 list-none p-0">
                {lines.slice(-GROUP_LINES).map((l) => <LineRow key={l.key} l={l} time={hhmmss(l.at).slice(0, 5)} />)}
              </ol>
              {g.vid && (
                <Link href={journeyHref(g.vid)} className="ad-link-a mt-1 inline-flex items-center gap-1 text-[11.5px]">Ver recorrido completo <ArrowRight className="h-3 w-3" /></Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-note border-t border-zinc-100 px-5 py-6 text-center dark:border-white/[0.06]">
          {groups.length ? "Nada de esto en las últimas 24 h." : "Todavía no se registró ningún evento."}
        </p>
      )}
    </section>
  );
}

/** Una persona conectada: dónde está, de qué anuncio vino y qué hizo. Clic = su recorrido completo. */
function PersonCard({ p, now, onPlay }: { p: Person; now: string; onPlay: (p: Person) => void }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold text-zinc-900 dark:text-white">
            <Flag cc={p.country} /><span className="truncate">{placeOf(p)}</span>
          </div>
          <div className="ad-muted mt-1 flex min-w-0 text-[11.5px]"><DeviceLine w={p} /></div>
        </div>
        {p.bot ? <span className="ad-badge warn" title="No cuenta como persona conectada">🤖 {p.bot}</span> : <ReturnBadge returning={p.returning} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <span className={`ad-badge ${PAGE_TONE[p.page]}`}><i />{p.step}</span>
        <span className="ad-muted" style={{ fontVariantNumeric: "tabular-nums" }}>hace {dur(Date.parse(now) - Date.parse(p.since))}</span>
        <span className="ad-faint ml-auto"><IpTag ip={p.ip} /></span>
      </div>

      <div className="mt-2.5 flex min-w-0 text-[12px] text-zinc-700 dark:text-zinc-300"><SourceLine s={p.source} /></div>
      {p.offer && (
        <div className="ad-faint mt-1 truncate text-[11.5px]">
          <Pv as={p.alias ?? "—"}>{p.offer}</Pv>{p.market ? ` · ${p.market}` : ""}
        </div>
      )}

      <div className="mt-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]"><JourneyChips steps={p.journey} /></div>
    </>
  );
  const cls = "block min-w-0 p-4";
  return (
    <div className="ad-card flex min-w-0 flex-col transition-colors hover:border-violet-500/40">
      {p.vid
        ? <Link href={journeyHref(p.vid)} className={`${cls} flex-1`} title="Ver el recorrido completo">{body}</Link>
        : <div className={`${cls} flex-1`}>{body}</div>}
      {(p.rec || p.vid) && (
        <div className="flex items-center gap-2 border-t border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
          {p.rec && (
            <button type="button" className="ad-btn sm primary" onClick={() => onPlay(p)}>
              <CirclePlay className="h-3.5 w-3.5" />Ver en vivo
            </button>
          )}
          {p.vid && <Link href={journeyHref(p.vid)} className="ad-btn sm ghost">Recorrido <ArrowRight className="h-3 w-3" /></Link>}
        </div>
      )}
    </div>
  );
}

/** Interruptor de la grabación de un checkout (se guarda en funnels.record_sessions). */
function RecToggle({ funnelId, on }: { funnelId: string; on: boolean }) {
  const [v, setV] = useState(on);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(on); }, [on]);
  const flip = async () => {
    setBusy(true);
    const next = !v;
    setV(next);
    try {
      const r = await fetch("/api/admin/en-vivo/rec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ funnelId, on: next }) });
      if (!r.ok) setV(!next);
    } catch { setV(!next); } finally { setBusy(false); }
  };
  return (
    <button type="button" role="switch" aria-checked={v} disabled={busy} onClick={flip}
      title={v ? "Se graban las visitas de este checkout (tocá para apagar)" : "No se graba (tocá para prender)"}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${v ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"} ${busy ? "opacity-60" : ""}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${v ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

function Flags({ list, max = 6 }: { list: [string, number][]; max?: number }) {
  if (!list.length) return <span className="ad-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.slice(0, max).map(([cc, n]) => (
        <span key={cc} title={`${countryName(cc)}: ${n}`} className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-0.5 text-[11.5px] font-bold dark:bg-zinc-800">
          <Flag cc={cc} />{n}
        </span>
      ))}
      {list.length > max && <span className="ad-faint ad-small">+{list.length - max}</span>}
    </div>
  );
}

function DeviceSplit({ d }: { d: Devices }) {
  const parts: [React.ReactNode, number, string][] = [
    [<Smartphone key="m" className="h-3.5 w-3.5" />, d.mobile, "celular"],
    [<Monitor key="d" className="h-3.5 w-3.5" />, d.desktop, "computadora"],
    [<Tablet key="t" className="h-3.5 w-3.5" />, d.tablet, "tablet"],
  ];
  const shown = parts.filter(([, n]) => n > 0);
  if (!shown.length) return <i className="ad-faint not-italic">—</i>;
  // Sin <span>: dentro de .ad-kpi los span toman el estilo de etiqueta.
  return (
    <i className="inline-flex items-center gap-2.5 whitespace-nowrap not-italic">
      {shown.map(([ic, n, label]) => <i key={label} title={label} className="inline-flex items-center gap-1 not-italic">{ic}<b>{n}</b></i>)}
    </i>
  );
}

export default function Live({ initial }: { initial: LiveSnapshot | null }) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(initial);
  const [err, setErr] = useState<string | null>(initial ? null : "No se pudo leer la base. Reintentando…");
  const busy = useRef(false);
  const dead = useRef(false);
  const [playing, setPlaying] = useState<Person | null>(null);
  // «Mostrar robots»: apagado por defecto (robots, revisión de Meta, monitores, pruebas y posibles robots).
  const [robots, setRobots] = useState(false);
  const robotsRef = useRef(false);
  robotsRef.current = robots;
  useEffect(() => { try { setRobots(localStorage.getItem("ad-live-robots") === "1"); } catch { /* nada */ } }, []);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const tick = async () => {
      if (busy.current || dead.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const r = await fetch(`/api/admin/en-vivo${robotsRef.current ? "?robots=1" : ""}`, { cache: "no-store" });
        if (r.status === 401) { dead.current = true; setErr("Se cerró la sesión del panel: volvé a entrar."); return; }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setSnap(j as LiveSnapshot);
        setErr(null);
      } catch (e) {
        setErr(`No se pudo actualizar (${(e as Error).message}). Reintentando…`);
      } finally {
        busy.current = false;
      }
    };
    tickRef.current = () => { void tick(); };
    const id = setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (!snap) return err ? <div className="ad-flash warn">{err}</div> : null;
  const t = snap.total;
  const people = snap.people ?? [];
  const live = playing ? people.find((p) => p.key === playing.key) ?? playing : null;

  return (
    <>
      {err && <div className="ad-flash warn">{err}</div>}

      <div className="ad-grid g-kpi">
        <div className="ad-card ad-kpi">
          <span>Conectados <i className="ad-livedot not-italic" style={{ marginLeft: "auto" }}>EN VIVO</i></span>
          <strong>{t.all}</strong>
          <small className="flex flex-wrap items-center gap-2"><DeviceSplit d={snap.devices} /> · {hhmmss(snap.at)}</small>
        </div>
        {PAGES.map(([k, label]) => (
          <div key={k} className="ad-card ad-kpi">
            <span>{label}</span>
            <strong>{t[k]}</strong>
            <small>{t.all ? `${Math.round((t[k] / t.all) * 100)}% de los conectados` : "nadie ahora"}</small>
          </div>
        ))}
      </div>

      {snap.countries.length > 0 && (
        <section className="ad-card mt">
          <div className="ad-card-b"><Flags list={snap.countries} max={20} /></div>
        </section>
      )}

      <section className="mt2">
        <div className="ad-sec">
          <h2>Personas ahora{people.length > 0 && ` · ${people.length}`}</h2>
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-semibold text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" checked={robots} className="h-3.5 w-3.5 accent-violet-600"
              onChange={(e) => {
                const on = e.target.checked;
                setRobots(on);
                robotsRef.current = on;
                try { localStorage.setItem("ad-live-robots", on ? "1" : "0"); } catch { /* nada */ }
                tickRef.current();
              }} />
            Mostrar robots
          </label>
        </div>
        {people.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))" }}>
            {people.map((p) => <PersonCard key={p.key} p={p} now={snap.at} onPlay={setPlaying} />)}
          </div>
        ) : (
          <div className="ad-card"><div className="ad-card-b ad-faint" style={{ textAlign: "center" }}>Nadie conectado ahora.</div></div>
        )}
      </section>

      <section className="ad-card mt2">
        <div className="ad-card-h">
          <div style={{ minWidth: 0 }}>
            <h3>Por oferta y checkout</h3>
            <p>Personas con la página abierta y a la vista en los últimos {snap.windowS} segundos. Cada pestaña cuenta una vez, donde está ahora.</p>
          </div>
        </div>
        <div className="ad-scroll">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Oferta · mercado</th>
                {PAGES.map(([k, label]) => <th key={k} className="num">{label}</th>)}
                <th className="num">Total</th>
                <th>Países</th>
                <th>Dispositivos</th>
                <th title="Grabación de sesión para ver en vivo (se guarda 72 h)">Grabar</th>
              </tr>
            </thead>
            <tbody>
              {snap.rows.map((r) => (
                <tr key={r.funnelId ?? "none"} style={r.total ? undefined : { opacity: 0.5 }}>
                  <td>
                    <b>{r.funnelId ? <Pv as={r.alias}>{r.offer}</Pv> : r.offer}</b>
                    {r.market && <span className="sub">{r.flags.length > 0 && <span className="mr-1 inline-flex gap-1 align-[-2px]">{r.flags.map((cc) => <Flag key={cc} cc={cc} />)}</span>}{r.market}</span>}
                  </td>
                  {PAGES.map(([k]) => <td key={k} className="num">{r.counts[k] ? <b>{r.counts[k]}</b> : <span className="ad-faint">0</span>}</td>)}
                  <td className="num">{r.total ? <b>{r.total}</b> : <span className="ad-faint">0</span>}</td>
                  <td><Flags list={r.countries} /></td>
                  <td><DeviceSplit d={r.devices} /></td>
                  <td>{r.funnelId && r.rec !== undefined ? <RecToggle funnelId={r.funnelId} on={r.rec} /> : <span className="ad-faint">—</span>}</td>
                </tr>
              ))}
              {!snap.rows.length && (
                <tr><td colSpan={9} className="ad-faint" style={{ textAlign: "center", padding: 28 }}>Todavía no hay ofertas activas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Activity groups={snap.activity ?? []} now={snap.at} />

      {live && (
        <RecPlayer
          sid={live.key}
          title={<span className="inline-flex items-center gap-1.5"><Flag cc={live.country} />{placeOf(live)}</span>}
          sub={<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5"><DeviceLine w={live} /><SourceLine s={live.source} /></span>}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}
