"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inter, DM_Sans } from "next/font/google";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { T, money, type Locale } from "@/lib/i18n";
import { toMinor } from "@/lib/minor";
import { CHECKOUT_CSS } from "./checkout.css";
import { MetaPixel, track, fbIds } from "@/components/MetaPixel";
import { track as logEvent, startPresence } from "@/lib/track-client";
import type { CheckoutSettings } from "@/lib/checkout-settings";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
// El diseño 2 copia a la plataforma anterior: fuente del sistema y DM Sans en los bumps.
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-dm" });
const SYSTEM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type Offer = {
  slug: string; name: string; shortName: string; description: string;
  image: string | null; amount: number; compareAt: number | null; off: number | null;
  /** Preventa: en cuántos días llega (null = ya está). */
  presaleDays?: number | null;
};

export type Props = {
  store: string; funnel: string; locale: Locale; country: string | null;
  currency: string; publishableKey: string;
  /** Configuración de medios de pago de Stripe de la tienda (la misma que la plataforma anterior). */
  pmc: string | null;
  /** Pixels de Meta de esta oferta. */
  pixels: string[];
  storeName: string; legalName: string; legalAddress: string; statementName: string;
  supportEmail: string; payColor: string; guaranteeDays: number; guaranteeImage: string | null;
  main: { name: string; shortName: string; image: string | null; amount: number; compareAt: number | null };
  included: { name: string }[];
  bonuses: { name: string; displayValue: number | null }[];
  offers: Offer[];
  baseCompareTotal: number;
  utm: Record<string, string>;
  /** Viene del link del email de recuperación. */
  prefillEmail: string;
  /** Volvió de un pago con redirección que no se completó (Klarna, Cash App…): se lo dice arriba. */
  notice?: string | null;
  settings: CheckoutSettings;
  /** Vista previa del editor: no crea pagos y escucha ajustes por postMessage. */
  preview: boolean;
  /** Personas con este checkout abierto en los últimos 30 minutos. */
  buyersNow: number;
  logoUrl: string | null;
  policyUrls: { terms: string; privacy: string; refund: string };
  /** Precio del principal con la oferta de salida, si hay. */
  exitPrice: number | null;
  /**
   * Descuento del mail de carrito abandonado: ya aplicado en los precios que
   * llegan (principal y bumps que tenía); el token se manda a /api/pi, que lo
   * vuelve a verificar y cobra. `notice` = el link venció o no vale.
   */
  recovery?: { token: string; pct: number; bumps: string[]; banner: string } | { notice: string } | null;
};

type Dict = (typeof T)[Locale];

export default function CheckoutClient(p: Props) {
  const stripePromise = useMemo(
    () => (p.publishableKey ? loadStripe(p.publishableKey) : null),
    [p.publishableKey]
  );
  const [fatal, setFatal] = useState<string | null>(null);
  const checkoutRef = useRef<string | null>(null);
  const [exitOn, setExitOn] = useState(false);
  const [policy, setPolicy] = useState<string | null>(null);
  const closePolicy = useCallback(() => setPolicy(null), []);

  // El <html lang> del layout es fijo: acá toma el idioma del checkout (traductor del navegador, lectores de pantalla).
  useEffect(() => {
    document.documentElement.lang = p.locale;
  }, [p.locale]);

  // Ajustes del checkout. En la vista previa del editor llegan en vivo.
  const [st, setSt] = useState(p.settings);
  useEffect(() => {
    if (!p.preview) return;
    const on = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "cp-settings") setSt(e.data.settings as CheckoutSettings);
    };
    window.addEventListener("message", on);
    window.parent?.postMessage({ type: "cp-ready" }, window.location.origin);
    return () => window.removeEventListener("message", on);
  }, [p.preview]);

  const rec = p.recovery && "token" in p.recovery ? p.recovery : null;
  const initialBumps = useMemo(
    // Del mail de carrito: los bumps que tenía tildados.
    () => (rec ? p.offers.map((o) => o.slug).filter((s) => rec.bumps.includes(s)) : p.settings.bumps.preselect ? p.offers.map((o) => o.slug) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [bumps, setBumps] = useState<string[]>(initialBumps);

  // El total se calcula acá con los mismos importes que mandó el servidor; al
  // pagar, el servidor lo vuelve a calcular desde la base y es el que cobra.
  const mainAmount = exitOn && p.exitPrice != null ? p.exitPrice : p.main.amount;
  const total = Math.round((mainAmount + p.offers.filter((o) => bumps.includes(o.slug)).reduce((a, o) => a + o.amount, 0)) * 100) / 100;

  // Registro del checkout abierto (sin Stripe): conversión, carrito abandonado
  // y el InitiateCheckout del pixel. No frena nada si falla.
  useEffect(() => {
    if (p.preview) return;
    fetch("/api/checkout/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: p.store, funnel: p.funnel, utm: p.utm, country: p.country, currency: p.currency, amount: total, ...fbIds() }),
    })
      .then((r) => r.json())
      .then((d: { id?: string }) => {
        if (!d.id) return;
        checkoutRef.current = d.id;
        track(p.pixels, "InitiateCheckout", { value: total, currency: p.currency, content_type: "product" }, `ic_${d.id}`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quién está en el checkout ahora (panel «En vivo»): sendBeacon, no espera nada.
  useEffect(() => {
    if (p.preview) return;
    return startPresence("checkout", { store: p.store, funnel: p.funnel });
  }, [p.preview, p.store, p.funnel]);

  /** Crea (o reusa) el PaymentIntent al pagar y devuelve su client secret. */
  const createIntent = useCallback(
    async (who: { email?: string; name?: string; phone?: string }, opts: { sca?: boolean } = {}) => {
      const res = await fetch("/api/pi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: p.store, funnel: p.funnel, bumps, exit: exitOn, checkout: checkoutRef.current, ...(rec ? { r: rec.token } : {}),
          currency: p.currency, country: p.country, shown: total, ...who, ...fbIds(), ...(opts.sca ? { sca: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "currency") window.location.reload();
        throw new Error(data.error ?? "No se pudo preparar el pago");
      }
      return data.clientSecret as string;
    },
    [p.store, p.funnel, p.currency, p.country, bumps, exitOn, rec, total]
  );

  const t = T[p.locale];
  // Diseño 2 = el de referencia (una columna, verde); diseño 1 = dos columnas.
  const d2 = st.design !== "1";
  const pay = st.payButton.color || st.colors.pay || (d2 ? "#16a34a" : p.payColor);
  const showBuyers = st.buyersBar.show && (p.preview || p.buyersNow >= st.buyersBar.min);

  return (
    <div
      className={`ck ${d2 ? `d2 ${dmSans.variable}` : `d1 ${inter.className}`}`}
      style={{
        ["--pay" as string]: pay,
        ...(st.colors.accent ? { ["--accent" as string]: st.colors.accent } : {}),
        ...(st.colors.background ? { background: st.colors.background } : {}),
      }}
    >
      <MetaPixel pixels={p.pixels} />
      <style dangerouslySetInnerHTML={{ __html: CHECKOUT_CSS + EXTRA_CSS + D2_CSS + (st.customCss ? `\n${st.customCss}` : "") }} />
      {d2 ? (
        st.topBar.show && (
          <header className="ck-topbar">
            {st.logo.show && p.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.logoUrl} alt={p.storeName} className="ck-logo" />
            ) : null}
            <IconLock /> <span>{st.topBar.text || t.ckSecure}</span>
          </header>
        )
      ) : (st.topBar.show || (st.logo.show && p.logoUrl)) && (
        <header className="ck-top">
          {st.topBar.show && <span className="ck-safe"><IconLock /> {st.topBar.text || t.ckSecurePay}</span>}
          {st.logo.show && p.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.logoUrl} alt={p.storeName} className="ck-logo" />
          ) : <span />}
        </header>
      )}
      {showBuyers && <SocialBar text={t.ckBuying} n={Math.max(p.buyersNow, p.preview ? st.buyersBar.min : 0)} />}
      {rec && <div className="ck-recov" role="status">{rec.banner}</div>}
      {p.recovery && "notice" in p.recovery && <div className="ck-recov off" role="status">{p.recovery.notice}</div>}
      {st.exitOffer.show && !exitOn && !rec && (
        <ExitOffer
          s={st.exitOffer}
          price={p.exitPrice != null ? money(p.exitPrice, p.currency, p.locale) : null}
          was={money(p.main.amount, p.currency, p.locale)}
          preview={p.preview}
          locale={p.locale}
          storageKey={`ck_exit_${p.store}_${p.funnel}`}
          onAccept={async () => setExitOn(true)}
        />
      )}

      <main className="ck-wrap">
        {fatal ? (
          <p className="ck-err">{fatal}</p>
        ) : stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              // Pago diferido: Stripe dibuja el formulario apenas carga la
              // página, sin esperar a crear el pago. El PaymentIntent se crea
              // al tocar "Pagar" (y en la vista previa del editor, nunca).
              mode: "payment",
              amount: Math.max(1, toMinor(total, p.currency)),
              currency: p.currency.toLowerCase(),
              setupFutureUsage: "on_session",
              ...(p.pmc ? { paymentMethodConfiguration: p.pmc } : {}),
              locale: p.locale,
              fonts: d2 ? [] : [{ cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" }],
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: pay,
                  colorText: d2 ? "#1f2937" : "#171717",
                  colorTextSecondary: "#6b7280",
                  colorDanger: "#b91c1c",
                  borderRadius: "8px",
                  fontFamily: d2 ? SYSTEM_FONT : "Inter, system-ui, sans-serif",
                  fontSizeBase: "14px",
                },
                rules: {
                  ".Input": { border: "1px solid #d1d5db", boxShadow: "none", padding: "12px 14px" },
                  ".Input:focus": { border: `1px solid ${pay}`, boxShadow: "0 0 0 3px rgba(0,91,209,.15)" },
                  ".Tab": { border: "1px solid #e5e7eb", boxShadow: "none" },
                  ".Tab--selected": { border: `1px solid ${pay}`, boxShadow: `0 0 0 1px ${pay}` },
                  ".Label": { fontWeight: "500", color: "#374151" },
                },
              },
            }}
          >
            <CheckoutForm
              p={p} t={t} st={st} total={total} bumps={bumps} setBumps={setBumps}
              createIntent={createIntent} getCheckout={() => checkoutRef.current} exitOn={exitOn}
            />
          </Elements>
        ) : (
          <div className="ck-skel" />
        )}

        {/* Como en la plataforma anterior: solo los links de las políticas (las páginas
            legales completas viven en el catálogo de la tienda). */}
        {st.policies.show && (
          <footer className="ck-foot">
            {([[p.policyUrls.privacy, t.ckPrivacy], [p.policyUrls.terms, t.ckTerms]] as const).map(([url, label]) => (
              <a key={url} href={url} onClick={(e) => { e.preventDefault(); setPolicy(url); }}>{label}</a>
            ))}
          </footer>
        )}
      </main>
      {policy && <PolicySheet url={policy} onClose={closePolicy} />}
    </div>
  );
}

/*
 * Las políticas se abren en una hoja encima del checkout, no en otra pestaña:
 * en el celular una pestaña nueva no tiene «atrás» y el comprador quedaba
 * afuera. «Atrás», la × o tocar afuera la cierran, sin perder lo escrito.
 * La trampa de «atrás» de la oferta de salida ignora ese «atrás».
 */
let policyOpen = false;
let policyClosedAt = 0;

function PolicySheet({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    policyOpen = true;
    history.pushState({ ckPolicy: 1 }, "", location.href);
    const onPop = () => { policyOpen = false; policyClosedAt = Date.now(); onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") history.back(); };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      policyOpen = false;
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="ck-pol" role="dialog" aria-modal="true" onClick={() => history.back()}>
      <div className="ck-polCard" onClick={(e) => e.stopPropagation()}>
        <div className="ck-polBar">
          <button type="button" className="ck-polX" aria-label="×" onClick={() => history.back()}>×</button>
        </div>
        <iframe src={url} title="policy" />
      </div>
    </div>
  );
}

/* ================================================================ form */

function CheckoutForm({
  p, t, st, total, bumps, setBumps, createIntent, getCheckout, exitOn,
}: {
  p: Props; t: Dict; st: CheckoutSettings; total: number; bumps: string[]; setBumps: (b: string[]) => void;
  createIntent: (who: { email?: string; name?: string; phone?: string }, opts?: { sca?: boolean }) => Promise<string>;
  getCheckout: () => string | null; exitOn: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const syncing = false;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState(p.prefillEmail);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [express, setExpress] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);

  const d2 = st.design !== "1";
  const fmt = (n: number) => money(n, p.currency, p.locale);
  const mainAmount = exitOn && p.exitPrice != null ? p.exitPrice : p.main.amount;
  const guaranteeDays = st.guarantee.days ?? p.guaranteeDays;
  const guaranteeImage = st.guarantee.image || p.guaranteeImage;
  const chosen = p.offers.filter((o) => bumps.includes(o.slug));
  const compareTotal = p.baseCompareTotal + chosen.reduce((a, o) => a + (o.compareAt ?? o.amount), 0);
  const saving = Math.max(compareTotal - total, 0);
  const returnUrl = () => `${window.location.origin}/gracias`;

  // Tildar un bump es instantáneo: el total se recalcula acá y el formulario de
  // Stripe (Apple Pay incluido) toma el importe nuevo desde las opciones.
  function toggle(slug: string) {
    setBumps(bumps.includes(slug) ? bumps.filter((s) => s !== slug) : [...bumps, slug]);
  }

  /** Tocar cualquier parte de la tarjeta del bump lo agrega o lo saca (también con teclado). */
  const cardToggle = (slug: string, on: boolean) => ({
    role: "checkbox" as const, "aria-checked": on, tabIndex: 0,
    onClick: () => { if (!busy) toggle(slug); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!busy) toggle(slug); }
    },
  });

  /** Guarda el email apenas lo escribe: es lo que permite recuperar el carrito. */
  function captureLead() {
    const checkout = getCheckout();
    if (!checkout || !/.+@.+\..+/.test(email)) return;
    const name = [first, last].filter(Boolean).join(" ");
    navigator.sendBeacon?.(
      "/api/checkout-lead",
      new Blob([JSON.stringify({ checkout, email, name })], { type: "application/json" })
    );
  }

  /** Email válido al salir del campo: evento «lead» (una vez por email). */
  const leadSent = useRef("");
  function leadEvent() {
    const e = email.trim().toLowerCase();
    if (p.preview || e === leadSent.current || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    leadSent.current = e;
    logEvent("checkout", "lead", { email: e.slice(0, 120), checkout: getCheckout() });
  }

  /** Ya se fue a gracias (por el resultado de Stripe o por el vigía): no se navega dos veces. */
  const leaving = useRef(false);
  function toThanks(pi: { id: string; status: string }, clientSecret: string, via: string) {
    if (leaving.current) return;
    leaving.current = true;
    logEvent("checkout", "paid", { pi: pi.id, status: pi.status, total, currency: p.currency, ...(via !== "confirm" ? { via } : {}) });
    const q = new URLSearchParams({
      payment_intent: pi.id,
      payment_intent_client_secret: clientSecret,
      redirect_status: pi.status === "succeeded" ? "succeeded" : pi.status,
    });
    window.location.assign(`${returnUrl()}?${q}`);
  }

  /**
   * Vigía del pago mientras el botón dice «Procesando». Cada 4 s y al volver a la pestaña le pregunta a Stripe cómo quedó: cobrado → gracias;
   * venció o lo rechazaron después de mandarlo a otra app → aviso y botón libre para pagar de otra forma.
   */
  function watchIntent(clientSecret: string) {
    let stop = false;
    let wentOut = false;
    const check = async () => {
      if (stop || leaving.current || !stripe) return;
      const { paymentIntent: pi } = await stripe.retrievePaymentIntent(clientSecret).catch(() => ({ paymentIntent: null }));
      if (!pi || stop) return;
      if (pi.status === "succeeded" || pi.status === "processing") { stop = true; return toThanks(pi, clientSecret, "watch"); }
      if (pi.status === "requires_action") wentOut = true;
      if (wentOut && pi.status === "requires_payment_method" && pi.last_payment_error) {
        stop = true;
        logEvent("checkout", "pay_error", { stage: "watch", code: pi.last_payment_error.code ?? pi.last_payment_error.decline_code ?? null, type: pi.last_payment_error.payment_method?.type ?? null });
        setMsg(t.ckPayNotDone);
        setBusy(false);
      }
    };
    const iv = window.setInterval(check, 4000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop = true; window.clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }

  /** Valida el formulario, crea el pago en el servidor y lo confirma. true = ya se va a gracias. */
  async function pay(who: { email?: string; name?: string; phone?: string }, method: "form" | "express", sca = false): Promise<boolean> {
    if (!stripe || !elements) return false;
    logEvent("checkout", "pay_attempt", { method, total, currency: p.currency, bumps: bumps.length, checkout: getCheckout() });
    const { error: invalid } = await elements.submit();
    if (invalid) {
      logEvent("checkout", "pay_error", { stage: "form", code: invalid.code ?? invalid.type ?? null });
      setMsg(invalid.message ?? null);
      return false;
    }
    let clientSecret: string;
    try {
      clientSecret = await createIntent(who, { sca });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      logEvent("checkout", "pay_error", { stage: "intent", message: m.slice(0, 160) });
      setMsg(m);
      return false;
    }
    // if_required: con tarjeta y billeteras Stripe devuelve el resultado acá y
    // la redirección a gracias la hacemos nosotros (igual a la de Stripe), así
    // queda el evento «paid». Los métodos con redirección siguen redirigiendo solos.
    const unwatch = watchIntent(clientSecret);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      redirect: "if_required",
      confirmParams: {
        return_url: returnUrl(),
        receipt_email: who.email || undefined,
        payment_method_data: {
          billing_details: {
            email: who.email || undefined, name: who.name || undefined, phone: who.phone || undefined,
            // El formulario no pide país ni código postal (como la plataforma anterior): va el
            // país desde donde se conecta. Stripe exige mandar la dirección si no la pide.
            address: { country: p.country || "US", postal_code: "", state: "", city: "", line1: "", line2: "" },
          },
        },
      },
    });
    unwatch();
    if (!error && paymentIntent) {
      toThanks(paymentIntent, clientSecret, "confirm");
      return true;
    }
    if (leaving.current) return true;
    logEvent("checkout", "pay_error", { stage: "confirm", code: error?.code ?? null, decline: error?.decline_code ?? null, type: error?.type ?? null });
    // El banco pide verificar: un reintento pidiendo 3D Secure (el comprador ve la verificación de su banco).
    const authReq = error?.decline_code === "authentication_required" || error?.code === "authentication_required";
    if (authReq && !sca) return pay(who, method, true);
    setMsg(authReq ? t.ckAuthRequired : error?.message ?? t.ckPayNotDone);
    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p.preview) return setMsg("Vista previa: acá no se cobra nada.");
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setMsg(null);
    track(p.pixels, "AddPaymentInfo");
    // Si salió bien el botón queda girando hasta que carga gracias (no se puede pagar dos veces).
    if (!(await pay({ email, name: [first, last].filter(Boolean).join(" "), phone: phone.trim() }, "form"))) setBusy(false);
  }

  return (
    <form className="ck-grid" onSubmit={submit}>
      {/* ------------------------------------------------ columna izquierda */}
      <div className="ck-left">
        {p.notice && <p className="ck-err ck-notice" role="alert">{p.notice}</p>}
        {d2 && (
          <section className="ck-prod o-prod">
            {st.offer.showImage && p.main.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.main.image} alt="" />
            )}
            <div>
              <p>{st.offer.title || p.main.name}</p>
              {st.offer.subtitle && <small className="ck-sub">{st.offer.subtitle}</small>}
              <b>
                {exitOn && st.offer.showCompareAt && <s className="ck-was">{fmt(p.main.amount)}</s>}
                {!exitOn && p.recovery && "token" in p.recovery && p.main.compareAt != null && <s className="ck-was">{fmt(p.main.compareAt)}</s>}
                {fmt(mainAmount)}
              </b>
            </div>
          </section>
        )}
        <section className="o-data">
          <h2 className="ck-h">{d2 ? <span className="ck-num">1</span> : <IconUser />}{t.ckPersonal}</h2>
          <label className="ck-label" htmlFor="ck-email">{t.ckEmail} *</label>
          <input
            id="ck-email" type="email" required autoComplete="email" inputMode="email"
            className="ck-input" placeholder={`${t.ckEmail} *`}
            value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => { captureLead(); leadEvent(); }}
          />
          <p className="ck-help">{t.ckEmailHelp}</p>
          <div className="ck-row" style={st.buyer.askLastName ? undefined : { gridTemplateColumns: "1fr" }}>
            <div>
              <label className="ck-label" htmlFor="ck-first">{t.ckFirstName} *</label>
              <input id="ck-first" required autoComplete="given-name" className="ck-input"
                placeholder={`${t.ckFirstName} *`} value={first}
                onChange={(e) => setFirst(e.target.value)} onBlur={captureLead} />
            </div>
            {st.buyer.askLastName && (
              <div>
                <label className="ck-label" htmlFor="ck-last">{t.ckLastName} *</label>
                <input id="ck-last" required autoComplete="family-name" className="ck-input"
                  placeholder={`${t.ckLastName} *`} value={last}
                  onChange={(e) => setLast(e.target.value)} onBlur={captureLead} />
              </div>
            )}
          </div>
          {st.buyer.askPhone && (
            <>
              <label className="ck-label" htmlFor="ck-phone">
                {PHONE[p.locale] ?? PHONE.en}{st.buyer.phoneRequired ? " *" : ` (${OPTIONAL[p.locale] ?? OPTIONAL.en})`}
              </label>
              <input id="ck-phone" type="tel" autoComplete="tel" inputMode="tel" className="ck-input"
                required={st.buyer.phoneRequired} placeholder="+39 333 123 4567"
                value={phone} onChange={(e) => setPhone(e.target.value)} />
            </>
          )}
        </section>

        <section className="o-method">
          <h2 className="ck-h">{d2 ? <span className="ck-num">2</span> : <IconCard />}{t.ckPayMethod}</h2>
          {st.payment.express && <ExpressCheckoutElement
            options={{
              emailRequired: true,
              buttonHeight: 48,
              // Como la plataforma anterior: el botón principal (Google Pay / Apple Pay) y «Mostrar más».
              layout: { maxColumns: 1, maxRows: 1, overflow: "auto" },
              buttonType: { applePay: "buy", googlePay: "buy" },
            }}
            onReady={({ availablePaymentMethods }) => setExpress(!!availablePaymentMethods)}
            // Sin la casilla de acceso inmediato (UE/Reino Unido) no se abre Apple/Google Pay.
            onConfirm={async (ev) => {
              if (p.preview) return setMsg("Vista previa: acá no se cobra nada.");
              track(p.pixels, "AddPaymentInfo");
              await pay({
                email: ev.billingDetails?.email ?? undefined,
                name: ev.billingDetails?.name ?? undefined,
                phone: ev.billingDetails?.phone ?? undefined,
              }, "express");
            }}
          />}
          {st.payment.express && express && <div className="ck-or">{t.ckOrPayOther}</div>}
          <div className="ck-paycard">
            <PaymentElement
              options={{
                // Como la plataforma anterior: lista con círculos, la tarjeta abierta.
                layout: { type: "accordion", radios: "always", spacedAccordionItems: false, defaultCollapsed: false },
                // Nombre y email ya se piden arriba.
                fields: { billingDetails: { name: "never", email: "never", address: "never" } },
                // Apple Pay, Google Pay y Link van arriba como botones rápidos;
                // si el checkout los apaga arriba, quedan como pestañas acá.
                wallets: st.payment.express
                  ? { applePay: "never", googlePay: "never", link: "never" }
                  : { applePay: "auto", googlePay: "auto", link: "auto" },
                // El aviso de "cobros futuros" es para cobrar sin el comprador
                // presente; los upsells se cobran con él en pantalla.
                terms: { card: "never" },
              }}
            />
          </div>
        </section>

        <div className="o-pay">
          <button type="submit" className="ck-pay" disabled={busy || syncing || !stripe}>
            {busy || syncing ? <span className="ck-spin" /> : null}
            {busy ? t.ckProcessing : st.payButton.text ? st.payButton.text.replace("{total}", fmt(total)) : t.ckPay(fmt(total))}
          </button>
          {msg && <p className="ck-err" role="alert">{msg}</p>}
          {!d2 && st.guarantee.seals && (
            <p className="ck-secure">
              <IconLock /> {t.ckSecurePay}{st.guarantee.show ? ` · ${st.guarantee.text || T[p.locale].guarantee(guaranteeDays)}` : ""}
            </p>
          )}
        </div>

        {st.guarantee.show && guaranteeImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ck-guar o-guar" src={guaranteeImage} alt={T[p.locale].guarantee(guaranteeDays)} loading="lazy" />
        )}
        {d2 && st.guarantee.seals && (
          <p className="ck-seals o-seals">
            <span><IconLock /> {t.ckSecurePay}</span>
            {st.guarantee.show && <span><IconShield /> {st.guarantee.text || T[p.locale].guarantee(guaranteeDays)}</span>}
          </p>
        )}
      </div>

      {/* ------------------------------------------------- columna derecha */}
      <div className="ck-right">
        {st.countdown.show && (
          <Countdown
            label={st.countdown.text ? (x) => st.countdown.text.includes("{tiempo}") ? st.countdown.text.replace("{tiempo}", x) : `${st.countdown.text} ${x}` : t.ckExpires}
            minutes={st.countdown.minutes}
            storageKey={`ck_dl_${p.store}_${p.funnel}`}
          />
        )}
        {p.offers.length > 0 && (
          <section className="ck-bumps o-bumps">
            {(!d2 || st.bumps.title) && <p className="ck-bumpTitle">⚡ {st.bumps.title || t.ckBumpsTitle}</p>}
            <div className="ck-bumpList">
              {p.offers.map((o) => {
                const on = bumps.includes(o.slug);
                if (d2) return (
                  // Diseño 2: la tarjeta de la plataforma anterior, con la casilla abajo. Toda la tarjeta agrega o saca.
                  <div key={o.slug} className={`ck-b2${on ? " on" : ""}`} {...cardToggle(o.slug, on)}>
                    <div className="ck-b2Body">
                      <p className="ck-b2Name">{o.name}</p>
                      <div className="ck-b2Row">
                        {o.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="ck-b2Img" src={o.image} alt="" loading="lazy" />
                        )}
                        <div className="ck-b2Desc">{o.description}</div>
                      </div>
                      <div className="ck-b2Price">
                        <b>{fmt(o.amount)}</b>
                        {o.compareAt != null && <s>{fmt(o.compareAt)}</s>}
                        {o.off != null && o.off > 0 && <span className="ck-b2Off">-{o.off}%</span>}
                      </div>
                    </div>
                    <label className="ck-b2Foot" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(o.slug)} />
                      <span>{on ? t.ckAdded : t.ckAddToOrder}</span>
                    </label>
                  </div>
                );
                return (
                  <div key={o.slug} className={`ck-bump${on ? " on" : ""}`} {...cardToggle(o.slug, on)}>
                    {o.off != null && o.off > 0 && <span className="ck-off">-{o.off}%</span>}
                    {o.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="ck-bumpImg" src={o.image} alt="" loading="lazy" />
                    )}
                    <div className="ck-bumpBody">
                      <p className="ck-bumpName">{o.name}</p>
                      <p className="ck-bumpPrice">
                        {o.compareAt != null && <s>{fmt(o.compareAt)}</s>}
                        <b>+{fmt(o.amount)}</b>
                      </p>
                      <p className="ck-bumpDesc">{o.description}</p>
                      <button type="button" className={`ck-bumpBtn${on ? " on" : ""}`}
                        disabled={syncing || busy} onClick={(e) => { e.stopPropagation(); toggle(o.slug); }}>
                        {on ? t.ckAdded : t.ckAddToOrder}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="ck-sum o-sum" data-open={sumOpen}>
          <button type="button" className="ck-sumHead" onClick={() => setSumOpen((v) => !v)}>
            <span>{t.ckSummary}<IconChevron /></span>
            <strong>{fmt(total)}</strong>
          </button>
          <div className="ck-sumBody">
            <div className="ck-line">
              {st.offer.showImage && p.main.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.main.image} alt="" />
              )}
              <span>
                {st.offer.title || p.main.name}
                {st.offer.subtitle && <small className="ck-sub">{st.offer.subtitle}</small>}
              </span>
              <b>
                {exitOn && st.offer.showCompareAt && <s className="ck-was">{fmt(p.main.amount)}</s>}
                {!exitOn && p.recovery && "token" in p.recovery && p.main.compareAt != null && <s className="ck-was">{fmt(p.main.compareAt)}</s>}
                {fmt(mainAmount)}
              </b>
            </div>
            {chosen.map((o) => (
              <div key={o.slug} className="ck-line">
                {o.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.image} alt="" />
                )}
                <span>{o.shortName}</span>
                <b>{fmt(o.amount)}</b>
              </div>
            ))}

            {st.bonuses.show && (p.bonuses.length > 0 || p.included.length > 0) && (
              <>
                <p className="ck-free"><IconGift />{st.bonuses.title || t.ckIncludesFree}</p>
                {[...p.included.map((b) => ({ name: b.name, displayValue: null as number | null })), ...p.bonuses].map((b, i) => (
                  <div key={i} className="ck-freeRow">
                    <span title={b.name}>{b.name}</span>
                    {b.displayValue != null && <s>{fmt(b.displayValue)}</s>}
                    <em className="ck-badge" style={{ fontStyle: "normal" }}>{t.ckFree}</em>
                  </div>
                ))}
              </>
            )}

            <div className="ck-total">
              <div className="row">
                <span>{t.ckTotal}</span>
                {st.offer.showCompareAt && saving > 0 && <s>{fmt(compareTotal)}</s>}
              </div>
              <p className="big">{fmt(total)}</p>
              {st.offer.showSavings && saving > 0 && <p className="save">{t.ckSave(fmt(saving))}</p>}
            </div>
          </div>
        </section>
      </div>
    </form>
  );
}

/* ============================================================= piezas */

function Countdown({ label, minutes, storageKey }: { label: (t: string) => string; minutes: number; storageKey: string }) {
  // Solo corre en el cliente: si el servidor pintara un número, React
  // encontraría otro al hidratar. El plazo se guarda en el navegador: recargar
  // la página no lo reinicia (un reloj que vuelve a empezar es engañoso).
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let deadline = Date.now() + minutes * 60_000;
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved && saved > Date.now() - 24 * 3600_000) deadline = saved;
      else localStorage.setItem(storageKey, String(deadline));
    } catch { /* modo privado: queda en memoria */ }
    const tick = () => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [minutes, storageKey]);
  if (left === 0) return null;
  const mm = left === null ? "--" : String(Math.floor(left / 60)).padStart(2, "0");
  const ss = left === null ? "--" : String(left % 60).padStart(2, "0");
  const [before, after] = label("§").split("§");
  return (
    <div className="ck-timer" style={{ visibility: left === null ? "hidden" : "visible" }}>
      <IconClock />{before}<b>{mm}:{ss}</b>{after}
    </div>
  );
}

/** Personas con este checkout abierto en la última media hora (número real). */
function SocialBar({ text, n }: { text: (n: number) => string; n: number }) {
  return (
    <div className="ck-social">
      <IconUsers /> {text(n)} <span className="ck-dot" />
    </div>
  );
}

/** Oferta de salida: una vez por visita, cuando el mouse se va hacia arriba (escritorio). */
/**
 * Downsell: una sola vez por visita. Se dispara al tocar «atrás» (celular y
 * computadora: se agrega una entrada al historial y se la intercepta) o al
 * sacar el mouse por arriba (computadora). Si lo cierra o vuelve a tocar
 * «atrás», se va normalmente.
 */
function ExitOffer({ s, price, was, preview, locale, storageKey, onAccept }: {
  s: CheckoutSettings["exitOffer"]; price: string | null; was: string; preview: boolean; locale: Locale;
  storageKey: string; onAccept: () => Promise<void>;
}) {
  const [open, setOpen] = useState(preview);
  useEffect(() => {
    if (preview) return;
    const seen = () => { try { return !!sessionStorage.getItem(storageKey); } catch { return false; } };
    const mark = () => { try { sessionStorage.setItem(storageKey, "1"); } catch { /* sin storage */ } };
    const show = () => { if (seen()) return false; mark(); setOpen(true); return true; };

    const onOut = (e: MouseEvent) => {
      if (e.clientY > 8 || e.relatedTarget) return;
      show();
    };
    // «Atrás»: la entrada extra del historial atrapa el primer toque.
    let trapped = false;
    const onPop = () => {
      // Ese «atrás» cerró la hoja de políticas: no es irse del checkout.
      if (policyOpen || Date.now() - policyClosedAt < 400) return;
      if (trapped && show()) {
        history.pushState({ ckExit: 1 }, "", location.href);
        return;
      }
      trapped = false;
      history.back();
    };
    if (s.onExitIntent) document.addEventListener("mouseout", onOut);
    if (s.onBack && !seen()) {
      history.pushState({ ckExit: 1 }, "", location.href);
      trapped = true;
      window.addEventListener("popstate", onPop);
    }
    return () => {
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("popstate", onPop);
    };
  }, [preview, s.onBack, s.onExitIntent, storageKey]);
  if (!open) return null;
  const tx = EXIT_TX[locale] ?? EXIT_TX.en;
  const hasDeal = !!price && (s.price > 0 || s.discountPercent > 0);
  return (
    <div className="ck-exit" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
      <div className="ck-exitCard" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ck-exitX" aria-label="×" onClick={() => setOpen(false)}>×</button>
        <p className="ck-exitTitle">{s.title || tx.title}</p>
        {s.text && <p className="ck-exitText">{s.text}</p>}
        {hasDeal && <p className="ck-exitPrice"><s>{was}</s> <b>{price}</b></p>}
        {hasDeal ? (
          <>
            <button type="button" className="ck-pay" onClick={async () => { setOpen(false); await onAccept(); }}>
              {tx.yes(price!)}
            </button>
            <button type="button" className="ck-exitNo" onClick={() => setOpen(false)}>{tx.no}</button>
          </>
        ) : (
          <button type="button" className="ck-pay" onClick={() => setOpen(false)}>OK</button>
        )}
      </div>
    </div>
  );
}

const EXIT_TX: Partial<Record<string, { title: string; yes: (p: string) => string; no: string }>> & { en: { title: string; yes: (p: string) => string; no: string } } = {
  en: { title: "Wait! Before you go…", yes: (p) => `Yes, I want it for ${p}`, no: "No, thanks" },
  it: { title: "Aspetta! Prima di andare…", yes: (p) => `Sì, lo voglio a ${p}`, no: "No, grazie" },
  es: { title: "¡Esperá! Antes de irte…", yes: (p) => `Sí, lo quiero por ${p}`, no: "No, gracias" },
  "pt-BR": { title: "Espera! Antes de sair…", yes: (p) => `Sim, quero por ${p}`, no: "Não, obrigado" },
  fr: { title: "Attends ! Avant de partir…", yes: (p) => `Oui, je le veux pour ${p}`, no: "Non, merci" },
  de: { title: "Warte! Bevor du gehst…", yes: (p) => `Ja, ich will es für ${p}`, no: "Nein, danke" },
};

const PHONE: Partial<Record<string, string>> = { it: "Telefono", en: "Phone", es: "Teléfono", "pt-BR": "Telefone", fr: "Téléphone", de: "Telefon" };
const OPTIONAL: Partial<Record<string, string>> = { it: "facoltativo", en: "optional", es: "opcional", "pt-BR": "opcional", fr: "facultatif", de: "optional" };

/**
 * Diseño 2: el checkout de referencia, medido sobre
 * un checkout de referencia. Una columna de 544 px, verde
 * #16a34a, fondo #eef1f4, tarjetas blancas con borde #e5e7eb y radio 10,
 * pasos numerados, bumps con casilla abajo y resumen plegable al final.
 */
const D2_CSS = `
.ck.d2 { --pay:#16a34a; --ok:#16a34a; background:#eef1f4; color:#1f2937;
  font-family:ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.d2 .ck-topbar { background:#16a34a; color:#fff; min-height:48px; padding:12px 16px; display:flex; align-items:center;
  justify-content:center; gap:6px; font-size:14px; font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.04); }
.d2 .ck-topbar .ck-logo { max-height:26px; margin-right:10px; }
.d2 .ck-social { background:#2d2d2d; padding:8px 16px; font-size:12px; }
.d2 .ck-wrap { max-width:576px; padding:20px 16px 36px; }
.d2 .ck-grid { display:flex; flex-direction:column; align-items:stretch; gap:16px; }
.d2 .ck-left, .d2 .ck-right { display:contents; }
.d2 .ck-notice { order:-1 } .d2 .o-prod { order:0 } .d2 .o-data { order:1 } .d2 .o-method { order:2 } .d2 .ck-timer { order:3 }
.d2 .o-bumps { order:4 } .d2 .o-pay { order:5 } .d2 .o-guar { order:6 } .d2 .o-seals { order:7 } .d2 .o-sum { order:8 }
.d2 .ck-prod { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14px 16px; display:flex; gap:12px; align-items:center; }
.d2 .ck-prod img { width:48px; height:62px; object-fit:contain; flex-shrink:0; }
.d2 .ck-prod p { margin:0; font-size:15.2px; font-weight:700; line-height:1.3; color:#1f2937; }
.d2 .ck-prod b { display:block; margin-top:3px; color:#16a34a; font-size:18.4px; font-weight:700; }
.d2 .o-data, .d2 .o-method { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:16px; }
.d2 .ck-h { font-size:18.4px; font-weight:600; color:#1f2937; gap:8px; margin:0 0 14px; letter-spacing:0; }
.d2 .ck-num { width:26px; height:26px; border-radius:9999px; background:#16a34a; color:#fff; font-size:13.6px; font-weight:800;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.d2 .ck-help { display:none; }
.d2 .ck-label { margin-top:4px; }
.d2 .ck-input { border-color:#d1d5db; }
.d2 .o-data .ck-input { margin-bottom:12px; }
.d2 .ck-paycard { background:transparent; border:0; padding:0; }
.d2 .ck-or { color:#4b5563; font-size:12px; }
.d2 .ck-bumps { background:none; border:0; padding:0; }
.d2 .ck-bumpList { gap:10px; }
.d2 .ck-b2 { background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;
  font-family:var(--font-dm), "DM Sans", -apple-system, sans-serif; transition:border-color .15s; }
.d2 .ck-b2.on { border-color:#16a34a; }
.d2 .ck-b2Body { padding:14px 14px 12px; }
.d2 .ck-b2Name { margin:0 0 8px; font-size:16px; font-weight:700; line-height:1.5; color:#1f2937; }
.d2 .ck-b2Row { display:flex; gap:10px; align-items:flex-start; }
.d2 .ck-b2Img { width:64px; height:64px; object-fit:contain; flex-shrink:0; }
.d2 .ck-b2Desc { font-size:16px; line-height:1.5; color:#6b7280; }
.d2 .ck-b2Price { display:flex; align-items:center; gap:8px; margin-top:10px; }
.d2 .ck-b2Price b { color:#16a34a; font-size:16px; font-weight:700; }
.d2 .ck-b2Price s { color:#9ca3af; font-size:12.8px; }
.d2 .ck-b2Off { margin-left:auto; background:#16a34a; color:#fff; font-size:11.2px; font-weight:700; padding:2px 8px; border-radius:6px; }
.d2 .ck-b2Foot { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#fafafa; border-top:1px solid #e5e7eb;
  cursor:pointer; color:#16a34a; font-size:14.4px; font-weight:700; }
.d2 .ck-b2.on .ck-b2Foot { background:#f0fdf4; }
.d2 .ck-b2Foot input { width:18px; height:18px; accent-color:#16a34a; margin:0; cursor:pointer; }
.d2 .ck-pay { border-radius:8px; height:56px; font-weight:800; text-transform:uppercase; letter-spacing:.02em;
  box-shadow:0 2px 6px rgba(22,163,74,.35); }
.d2 .ck-guar { border-radius:10px; }
.d2 .ck-seals { display:flex; justify-content:center; gap:16px; margin:4px 0 0; font-size:11.5px; color:#4b5563; }
.d2 .ck-seals span { display:inline-flex; align-items:center; gap:5px; }
.d2 .ck-sum { border-radius:10px; }
.d2 .ck-sumHead { cursor:pointer; padding:14px 16px; }
.d2 .ck-sumHead span { color:#16a34a; font-weight:400; font-size:14px; }
.d2 .ck-sumHead strong { font-size:17.6px; font-weight:600; color:#1f2937; }
.d2 .ck-sumHead svg { display:block; transition:transform .2s; }
.d2 .ck-sum[data-open="false"] .ck-sumBody { display:none; }
.d2 .ck-sum[data-open="true"] .ck-sumHead svg { transform:rotate(180deg); }
.d2 .ck-foot { margin-top:18px; display:flex; justify-content:center; gap:16px; flex-wrap:wrap; }
.d2 .ck-foot a { font-size:11.2px; text-transform:uppercase; color:#6b7280; text-decoration:underline; text-underline-offset:2px; }
/* Compu (06/10, pedido del dueño): dos columnas en vez de una angosta con gris a los costados.
   Izquierda: producto, datos, pago, Pagar y garantía. Derecha: cuenta regresiva, bumps y el
   resumen siempre abierto. No es sticky: con 4 bumps es más alta que la pantalla. En el
   celular (menos de 1024 px) sigue igual: una columna. */
@media (min-width:1024px) {
  .d2 .ck-wrap { max-width:1080px; padding:28px 24px 40px; }
  .d2 .ck-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,420px); gap:24px; align-items:start; }
  .d2 .ck-left, .d2 .ck-right { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .d2 .ck-right { position:static; }
  .d2 .ck-sum[data-open="false"] .ck-sumBody { display:block; }
  .d2 .ck-sumHead { cursor:default; pointer-events:none; }
  .d2 .ck-sumHead svg { display:none; }
}
`;

const EXTRA_CSS = `
html,body{touch-action:manipulation;-webkit-text-size-adjust:100%}
@media (max-width:640px){.ck-input{font-size:16px}}
.ck-recov{background:#dcfce7;color:#14532d;font-weight:700;font-size:14px;line-height:1.4;text-align:center;padding:10px 16px;border-bottom:1px solid #bbf7d0}
.ck-recov.off{background:#f3f4f6;color:#4b5563;font-weight:500;border-bottom-color:#e5e7eb}
.ck-foot { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; }
.d1 .ck-top { justify-content:space-between; }
.ck-top{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1080px;margin:0 auto;padding:12px 16px}
.ck-logo{max-height:34px;max-width:180px;object-fit:contain}
.ck-safe{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#15803d}
.ck-sub{display:block;font-size:12px;font-weight:400;color:#6b7280;margin-top:2px}
.ck-was{color:#9ca3af;font-weight:400;margin-right:6px}
.ck-exit{position:fixed;inset:0;z-index:50;background:rgba(17,17,17,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.ck-exitCard{position:relative;background:#fff;border-radius:16px;max-width:420px;width:100%;padding:28px 24px 22px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.ck-exitX{position:absolute;top:8px;right:12px;border:0;background:none;font-size:24px;line-height:1;color:#9ca3af;cursor:pointer}
.ck-exitTitle{font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-.01em}
.ck-exitText{font-size:15px;line-height:1.5;color:#4b5563;margin:0 0 14px;white-space:pre-line}
.ck-exitNo{margin-top:10px;border:0;background:none;color:#6b7280;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit}
.ck-exitPrice{font-size:18px;margin:0 0 16px}.ck-exitPrice s{color:#9ca3af;font-weight:400}.ck-exitPrice span{color:#15803d;font-weight:700;font-size:14px;margin-left:4px}
`;

const svg = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IconUser = () => (<svg {...svg}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
const IconCard = () => (<svg {...svg}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></svg>);
const IconLock = () => (<svg {...svg} width={14} height={14}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>);
const IconClock = () => (<svg {...svg} width={13} height={13} strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const IconGift = () => (<svg {...svg} width={13} height={13} strokeWidth={2.2}><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9M12 8c-2-4-6-4-6-1.5S9 8 12 8c3 0 6-.5 6-2.5S14 4 12 8" /></svg>);
const IconUsers = () => (<svg {...svg} width={14} height={14}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>);
const IconShield = () => (<svg {...svg} width={13} height={13}><path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" /></svg>);
const IconChevron = () => (<svg {...svg} width={16} height={16} strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>);
