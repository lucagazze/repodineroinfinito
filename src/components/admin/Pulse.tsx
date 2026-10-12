"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Radio } from "lucide-react";
import type { Pulse } from "@/lib/admin/pulse";
import type { LivePage } from "@/lib/live";
import WorldMap, { countryName, type MapDot, type MapValue } from "./WorldMap";
import { Flag } from "./RecentOrders";
import EventsByPerson from "./EventsByPerson";
import { readIfChanged, usePoll, SALE_EVENT } from "./poll";
import ClientsPanel from "./ClientsPanel";

/**
 * Centro de control de «Todas las ofertas»: pide /api/admin/pulso cada 5 s
 * mientras la pestaña está a la vista y lo comparte (contexto) con la tabla
 * de ofertas, que muestra quién está en vivo y lo vendido hoy en cada una.
 */

const POLL_MS = 5000;
/** El latido: ¿entró una compra? Liviano, así una venta aparece en 3 s y no en hasta 5 + lo que tarde el pulso. */
const BEAT_MS = 3000;
const Ctx = createContext<{ data: Pulse | null; err: string | null }>({ data: null, err: null });
/**
 * Los datos recién después de montar: la tabla de ofertas llega más tarde
 * (Suspense) y, si ya hubiera datos, no coincidiría con el HTML del servidor.
 */
export function usePulse() {
  const d = useContext(Ctx).data;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? d : null;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Pulse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dead = useRef(false);
  const last = useRef<string | null>(null);
  // Tras un aviso de compra, el próximo pedido pide el pulso recién armado (sin la caché de 2 s del servidor).
  const fresh = useRef(false);
  useEffect(() => {
    const on = () => { fresh.current = true; };
    window.addEventListener(SALE_EVENT, on);
    return () => window.removeEventListener(SALE_EVENT, on);
  }, []);
  // El reloj compartido del panel (poll.ts): sin pedidos superpuestos, en pausa con la
  // pestaña oculta o navegando, más lento si el servidor tarda y sin redibujar si no cambió nada.
  usePoll(async (signal) => {
    if (dead.current) return;
    try {
      const r = await fetch(fresh.current ? "/api/admin/pulso?fresh=1" : "/api/admin/pulso", { cache: "no-store", signal });
      fresh.current = false;
      if (r.status === 401) { dead.current = true; setErr("Se cerró la sesión del panel: volvé a entrar."); return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const j = await readIfChanged<Pulse>(r, last);
      if (j) setData(j);
      setErr(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(`No se pudo actualizar lo que pasa ahora (${(e as Error).message}). Reintentando…`);
    }
  }, POLL_MS, [], SALE_EVENT);

  // Si cambia la huella de compras (pedidos pagados : OTOs cobrados), se avisa a todo
  // Inicio (pulso, últimos pagos, eventos), que pide ya. La primera respuesta solo se anota.
  const beat = useRef<string | null>(null);
  const beatDead = useRef(false);
  usePoll(async (signal) => {
    if (beatDead.current || dead.current) return;
    const r = await fetch("/api/admin/latido", { cache: "no-store", signal }).catch(() => null);
    if (!r) return;
    if (r.status === 401) { beatDead.current = true; return; }
    if (!r.ok) return;
    const { s } = (await r.json()) as { s: string };
    if (beat.current !== null && s !== beat.current) window.dispatchEvent(new Event(SALE_EVENT));
    beat.current = s;
  }, BEAT_MS);
  return <Ctx.Provider value={{ data, err }}>{children}</Ctx.Provider>;
}

export const PHASES: [LivePage, string][] = [["landing", "Landing"], ["checkout", "Checkout"], ["oferta", "Post-pago"], ["gracias", "Gracias"]];
const PHASE_DOT: Record<LivePage, string> = { landing: "bg-sky-500", checkout: "bg-amber-500", oferta: "bg-violet-500", gracias: "bg-emerald-500" };
/** Los mismos colores, para los puntos del mapa (cada persona, del color del paso en que está). */
const PHASE_HEX: Record<LivePage, string> = { landing: "#0ea5e9", checkout: "#f59e0b", oferta: "#8b5cf6", gracias: "#10b981" };
const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

/**
 * En vivo de una fila de la tabla de ofertas: un solo número (como el resto de la tabla). En qué paso
 * está cada uno y los de fuera del mercado (suelen ser los revisores de Meta) van en el globo.
 */
export function LiveSplit({ ids }: { ids: string[] }) {
  const p = usePulse();
  if (!p) return <span className="text-zinc-300 dark:text-zinc-600">·</span>;
  const c: Record<LivePage, number> = { landing: 0, checkout: 0, oferta: 0, gracias: 0 };
  for (const id of ids) {
    const x = p.live.byFunnel[id];
    if (x) for (const [k] of PHASES) c[k] += x[k];
  }
  const all = PHASES.reduce((a, [k]) => a + c[k], 0);
  if (!all) return <span className="text-zinc-300 dark:text-zinc-600">0</span>;
  const away = new Map<string, number>();
  for (const id of ids) for (const [cc, n] of p.live.outside?.[id] ?? []) away.set(cc, (away.get(cc) ?? 0) + n);
  const awayN = [...away.values()].reduce((a, b) => a + b, 0);
  const tip = [
    PHASES.filter(([k]) => c[k]).map(([k, l]) => `${c[k]} en ${l.toLowerCase()}`).join(" · "),
    awayN ? `${awayN} fuera del mercado (${[...away].map(([cc, n]) => `${cc} ${n}`).join(", ")}): suelen ser los revisores de Meta.` : "",
  ].filter(Boolean).join(" · ");
  return <span className="tabular-nums" title={tip}>{all}{awayN > 0 && <span className="text-zinc-400">*</span>}</span>;
}

/** Lo vendido hoy (día de Argentina, el del panel) por los checkouts de una fila: el monto; la cantidad, en el globo. */
export function TodaySales({ ids }: { ids: string[] }) {
  const p = usePulse();
  if (!p) return <span className="text-zinc-300 dark:text-zinc-600">·</span>;
  let revenue = 0, orders = 0;
  for (const id of ids) { const x = p.today.byFunnel[id]; if (x) { revenue += x.revenue; orders += x.orders; } }
  if (!orders) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  return <span className="tabular-nums" title={`${orders} ${orders === 1 ? "venta" : "ventas"} hoy`}>{usd(revenue)}</span>;
}

export function CommandCenter() {
  const { data: p, err } = useContext(Ctx);
  const [mode, setMode] = useState<"live" | "sales">("live");
  const values: MapValue[] = useMemo(() => {
    if (!p) return [];
    return mode === "live"
      ? p.live.countries.map(([cc, n]) => ({ cc, value: n, label: `${n} ${n === 1 ? "persona" : "personas"} en vivo` }))
      : p.today.countries.map(([cc, n, v]) => ({ cc, value: v || n, label: `${n} ${n === 1 ? "venta" : "ventas"} · ${usd(v)}` }));
  }, [p, mode]);
  // En vivo: un punto por ciudad y paso, del color del paso (ciudad · oferta · paso al tocarlo).
  const dots: MapDot[] | undefined = useMemo(() => {
    if (!p || mode !== "live") return undefined;
    const label = (k: LivePage) => PHASES.find(([x]) => x === k)?.[1] ?? k;
    return (p.live.points ?? []).map((pt) => ({
      key: `${pt.lat}|${pt.lon}|${pt.page}|${pt.offer ?? ""}`, lat: pt.lat, lon: pt.lon, color: PHASE_HEX[pt.page], n: pt.n,
      label: [pt.city ?? (pt.cc ? countryName(pt.cc) : "Ciudad desconocida"), pt.offer ?? "Sin oferta", `${label(pt.page)}${pt.n > 1 ? ` (${pt.n})` : ""}`].join(" · "),
    }));
  }, [p, mode]);

  if (!p) {
    return (
      <div className="grid gap-4">
        {err && <p className="ad-flash warn mb-0">{err}</p>}
        {/* Del mismo alto que la tarjeta con el mapa: nada salta cuando llega. */}
        <div className="ad-card p-4 sm:p-5"><div className="sk h-[96px] rounded-xl" /><div className="sk mx-auto mt-3 w-full max-w-[960px] rounded-xl" style={{ aspectRatio: "1000 / 431.7" }} /><div className="sk mt-3 h-[30px] rounded-lg" /></div>
        <div className="grid gap-4 xl:grid-cols-2"><div className="sk h-[420px] rounded-2xl" /><div className="sk h-[420px] rounded-2xl" /></div>
      </div>
    );
  }
  const list = mode === "live" ? p.live.countries.map(([cc, n]) => [cc, String(n)] as const) : p.today.countries.map(([cc, n]) => [cc, `${n}`] as const);
  // El mapa está siempre, del mismo alto: sin nadie (o sin ventas hoy) queda vacío con un cartel
  // encima. Así nada de lo de abajo se mueve cuando alguien entra o se va (antes era una línea).
  const empty = !values.length;

  return (
    <div className="grid gap-4" data-live>
      {err && <p className="ad-flash warn mb-0">{err}</p>}

      <section className="ad-card min-w-0">
        {/* Ahora: cuántos hay conectados y en qué paso, siempre a la vista (los ceros, apagados), y de dónde son. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-zinc-900 dark:text-white">
            <Radio className="h-4 w-4 text-zinc-400" /> Ahora
            <span className="text-[14px] font-semibold tabular-nums text-zinc-900 dark:text-white">· {p.live.total.all.toLocaleString("es-AR")} {p.live.total.all === 1 ? "conectado" : "conectados"}</span>
            <i className="ad-pulsedot" title="Se actualiza solo" aria-label="En vivo" />
          </h3>
          {/* En el celular la explicación va en su propia línea, debajo (al lado no entra). */}
          <span className="order-last w-full text-[12.5px] text-zinc-500 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 dark:text-zinc-400">
            {mode === "live" ? `Últimos ${p.windowS} segundos.` : empty ? "Todavía no hay ventas hoy." : "Mapa: ventas de hoy (hora de Argentina) por país del comprador."}
          </span>
          <div className="ad-seg-sm ml-auto" role="tablist">
            {([["live", "En vivo"], ["sales", "Ventas de hoy"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-3 sm:grid-cols-4 sm:px-5">
          {PHASES.map(([k, l]) => {
            const n = p.live.total[k];
            return (
              <div key={k} className="min-w-0 rounded-xl bg-zinc-50 px-2.5 py-2 sm:px-3 dark:bg-white/[0.03]">
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
                  {/* Siempre del color de su paso: es también la leyenda de los puntos del mapa. */}<i className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT[k]} ${n ? "" : "opacity-50"}`} /><span className="truncate">{l}</span>
                </span>
                <b className={`mt-1 block text-[20px] font-semibold leading-none tabular-nums ${n ? "text-zinc-900 dark:text-white" : "text-zinc-300 dark:text-zinc-600"}`}>{n}</b>
              </div>
            );
          })}
        </div>
        {/* El mundo entero también en el celular (chico, pero sin tener que deslizar). */}
        <div className="relative px-2 pb-2 sm:px-5">
          <div className="mx-auto max-w-[960px]">
            <WorldMap values={values} tone={mode} empty="" dots={dots} />
          </div>
          {empty && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-zinc-900/80 px-3 py-1 text-[12.5px] font-medium text-zinc-400 ring-1 ring-white/10">
                {mode === "live" ? "Nadie conectado ahora" : "Todavía no hay ventas hoy"}
              </span>
            </p>
          )}
        </div>
        {/* Una sola fila de alto fijo: los países (los que no entran, «+N») y, en vivo, qué color es cada paso. */}
        <div className="flex h-[46px] items-center gap-3 overflow-hidden border-t border-zinc-100 px-4 sm:px-5 dark:border-white/[0.05]">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {list.slice(0, 8).map(([cc, n]) => (
              <span key={cc} title={countryName(cc)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums dark:bg-zinc-800">
                <Flag cc={cc} w={16} />{n}
              </span>
            ))}
            {list.length > 8 && <span className="shrink-0 text-[12px] text-zinc-500">+{list.length - 8}</span>}
            {!list.length && <span className="truncate text-[12px] text-zinc-500">{mode === "live" ? "Sin países por ahora" : "Sin ventas hoy"}</span>}
          </span>
          {mode === "live" && (
            <span className="flex shrink-0 items-center gap-2.5 text-[11px] text-zinc-500" aria-label="Colores de los puntos">
              {PHASES.map(([k, l]) => (
                <span key={k} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: PHASE_HEX[k] }} /><span className="hidden sm:inline">{l}</span></span>
              ))}
            </span>
          )}
        </div>
      </section>

      {/* Los últimos pagos son una tabla (como Clientes de la plataforma anterior): a lo ancho, y al lado de lo que
          va haciendo cada persona solo en pantallas muy anchas. */}
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ClientsPanel />
        <EventsByPerson />
      </div>
    </div>
  );
}
