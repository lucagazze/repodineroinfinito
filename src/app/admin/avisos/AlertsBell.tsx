"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { pollSoon, resolveAlert, undoResolve, dismissToast, useAlerts } from "./alerts-store";

const DOT: Record<string, string> = { error: "bg-red-500", warn: "bg-amber-500", info: "bg-sky-500" };

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60_000));
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};

/**
 * Campanita del encabezado: cuántos avisos abiertos hay y los últimos 10, cada
 * uno con su «×» para marcarlo resuelto al instante (con «Deshacer» 5 s). Un
 * solo pedido por minuto para las dos campanitas (alerts-store), con fetch
 * común: antes era una server action y cada consulta podía hacer que Next
 * pidiera otra vez la página al navegar. align="left" en el menú lateral (el
 * desplegable se abre hacia la página), "right" en la barra del celular.
 */
export default function AlertsBell({ className = "", align = "right" }: { className?: string; align?: "left" | "right" }) {
  const { data } = useAlerts();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  // Al cambiar de página: cerrar y volver a contar (después de que llegue la página).
  useEffect(() => { setOpen(false); pollSoon(); }, [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const n = data?.count ?? 0;
  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) pollSoon(); }}
        aria-label={n ? `${n} avisos sin resolver` : "Avisos"}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <Bell className="h-[17px] w-[17px]" />
        {n > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white shadow-sm shadow-red-500/30">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {open && (
        // En el celular ocupa el ancho de la pantalla; en la compu cuelga del botón.
        <div className={`fixed inset-x-3 top-16 z-[400] lg:absolute lg:inset-x-auto lg:top-11 lg:w-[360px] ${align === "left" ? "lg:left-0" : "lg:right-0"} overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.08] dark:bg-zinc-900`}>
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-white/[0.05]">
            <b className="text-[13.5px] font-semibold text-zinc-900 dark:text-white">Avisos</b>
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{n ? `${n} sin resolver` : "Todo en orden"}</span>
          </div>
          {!data?.items.length ? (
            <p className="m-0 px-4 py-6 text-center text-[12.5px] text-zinc-500">{data ? "No hay avisos abiertos." : "Cargando…"}</p>
          ) : (
            <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto p-0">
              {data.items.map((a) => (
                <li key={a.id} className="flex items-start border-b border-zinc-100 last:border-b-0 dark:border-white/[0.04]">
                  <Link href={a.link ?? "/admin/avisos"} className="flex min-w-0 flex-1 gap-2.5 py-2.5 pl-4 pr-1 no-underline hover:bg-zinc-50 dark:hover:bg-white/[0.03]">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.severity] ?? DOT.info}`} />
                    <span className="min-w-0">
                      <span data-pv-blur className="line-clamp-2 block text-[12.5px] font-medium leading-snug text-zinc-800 dark:text-zinc-100">{a.title}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-400">{ago(a.created_at)}</span>
                    </span>
                  </Link>
                  <button type="button" onClick={() => void resolveAlert(a.id, a.title)} title="Marcar como resuelto" aria-label={`Marcar como resuelto: ${a.title}`}
                    className="m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/avisos" className="block border-t border-zinc-100 px-4 py-2.5 text-center text-[12.5px] font-semibold text-violet-600 no-underline hover:bg-zinc-50 dark:border-white/[0.05] dark:text-violet-400 dark:hover:bg-white/[0.03]">
            Ver todos los avisos
          </Link>
        </div>
      )}
    </div>
  );
}

/** «Aviso resuelto · Deshacer» abajo de la pantalla, 5 s. Una sola vez en el panel (Shell). */
export function AlertsToast() {
  const { toast } = useAlerts();
  if (!toast) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-4 z-[450] mx-auto flex max-w-[420px] items-center gap-3 rounded-2xl border border-black/[0.08] bg-zinc-900 px-4 py-3 text-[13px] text-white shadow-2xl dark:border-white/10 dark:bg-zinc-800">
      {toast.error
        ? <span className="min-w-0 flex-1 text-amber-300">{toast.error}</span>
        : <span className="flex min-w-0 flex-1 items-center gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /><span className="truncate">Aviso resuelto</span></span>}
      {!toast.error && (
        <button type="button" onClick={() => void undoResolve(toast.id)} className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold text-violet-300 hover:bg-white/10">Deshacer</button>
      )}
      <button type="button" onClick={dismissToast} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
    </div>
  );
}
