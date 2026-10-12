"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CirclePlay, ExternalLink, X } from "lucide-react";

/**
 * Reproductor de las grabaciones propias (rrweb, /api/rec → rec_chunks).
 * Mientras la persona sigue conectada la sigue en vivo (unos segundos de
 * atraso: el navegador manda cada 3 s y acá se pide cada 2,5 s): su página,
 * su puntero y su scroll. Cuando se va, pasa a reproducción normal con toda
 * la sesión (landing → checkout → pos-pago) y la línea de tiempo.
 * rrweb-player (MIT) se baja de jsDelivr recién al abrirlo.
 */

const PLAYER_JS = "https://cdn.jsdelivr.net/npm/rrweb-player@2.1.7/+esm";
const PLAYER_CSS = "https://cdn.jsdelivr.net/npm/rrweb-player@2.1.7/dist/style.css";
const POLL_MS = 2500;
/** Colchón del modo en vivo: los eventos llegan hasta ~6 s después de pasar. */
const BUFFER_MS = 8000;
const PAGE: Record<string, string> = { landing: "Landing", checkout: "Checkout", oferta: "Post-pago", gracias: "Gracias" };

type Ev = { type: number; timestamp: number; data?: { width?: number; height?: number; source?: number } };
type PlayerT = {
  addEvent(e: Ev): void;
  getReplayer(): { startLive(baseline?: number): void };
  $destroy(): void;
};
type PlayerCtor = new (o: { target: HTMLElement; props: Record<string, unknown> }) => PlayerT;

let lib: Promise<PlayerCtor> | null = null;
function loadPlayer() {
  if (!document.querySelector(`link[href="${PLAYER_CSS}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = PLAYER_CSS;
    document.head.appendChild(l);
  }
  lib ??= import(/* webpackIgnore: true */ PLAYER_JS).then((m: { default: PlayerCtor }) => m.default);
  return lib;
}

type Mode = "loading" | "wait" | "live" | "replay" | "error";

export function RecPlayer({ sid, title, sub, clarityUrl, onClose }: {
  sid: string; title: ReactNode; sub?: ReactNode; clarityUrl?: string | null; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [where, setWhere] = useState<{ page: string | null; path: string | null }>({ page: null, path: null });
  const [err, setErr] = useState<string | null>(null);

  // <dialog> modal: va a la capa superior del navegador, encima del menú y la barra
  // del panel sin importar su z-index, y Escape lo cierra solo.
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let dead = false;
    let player: PlayerT | null = null;
    let current: Mode = "loading";
    let after = 0;
    let fed = 0;
    let quiet = 0;
    // Para saber qué hora es «ahora» en el reloj del visitante: diferencia panel↔servidor y servidor↔visitante.
    let skew = 0;
    let off: number | null = null;
    const events: Ev[] = [];
    const set = (m: Mode) => { current = m; setMode(m); };

    /** Tamaño de la pantalla grabada (la última que se vio). */
    const viewport = () => {
      let w = 1280, h = 800;
      for (const e of events) {
        if ((e.type === 4 || (e.type === 3 && e.data?.source === 4)) && e.data?.width && e.data?.height) { w = e.data.width; h = e.data.height; }
      }
      return { w, h };
    };
    /** El reproductor entra entero: ancho del cuadro y alto de la ventana. */
    const fit = (controller: boolean) => {
      const el = box.current!;
      const { w, h } = viewport();
      const maxW = Math.max(200, el.clientWidth - 8);
      const maxH = Math.max(220, window.innerHeight - (controller ? 290 : 210));
      const k = Math.min(maxW / w, maxH / h);
      const width = Math.round(w * k);
      // Con controles, un mínimo de ancho para que entren (la pantalla grabada queda centrada adentro).
      return { width: controller ? Math.min(maxW, Math.max(width, 380)) : width, height: Math.round(h * k) };
    };

    async function pull() {
      let live = false;
      for (let i = 0; i < 30; i++) {
        const r = await fetch(`/api/admin/en-vivo/rec?sid=${encodeURIComponent(sid)}&after=${after}`, { cache: "no-store" });
        if (r.status === 401) throw new Error("Se cerró la sesión del panel: volvé a entrar.");
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const batch = (j.events as Ev[]).sort((a, b) => a.timestamp - b.timestamp);
        events.push(...batch);
        after = j.after;
        if (typeof j.server === "number") skew = j.server - Date.now();
        if (typeof j.off === "number" && (off === null || j.off < off)) off = j.off;
        live = j.live;
        if (!dead) setWhere({ page: j.page, path: j.path });
        if (!j.more) break;
      }
      return live;
    }

    async function mount(asLive: boolean) {
      const Player = await loadPlayer();
      if (dead || !box.current) return;
      player?.$destroy();
      box.current.innerHTML = "";
      events.sort((a, b) => a.timestamp - b.timestamp);
      const common = { mouseTail: { strokeStyle: "#8b5cf6", lineWidth: 2, duration: 500 }, UNSAFE_replayCanvas: false };
      if (asLive) {
        player = new Player({ target: box.current, props: { ...common, events: events.slice(), ...fit(false), liveMode: true, showController: false, autoPlay: false } });
        // En vivo = la hora actual del visitante menos el colchón (no la del último evento: si estuvo quieto, quedaría atrás).
        const lastTs = events[events.length - 1].timestamp;
        const visitorNow = Date.now() + skew - Math.max(0, off ?? 0);
        player.getReplayer().startLive(Math.max(lastTs, visitorNow) - BUFFER_MS);
        fed = events.length;
        set("live");
      } else {
        player = new Player({ target: box.current, props: { ...common, events: events.slice(), ...fit(true), autoPlay: true, skipInactive: true, showController: true, speedOption: [1, 2, 4, 8] } });
        fed = events.length;
        set("replay");
      }
    }

    async function tick() {
      if (dead || current === "replay" || current === "error") return;
      try {
        const live = await pull();
        if (dead) return;
        if (events.length < 2) { set("wait"); return; }
        if (current === "loading" || current === "wait") return mount(live);
        if (current === "live") {
          for (const e of events.slice(fed)) player?.addEvent(e);
          fed = events.length;
          // Se fue (o cerró la pestaña): dos vueltas sin conexión y pasa a la grabación completa.
          quiet = live ? 0 : quiet + 1;
          if (quiet >= 2) await mount(false);
        }
      } catch (e) {
        if (!dead) { setErr((e as Error).message); set("error"); }
      }
    }

    void tick();
    const iv = setInterval(() => { void tick(); }, POLL_MS);
    return () => { dead = true; clearInterval(iv); try { player?.$destroy(); } catch { /* nada */ } };
  }, [sid]);

  return (
    <dialog ref={dlg} aria-label="Grabación de la sesión" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-0 h-full max-h-none w-full max-w-none items-start justify-center overflow-y-auto bg-transparent p-2 backdrop:bg-black/60 open:flex sm:items-center sm:p-6">
      <div role="document" className="ad-card w-full max-w-[1100px] overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-bold text-zinc-900 dark:text-white">
              <span className="min-w-0 truncate">{title}</span>
              {mode === "live" && <span className="ad-livedot">En vivo</span>}
              {mode === "replay" && <span className="ad-badge">Grabación</span>}
            </div>
            {sub && <div className="ad-muted mt-0.5 min-w-0 text-[11.5px]">{sub}</div>}
            {where.page && (
              <div className="ad-faint mt-0.5 truncate text-[11.5px]">
                {mode === "live" ? "Ahora en " : "Última página: "}<b className="text-zinc-600 dark:text-zinc-300">{PAGE[where.page] ?? where.page}</b>{where.path ? ` · ${where.path}` : ""}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="ad-btn ghost sm shrink-0" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>

        <div className="relative bg-zinc-100 p-2 dark:bg-zinc-950">
          <div ref={box} className="flex min-h-[240px] w-full justify-center [&_.rr-player]:!shadow-none" />
          {mode !== "live" && mode !== "replay" && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12.5px] text-zinc-500">
              {mode === "loading" && "Cargando la grabación…"}
              {mode === "wait" && "Todavía no llegó la grabación: empieza unos segundos después de que la página termina de cargar."}
              {mode === "error" && (err ?? "No se pudo cargar la grabación.")}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11.5px]">
          <span className="ad-faint">Los campos y los emails se ven tapados. Se guarda 72 h.</span>
          {clarityUrl && (
            <a href={clarityUrl} target="_blank" rel="noreferrer" className="ad-link-a inline-flex items-center gap-1">Ver en Clarity <ExternalLink className="h-3 w-3" /></a>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Botón «Ver grabación» (o «Ver en vivo») que abre el reproductor. */
export function RecButton({ sid, label = "Ver grabación", title, sub, clarityUrl, className = "ad-btn sm" }: {
  sid: string; label?: string; title: ReactNode; sub?: ReactNode; clarityUrl?: string | null; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <CirclePlay className="h-3.5 w-3.5" />{label}
      </button>
      {open && <RecPlayer sid={sid} title={title} sub={sub} clarityUrl={clarityUrl} onClose={() => setOpen(false)} />}
    </>
  );
}
