"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { SheetData } from "@/app/oferta/[step]/useOffer";
import type { Locale } from "@/lib/i18n";
import { coverImg, thumb } from "./thumb";

// Stripe (≈300 KB) se carga recién cuando hace falta pagar, no al abrir la biblioteca.
const PaySheet = dynamic(() => import("@/app/oferta/[step]/PaySheet").then((m) => m.PaySheet), { ssr: false });
const stripeFor = (pk: string) => import("@/app/oferta/[step]/useOffer").then((m) => m.stripeFor(pk));

async function post(url: string, body: Record<string, unknown>) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, data: { reason: "network" } as Record<string, unknown> };
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bloquea el scroll de la página mientras hay una hoja o un visor abierto. */
function useLockScroll(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [on]);
}

type LoginTexts = { emailPh: string; send: string; sending: string; sent: string; badEmail: string; tooMany: string; checkMail: string; otherEmail: string; notFound: string };

/** «Escribí el email con el que compraste»: si compró, entra directo; si no, el aviso de que no hay compras. */
export function LoginForm({ store, locale, t, autoFocus = true }: { store: string; locale: string; t: LoginTexts; autoFocus?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return setMsg({ ok: false, text: t.badEmail });
    setBusy(true);
    // Si el mail compró, entra directo (la sesión queda en la cookie) y se recarga en su biblioteca.
    const r = await post("/api/biblioteca/link", { store, email: v, locale, direct: true });
    if (r.data.direct) { window.location.reload(); return; }
    setBusy(false);
    if (r.status === 400) return setMsg({ ok: false, text: t.badEmail });
    if (r.data.notFound) return setMsg({ ok: false, text: t.notFound });
    setMsg({ ok: false, text: r.data.tooMany ? t.tooMany : t.badEmail });
  };
  if (msg?.ok) {
    return (
      <div className="bib-sent" role="status">
        <div className="bib-sent-ic" aria-hidden>✉️</div>
        <h2>{t.checkMail}</h2>
        <p>{msg.text}</p>
        <button type="button" className="bib-textbtn" onClick={() => setMsg(null)}>{t.otherEmail}</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="bib-form">
      <label className="bib-field">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
        <input type="email" inputMode="email" autoComplete="email" placeholder={t.emailPh} aria-label={t.emailPh} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={autoFocus} />
      </label>
      <button className="bib-btn bib-cta" type="submit" disabled={busy}>{busy ? t.sending : t.send} {!busy && <span aria-hidden>→</span>}</button>
      {msg && <p className="bib-msg" role="alert">{msg.text}</p>}
    </form>
  );
}

/** Catálogo público: «¿Ya compraste? Entrá con tu email» abre el formulario ahí mismo. */
export function LoginToggle({ label, title, sub, open: initial, children }: { label: string; title: string; sub: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initial);
  useEffect(() => {
    const go = () => { if (window.location.hash === "#entrar") { setOpen(true); document.getElementById("entrar")?.scrollIntoView({ behavior: "smooth", block: "center" }); } };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  if (!open) {
    return (
      <button type="button" className="bib-login-toggle" id="entrar" onClick={() => setOpen(true)} aria-expanded={false}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
        {label}
      </button>
    );
  }
  return (
    <div className="bib-loginbox" id="entrar" style={{ marginTop: 22, maxWidth: 460 }}>
      <h2>{title}</h2>
      <p>{sub}</p>
      {children}
    </div>
  );
}

/**
 * El idioma: un botón con el idioma actual que abre una lista con el estilo
 * de las landings; teclado (flechas, Enter, Esc) y táctil. La elección se guarda en una cookie y la página se rearma.
 */
export function LangPicker({ value, langs, label }: { value: string; langs: [string, string][]; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, langs.findIndex(([k]) => k === value)));
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = langs.find(([k]) => k === value)?.[1] ?? value;
  const pick = (k: string) => {
    setOpen(false);
    if (k === value) return;
    document.cookie = `bib_lang=${k}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % langs.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + langs.length) % langs.length); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(langs.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(langs[active][0]); btn.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="bib-lang" ref={box}>
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current}`} title={label}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); } }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
        <span className="bib-lang-name">{current}</span>
        <svg className="bib-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul ref={list} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`bib-lang-${langs[active][0]}`} onKeyDown={onKey}>
          {langs.map(([k, n], i) => (
            <li key={k} id={`bib-lang-${k}`} role="option" aria-selected={k === value} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(k)}>
              {n}<small>{k === "pt-BR" ? "PT" : k}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Pestañas del perfil (Mis libros · Tienda · Mis pedidos); recuerda la elegida en el #; un link a #tienda cambia de
 * pestaña. Las pestañas `lazy` (la Tienda) no vienen en el HTML: se arman en el navegador la primera vez que se abren.
 */
export function Tabs({ tabs }: { tabs: { id: string; label: string; count?: number; node: React.ReactNode; lazy?: boolean }[] }) {
  const [cur, setCur] = useState(tabs[0]?.id);
  const [seen, setSeen] = useState<Set<string>>(() => new Set([tabs[0]?.id]));
  const warm = (id: string) => setSeen((s) => (s.has(id) ? s : new Set([...s, id])));
  useEffect(() => warm(cur), [cur]);
  // Ya cargada la página, las pestañas lazy se arman ocultas cuando el navegador está libre (el cambio de pestaña es instantáneo).
  useEffect(() => {
    const go = () => setSeen(new Set(tabs.map((t) => t.id)));
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const h = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : window.setTimeout(go, 2500);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(h); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const top = () => {
    const bar = document.querySelector<HTMLElement>(".bib-tabsbar");
    if (bar && window.scrollY > bar.offsetTop - 60) window.scrollTo({ top: bar.offsetTop - 60, behavior: "smooth" });
  };
  useEffect(() => {
    const read = (scroll: boolean) => {
      const h = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === h)) { setCur(h); if (scroll) top(); }
    };
    read(false);
    const onHash = () => read(true);
    // Un tema elegido en el menú abre la Tienda (ShopBrowser lo filtra).
    const onTopic = () => { if (tabs.some((t) => t.id === "tienda")) { setCur("tienda"); window.history.replaceState(null, "", "#tienda"); } };
    window.addEventListener("hashchange", onHash);
    window.addEventListener(TOPIC_EVENT, onTopic);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener(TOPIC_EVENT, onTopic); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (id: string) => {
    setCur(id);
    window.history.replaceState(null, "", `#${id}`);
    top();
  };
  return (
    <>
      <div className="bib-tabsbar">
        <div className="bib-wrap">
          <nav className="bib-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={cur === t.id} onClick={() => go(t.id)} onPointerEnter={() => warm(t.id)} onFocus={() => warm(t.id)}>
                {t.label}{t.count != null && <span>{t.count}</span>}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <div className="bib-wrap">
        {tabs.map((t) => <div key={t.id} role="tabpanel" hidden={cur !== t.id}>{!t.lazy || seen.has(t.id) || cur === t.id ? t.node : null}</div>)}
      </div>
    </>
  );
}

/** Fecha y hora de un pedido, en el idioma y la zona horaria de quien mira. */
export function When({ iso, locale, time = true }: { iso: string; locale: string; time?: boolean }) {
  const [s, setS] = useState(() => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
  useEffect(() => {
    setS(new Date(iso).toLocaleString(locale, time ? { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" }));
  }, [iso, locale, time]);
  return <time dateTime={iso}>{s}</time>;
}

type UnlockTexts = {
  unlock: string; unlocking: string; unlocked: string; payError: string; adminNoBuy: string;
  buyTitle: string; payNow: string; buyNote: string; cancel: string; secure: string; includes: string; gifts: string;
};

/**
 * Comprar desde la biblioteca: el botón abre la hoja «Confirmá tu compra» (portada, qué incluye, precio); «Pagar» cobra con el medio de
 * su última compra (3DS en la página) o, si no se puede, abre la hoja de pago de Stripe con cualquier medio.
 * Nada es gratis: el precio lo decide el servidor. En la vista de administrador la hoja se ve pero no cobra.
 */
export function Unlock(p: {
  id: string; name: string; label: string; compare?: string | null; cover?: string | null; books?: number; gifts?: number; cta: string;
  publishableKey: string | null; locale: Locale; email: string; admin: boolean; t: UnlockTexts;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Con la hoja abierta se va cargando Stripe (por si pide 3DS o la hoja de pago).
  useEffect(() => { if (open && p.publishableKey) stripeFor(p.publishableKey).catch(() => {}); }, [open, p.publishableKey]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && state !== "loading") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, state]);

  const succeed = () => {
    setSheet(null);
    setState("done");
    setOpen(true);
    setTimeout(() => { setOpen(false); router.refresh(); }, 1800);
  };
  const fail = () => { setState("error"); setErr(p.t.payError); };

  async function settle(pi: string) {
    for (let i = 0; i < 12; i++) {
      const r = await post("/api/biblioteca/confirmar", { pi });
      if (r.data.ok) return succeed();
      if (!r.data.processing) return fail();
      await sleep(2500);
    }
    fail();
  }

  async function charge(opts: { fresh?: boolean; cancelPi?: string } = {}): Promise<void> {
    setErr(null);
    setState("loading");
    const r = await post("/api/biblioteca/comprar", { productId: p.id, returnUrl: window.location.href, ...opts });
    const d = r.data;
    if (d.ok) return succeed();
    if (d.reason === "processing" && typeof d.pi === "string") return settle(d.pi);
    if (d.reason === "requires_action" && typeof d.clientSecret === "string" && p.publishableKey) {
      const stripe = await stripeFor(p.publishableKey);
      if (stripe) {
        const { paymentIntent } = await stripe.handleNextAction({ clientSecret: d.clientSecret });
        if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) return settle(paymentIntent.id);
      }
      return charge({ fresh: true, cancelPi: String(d.pi ?? "") });
    }
    if (d.reason === "needs_payment" && typeof d.clientSecret === "string") {
      setOpen(false);
      setSheet({ clientSecret: d.clientSecret, pi: String(d.pi), amount: Number(d.amount), currency: String(d.currency), savedFailed: !!d.reuseFailed });
      setState("idle");
      return;
    }
    fail();
  }

  const done = state === "done";
  return (
    <>
      {done
        ? <button type="button" className="bib-btn bib-done" disabled>{p.t.unlocked}</button>
        : <button type="button" className="bib-btn bib-unlock" onClick={() => { setErr(null); setOpen(true); }}>{p.cta}</button>}
      {open && (
        <div className="bib-sheet-bg" onClick={() => state !== "loading" && !done && setOpen(false)}>
          <div className="bib-sheet" role="dialog" aria-modal="true" aria-label={p.t.buyTitle} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="bib-sheet-x" aria-label={p.t.cancel} onClick={() => setOpen(false)} disabled={state === "loading"}>×</button>
            <p className="bib-sheet-k">{done ? p.t.unlocked : p.t.buyTitle}</p>
            <div className="bib-sheet-top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.cover ? <Img src={thumb(p.cover, 240)} fallback={p.cover} alt="" /> : <div className="bib-sheet-ph">📘</div>}
              <div style={{ minWidth: 0 }}>
                <h3>{p.name}</h3>
                {(p.t.includes || p.t.gifts) && (
                  <p className="bib-sheet-m">
                    {p.t.includes}
                    {p.t.gifts && <>{p.t.includes && <br />}<b>🎁 {p.t.gifts}</b></>}
                  </p>
                )}
                <div className="bib-price" style={{ margin: "8px 0 0" }}><b>{p.label}</b>{p.compare && <s>{p.compare}</s>}</div>
              </div>
            </div>
            {done ? (
              <div className="bib-sheet-ok">✓</div>
            ) : (
              <>
                <button type="button" className="bib-btn bib-unlock bib-pay" disabled={state === "loading" || p.admin} title={p.admin ? p.t.adminNoBuy : undefined} onClick={() => charge()}>
                  {state === "loading" ? p.t.unlocking : <>🔒 {p.t.payNow}</>}
                </button>
                {p.admin && <p className="bib-sheet-note" style={{ color: "#92400E" }}>{p.t.adminNoBuy}</p>}
                {err && <p className="bib-err" style={{ textAlign: "center" }}>{err}</p>}
                <p className="bib-sheet-note">{p.t.buyNote}</p>
                <p className="bib-sheet-secure">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  {p.t.secure}
                </p>
              </>
            )}
          </div>
        </div>
      )}
      {sheet && p.publishableKey && (
        <PaySheet
          data={sheet} publishableKey={p.publishableKey} locale={p.locale} productName={p.name}
          buyer={{ email: p.email, name: null, country: null }} done={false}
          returnUrl={() => window.location.href}
          onDecline={() => setSheet(null)}
          onPaid={(pi) => settle(pi)}
          onError={() => setErr(p.t.payError)}
        />
      )}
    </>
  );
}

/** Vuelta de una redirección de pago (3DS fuera de la página, Amazon Pay…): registra y recarga. */
export function PayReturn() {
  const router = useRouter();
  useEffect(() => {
    const u = new URL(window.location.href);
    const pi = u.searchParams.get("payment_intent");
    if (!pi) return;
    (async () => {
      for (let i = 0; i < 8; i++) {
        const r = await post("/api/biblioteca/confirmar", { pi });
        if (r.data.ok || !r.data.processing) break;
        await sleep(2500);
      }
      for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status"]) u.searchParams.delete(k);
      window.history.replaceState(null, "", u.toString());
      router.refresh();
    })();
  }, [router]);
  return null;
}

/** Administrador: desbloquear gratis (o quitar) un libro en la biblioteca de este comprador. */
export function AdminGrant({ store, email, productId, remove }: { store: string; email: string; productId: string; remove?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (remove && !window.confirm("¿Quitarle este libro de su biblioteca?")) return;
    setBusy(true);
    const r = await post("/api/admin/biblioteca/regalar", { store, email, productId, remove: !!remove });
    setBusy(false);
    if (r.status !== 200) return window.alert(String(r.data.error ?? "No se pudo"));
    router.refresh();
  };
  return (
    <button type="button" className={`bib-btn ${remove ? "bib-ghost" : ""}`} style={remove ? undefined : { background: "#16A34A" }} disabled={busy} onClick={go}>
      {busy ? "…" : remove ? "Quitar" : "🎁 Desbloquear gratis"}
    </button>
  );
}

/** Administrador: ir al portal de un comprador por su email. */
export function BuyerSearch({ store }: { store: string }) {
  const [email, setEmail] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) window.location.href = `/api/admin/biblioteca?store=${store}&email=${encodeURIComponent(email.trim())}`; }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
      <input className="bib-in" style={{ flex: "1 1 220px" }} type="email" placeholder="Email del comprador" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="bib-btn" type="submit">Ver su portal</button>
    </form>
  );
}

/** Las páginas en grande: se deslizan (táctil), flechas del teclado y de la pantalla, Esc cierra. */
function PageViewer({ pages, title, start, onClose, closeLabel }: { pages: string[]; title: string; start: number; onClose: () => void; closeLabel: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  useLockScroll(true);
  const goTo = useCallback((n: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    const k = Math.max(0, Math.min(pages.length - 1, n));
    el.scrollTo({ left: k * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }, [pages.length]);
  useEffect(() => { goTo(start, false); }, [goTo, start]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "ArrowRight") goTo(i + 1);
      if (e.key === "ArrowLeft") goTo(i - 1);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [i, goTo, onClose]);
  return (
    <div className="bib-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="bib-x" aria-label={closeLabel} onClick={onClose}>×</button>
      <div className="bib-viewer-track" ref={track} onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {pages.map((src, n) => (
          <div key={n} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${title} ${n + 1}`} loading={Math.abs(n - start) < 2 ? "eager" : "lazy"} />
          </div>
        ))}
      </div>
      <div className="bib-viewer-bar">
        <button type="button" aria-label="‹" onClick={() => goTo(i - 1)} disabled={i === 0}>‹</button>
        <span>{i + 1} / {pages.length}</span>
        <button type="button" aria-label="›" onClick={() => goTo(i + 1)} disabled={i === pages.length - 1}>›</button>
      </div>
    </div>
  );
}

/** «Sfoglia»: las páginas de muestra de un libro que ya tiene. */
export function Pages({ pages, title, label, closeLabel }: { pages: string[]; title: string; label: string; closeLabel: string }) {
  const [i, setI] = useState<number | null>(null);
  if (!pages.length) return null;
  return (
    <>
      <button type="button" className="bib-btn bib-ghost" onClick={() => setI(0)}>{label}</button>
      {i != null && <PageViewer pages={pages} title={title} start={i} onClose={() => setI(null)} closeLabel={closeLabel} />}
    </>
  );
}

export type PreviewItem = {
  id: string; name: string; description: string; cover: string | null; label: string | null; compare: string | null;
  gifts: string | null; badge: string | null; locked?: boolean;
  /** Páginas de muestra que tiene (0 = ninguna: la vista previa muestra la portada grande; null = se sabe al abrirla). */
  pages?: number | null;
};
export type PreviewTexts = { preview: string; samplePages: string; close: string; loading: string };

/** Las páginas de muestra, una sola vez por libro y por visita (se piden al pasar el dedo o el mouse, antes del clic). */
const pageCache = new Map<string, Promise<string[]>>();
function loadPages(store: string, id: string): Promise<string[]> {
  let p = pageCache.get(id);
  if (!p) {
    p = fetch(`/api/biblioteca/paginas?s=${store}&p=${id}`).then((r) => (r.ok ? r.json() : { pages: [] })).then((d: { pages?: string[] }) => d.pages ?? [])
      .then((pages) => { for (const u of pages.slice(0, 3)) { const im = new Image(); im.decoding = "async"; im.src = thumb(u, 400); } return pages; })
      .catch(() => { pageCache.delete(id); return []; });
    pageCache.set(id, p);
  }
  return p;
}

/**
 * Tarjeta de un libro de la Tienda: portada, título, una línea,
 * precio y el botón de compra. La portada o el título abren la vista previa (pantalla completa en el celular) con la
 * descripción, el precio, el mismo botón y las páginas de muestra. Si el libro no tiene páginas, la portada en grande y
 * la descripción, sin cuadros vacíos.
 */
export function PreviewCard({ item, store, cta, t }: { item: PreviewItem; store: string; cta: React.ReactNode; t: PreviewTexts }) {
  const [open, setOpen] = useState(false);
  const none = item.pages === 0;
  const [pages, setPages] = useState<string[] | null>(none ? [] : null);
  const [view, setView] = useState<number | null>(null);
  useLockScroll(open);
  useEffect(() => {
    if (!open || pages) return;
    let off = false;
    loadPages(store, item.id).then((p) => { if (!off) setPages(p); });
    return () => { off = true; };
  }, [open, pages, store, item.id]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && view == null) setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, view]);
  const prefetch = () => { if (!none && !pages) void loadPages(store, item.id); };
  const price = item.label && (
    <div className="bib-price"><b>{item.label}</b>{item.compare && <s>{item.compare}</s>}</div>
  );
  const skel = Math.min(4, Math.max(1, item.pages ?? 4));
  return (
    <article className={`bib-book${item.locked ? " bib-lock" : ""}`} onPointerEnter={prefetch} onTouchStart={prefetch} onFocus={prefetch}>
      <button type="button" className="bib-open" onClick={() => setOpen(true)} aria-label={`${t.preview}: ${item.name}`}>
        <div className="bib-cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.cover ? <Img {...coverImg(item.cover)} fallback={item.cover} alt={item.name} loading="lazy" decoding="async" /> : <div className="bib-ph"><span>{item.name}</span></div>}
          {item.badge && <span className="bib-badge">{item.badge}</span>}
          {item.locked && <span className="bib-lk" aria-hidden>🔒</span>}
          <span className="bib-peek" aria-hidden>👁 {t.preview}</span>
        </div>
      </button>
      <h3 className="bib-t"><button type="button" className="bib-open" onClick={() => setOpen(true)}>{item.name}</button></h3>
      <p className="bib-d bib-d1">{item.description}</p>
      {price}
      {item.gifts && <span className="bib-gift">🎁 {item.gifts}</span>}
      <div className="bib-acts">{cta}</div>
      {/* La vista previa ocupa la pantalla (fixed): ninguna tarjeta ni contenedor tiene transform (ver bib.css). */}
      {open && (
        <div className="bib-pv-bg" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bib-pv" role="dialog" aria-modal="true" aria-label={item.name}>
            <div className="bib-pv-top">
              <p>{t.preview}</p>
              <button type="button" className="bib-x" aria-label={t.close} onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="bib-pv-body">
              <div className={`bib-pv-cover${pages && !pages.length ? " bib-pv-cover-big" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* La de la grilla (ya descargada) al instante; encima, la grande cuando llega. */}
                {item.cover ? <><Img src={thumb(item.cover, 400)} fallback={item.cover} alt={item.name} /><HiRes src={thumb(item.cover, 720)} /></> : <div className="bib-ph"><span>{item.name}</span></div>}
              </div>
              <div style={{ minWidth: 0 }}>
                <h2>{item.name}</h2>
                {price}
                {item.gifts && <span className="bib-gift">🎁 {item.gifts}</span>}
                <div className="bib-acts">{cta}</div>
                {item.description && <p className="bib-pv-desc">{item.description}</p>}
              </div>
              {(pages == null || pages.length > 0) && (
                <div className="bib-pv-pages">
                  <h3>{t.samplePages}{pages && <span className="bib-count">{pages.length}</span>}</h3>
                  <div className="bib-strip">
                    {pages == null
                      ? Array.from({ length: skel }, (_, n) => <div key={n} className="bib-skel" aria-label={t.loading} />)
                      : pages.map((src, n) => (
                        <button key={n} type="button" onClick={() => setView(n)} aria-label={`${item.name} ${n + 1}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <Img src={thumb(src, 400)} fallback={src} alt="" loading={n < 3 ? "eager" : "lazy"} decoding="async" />
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {view != null && pages && <PageViewer pages={pages} title={item.name} start={view} onClose={() => setView(null)} closeLabel={t.close} />}
        </div>
      )}
    </article>
  );
}

function HiRes({ src }: { src: string }) {
  const [ok, setOk] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden className="bib-hires" data-ok={ok || undefined} onLoad={() => setOk(true)} onError={(e) => { e.currentTarget.style.display = "none"; }} decoding="async" />;
}

/**
 * Una imagen redimensionada que, si la transformación de Supabase falla (429, imagen demasiado grande…), vuelve al
 * archivo original: nunca un cuadro vacío.
 */
export function Img({ src, srcSet, fallback, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string | null; fallback?: string | null }) {
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const fail = () => { if (!bad && fallback && fallback !== src) setBad(true); };
  // Si falló antes de que React tomara la página (HTML del servidor), se detecta al montar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const i = ref.current; if (i && i.complete && i.naturalWidth === 0 && i.currentSrc) fail(); }, []);
  const use = bad && fallback ? fallback : src ?? undefined;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img ref={ref} {...rest} src={use} srcSet={bad ? undefined : srcSet} onError={fail} />;
}

/**
 * Las tarjetas de la Tienda, de «Altri libri per te», de las colecciones y del catálogo público se arman en el navegador
 * a partir de sus datos: los textos y la forma de comprar viajan una sola vez (CardCtx)
 * y cada tarjeta solo con lo suyo, en vez de repetir el HTML de la hoja de compra en cada una.
 */
export type CardData = {
  id: string; name: string; description: string; cover: string | null; label: string | null; compare: string | null;
  /** lock = lo que le falta de su colección; shop = Tienda / «Altri libri per te»; pub = catálogo público. */
  kind: "lock" | "shop" | "pub";
  books: number; gifts: number; badge: string | null; pages: number | null; url: string | null;
};
export type CardCtx = {
  store: string; pt: PreviewTexts;
  /** includes[n] / gifts[n]: «n libros», «+ n regalos» ya escritos en su idioma. */
  includes: string[]; gifts: string[];
  t: UnlockTexts & { buy: string; seeOffer: string; seeBook: string; payNowTpl: string };
  buyer: null | { canBuy: boolean; buyerAdmin: boolean; admin: boolean; publishableKey: string | null; locale: Locale; email: string; tok: string };
};
const Ctx = createContext<CardCtx | null>(null);
export function CardProvider({ value, children }: { value: CardCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Card({ c }: { c: CardData }) {
  const x = useContext(Ctx);
  if (!x) return null;
  const b = x.buyer;
  const unlockT = (label: string) => ({
    ...x.t, payNow: x.t.payNowTpl.replace("{label}", label),
    includes: c.books > 1 ? x.includes[c.books] ?? "" : "", gifts: c.gifts ? x.gifts[c.gifts] ?? "" : "",
  });
  const unlock = (cta: string) => b && c.label && (
    <Unlock id={c.id} name={c.name} label={c.label} compare={c.compare} cover={c.cover} books={c.books} gifts={c.gifts || undefined} cta={cta}
      publishableKey={b.publishableKey} locale={b.locale} email={b.email} admin={b.admin} t={unlockT(c.label)} />
  );
  let cta: React.ReactNode;
  if (c.kind === "pub" || !b) cta = <a className="bib-btn bib-cta" href={c.url ?? "#"}>{x.t.seeBook} →</a>;
  else if (c.kind === "lock") {
    cta = b.buyerAdmin ? <AdminGrant store={x.store} email={b.email} productId={c.id} />
      : b.canBuy && c.label ? unlock(`🔓 ${x.t.unlock}`)
      : <a className="bib-btn bib-unlock" href={`/api/biblioteca/checkout?p=${c.id}${b.tok}`}>🔓 {x.t.unlock}</a>;
  } else {
    cta = c.label && (b.canBuy || b.admin) && !b.buyerAdmin ? unlock(x.t.buy)
      : c.url
        ? <a className="bib-btn bib-unlock" href={c.url} target="_blank" rel="noreferrer">{c.label ? x.t.buy : x.t.seeOffer} →</a>
        // Un libro de bump o del post-pago, sin un clic posible: su checkout suelto.
        : <a className="bib-btn bib-unlock" href={`/api/biblioteca/checkout?p=${c.id}${b.tok}`}>{x.t.buy} →</a>;
  }
  return (
    <PreviewCard store={x.store} t={x.pt} cta={cta}
      item={{ id: c.id, name: c.name, description: c.description, cover: c.cover, label: c.label, compare: c.compare,
        gifts: c.gifts ? x.gifts[c.gifts] ?? null : null, badge: c.badge, locked: c.kind === "lock", pages: c.pages }} />
  );
}

/**
 * La Tienda: buscador grande arriba, temas como filtros, cantidad de
 * resultados, «Sorprendeme» y la grilla; los del mismo tema primero y el resto mezclado en cada visita (el orden lo
 * decide el servidor: nada se reacomoda al cargar). Sin buscar ni filtrar, arriba va `top`.
 */
const CHIPS = 9;
const PAGE = 36;
/** Al acercarse al final de la grilla suma la página siguiente (y un botón por si el navegador no avisa). */
function Sentinel({ onHit, innerRef }: { onHit: () => void; innerRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const el = innerRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onHit(); }, { rootMargin: "1600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });
  return <div ref={innerRef} className="bib-sentinel"><button type="button" className="bib-btn bib-ghost" onClick={onHit}>+ {PAGE}</button></div>;
}
export function ShopBrowser({ items, topics, top, counts, t }: {
  items: { id: string; q: string; topic: string; first: boolean; card: CardData }[];
  topics: [string, string][];
  top?: React.ReactNode;
  /** counts[n]: «n libros» ya escrito en su idioma (los plurales del polaco no se arman con un reemplazo). */
  counts: string[];
  t: { search: string; all: string; title: string; shuffle: string; shuffleLabel: string; noMatch: string };
}) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  // Muchos libros: se dibujan de a PAGE; al acercarse al final, más.
  const [limit, setLimit] = useState(PAGE);
  const more = useRef<HTMLDivElement>(null);
  // Un tema elegido en el menú (también si la Tienda se arma recién ahora).
  useEffect(() => {
    const apply = (k: string) => {
      setTopic(k); setQuery(""); setAllTopics(true); setLimit(PAGE);
      requestAnimationFrame(() => document.querySelector(".bib-shopbar")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    if (pendingTopic != null) { apply(pendingTopic); pendingTopic = null; }
    const on = (e: Event) => { apply(String((e as CustomEvent).detail ?? "")); pendingTopic = null; };
    window.addEventListener(TOPIC_EVENT, on);
    return () => window.removeEventListener(TOPIC_EVENT, on);
  }, []);
  const [allTopics, setAllTopics] = useState(false);
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.id));
  // Otro idioma (o una compra) cambia los libros: el orden y el tema se rehacen con los nuevos.
  const itemsKey = items.map((i) => i.id).join();
  useEffect(() => {
    setOrder(items.map((i) => i.id));
    setTopic((k) => (k && !items.some((i) => i.topic === k) ? "" : k));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);
  const shuffle = () => {
    const mix = (xs: string[]) => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    setOrder([...mix(items.filter((i) => i.first).map((i) => i.id)), ...mix(items.filter((i) => !i.first).map((i) => i.id))]);
  };
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = order.map((id) => byId.get(id)!).filter((i) => i && (!topic || i.topic === topic) && words.every((w) => fold(i.q).includes(w)));
  const per = new Map<string, number>();
  for (const i of items) per.set(i.topic, (per.get(i.topic) ?? 0) + 1);
  const filtering = !!words.length || !!topic;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLimit(PAGE), [query, topic]);
  return (
    <>
      <div className="bib-shopbar">
        <label className="bib-search">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" enterKeyHint="search" placeholder={t.search} aria-label={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" aria-label="×" onClick={() => setQuery("")}>×</button>}
        </label>
        {topics.length > 1 && (
          <div className="bib-chips" role="group" aria-label={t.all}>
            <button type="button" className="bib-chip" aria-pressed={!topic} onClick={() => setTopic("")}>{t.all} <i>{items.length}</i></button>
            {/* Los temas más grandes a la vista; el resto, con «+N» (que no ocupe media pantalla). */}
            {(allTopics ? topics : topics.slice(0, CHIPS)).map(([k, label]) => (
              <button key={k} type="button" className="bib-chip" aria-pressed={topic === k} onClick={() => setTopic(topic === k ? "" : k)}>{label} <i>{per.get(k) ?? 0}</i></button>
            ))}
            {topics.length > CHIPS && (
              <button type="button" className="bib-chip bib-chip-more" aria-expanded={allTopics} onClick={() => setAllTopics((x) => !x)}>
                {allTopics ? "−" : `+${topics.length - CHIPS}`}
              </button>
            )}
          </div>
        )}
      </div>
      {!filtering && top}
      <div className="bib-results-h">
        <h2 className="bib-h2">{t.title} <span className="bib-count" aria-live="polite">{counts[shown.length] ?? shown.length}</span></h2>
        <button type="button" className="bib-btn bib-ghost bib-shuffle" title={t.shuffleLabel} onClick={shuffle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
          {t.shuffle}
        </button>
      </div>
      {shown.length
        ? <>
            <div className="bib-grid">{shown.slice(0, limit).map((i) => <div key={i.id} className="bib-cell"><Card c={i.card} /></div>)}</div>
            {shown.length > limit && <Sentinel onHit={() => setLimit((n) => n + PAGE)} innerRef={more} />}
          </>
        : <div className="bib-empty"><p className="bib-sub" style={{ margin: 0 }}>{t.noMatch.replace("{q}", query.trim() || (topics.find(([k]) => k === topic)?.[1] ?? ""))}</p></div>}
    </>
  );
}

/** Elegir un tema desde el menú: la Tienda (o el catálogo) se filtra a ese tema. */
const TOPIC_EVENT = "bib:topic";
let pendingTopic: string | null = null;
function pickTopic(key: string) {
  pendingTopic = key;
  window.dispatchEvent(new CustomEvent(TOPIC_EVENT, { detail: key }));
}

export type TopGroup = { key: string; label: string; topics: [string, string, number][] };
type NavItem = { label: string; href?: string; post?: string; count?: number };

/**
 * La barra de arriba: la marca a la izquierda; a la derecha «Temas ▾»
 * (en pantallas anchas, con sus categorías como submenús), el botón de color (Entrar / Tienda) y la hamburguesa, que
 * abre la plataforma (Mis libros, Tienda, Mis pedidos, Salir), los temas por categoría y el idioma. Nada escucha el
 * scroll ni cambia de tamaño: la barra es sticky con alto fijo y el menú se abre por encima del contenido.
 */
export function TopBar({ brand, cta, items, groups, langs, lang, t }: {
  brand: string; cta: { label: string; href: string } | null; items: NavItem[]; groups: TopGroup[];
  langs: [string, string][]; lang: string;
  t: { menu: string; topics: string; account: string; close: string; back: string; language: string; all: string };
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [dGroup, setDGroup] = useState(groups[0]?.key ?? "");
  const dropRef = useRef<HTMLDivElement>(null);
  useLockScroll(menu);
  useEffect(() => {
    if (!menu && !drop) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); setDrop(false); } };
    const out = (e: MouseEvent) => { if (drop && !dropRef.current?.contains(e.target as Node)) setDrop(false); };
    window.addEventListener("keydown", k);
    document.addEventListener("mousedown", out);
    return () => { window.removeEventListener("keydown", k); document.removeEventListener("mousedown", out); };
  }, [menu, drop]);
  const close = () => { setMenu(false); setDrop(false); setGroup(null); };
  const topic = (k: string) => { close(); pickTopic(k); };
  const nav = (href: string) => (e: React.MouseEvent) => {
    close();
    // El mismo # otra vez no dispara hashchange: se avisa a mano (abre la pestaña o el formulario de entrar).
    if (href.startsWith("#") && window.location.hash === href) { e.preventDefault(); window.dispatchEvent(new HashChangeEvent("hashchange")); }
  };
  const setLang = (k: string) => {
    close();
    if (k === lang) return;
    document.cookie = `bib_lang=${k}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const cur = groups.find((g) => g.key === dGroup) ?? groups[0];
  return (
    <header className="bib-top">
      <div className="bib-wrap">
        <span className="bib-wm">{brand}</span>
        <div className="bib-me">
          {groups.length > 0 && (
            <div className="bib-drop" ref={dropRef}>
              <button type="button" className="bib-navbtn" aria-haspopup="true" aria-expanded={drop} onClick={() => setDrop((d) => !d)}>
                {t.topics}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {drop && cur && (
                <div className="bib-mega" role="menu">
                  <ul className="bib-mega-groups">
                    {groups.map((g) => (
                      <li key={g.key}>
                        <button type="button" role="menuitem" aria-expanded={g.key === cur.key} onMouseEnter={() => setDGroup(g.key)} onFocus={() => setDGroup(g.key)} onClick={() => setDGroup(g.key)}>
                          {g.label}<span aria-hidden>›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <ul className="bib-mega-topics">
                    {cur.topics.map(([k, label, n]) => (
                      <li key={k}><button type="button" role="menuitem" onClick={() => topic(k)}>{label}<i>{n}</i></button></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {cta && <a className="bib-btn bib-cta bib-topcta" href={cta.href} onClick={nav(cta.href)}>{cta.label}</a>}
          <button type="button" className="bib-burger" aria-label={t.menu} aria-expanded={menu} onClick={() => { setDrop(false); setGroup(null); setMenu((m) => !m); }}>
            {menu
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>}
          </button>
        </div>
      </div>
      {menu && (
        <div className="bib-menu-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <nav className="bib-menu" aria-label={t.menu}>
            <div className="bib-menu-top">
              <span className="bib-wm">{brand}</span>
              <button type="button" className="bib-x" aria-label={t.close} onClick={close}>×</button>
            </div>
            {/* primero el idioma, después los temas (cada categoría se abre ahí mismo) y al final su cuenta. */}
            <section>
              <h3>{t.language}</h3>
              <ul className="bib-menu-langs">
                {langs.map(([k, n]) => (
                  <li key={k}><button type="button" className="bib-menu-lang" aria-pressed={k === lang} onClick={() => setLang(k)}>{n}</button></li>
                ))}
              </ul>
            </section>
            {groups.length > 0 && (
              <section>
                <h3>{t.topics}</h3>
                <ul>
                  <li><button type="button" className="bib-menu-item" onClick={() => topic("")}>{t.all}</button></li>
                  {groups.map((g) => (
                    <li key={g.key}>
                      <button type="button" className="bib-menu-item" aria-expanded={group === g.key} onClick={() => setGroup(group === g.key ? null : g.key)}>
                        {g.label}<span className="bib-menu-n">{g.topics.reduce((n, x) => n + x[2], 0)} <b className="bib-menu-chev" aria-hidden>›</b></span>
                      </button>
                      {group === g.key && (
                        <ul className="bib-menu-sub">
                          {g.topics.map(([k, label, n]) => (
                            <li key={k}><button type="button" className="bib-menu-item" onClick={() => topic(k)}>{label}<i>{n}</i></button></li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {items.length > 0 && (
              <section>
                <h3>{t.account}</h3>
                <ul>
                  {items.map((it) => (
                    <li key={it.label}>
                      {it.post
                        ? <form method="post" action={it.post}><button type="submit" className="bib-menu-item">{it.label}</button></form>
                        : <a className="bib-menu-item" href={it.href} onClick={nav(it.href ?? "")}>{it.label}{it.count != null && <i>{it.count}</i>}</a>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
