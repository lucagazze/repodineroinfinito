/**
 * Registro de eventos desde el navegador (checkout, pos-pago, gracias) a
 * /api/ev → site_events. Todo va por sendBeacon: no se espera nada, no frena
 * el pago y sobrevive a la navegación. Las landings estáticas usan lo mismo
 * en public/t.js (mismas claves de storage, así el visitante es el mismo).
 *
 *  startPresence(page, ctx)  view al entrar, heartbeat cada 20 s solo con la
 *                            pestaña a la vista, leave al irse. Devuelve stop().
 *  track(page, event, data)  un evento suelto (lead, pay_attempt, paid…), con
 *                            el contexto (tienda/checkout/pedido) de la presencia.
 *
 * startPresence también carga Microsoft Clarity (grabaciones) cuando la página
 * ya responde y le pasa el visitor_id, y la grabación propia (rrweb → /api/rec)
 * que el panel muestra en vivo. Donde no hay presencia (vistas previas, compras
 * de prueba) tampoco hay grabación.
 */

import { clarityProject } from "./clarity";

export type Page = "landing" | "checkout" | "oferta" | "gracias";
export type TrackEvent =
  | "view" | "heartbeat" | "leave" | "lead" | "pay_attempt" | "pay_error" | "paid"
  | "oto_accept" | "oto_decline" | "download" | "cta_click";
export type TrackCtx = { store?: string | null; funnel?: string | null; order?: string | null };

const OK_ID = /^[A-Za-z0-9_-]{6,64}$/;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let ids: { vid: string; sid: string } | null = null;
let ctx: TrackCtx = {};
let pv = "";

/** Visitante (persistente) y pestaña. La landing pasa los suyos en el link al checkout (?vid=&sid=), aunque sea otro dominio. */
function who() {
  if (ids) return ids;
  const q = new URLSearchParams(location.search);
  const get = (kind: "localStorage" | "sessionStorage", key: string, param: string) => {
    const adopt = q.get(param);
    try {
      const st = window[kind];
      if (adopt && OK_ID.test(adopt)) { st.setItem(key, adopt); return adopt; }
      let v = st.getItem(key);
      if (!v || !OK_ID.test(v)) { v = rid(); st.setItem(key, v); }
      return v;
    } catch {
      return adopt && OK_ID.test(adopt) ? adopt : rid(); // modo privado: queda en memoria
    }
  };
  return (ids = { vid: get("localStorage", "algd_vid", "vid"), sid: get("sessionStorage", "algd_sid", "sid") });
}

function utm() {
  const out: Record<string, string> = {};
  let n = 0;
  new URLSearchParams(location.search).forEach((v, k) => {
    if ((/^utm_/.test(k) || k === "fbclid") && n++ < 8) out[k.slice(0, 40)] = v.slice(0, 200);
  });
  return out;
}

function send(body: Record<string, unknown>) {
  try {
    const j = JSON.stringify(body);
    if (j.length > 2000) return;
    if (navigator.sendBeacon?.("/api/ev", j)) return;
    fetch("/api/ev", { method: "POST", body: j, keepalive: true }).catch(() => {});
  } catch { /* nunca rompe la página */ }
}

/**
 * ¿Hay una persona? El primer toque, puntero, rueda o tecla queda anotado en
 * la pestaña (sessionStorage) y cada evento lo lleva (h=1). Sin eso el panel
 * la trata como posible robot. hv=1: este navegador ya manda la señal.
 */
let human = false;
let listening = false;
function watchHuman() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  try { human = sessionStorage.getItem("algd_h") === "1"; } catch { /* modo privado */ }
  const on = () => {
    if (human) return;
    human = true;
    try { sessionStorage.setItem("algd_h", "1"); } catch { /* modo privado */ }
  };
  for (const t of ["pointerdown", "pointermove", "touchstart", "keydown", "wheel"]) {
    window.addEventListener(t, on, { passive: true, capture: true });
  }
}

export function track(page: Page, event: TrackEvent, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const { vid, sid } = who();
  const quiet = event === "heartbeat" || event === "leave";
  send({
    page, event, vid, sid,
    ...(pv ? { pv } : {}),
    ...(ctx.store ? { store: ctx.store } : {}),
    ...(ctx.funnel ? { funnel: ctx.funnel } : {}),
    ...(ctx.order ? { order: ctx.order } : {}),
    path: location.pathname.slice(0, 300),
    ...(quiet ? {} : { utm: utm() }),
    ...(event === "view" && document.referrer ? { ref: document.referrer.slice(0, 500) } : {}),
    data: { ...(data ?? {}), hv: 1, ...(human ? { h: 1 } : {}) },
    // Lo maneja un programa (Playwright, Selenium…): /api/ev lo marca como robot.
    ...(navigator.webdriver ? { wd: 1 } : {}),
  });
}

// ---------------------------------------------------------------- Clarity

type ClarityFn = ((...a: unknown[]) => void) & { q?: unknown[] };
let clarityLoaded = false;

/** Paso para buscar la grabación: landing, checkout, postpago-1, gracias. */
function stepOf(page: Page) {
  if (page !== "oferta") return page;
  const n = location.pathname.match(/\/oferta\/(\d+)/);
  return n ? `postpago-${Number(n[1]) + 1}` : "postpago";
}

function clarity(page: Page, c: TrackCtx) {
  try {
    if (new URLSearchParams(location.search).get("preview") === "1") return;
    const w = window as unknown as { clarity?: ClarityFn };
    // La misma cola que el snippet oficial: las llamadas esperan al script.
    if (!w.clarity) {
      // eslint-disable-next-line prefer-rest-params
      const f: ClarityFn = function () { (f.q = f.q || []).push(arguments); };
      w.clarity = f;
    }
    const id = clarityProject({ store: c.store, host: location.hostname });
    // Sin NEXT_PUBLIC_CLARITY_ID el src quedaba en "clarity.ms/tag/" a secas:
    // una peticion muerta en CADA carga del checkout, y nada que grabar.
    if (id && !clarityLoaded && !document.querySelector('script[src*="clarity.ms/tag/"]')) {
      clarityLoaded = true;
      const load = () => {
        const s = document.createElement("script");
        s.async = true;
        s.src = `https://www.clarity.ms/tag/${id}`;
        document.head.appendChild(s);
      };
      // Con la página ya interactiva: nunca compite con Stripe ni con el pago.
      if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 4000 });
      else setTimeout(load, 1500);
    }
    const { vid, sid } = who();
    const step = stepOf(page);
    // identify: el panel filtra las grabaciones por «Custom user ID» = visitor_id.
    w.clarity!("identify", vid, sid, step, vid);
    w.clarity!("set", "vid", vid);
    w.clarity!("set", "step", step);
    if (c.funnel) w.clarity!("set", "funnel", c.funnel);
    if (c.order) w.clarity!("set", "order", c.order);
  } catch { /* nunca rompe la página */ }
}

// ------------------------------------------------------- grabación propia (rrweb)

/**
 * rrweb (MIT) desde jsDelivr, versión fija, recién cuando la página ya cargó y
 * está quieta: nunca compite con el primer pintado ni con el botón de pagar.
 * Los campos van tapados (maskAllInputs) y los emails escritos en la página
 * también. Cada ~3 s manda lo nuevo a /api/rec (gzip si el navegador puede).
 */
export const REC_LIB = "https://cdn.jsdelivr.net/npm/@rrweb/record@2.1.7/+esm";
const BOT = /bot\b|bot\/|crawler|spider|HeadlessChrome|headless|Lighthouse|Playwright|Puppeteer/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
let recording = false;

type RecordFn = (o: Record<string, unknown>) => (() => void) | undefined;

function afterLoad(fn: () => void) {
  const go = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 1500);
  };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
}

function rec(page: Page, c: TrackCtx) {
  try {
    if (recording || navigator.webdriver || BOT.test(navigator.userAgent)) return;
    const q = new URLSearchParams(location.search);
    if (q.get("preview") === "1" || q.has("norec")) return;
    recording = true;
    const where = new URLSearchParams();
    if (c.store) where.set("store", c.store);
    if (c.funnel) where.set("funnel", c.funnel);
    if (c.order) where.set("order", c.order);
    const myPv = pv;
    afterLoad(async () => {
      try {
        const cfg = await fetch(`/api/rec?c=1&${where}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!cfg?.on) return;
        // webpackIgnore: lo baja el navegador, no entra en el bundle de la página.
        const mod = (await import(/* webpackIgnore: true */ REC_LIB)) as { record: RecordFn };
        const { vid, sid } = who();
        let buf: unknown[] = [];
        let seq = 0;
        let stop: (() => void) | undefined;
        let iv: ReturnType<typeof setInterval> | undefined;
        const end = () => { try { stop?.(); } catch { /* nada */ } if (iv) clearInterval(iv); buf = []; };
        const url = (z: 0 | 1) => {
          const u = new URLSearchParams({ s: sid, v: vid, p: myPv, q: String(seq++), pg: page, path: location.pathname.slice(0, 200), z: String(z) });
          where.forEach((v, k) => u.set(k, v));
          return `/api/rec?${u}`;
        };
        const check = (r: Response) => { if (r.status === 409 || r.status === 403) end(); };
        const flush = (final = false) => {
          if (!buf.length) return;
          const json = JSON.stringify(buf);
          buf = [];
          if (final || typeof CompressionStream === "undefined") {
            // Al irse: sin esperar (sendBeacon). Lo muy grande no entra en un beacon y se pierde.
            if (json.length < 60_000 && navigator.sendBeacon?.(url(0), new Blob([json], { type: "text/plain" }))) return;
            fetch(url(0), { method: "POST", body: json, keepalive: json.length < 60_000 }).then(check).catch(() => {});
            return;
          }
          new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).blob()
            .then((z) => fetch(url(1), { method: "POST", body: z, keepalive: z.size < 60_000 }))
            .then(check).catch(() => {});
        };
        stop = mod.record({
          emit(e: unknown) { buf.push(e); if (buf.length > 500) flush(); },
          maskAllInputs: true,
          maskTextSelector: "*",
          maskTextFn: (t: string) => (t.includes("@") ? t.replace(EMAIL, (m) => m.replace(/[^@.]/g, "*")) : t),
          sampling: { mousemove: 80, scroll: 150, media: 800, input: "last" },
          slimDOMOptions: "all",
          recordCanvas: false,
          collectFonts: false,
        });
        setTimeout(() => flush(), 1000); // la foto inicial, enseguida: el panel la ve casi en vivo
        iv = setInterval(() => flush(), 3000);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
        window.addEventListener("pagehide", () => flush(true));
      } catch { /* sin grabación: la página sigue igual */ }
    });
  } catch { /* nunca rompe la página */ }
}

export function startPresence(page: Page, c: TrackCtx = {}): () => void {
  if (typeof window === "undefined") return () => {};
  ctx = c;
  pv = rid();
  watchHuman();
  clarity(page, c);
  rec(page, c);
  const t0 = Date.now();
  let last = 0;
  let gone = false;
  const beat = (ev: "view" | "heartbeat") => { last = Date.now(); gone = false; track(page, ev); };
  const leave = () => { if (!gone) { gone = true; track(page, "leave", { s: Math.round((Date.now() - t0) / 1000) }); } };

  beat("view");
  const iv = setInterval(() => { if (document.visibilityState === "visible") beat("heartbeat"); }, 20_000);
  // Vuelve a la pestaña: aparece de nuevo sin esperar al próximo latido.
  const onVis = () => { if (document.visibilityState === "visible" && Date.now() - last > 10_000) beat("heartbeat"); };
  // Volvió con «atrás» desde la caché del navegador: la misma visita sigue.
  const onShow = (e: PageTransitionEvent) => { if (e.persisted) beat("view"); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", onShow);
  return () => {
    clearInterval(iv);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", onShow);
    leave();
  };
}
