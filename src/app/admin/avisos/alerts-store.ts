"use client";

import { useEffect, useState } from "react";
import type { BellItem } from "@/app/api/admin/avisos/route";

/**
 * Los avisos abiertos para la campanita (montada dos veces: menú y barra del
 * celular) y el «Resuelto» de cada aviso, en un solo lugar: un pedido por
 * minuto para todas, y al resolver todo baja al instante (la campanita, la
 * fila de Avisos) aunque el servidor tarde. Con fetch común, no server actions.
 */

export type BellData = { count: number; items: BellItem[] };
type Toast = { id: string; title: string; error?: string } | null;

let data: BellData | null = null;
/** Resueltos desde esta pestaña: se esconden ya, sin esperar al servidor (y vuelven con «Deshacer»). */
const resolved = new Set<string>();
/** Resoluciones en vuelo: la cuenta baja antes de que conteste el servidor. */
let inflightN = 0;
let toast: Toast = null;
let toastT: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let req: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const view = (): BellData | null =>
  data && { count: Math.max(0, data.count - inflightN), items: data.items.filter((i) => !resolved.has(i.id)) };
export const isResolved = (id: string) => resolved.has(id);
export const currentToast = () => toast;

export function poll() {
  if (req || document.visibilityState === "hidden") return req;
  req = fetch("/api/admin/avisos", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: BellData | null) => { if (j && typeof j.count === "number") { data = j; emit(); } })
    .catch(() => {})
    .finally(() => { req = null; });
  return req;
}
/** Después de navegar: primero que llegue la página, después se pide. */
export function pollSoon() {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { soon = null; void poll(); }, 2500);
}

export function subscribe(fn: () => void) {
  subs.add(fn);
  if (!timer) {
    timer = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
  }
  if (!data) void poll();
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) { clearInterval(timer); timer = null; document.removeEventListener("visibilitychange", poll); }
  };
}

function showToast(t: Toast) {
  toast = t;
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => { toast = null; emit(); }, 5000);
  emit();
}
export function dismissToast() {
  if (toastT) clearTimeout(toastT);
  toast = null;
  emit();
}

async function send(id: string, undo: boolean) {
  const r = await fetch("/api/admin/avisos", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, undo }) });
  const j = (await r.json().catch(() => null)) as (BellData & { error?: string }) | null;
  if (!r.ok || !j || typeof j.count !== "number") throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j;
}

/** «Resuelto»: se esconde ya; 5 s para «Deshacer». */
export async function resolveAlert(id: string, title: string) {
  if (resolved.has(id)) return;
  resolved.add(id);
  inflightN++;
  showToast({ id, title });
  try {
    data = await send(id, false);
  } catch (e) {
    resolved.delete(id);
    showToast({ id, title, error: `No se pudo marcar como resuelto (${(e as Error).message}).` });
  } finally {
    inflightN--;
    emit();
  }
}

export async function undoResolve(id: string) {
  resolved.delete(id);
  dismissToast();
  try { data = await send(id, true); } catch { /* el próximo pedido lo corrige */ }
  emit();
}

/** Para los componentes: se redibujan cuando cambia algo (cuenta, lista, «Deshacer»). */
export function useAlerts() {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return { data: view(), toast: currentToast() };
}
