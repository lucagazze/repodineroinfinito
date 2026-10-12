"use client";

import { useEffect } from "react";

/**
 * Pixel de Meta en el navegador. Inicializa SOLO los pixels que se le pasan
 * (los de la oferta + los de la tienda marcados para todas) y manda PageView.
 * La compra la manda también el servidor por la API de Conversiones con el
 * mismo eventID, así que Meta la cuenta una vez.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq; __pixelsInit?: Set<string>; __pixelSent?: Set<string> }
}

function ensureFbq() {
  if (typeof window === "undefined" || window.fbq) return;
  const n = function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).callMethod ? (n as any).callMethod(...args) : (n as any).queue.push(args);
  } as Fbq;
  window.fbq = n;
  window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
}

/** Manda un evento a cada pixel inicializado de esta página. */
export function track(pixels: string[], event: string, params: Record<string, unknown> = {}, eventID?: string) {
  if (typeof window === "undefined" || !window.fbq || !pixels.length) return;
  for (const id of pixels) window.fbq("trackSingle", id, event, params, eventID ? { eventID } : undefined);
}

type PixelEvent = { name: string; params?: Record<string, unknown>; eventID?: string };

/** true = ya se mandó antes (en esta página o en otra de este navegador); si no, lo marca. */
function once(key: string): boolean {
  window.__pixelSent ??= new Set();
  if (window.__pixelSent.has(key)) return true;
  window.__pixelSent.add(key);
  try {
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* sin almacenamiento (navegador privado): queda la marca de esta página */ }
  return false;
}

export function MetaPixel({ pixels, events = [] }: { pixels: string[]; events?: PixelEvent[] }) {
  useEffect(() => {
    if (!pixels.length) return;
    ensureFbq();
    window.__pixelsInit ??= new Set();
    const fresh = pixels.filter((id) => !window.__pixelsInit!.has(id));
    for (const id of fresh) {
      window.fbq!("init", id);
      window.__pixelsInit.add(id);
      window.fbq!("trackSingle", id, "PageView");
    }
    // Eventos de la página (la compra en gracias): con eventID, Meta descarta
    // el duplicado de la API de Conversiones. Pero cada pantalla después de pagar
    // (cada OTO, cada downsell, gracias) la volvía a mandar: un píxel recibió
    // 6 y 12 «Purchase» por un solo pedido. Ahora sale una sola vez
    // por pedido en este navegador.
    for (const e of events) {
      if (e.eventID && once(`fbev:${e.name}:${e.eventID}`)) continue;
      track(pixels, e.name, e.params, e.eventID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixels.join(",")]);
  return null;
}

/** _fbp y _fbc para la API de Conversiones. _fbc sale del fbclid del anuncio si la cookie no está. */
export function fbIds() {
  if (typeof document === "undefined") return {};
  const cookie = (k: string) => document.cookie.split("; ").find((c) => c.startsWith(k + "="))?.split("=")[1];
  const fbclid = new URLSearchParams(location.search).get("fbclid");
  return {
    fbp: cookie("_fbp"),
    fbc: cookie("_fbc") ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined),
    url: location.href.slice(0, 500),
  };
}
