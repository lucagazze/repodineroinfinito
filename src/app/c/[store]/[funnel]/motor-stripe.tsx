"use client";

import { ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { track } from "@/components/MetaPixel";
import { track as logEvent } from "@/lib/track-client";
import type { Comprador, CtxMotor, Motor } from "./motores";

/**
 * Cobrar con Stripe. Es el codigo que venia funcionando, movido tal cual desde
 * CheckoutClient: al agregar Whop no se reescribio nada de este camino, porque
 * el circuito de cobro que ya cobra es lo ultimo que conviene tocar.
 */
export function useMotorStripe(c: CtxMotor): Motor {
  const { p, t, st, total, bumps, setMsg, setBusy, getCheckout, createIntent, aGracias, yendose, express, setExpress } = c;
  const stripe = useStripe();
  const elements = useElements();

  const returnUrl = () => `${window.location.origin}/gracias`;

  const aGraciasStripe = (pi: { id: string; status: string }, clientSecret: string, via: string) =>
    aGracias({
      id: pi.id, status: pi.status, via,
      qs: {
        payment_intent: pi.id,
        payment_intent_client_secret: clientSecret,
        redirect_status: pi.status === "succeeded" ? "succeeded" : pi.status,
      },
    });

  /**
   * Vigia del pago mientras el boton dice «Procesando». Cada 4 s y al volver a
   * la pestana le pregunta a Stripe como quedo: cobrado -> gracias; vencio o lo
   * rechazaron despues de mandarlo a otra app -> aviso y boton libre para pagar
   * de otra forma.
   */
  function watchIntent(clientSecret: string) {
    let stop = false;
    let wentOut = false;
    const check = async () => {
      if (stop || yendose.current || !stripe) return;
      const { paymentIntent: pi } = await stripe.retrievePaymentIntent(clientSecret).catch(() => ({ paymentIntent: null }));
      if (!pi || stop) return;
      if (pi.status === "succeeded" || pi.status === "processing") { stop = true; return aGraciasStripe(pi, clientSecret, "watch"); }
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
  async function pagar(who: Comprador, method: "form" | "express", sca = false): Promise<boolean> {
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
    // if_required: con tarjeta y billeteras Stripe devuelve el resultado aca y
    // la redireccion a gracias la hacemos nosotros (igual a la de Stripe), asi
    // queda el evento «paid». Los metodos con redireccion siguen redirigiendo solos.
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
            // El formulario no pide pais ni codigo postal (como la plataforma anterior): va el
            // pais desde donde se conecta. Stripe exige mandar la direccion si no la pide.
            address: { country: p.country || "US", postal_code: "", state: "", city: "", line1: "", line2: "" },
          },
        },
      },
    });
    unwatch();
    if (!error && paymentIntent) {
      aGraciasStripe(paymentIntent, clientSecret, "confirm");
      return true;
    }
    if (yendose.current) return true;
    logEvent("checkout", "pay_error", { stage: "confirm", code: error?.code ?? null, decline: error?.decline_code ?? null, type: error?.type ?? null });
    // El banco pide verificar: un reintento pidiendo 3D Secure (el comprador ve la verificacion de su banco).
    const authReq = error?.decline_code === "authentication_required" || error?.code === "authentication_required";
    if (authReq && !sca) return pagar(who, method, true);
    setMsg(authReq ? t.ckAuthRequired : error?.message ?? t.ckPayNotDone);
    return false;
  }

  return {
    listo: !!stripe && !!elements,
    pagar: (who, method) => pagar(who, method),
    elemento: (
      <>
        {st.payment.express && <ExpressCheckoutElement
          options={{
            emailRequired: true,
            buttonHeight: 48,
            // Como la plataforma anterior: el boton principal (Google Pay / Apple Pay) y «Mostrar mas».
            layout: { maxColumns: 1, maxRows: 1, overflow: "auto" },
            buttonType: { applePay: "buy", googlePay: "buy" },
          }}
          onReady={({ availablePaymentMethods }) => setExpress(!!availablePaymentMethods)}
          // Sin la casilla de acceso inmediato (UE/Reino Unido) no se abre Apple/Google Pay.
          onConfirm={async (ev) => {
            if (p.preview) return setMsg("Vista previa: aca no se cobra nada.");
            track(p.pixels, "AddPaymentInfo");
            await pagar({
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
              // Como la plataforma anterior: lista con circulos, la tarjeta abierta.
              layout: { type: "accordion", radios: "always", spacedAccordionItems: false, defaultCollapsed: false },
              // Nombre y email ya se piden arriba.
              fields: { billingDetails: { name: "never", email: "never", address: "never" } },
              // Apple Pay, Google Pay y Link van arriba como botones rapidos;
              // si el checkout los apaga arriba, quedan como pestanas aca.
              wallets: st.payment.express
                ? { applePay: "never", googlePay: "never", link: "never" }
                : { applePay: "auto", googlePay: "auto", link: "auto" },
              // El aviso de "cobros futuros" es para cobrar sin el comprador
              // presente; los upsells se cobran con el en pantalla.
              terms: { card: "never" },
            }}
          />
        </div>
      </>
    ),
  };
}
