"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

/**
 * Mapa del mundo liviano: los países ya vienen proyectados como paths SVG
 * (world-map-data.ts, Natural Earth 110m) y se cargan aparte, recién cuando
 * el mapa se muestra. Sin d3 ni topojson en el navegador.
 */

type Data = { W: number; H: number; shapes: [string, string][]; points: Record<string, [number, number]> };
let loading: Promise<Data> | null = null;
const load = () => (loading ??= import("./world-map-data").then((m) => ({ W: m.WORLD_W, H: m.WORLD_H, shapes: m.WORLD_SHAPES, points: m.WORLD_POINTS })));

export type MapValue = { cc: string; value: number; label: string };
/**
 * Un punto en una ciudad (posición de la ciudad, ≈ 10 km; nunca la exacta), con su color y su
 * texto (ciudad · oferta · paso). n = cuántas personas: el punto crece un poco con más gente.
 */
export type MapDot = { key: string; lat: number; lon: number; color: string; label: string; n: number };

/**
 * La misma proyección con la que se dibujaron los países (Natural Earth I, world-map-data.ts:
 * 1000 de ancho, centrada en el meridiano 0), para ubicar una latitud y longitud en el mapa.
 */
const SCALE = 180.596, CX = 500, CY = 250.3;
export function project(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180, p2 = p * p, p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [CX + SCALE * x, CY - SCALE * y];
}

let regions: Intl.DisplayNames | null = null;
export const countryName = (cc: string) => {
  try { regions ??= new Intl.DisplayNames(["es"], { type: "region" }); return regions.of(cc.toUpperCase()) ?? cc; } catch { return cc; }
};

const TONE = {
  live: { fill: "fill-emerald-500", dot: "bg-emerald-500", halo: "rgba(16,185,129,.22)" },
  sales: { fill: "fill-violet-500", dot: "bg-violet-600", halo: "rgba(124,58,237,.2)" },
};

function WorldMap({ values, tone, empty, dots }: {
  values: MapValue[]; tone: "live" | "sales"; empty: string;
  /** Puntos por ciudad (en vivo): si vienen, van estos en vez de un punto por país. */
  dots?: MapDot[];
}) {
  const [d, setD] = useState<Data | null>(null);
  const [hover, setHover] = useState<{ cc: string; x: number; y: number; text?: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let on = true;
    load().then((x) => on && setD(x)).catch(() => { loading = null; });
    return () => { on = false; };
  }, []);

  const byCc = useMemo(() => new Map(values.map((v) => [v.cc.toUpperCase(), v])), [values]);
  const max = Math.max(1, ...values.map((v) => v.value));
  const t = TONE[tone];

  const at = (e: React.MouseEvent | React.PointerEvent, cc: string, text?: string) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setHover({ cc, x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const hv = hover ? byCc.get(hover.cc) : undefined;
  const W = d?.W ?? 1000, H = d?.H ?? 432;
  // Los países sin actividad, todos en un solo path (antes ~180 nodos del DOM, uno por país):
  // solo los que tienen gente o ventas van sueltos, para pintarlos y mostrar su globo.
  const rest = useMemo(() => (d ? d.shapes.filter(([cc]) => !byCc.has(cc)).map(([, p]) => p).join(" ") : ""), [d, byCc]);

  // ---- Zoom: k = aumento,
  // (cx, cy) = el centro de lo que se ve, en fracción del mapa. Botones, doble clic y arrastrar.
  const [z, setZ] = useState({ k: 1, cx: 0.5, cy: 0.5 });
  const clampZ = (k: number, cx: number, cy: number) => {
    k = Math.min(16, Math.max(1, k));
    const h = 0.5 / k;
    return { k, cx: Math.min(1 - h, Math.max(h, cx)), cy: Math.min(1 - h, Math.max(h, cy)) };
  };
  const zoomBy = (f: number, cx = z.cx, cy = z.cy) => setZ(clampZ(z.k * f, cx, cy));
  // Acercar hasta que se vean todos los puntos (o los países con actividad).
  const fit = () => {
    const pts: [number, number][] = dots?.length ? dots.map((o) => { const [x, y] = project(o.lon, o.lat); return [x / W, y / H]; })
      : d ? values.map((v) => d.points[v.cc.toUpperCase()]).filter(Boolean).map((q) => [q![0] / W, q![1] / H] as [number, number]) : [];
    if (!pts.length) return;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const k = Math.min(12, 0.7 / Math.max(w, h, 0.06));
    setZ(clampZ(k, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2));
  };
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { if (z.k > 1) drag.current = { x: e.clientX, y: e.clientY, cx: z.cx, cy: z.cy, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current, r = box.current?.getBoundingClientRect();
    if (!g || !r) return;
    const dx = (e.clientX - g.x) / (r.width * z.k), dy = (e.clientY - g.y) / (r.height * z.k);
    if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 3) g.moved = true;
    setZ(clampZ(z.k, g.cx - dx, g.cy - dy));
  };
  const onUp = () => { drag.current = null; };
  const onDbl = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    // Dónde tocó, en fracción del mapa (con el zoom de ahora).
    const fx = z.cx + ((e.clientX - r.left) / r.width - 0.5) / z.k, fy = z.cy + ((e.clientY - r.top) / r.height - 0.5) / z.k;
    zoomBy(2, fx, fy);
  };
  // Ctrl + ruedita (o pellizco en el touchpad): acerca o aleja dejando fijo lo que está bajo el
  // mouse. Escucha nativa no pasiva: si no, el navegador hace zoom de la página entera.
  const wheelAt = useRef(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      wheelAt.current = Date.now();
      const r = el.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width - 0.5, my = (e.clientY - r.top) / r.height - 0.5;
      setZ((p) => {
        const k = Math.min(16, Math.max(1, p.k * Math.exp(-e.deltaY * 0.0025)));
        const fx = p.cx + mx / p.k, fy = p.cy + my / p.k, h = 0.5 / k;
        return { k, cx: Math.min(1 - h, Math.max(h, fx - mx / k)), cy: Math.min(1 - h, Math.max(h, fy - my / k)) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const view = { transformOrigin: "0 0", transform: `translate(${(0.5 - z.cx * z.k) * 100}%, ${(0.5 - z.cy * z.k) * 100}%) scale(${z.k})`, transition: drag.current || Date.now() - wheelAt.current < 300 ? "none" : "transform .25s ease" };

  return (
    <div ref={box} className={`relative w-full select-none overflow-hidden ${z.k > 1 ? "cursor-grab active:cursor-grabbing" : ""}`} style={{ aspectRatio: `${W} / ${H}`, touchAction: z.k > 1 ? "none" : "auto" }}
      onMouseLeave={() => { setHover(null); onUp(); }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl}>
      <div className="absolute inset-0" style={view}>
      {d ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img" aria-label="Mapa por país">
          <path d={rest} className="fill-zinc-200 stroke-white dark:fill-zinc-800 dark:stroke-[#111113]" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
          <g>
            {d.shapes.map(([cc, path]) => {
              const v = byCc.get(cc);
              if (!v) return null;
              return (
                <path key={cc} d={path}
                  className={`${t.fill} stroke-white transition-[fill-opacity] dark:stroke-[#111113] ${hover?.cc === cc ? "!stroke-zinc-900 dark:!stroke-white" : ""}`}
                  strokeWidth={hover?.cc === cc ? 1.2 : 0.5} vectorEffect="non-scaling-stroke"
                  style={{ fillOpacity: 0.3 + 0.6 * (v.value / max) }}
                  onMouseMove={(e) => at(e, cc)} onClick={(e) => at(e, cc)} />
              );
            })}
          </g>
        </svg>
      ) : <div className="sk h-full w-full rounded-xl" />}

      {/* Un punto por país con actividad (los chicos, como Malta o Singapur, no tienen forma a esta
          escala). En HTML encima del mapa y en px fijos: chicos en cualquier pantalla (6 a 9 px según
          cuántos haya) con un halo suave QUIETO. Sin animación: el latido (antes en el SVG, después
          en CSS) tenía el celular ocupado entre 25 y 60 % con la página quieta. */}
      {d && dots && dots.map((dot, i) => {
        const [x, y] = project(dot.lon, dot.lat);
        const size = Math.round(6 + 2 * Math.min(3, Math.sqrt(dot.n - 1 || 0)));
        // Varios pasos en la misma ciudad: un poco corridos para que se vean los dos colores.
        const dup = dots.findIndex((o) => o.lat === dot.lat && o.lon === dot.lon);
        const shift = i === dup ? 0 : (i - dup) * 5;
        return (
          <span key={dot.key} className="absolute cursor-pointer p-1"
            style={{ left: `calc(${(x / W) * 100}% + ${shift / z.k}px)`, top: `${(y / H) * 100}%`, transform: `translate(-50%, -50%) scale(${1 / z.k})` }}
            onMouseMove={(e) => at(e, "", dot.label)} onClick={(e) => at(e, "", dot.label)}>
            <span className="flex items-center justify-center rounded-full" style={{ width: size + 7, height: size + 7, background: `${dot.color}38` }}>
              <span className="block rounded-full ring-[1.5px] ring-[#111113]" style={{ width: size, height: size, background: dot.color }} />
            </span>
          </span>
        );
      })}

      {d && !dots && values.map((v) => {
        const p = d.points[v.cc.toUpperCase()];
        if (!p) return null;
        const size = Math.round(6 + 3 * Math.sqrt(v.value / max));
        return (
          <span key={v.cc} className="absolute cursor-pointer p-1"
            style={{ left: `${(p[0] / W) * 100}%`, top: `${(p[1] / H) * 100}%`, transform: `translate(-50%, -50%) scale(${1 / z.k})` }}
            onMouseMove={(e) => at(e, v.cc.toUpperCase())} onClick={(e) => at(e, v.cc.toUpperCase())}>
            <span className="flex items-center justify-center rounded-full" style={{ width: size + 8, height: size + 8, background: t.halo }}>
              <span className={`block rounded-full ring-[1.5px] ring-white dark:ring-[#111113] ${t.dot}`} style={{ width: size, height: size }} />
            </span>
          </span>
        );
      })}

      </div>

      {d && (
        <div className="absolute right-2 top-2 z-[5] flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white/90 text-zinc-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-200"
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Acercar" onClick={() => zoomBy(2)} className="h-7 w-7 text-[16px] font-bold leading-none hover:bg-black/5 dark:hover:bg-white/10">+</button>
          <button type="button" aria-label="Alejar" onClick={() => zoomBy(0.5)} disabled={z.k <= 1} className="h-7 w-7 border-t border-black/10 text-[16px] font-bold leading-none hover:bg-black/5 disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/10">−</button>
          <button type="button" aria-label="Ver los puntos" title="Acercar hasta los puntos" onClick={fit} className="h-7 w-7 border-t border-black/10 text-[13px] leading-none hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">◎</button>
          {z.k > 1 && <button type="button" aria-label="Ver el mundo entero" title="Mundo entero" onClick={() => setZ({ k: 1, cx: 0.5, cy: 0.5 })} className="h-7 w-7 border-t border-black/10 text-[12px] leading-none hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">⟲</button>}
        </div>
      )}

      {d && !values.length && !dots?.length && empty && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11.5px] font-semibold text-zinc-400">{empty}</p>
      )}

      {hover && (
        <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[12px] shadow-xl dark:border-white/10 dark:bg-zinc-900"
          style={{ left: Math.min(hover.x + 12, (box.current?.clientWidth ?? 0) - 170), top: Math.max(hover.y - 52, 0) }}>
          {hover.text ? <b className="block text-zinc-900 dark:text-white">{hover.text}</b> : (
            <>
              <b className="flex items-center gap-1.5 text-zinc-900 dark:text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://flagcdn.com/20x15/${hover.cc.toLowerCase()}.png`} alt="" width={16} height={12} className="rounded-[2px]" />
                {countryName(hover.cc)}
              </b>
              <span className="mt-0.5 block font-semibold text-zinc-500">{hv ? hv.label : tone === "live" ? "Nadie conectado" : "Sin ventas hoy"}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Solo se vuelve a dibujar si cambiaron los países o los números: el panel pide
 * los datos cada 5 s y redibujar todo el mapa en un celular lento trababa la página.
 */
export default memo(WorldMap, (a, b) => a.tone === b.tone && a.empty === b.empty && JSON.stringify(a.values) === JSON.stringify(b.values) && JSON.stringify(a.dots ?? null) === JSON.stringify(b.dots ?? null));
