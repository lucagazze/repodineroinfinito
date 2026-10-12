"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import PushToggle from "./PushToggle";
import { playCashSound } from "./cash-sound";

/**
 * Las notificaciones en la barra de arriba: un botón que abre el mismo panel de siempre (activar, qué avisos recibe este dispositivo).
 */
export default function TopBarPush({ label }: { label?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Notificaciones"
        className={`flex h-9 items-center gap-1.5 rounded-xl px-2 text-[12.5px] font-semibold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white ${open ? "bg-zinc-100 dark:bg-white/5" : ""}`}>
        <BellRing className="h-[17px] w-[17px]" />{label && <span>Notificaciones</span>}
      </button>
      {/* Siempre montado (así revisa la suscripción al cargar); solo se ve abierto. */}
      <div className={`absolute right-0 top-11 z-[400] w-[300px] max-w-[calc(100vw-24px)] ${open ? "" : "hidden"}`}>
        <PushToggle className="shadow-xl" />
        <button type="button" onClick={playCashSound}
          className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[12px] font-semibold text-zinc-700 shadow-xl hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
          🔔 Probar el sonido de venta <span className="block text-[11px] font-normal text-zinc-500">Suena con cada venta mientras el panel está abierto.</span>
        </button>
      </div>
    </div>
  );
}
