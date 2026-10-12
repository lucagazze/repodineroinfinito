"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

/**
 * Mails de compradores sin leer: burbuja roja en «Mails» del menú y en la
 * barra del celular, y «(3) Panel» en la pestaña. Un solo pedido cada 30 s
 * (aunque esté montado tres veces) y otro un rato después de cambiar de
 * página: abrir un mail lo marca leído y el número baja sin recargar.
 * Es un fetch común y no una server action: una server action en curso al
 * tocar un link hace que Next vuelva a pedir la página entera al llegar, y en
 * un celular lento eso era otra página completa por cada toque.
 */

let count: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let observer: MutationObserver | null = null;
const subs = new Set<(n: number) => void>();
/** Por tienda (las pestañas de tienda en Mails), con el mismo pedido. */
let byStore: Record<string, number> | null = null;
const storeSubs = new Set<(m: Record<string, number>) => void>();

const PREFIX = /^\(\d+\+?\)\s*/;
let sets: number[] = [];
function applyTitle() {
  const cur = document.title;
  const base = cur.replace(PREFIX, "").trim();
  // Al navegar, React saca el <title> un momento. Sin título no se pone nada: «(3) » el navegador lo
  // devuelve como «(3)», nunca quedaba igual y se volvía a poner sin fin (la página se colgaba,
  // en el iPhone se cerraba). Cuando llega el título nuevo, el observador le pone el número.
  if (!base) return;
  const next = count ? `(${count > 99 ? "99+" : count}) ${base}` : base;
  if (cur.trim() === next) return;
  // Por las dudas: nunca más de 10 cambios en 2 s.
  const now = Date.now();
  sets = sets.filter((t) => now - t < 2000);
  if (sets.length >= 10) return;
  sets.push(now);
  document.title = next;
}

function poll() {
  if (inflight || document.visibilityState === "hidden") return inflight;
  inflight = fetch("/api/admin/mails/unread", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { count?: number; stores?: Record<string, number> } | null) => {
      if (typeof j?.count !== "number") return;
      if (j.count !== count) { count = j.count; subs.forEach((f) => f(j.count!)); }
      if (j.stores) { byStore = j.stores; storeSubs.forEach((f) => f(j.stores!)); }
      applyTitle();
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}
/** Después de navegar: primero que llegue la página, después se cuenta. */
function pollSoon() {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { soon = null; void poll(); }, 2500);
}

function start() {
  if (!timer) timer = setInterval(poll, 30_000);
  // Next cambia el título al navegar: se vuelve a poner el número.
  if (!observer) {
    observer = new MutationObserver(() => { if (count) applyTitle(); });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  }
  document.addEventListener("visibilitychange", poll);
}
function stop() {
  if (timer) clearInterval(timer);
  if (soon) clearTimeout(soon);
  timer = soon = null;
  observer?.disconnect();
  observer = null;
  document.removeEventListener("visibilitychange", poll);
}

export default function MailsUnread({ variant = "badge" }: { variant?: "badge" | "icon" }) {
  const [n, setN] = useState(count ?? 0);
  const path = usePathname();
  const q = useSearchParams().toString();

  useEffect(() => {
    subs.add(setN);
    if (count === null) void poll();
    start();
    return () => { subs.delete(setN); if (!subs.size && !storeSubs.size) stop(); };
  }, []);
  // Al cambiar de página (o de mail abierto) se vuelve a contar, sin competir con la página que llega.
  // El número en la pestaña vuelve enseguida (el título nuevo puede llegar un poco después de la página).
  useEffect(() => {
    if (count === null) return;
    pollSoon();
    const t = setTimeout(applyTitle, 700);
    return () => clearTimeout(t);
  }, [path, q]);

  const bubble = n > 0 && (
    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white shadow-sm shadow-red-500/30"
      aria-label={`${n} mails sin leer`}>
      {n > 99 ? "99+" : n}
    </span>
  );
  if (variant === "badge") return bubble || null;
  return (
    <Link href="/admin/mails" prefetch={false} aria-label={n ? `Mails: ${n} sin leer` : "Mails"}
      className="relative flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white">
      <Mail className="h-[17px] w-[17px]" />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5">{bubble}</span>}
    </Link>
  );
}

/**
 * «Mi Tienda 12» en las pestañas de tienda de Mails: los sin leer de esa
 * tienda, con el mismo pedido que la burbuja (cada 30 s y al rato de navegar:
 * abrir un mail baja el número sin recargar). Nada si no hay.
 */
export function StoreUnread({ storeId, initial }: { storeId: string; initial: number }) {
  const [m, setM] = useState<Record<string, number> | null>(byStore);
  useEffect(() => {
    storeSubs.add(setM);
    start();
    return () => { storeSubs.delete(setM); if (!subs.size && !storeSubs.size) stop(); };
  }, []);
  const n = m ? m[storeId] ?? 0 : initial;
  if (n <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-violet-500 px-1 align-[1px] text-[10px] font-black leading-none text-white"
      aria-label={`${n} sin leer`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
