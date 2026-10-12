"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { playCashSound } from "./cash-sound";

type Toast = { id: number; title: string; body: string; url: string };

/**
 * Con el panel abierto también se ve cada notificación (pedido, post-compra, mail…): el iPhone no
 * muestra el banner de una notificación web con la app en primer plano. El service worker le pasa
 * cada push a las pestañas abiertas (public/admin-sw.js) y acá aparece arriba unos segundos; tocarla
 * abre lo mismo que la notificación.
 */
export default function PushToast() {
  const [list, setList] = useState<Toast[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let n = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const on = (e: MessageEvent) => {
      const m = e.data as { type?: string; data?: { title?: string; body?: string; url?: string; kind?: string } } | null;
      if (m?.type !== "push" || !m.data || document.visibilityState !== "visible") return;
      // Cada venta y cada OTO aceptado: la caja registradora.
      if (m.data.kind === "sale" || m.data.kind === "oto") playCashSound();
      const id = Date.now() * 10 + (++n % 10);
      const t = { id, title: m.data.title || "Panel", body: m.data.body || "", url: m.data.url || "/admin" };
      setList((l) => [t, ...l].slice(0, 3));
      timers.push(setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 10_000));
    };
    navigator.serviceWorker.addEventListener("message", on);
    return () => {
      navigator.serviceWorker.removeEventListener("message", on);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!list.length) return null;
  const close = (id: number) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[460] mx-auto flex max-w-[420px] flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/10 bg-zinc-900/95 px-3.5 py-3 text-white shadow-2xl backdrop-blur">
          <button type="button" onClick={() => { close(t.id); router.push(t.url); }} className="flex min-w-0 flex-1 items-start gap-3 text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-192.png?v=3" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-xl" />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-bold">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-[12.5px] leading-snug text-zinc-300">{t.body}</span>}
            </span>
          </button>
          <button type="button" aria-label="Cerrar" onClick={() => close(t.id)} className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
