"use client";

import { useEffect, useRef } from "react";

/**
 * El reloj de todo lo que el panel actualiza solo (en vivo, últimas compras,
 * eventos, avisos). Antes cada parte tenía su setInterval: se pisaban, seguían
 * pidiendo con la pestaña oculta o en plena navegación y, en un celular lento,
 * trababan los cambios de página. Ahora:
 *  - nunca dos pedidos de la misma parte a la vez (el próximo se agenda cuando
 *    termina el anterior);
 *  - nada mientras la pestaña está oculta, en los 6 s siguientes a tocar un
 *    link del panel (navegando) ni mientras se aplica el filtro de fechas;
 *  - si el servidor tarda, se espera más (3 veces lo que tardó, hasta 60 s);
 *  - al volver a la pestaña, se actualiza enseguida;
 *  - la PRIMERA carga de cada parte sale apenas se monta, sin ninguna de estas
 *    pausas: la pausa de navegación es para los repasos de fondo (antes, al
 *    llegar a Inicio tocando un link, «Ahora» y el mapa esperaban hasta 6 s).
 */

let navAt = 0;
if (typeof window !== "undefined") {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    const href = a?.getAttribute("href") ?? "";
    if (href.startsWith("/admin") && !a?.hasAttribute("target")) navAt = Date.now();
  }, true);
  window.addEventListener("popstate", () => { navAt = Date.now(); });
}

/** ¿Conviene esperar? (pestaña oculta, navegando o aplicando un filtro). */
export function pollPaused() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "visible" || Date.now() - navAt < 6000 || !!document.querySelector(".ad-main[data-range-loading]");
}

/** Lo que se avisa cuando entra una compra (latido de Inicio): las partes que la muestran piden ya, sin esperar su turno. */
export const SALE_EVENT = "panel:venta";

/**
 * Llama a `fn` cada `ms` mientras el componente esté montado, con las reglas de
 * arriba. `fn` recibe una señal para cancelar si el componente se desmonta.
 * Con `wake` (un evento de window, p. ej. SALE_EVENT) pide enseguida al recibirlo;
 * si justo estaba pidiendo, vuelve a pedir apenas termina.
 */
export function usePoll(fn: (signal: AbortSignal) => Promise<void>, ms: number, deps: unknown[] = [], wake?: string) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout> | null = null, running = false, again = false, first = true;
    const ctl = new AbortController();
    const schedule = (wait: number) => { if (!dead) { if (timer) clearTimeout(timer); timer = setTimeout(run, wait); } };
    async function run() {
      if (dead || running) return;
      if (!first && pollPaused()) return schedule(1500);
      first = false;
      running = true;
      const t0 = Date.now();
      try { await ref.current(ctl.signal); } catch { /* cada parte muestra su error */ }
      running = false;
      if (again) { again = false; return schedule(0); }
      schedule(Math.min(60_000, Math.max(ms, (Date.now() - t0) * 3)));
    }
    void run();
    const onVis = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void run(); } };
    const onWake = () => { if (running) again = true; else { if (timer) clearTimeout(timer); void run(); } };
    document.addEventListener("visibilitychange", onVis);
    if (wake) window.addEventListener(wake, onWake);
    return () => {
      dead = true; ctl.abort(); if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      if (wake) window.removeEventListener(wake, onWake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, wake, ...deps]);
}

/** Lee la respuesta y avisa si cambió algo desde la última (para no volver a dibujar lo mismo). */
export async function readIfChanged<T>(r: Response, last: { current: string | null }): Promise<T | null> {
  const text = await r.text();
  if (text === last.current) return null;
  last.current = text;
  return JSON.parse(text) as T;
}
