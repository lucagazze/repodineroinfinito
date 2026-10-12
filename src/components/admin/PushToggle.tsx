"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, ChevronDown, Download, Loader2, Share, SquarePlus } from "lucide-react";

/**
 * «Activar notificaciones» del menú: suscribe este dispositivo a las
 * notificaciones push (ventas, upsells y avisos de error). En iPhone solo
 * funciona con el panel instalado (Agregar a pantalla de inicio): ahí lo explica.
 *
 * Se activan UNA vez: en cada carga del panel se confirma en silencio que la
 * suscripción sigue viva y se vuelve a guardar en el servidor; si el navegador
 * la perdió pero el permiso sigue dado, se rehace sola. Nunca se da de baja
 * sola (antes, al no coincidir la clave, se borraba y había que reactivar).
 * Cada dispositivo tiene un id estable: al resuscribirse, el servidor borra
 * sus endpoints viejos (una fila por dispositivo, sin duplicados).
 */

type Kind = "sale" | "alert" | "names" | "mail" | "refund" | "dispute" | "delivery" | "oto" | "unpaid" | "ai_reply" | "bid";
type State = "loading" | "unsupported" | "ios-install" | "off" | "denied" | "on";
type InstallEvt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const SW = "/admin-sw.js";
// Sin barra final: así /admin (la pantalla de inicio de la app) también queda bajo el service worker.
const SCOPE = "/admin";
const API = "/api/admin/push";
const KINDS: [Kind, string, string][] = [
  ["sale", "Ventas", "cada venta y upsell"],
  ["mail", "Mails nuevos", "cada mail de un comprador"],
  ["refund", "Pide reembolso", "o amenaza con contracargo (lo detecta la IA)"],
  ["dispute", "Contracargos", "disputa abierta en Stripe"],
  ["delivery", "Entrega que no salió", "mail de entrega fallido o rebotado"],
  ["oto", "Fallan los upsells", "3 o más cobros fallidos en 1 hora"],
  ["unpaid", "Pedido sin pago", "figura pagado sin pago en Stripe"],
  ["ai_reply", "Respondió la IA", "cada respuesta automática"],
  ["bid", "Pujas", "cada cambio del piloto de pujas"],
  ["alert", "Otros avisos", "links rotos, webhooks"],
  ["names", "Mostrar la oferta", "si no, solo «Panel» y el monto"],
];
/** Lo que recibe un dispositivo nuevo: todo menos «Respondió la IA» y los nombres. */
const DEFAULT_KINDS: Kind[] = ["sale", "alert", "mail", "refund", "dispute", "delivery", "oto", "unpaid", "bid"];

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Otro";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, isStandalone() ? "app" : br].filter(Boolean).join(" · ");
}

/** Clave VAPID (base64url) → bytes, como la pide pushManager.subscribe. */
function keyBytes(b64: string) {
  const s = (b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** La suscripción se hizo con la clave actual: true/false; null si el navegador no la informa. */
function sameKey(sub: PushSubscription, key: string): boolean | null {
  const cur = sub.options?.applicationServerKey;
  if (!cur) return null;
  const a = new Uint8Array(cur);
  const b = keyBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Id estable de este dispositivo (en una app de iPhone, el almacenamiento de la app). */
function deviceId(): string | undefined {
  try {
    let id = localStorage.getItem("panel-device");
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
      localStorage.setItem("panel-device", id);
    }
    return id;
  } catch { return undefined; }
}
/** «Desactivar» a propósito: entonces no se vuelven a suscribir solas. */
const OFF_KEY = "panel-push-off";
const markedOff = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
const markOff = (v: boolean) => { try { if (v) localStorage.setItem(OFF_KEY, "1"); else localStorage.removeItem(OFF_KEY); } catch { /* modo privado */ } };

async function call(path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

async function registration() {
  await navigator.serviceWorker.register(SW, { scope: SCOPE, updateViaCache: "none" });
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
  ]);
  if (!ready) throw new Error("El service worker no arrancó. Recargá la página.");
  return ready;
}

// El menú se vuelve a montar en cada cambio de página: lo último que se supo
// queda acá para no parpadear ni volver a confirmar con el servidor (6 h).
let memo: { state: State; kinds: Kind[]; key: string | null; at: number } | null = null;
const FRESH_MS = 6 * 3600_000;

// beforeinstallprompt llega una sola vez por carga (Android / Chrome): se guarda para «Instalar como app».
let installEvt: InstallEvt | null = null;
const installSubs = new Set<(e: InstallEvt | null) => void>();
const setInstallEvt = (e: InstallEvt | null) => { installEvt = e; installSubs.forEach((f) => f(e)); };
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => setInstallEvt(e as InstallEvt));
  window.addEventListener("appinstalled", () => setInstallEvt(null));
}

export default function PushToggle({ className = "" }: { className?: string }) {
  const [state, setState] = useState<State>(() => memo?.state ?? "loading");
  const [kinds, setKinds] = useState<Kind[]>(() => memo?.kinds ?? DEFAULT_KINDS);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [install, setInstall] = useState<InstallEvt | null>(null);
  const [ios, setIos] = useState(false);
  const key = useRef<string | null>(memo?.key || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null);
  const sub = useRef<PushSubscription | null>(null);

  useEffect(() => {
    if (state !== "loading") memo = { state, kinds, key: key.current, at: memo?.at ?? Date.now() };
  }, [state, kinds]);

  useEffect(() => {
    setIos(isIOS());
    setInstall(installEvt);
    installSubs.add(setInstall);

    (async () => {
      if (!supported()) return setState(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
      try {
        // Siempre el mismo service worker y el mismo alcance: nunca se cambia ni se da de baja.
        const reg = await navigator.serviceWorker.register(SW, { scope: SCOPE, updateViaCache: "none" });
        let s = await reg.pushManager.getSubscription();
        // Recién confirmado en esta sesión y nada cambió en este navegador: no hace falta preguntar.
        if (memo && Date.now() - memo.at < FRESH_MS && (memo.state === "on") === !!s && memo.state !== "loading") {
          sub.current = s;
          return;
        }
        const perm = Notification.permission;
        if (perm === "denied") return setState("denied");
        const dev = deviceId();
        const st = await call(`/subscribe?${new URLSearchParams({ ...(dev ? { device: dev } : {}), ...(s ? { endpoint: s.endpoint } : {}) })}`);
        if (st.publicKey) key.current = st.publicKey;
        if (memo) memo.at = Date.now();
        if (s) {
          // Viva: se vuelve a guardar en el servidor (por si se borró) con lo que ya recibía. Nunca se da de baja acá.
          sub.current = s;
          await save(s, undefined);
          setState("on");
          return;
        }
        if (perm === "granted" && !markedOff()) {
          // El navegador la perdió pero el permiso sigue: se rehace sola, con lo que recibía este dispositivo.
          try {
            sub.current = await subscribe(reg, undefined);
            setState("on");
          } catch {
            setState("off");
            setMsg({ ok: false, text: "Se desactivaron en este dispositivo: tocá «Activar notificaciones» una vez y quedan." });
          }
          return;
        }
        setState("off");
      } catch {
        setState(Notification.permission === "denied" ? "denied" : "off");
      }
    })();

    return () => { installSubs.delete(setInstall); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Guarda este dispositivo; sin `k`, conserva lo que ya recibía. */
  async function save(s: PushSubscription, k: Kind[] | undefined) {
    const client = {
      permission: Notification.permission, standalone: isStandalone(),
      keyMatch: key.current ? sameKey(s, key.current) : null, keyLen: s.options?.applicationServerKey?.byteLength ?? null, v: 2,
    };
    const r = await call("/subscribe", { subscription: s.toJSON(), kinds: k, label: deviceLabel(), deviceId: deviceId(), client });
    if (r.kinds) setKinds(r.kinds);
  }

  async function subscribe(reg: ServiceWorkerRegistration, k: Kind[] | undefined) {
    if (!key.current) throw new Error("Faltan las claves VAPID en el servidor.");
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.current) });
    await save(s, k);
    return s;
  }

  async function enable() {
    if (state === "ios-install" || state === "unsupported") return setOpen((o) => !o);
    setBusy("enable");
    setMsg(null);
    try {
      // Lo primero del clic: Safari solo pregunta el permiso si viene directo de un toque.
      const perm = await Notification.requestPermission();
      if (perm === "denied") return setState("denied");
      if (perm !== "granted") return setMsg({ ok: false, text: "No se activaron: tocá «Permitir» cuando lo pregunte." });
      markOff(false);
      const reg = await registration();
      let s = await reg.pushManager.getSubscription();
      // Solo con la clave que da el servidor (la que firma los envíos), y solo si el navegador dice que NO coincide.
      if (s && key.current && sameKey(s, key.current) === false) { await s.unsubscribe(); s = null; }
      if (s) await save(s, kinds);
      else s = await subscribe(reg, kinds);
      sub.current = s;
      setState("on");
      setOpen(true);
      setMsg({ ok: true, text: "Listo. Tocá «Probar» para ver cómo llega." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "No se pudieron activar." });
    } finally {
      setBusy(null);
    }
  }

  async function toggleKind(k: Kind) {
    if (!sub.current) return;
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    setKinds(next);
    setBusy(k);
    try {
      await save(sub.current, next);
    } catch (e) {
      setKinds(kinds);
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (!sub.current) return;
    setBusy("test");
    setMsg(null);
    try {
      await call("/test", { endpoint: sub.current.endpoint });
      setMsg({ ok: true, text: "Enviada. Tiene que aparecer en unos segundos." });
    } catch (e) {
      setMsg({ ok: false, text: `No salió: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("off");
    setMsg(null);
    try {
      const s = sub.current;
      markOff(true);
      if (s) {
        await call("/unsubscribe", { endpoint: s.endpoint }).catch(() => {});
        await s.unsubscribe().catch(() => false);
      }
      sub.current = null;
      setState("off");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  async function doInstall() {
    if (!install) return;
    await install.prompt();
    await install.userChoice.catch(() => null);
    // El evento sirve una sola vez.
    setInstallEvt(null);
  }

  const row = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12px] font-bold tracking-tight transition-colors";
  const ic = "h-4 w-4 shrink-0";
  const small = "rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-bold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5";

  return (
    <div className={`rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-white/[0.05] dark:bg-[#111] ${className}`}>
      {state === "loading" ? (
        <div className={`${row} text-zinc-400`}><Bell className={ic} /><span className="flex-1">Notificaciones</span><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
      ) : state === "on" ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className={`${row} text-zinc-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-white/[0.03]`} aria-expanded={open}>
          <BellRing className={`${ic} text-violet-500`} />
          <span className="min-w-0 flex-1">
            <span className="block">Notificaciones</span>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Activadas en este dispositivo
            </span>
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      ) : state === "denied" ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className={`${row} text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-white/[0.03]`} aria-expanded={open}>
          <BellOff className={ic} /><span className="flex-1">Notificaciones bloqueadas</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <button type="button" onClick={enable} disabled={!!busy} className={`${row} text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:text-white dark:hover:bg-white/[0.03]`}>
          {busy ? <Loader2 className={`${ic} animate-spin`} /> : <Bell className={ic} />}
          <span className="flex-1">Activar notificaciones</span>
        </button>
      )}

      {open && state === "on" && (
        <div className="space-y-2.5 border-t border-zinc-100 px-3 pb-3 pt-2.5 dark:border-white/[0.04]">
          {KINDS.map(([k, label, hint]) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 text-[11.5px]">
              <input type="checkbox" checked={kinds.includes(k)} disabled={busy === k} onChange={() => toggleKind(k)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-violet-600" />
              <span className="leading-tight">
                <b className="font-bold text-zinc-800 dark:text-zinc-100">{label}</b>
                <span className="block text-[10.5px] text-zinc-400">{hint}</span>
              </span>
            </label>
          ))}
          <div className="flex gap-1.5 pt-0.5">
            <button type="button" onClick={test} disabled={!!busy} className={small}>
              {busy === "test" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Probar"}
            </button>
            <button type="button" onClick={disable} disabled={!!busy} className={`${small} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-500/10`}>
              Desactivar
            </button>
          </div>
        </div>
      )}

      {open && state === "ios-install" && (
        <div className="border-t border-zinc-100 px-3 pb-3 pt-2.5 text-[11px] leading-snug text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
          <p className="mb-2">En iPhone las notificaciones funcionan con el panel instalado como app:</p>
          <ol className="space-y-1.5">
            <li className="flex gap-1.5"><b className="text-zinc-800 dark:text-zinc-100">1.</b><span>En Safari tocá <Share className="inline h-3.5 w-3.5 -translate-y-px text-sky-500" /> <b className="text-zinc-800 dark:text-zinc-100">Compartir</b>.</span></li>
            <li className="flex gap-1.5"><b className="text-zinc-800 dark:text-zinc-100">2.</b><span>Elegí <SquarePlus className="inline h-3.5 w-3.5 -translate-y-px" /> <b className="text-zinc-800 dark:text-zinc-100">Agregar a pantalla de inicio</b>.</span></li>
            <li className="flex gap-1.5"><b className="text-zinc-800 dark:text-zinc-100">3.</b><span>Abrí <b className="text-zinc-800 dark:text-zinc-100">Panel</b> desde el ícono nuevo y tocá acá otra vez.</span></li>
          </ol>
        </div>
      )}

      {open && state === "unsupported" && (
        <p className="border-t border-zinc-100 px-3 pb-3 pt-2.5 text-[11px] leading-snug text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
          {ios ? "Este iPhone no las admite: hace falta iOS 16.4 o más nuevo." : "Este navegador no admite notificaciones. Probá con Chrome, Edge o Safari."}
        </p>
      )}

      {open && state === "denied" && (
        <p className="border-t border-zinc-100 px-3 pb-3 pt-2.5 text-[11px] leading-snug text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
          {ios
            ? <>Las bloqueaste en este iPhone. Activalas en <b className="text-zinc-800 dark:text-zinc-100">Ajustes › Notificaciones › Panel</b> y volvé a abrir la app.</>
            : <>Las bloqueaste en este navegador. Tocá el candado de la barra de direcciones › <b className="text-zinc-800 dark:text-zinc-100">Notificaciones › Permitir</b> y recargá.</>}
        </p>
      )}

      {msg && (
        <p className={`px-3 pb-2.5 text-[10.5px] font-semibold leading-snug ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`} role="status">{msg.text}</p>
      )}

      {/* Panel es una web: sin botón de «Instalar como app». */}
      {false && install && (
        <button type="button" onClick={doInstall} className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-[11px] font-bold text-violet-600 hover:bg-violet-50/50 dark:border-white/[0.04] dark:text-violet-400 dark:hover:bg-violet-500/5">
          <Download className="h-3.5 w-3.5" />Instalar como app
        </button>
      )}
    </div>
  );
}

export { PushToggle };
