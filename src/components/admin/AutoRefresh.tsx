"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { pollPaused } from "./poll";

/**
 * Las páginas con datos se actualizan solas: cada 30 s, mientras la pestaña
 * está a la vista, se vuelve a pedir la página al servidor (router.refresh:
 * no se pierde lo que hay en pantalla ni el scroll). Las pantallas donde se
 * edita (productos, checkouts, configuración) no, para no pisar lo que se
 * está escribiendo. Muestra hace cuánto se actualizó y un botón para hacerlo ya.
 */

// Cada cuánto se vuelve a pedir la página entera. El Inicio general ya actualiza solo lo que está en
// vivo (compras, eventos, conectados), así que la página completa va cada 2 min; En vivo se actualiza
// solo y no entra. Volver a pedir la página es pesado en un celular: solo con la pestaña a la vista,
// sin navegar y con el dueño quieto 10 s (si está tocando o bajando, se espera).
const EVERY: [RegExp, number][] = [
  [/^\/admin$/, 120_000],
  [/^\/admin\/o\/[^/]+$/, 60_000], [/^\/admin\/o\/[^/]+\/(ventas|clientes|carritos|estadisticas|ads)(\/[^/]+)?$/, 60_000],
  [/^\/admin\/o\/[^/]+\/configuracion\/dominios$/, 60_000],
];
const IDLE_MS = 10_000;
let touchedAt = 0;
if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(ev, () => { touchedAt = Date.now(); }, { passive: true, capture: true });
}

export default function AutoRefresh({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const every = EVERY.find(([re]) => re.test(path))?.[1] ?? 0;
  const on = every > 0;
  const [at, setAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  // No se encima una actualización con otra (en un celular lento, una tarda más que el intervalo).
  const busy = useRef(false);
  busy.current = pending;
  const last = useRef(Date.now());

  const refresh = useCallback(() => {
    start(() => router.refresh());
    last.current = Date.now();
    setAt(last.current);
  }, [router]);

  // Al recargar (abrir la página o tocar «Actualizar») también se traen los cobros nuevos de Stripe
  // y el gasto de Meta, y después se vuelve a pedir la página con lo facturado al día.
  const [syncing, setSyncing] = useState(false);
  const syncNow = useCallback(async (force: boolean) => {
    setSyncing(true);
    try {
      const r = await fetch("/api/admin/sync-plata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force }) });
      const j = await r.json().catch(() => ({}));
      if (j.saved) refresh();
    } catch { /* sin red: queda lo que hay */ }
    finally { setSyncing(false); }
  }, [refresh]);
  const syncedOnce = useRef(false);
  useEffect(() => { if (!syncedOnce.current) { syncedOnce.current = true; void syncNow(false); } }, [syncNow]);
  const manual = useCallback(() => { refresh(); void syncNow(true); }, [refresh, syncNow]);

  // Al cambiar de página, la cuenta arranca de nuevo (la página recién llegó del servidor).
  useEffect(() => { last.current = Date.now(); setAt(last.current); }, [path]);

  useEffect(() => {
    const due = () => on && !busy.current && !pollPaused() && Date.now() - touchedAt >= IDLE_MS && Date.now() - last.current >= every;
    // Cada 5 s solo se mira si toca actualizar (sin redibujar nada); el «hace X» se redibuja
    // cada 30 s, en minutos: un reloj en segundos redibujaba el menú sin parar en el celular.
    const tick = setInterval(() => { if (due()) refresh(); }, 5000);
    const label = setInterval(() => setNow(Date.now()), 30_000);
    const onVis = () => { setNow(Date.now()); if (due()) refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(tick); clearInterval(label); document.removeEventListener("visibilitychange", onVis); };
  }, [on, every, refresh]);

  const s = Math.max(0, Math.round((now - at) / 1000));
  const ago = s < 60 ? "recién" : `hace ${Math.floor(s / 60)} min`;
  const btn = (
    <button type="button" onClick={manual} disabled={pending || syncing} title="Actualizar ahora (también lo facturado en Stripe y el gasto en Meta)" aria-label="Actualizar ahora"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:hover:bg-white/5 dark:hover:text-white">
      <RefreshCw className={`h-3.5 w-3.5 ${pending || syncing ? "animate-spin" : ""}`} />
    </button>
  );
  if (compact) return btn;
  return (
    <div className="flex items-center gap-1.5 px-1 text-[10.5px] font-semibold text-zinc-400" aria-live="off">
      {on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title={`Se actualiza sola cada ${Math.round(every / 60_000)} min`} />}
      <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>Actualizado {ago}</span>
      {btn}
    </div>
  );
}
