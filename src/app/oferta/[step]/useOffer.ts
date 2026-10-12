"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { track } from "@/lib/track-client";
import type { Locale } from "@/lib/i18n";

/**
 * Qué pasa al tocar "Sí" o "No, gracias", igual para la plantilla y para las
 * landings HTML.
 *
 *  live    → cobro real. La pantalla NO avanza hasta que el PaymentIntent
 *            esté cobrado (succeeded):
 *              1. 1 clic con el medio que dejó guardado en el checkout
 *                 (tarjeta, Link, Amazon Pay, Cash App…);
 *              2. si pide un paso más: 3DS en la página, o la redirección
 *                 (vuelve a esta oferta con upsell_return=1);
 *              3. si no se puede cobrar así: la hoja de pago (PaySheet) ahí
 *                 mismo, y se espera. Paga → «Agregado a tu pedido ✓» ~1 s y
 *                 sigue; cierra la hoja o toca «No, gracias» → sigue como un no.
 *            Nunca avanza por un error ni dice «aceptado» sin cobro.
 *            next = a dónde lleva "No, gracias" (el downsell, si hay);
 *            acceptNext = a dónde va después de comprar (el siguiente OTO).
 *            returned = volvió de una redirección ya mirada en el servidor:
 *            "ok" (cobrado) o "failed" (se abre la hoja).
 *  preview → nada se cobra ni se anota. Con acceptNext/declineNext (la
 *            simulación de la cadena) avanza como avanzaría el comprador; sin
 *            ellos (vista previa de un producto) se queda y muestra un aviso.
 */
export type OfferMode =
  | {
      kind: "live"; sessionId: string; orderId: string; productSlug: string; next: string; acceptNext?: string; publishableKey: string;
      locale?: Locale; productName?: string;
      buyer?: { email: string | null; name: string | null; country: string | null };
      returned?: "ok" | "failed";
    }
  | { kind: "preview"; acceptNext?: string; declineNext?: string };

export type OfferState = "idle" | "loading" | "done" | "error";

/** Lo que necesita la hoja de pago (un PaymentIntent sin confirmar, creado por el servidor). */
export type SheetData = { clientSecret: string; pi: string; amount: number; currency: string; savedFailed: boolean };

const stripes = new Map<string, Promise<Stripe | null>>();
export function stripeFor(pk: string) {
  let p = stripes.get(pk);
  if (!p) stripes.set(pk, (p = loadStripe(pk)));
  return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useOffer(mode: OfferMode) {
  const [state, setState] = useState<OfferState>("idle");
  const [previewNote, setPreviewNote] = useState(false);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** El pago quedó «procesando» más de lo que esperamos: se avisa, no se avanza solo. */
  const [pending, setPending] = useState(false);
  // Después de un intento fallido con el medio guardado, el próximo "sí" va directo a la hoja.
  const fresh = useRef(false);
  const live = mode.kind === "live" ? mode : null;
  const preview = mode.kind === "preview" ? mode : null;

  /** A dónde lleva "No, gracias". */
  const next = live?.next ?? preview?.declineNext ?? null;
  /** El enlace del aviso de error: si el cobro falló, no tiene sentido ofrecerle el downsell. */
  const continueHref = live ? live.acceptNext ?? live.next : next;

  function go(url: string) {
    // Un respiro para que se vea «Agregado a tu pedido ✓» antes de seguir.
    setTimeout(() => (window.location.href = url), 1200);
  }

  function beacon(event: "decline" | "fail") {
    if (!live) return;
    navigator.sendBeacon?.("/api/upsell/event",
      new Blob([JSON.stringify({ sessionId: live.sessionId, productSlug: live.productSlug, event })], { type: "application/json" }));
  }

  /** Un intento de cobro que no salió (no frena nada: queda en el panel con el motivo). */
  function payError(reason: string, extra: Record<string, unknown> = {}) {
    if (!live) return;
    track("oferta", "pay_error", { stage: "oto", code: reason.slice(0, 60), product: live.productSlug, order: live.orderId, ...extra });
  }

  /** Cobrado (PaymentIntent succeeded): recién acá cuenta como "aceptó la oferta" y avanza. */
  function succeed(via: string) {
    if (!live) return;
    track("oferta", "oto_accept", { product: live.productSlug, order: live.orderId, via });
    setState("done");
    go(live.acceptNext ?? live.next);
  }

  /** Error que no es del pago (pedido inválido, sin conexión): aviso con enlace, nunca avanza solo. */
  function fail(reason: string) {
    payError(reason);
    beacon("fail");
    setState("error");
  }

  async function post(url: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { status: 0, data: { reason: "network" } as Record<string, unknown> };
    }
  }

  /**
   * Un pago confirmado en el navegador (3DS, la hoja) o que quedó «procesando»:
   * el servidor lo mira en Stripe y lo registra. Avanza solo si está cobrado.
   */
  async function settle(pi: string, via: string) {
    const m = live!;
    for (let i = 0; i < 12; i++) {
      const r = await post("/api/upsell/confirm", { sessionId: m.sessionId, pi });
      if (r.data.ok && !r.data.processing) return succeed(via);
      if (!r.data.processing) {
        // Stripe no lo da por cobrado: no se avanza, se paga de otra forma.
        payError(String(r.data.status ?? r.data.reason ?? `confirm_${r.status}`), { pi });
        return openSheet({ fresh: true, cancelPi: pi });
      }
      await sleep(2500);
    }
    // Sigue procesando después de ~30 s: no se dice «agregado» ni se avanza solo.
    payError("still_processing", { pi });
    setSheetOpen(false);
    setPending(true);
    setState("error");
  }

  /** Pide la hoja de pago (PaymentIntent nuevo, sin confirmar) y la abre. */
  async function openSheet(opts: { fresh?: boolean; cancelPi?: string } = {}) {
    setState("loading");
    return charge({ ...opts, fresh: true });
  }

  /** Pide el cobro al servidor y sigue según la respuesta. */
  async function charge(opts: { fresh?: boolean; cancelPi?: string } = {}): Promise<void> {
    const m = live!;
    const r = await post("/api/upsell", {
      sessionId: m.sessionId, productSlug: m.productSlug, returnUrl: returnUrl(), ...opts,
    });
    const d = r.data;

    if (d.ok) return succeed(d.already ? "already" : `saved_${d.method ?? "method"}`);

    if (d.reason === "processing" && typeof d.pi === "string") return settle(d.pi, `saved_${d.method ?? "method"}`);

    // El medio guardado pide un paso más: 3DS en la página, o la redirección
    // (Amazon Pay, Cash App), que vuelve a esta oferta con upsell_return=1.
    if (d.reason === "requires_action" && typeof d.clientSecret === "string") {
      const stripe = await stripeFor(m.publishableKey);
      if (stripe) {
        const { paymentIntent, error } = await stripe.handleNextAction({ clientSecret: d.clientSecret });
        if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
          return settle(paymentIntent.id, `saved_${d.method ?? "method"}`);
        }
        payError(error?.decline_code ?? error?.code ?? error?.type ?? paymentIntent?.status ?? "requires_action", { method: d.method });
      } else payError("stripe_js");
      // No autenticó o se rechazó: que pague como quiera, ahí mismo.
      fresh.current = true;
      return charge({ fresh: true, cancelPi: String(d.pi ?? "") });
    }

    if (d.reason === "needs_payment" && typeof d.clientSecret === "string") {
      const rf = d.reuseFailed as { method?: string; code?: string } | undefined;
      if (rf) payError(`saved_${rf.method ?? "method"}_${rf.code ?? "failed"}`);
      fresh.current = true;
      setSheet({ clientSecret: d.clientSecret, pi: String(d.pi), amount: Number(d.amount), currency: String(d.currency), savedFailed: !!rf });
      setSheetOpen(true);
      setState("idle");
      return;
    }

    if (r.status === 403 || r.status === 404) return fail(String(d.error ?? `http_${r.status}`));
    // Cualquier otra cosa (red, error del servidor): una vez más, directo a la hoja.
    if (!opts.fresh) {
      payError(String(d.reason ?? d.error ?? `http_${r.status}`));
      fresh.current = true;
      return charge({ fresh: true });
    }
    fail(String(d.reason ?? d.error ?? `http_${r.status}`));
  }

  /** La URL a la que vuelven las redirecciones: esta misma oferta. */
  function returnUrl() {
    const u = new URL(window.location.href);
    for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status"]) u.searchParams.delete(k);
    u.searchParams.set("upsell_return", "1");
    return u.toString();
  }

  // Volvió de una redirección (Amazon Pay, Cash App…): el servidor ya miró el pago.
  const handled = useRef(false);
  useEffect(() => {
    if (!live?.returned || handled.current) return;
    handled.current = true;
    // Sin los parámetros de Stripe en la barra: recargar no repite nada.
    try {
      const u = new URL(window.location.href);
      for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status", "upsell_return"]) u.searchParams.delete(k);
      window.history.replaceState(null, "", u.toString());
    } catch { /* no importa */ }
    if (live.returned === "ok") succeed("redirect");
    else {
      // No se completó (canceló en Amazon Pay, rechazo…): la hoja, ahí mismo.
      payError("redirect_failed");
      fresh.current = true;
      void openSheet({ fresh: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept() {
    if (state === "loading" || state === "done") return;
    if (preview) {
      setState("loading");
      setTimeout(() => {
        setState("done");
        if (preview.acceptNext) go(preview.acceptNext);
        else setPreviewNote(true);
      }, 700);
      return;
    }
    // La hoja ya tiene su PaymentIntent: volver a abrirla, sin crear otro.
    if (sheet) {
      setSheetOpen(true);
      return;
    }
    setPending(false);
    setState("loading");
    track("oferta", "pay_attempt", { stage: "oto", product: live!.productSlug, order: live!.orderId });
    await charge(fresh.current ? { fresh: true } : {});
  }

  /**
   * "No, gracias". Devuelve true si el enlace debe seguir solo (navegación
   * normal); false si hay que frenar el clic (vista previa sin siguiente).
   */
  function decline(): boolean {
    if (live) {
      track("oferta", "oto_decline", { product: live.productSlug, order: live.orderId });
      beacon("decline");
      return true;
    }
    if (preview?.declineNext) return true;
    setPreviewNote(true);
    return false;
  }

  /** Cerrar la hoja sin pagar es un «No, gracias»: sigue al próximo paso. */
  function declineFromSheet() {
    if (!live) return;
    decline();
    setSheetOpen(false);
    window.location.href = live.next;
  }

  /** Props de la hoja de pago, o null si no está abierta. */
  const sheetProps = live && sheet && sheetOpen ? {
    data: sheet,
    publishableKey: live.publishableKey,
    locale: (live.locale ?? "en") as Locale,
    productName: live.productName ?? "",
    buyer: live.buyer ?? { email: null, name: null, country: null },
    done: state === "done",
    returnUrl,
    onDecline: declineFromSheet,
    onPaid: (pi: string) => settle(pi, "sheet"),
    onError: (code: string) => payError(code, { flow: "sheet" }),
  } : null;

  return { state, accept, decline, next, continueHref, previewNote, pending, isPreview: !!preview, sheetProps };
}
