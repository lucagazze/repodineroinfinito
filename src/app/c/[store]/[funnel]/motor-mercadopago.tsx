"use client";

import { track as logEvent } from "@/lib/track-client";
import type { Comprador, CtxMotor, Motor } from "./motores";

/**
 * El motor de Mercado Pago: Checkout Pro.
 *
 * ES EL MAS SIMPLE DE LOS TRES, Y A PROPOSITO
 *   No hay campos de tarjeta aqui. Se arma la preferencia en nuestro servidor
 *   y se manda al comprador a pagar a Mercado Pago, que lo trae de vuelta.
 *
 *   Se pierde la pagina unica. Se gana lo que en Argentina decide la venta:
 *   CUOTAS, la billetera, y Rapipago / Pago Facil para quien no tiene tarjeta.
 *   Un formulario propio no tiene nada de eso, y ademas obliga a tocar numeros
 *   de tarjeta -- que con Whop y con esto no pasa nunca.
 *
 * LO QUE ESTE MOTOR NO HACE
 *   No cobra. La respuesta de /api/mercadopago/pay dice A DONDE mandar al
 *   comprador, no que el dinero entro. Lo que entrega es el webhook del pago.
 *   Por eso aqui no se llama a `aGracias`: a la pagina de gracias la trae
 *   Mercado Pago con su `back_url`, y recien cuando el pago quedo aprobado.
 */
export function useMotorMercadoPago(c: CtxMotor): Motor {
  const { p, t, total, bumps, exitOn, setMsg, setBusy, getCheckout, recoveryToken } = c;

  async function pagar(who: Comprador, method: "form" | "express"): Promise<boolean> {
    logEvent("checkout", "pay_attempt", {
      method, total, currency: p.currency, bumps: bumps.length,
      checkout: getCheckout(), via: "mercadopago",
    });
    setMsg(null);
    setBusy(true);

    let r: Response;
    try {
      r = await fetch("/api/mercadopago/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          store: p.store, funnel: p.funnel,
          bumps, exit: exitOn, checkout: getCheckout(),
          email: who.email ?? "", name: who.name ?? "",
          currency: p.currency, country: p.country,
          // El total que vio en pantalla. El servidor lo recalcula y decide:
          // esto es para detectar que cambio, no para fijar el precio.
          shown: total,
          r: recoveryToken ?? undefined,
        }),
      });
    } catch {
      setBusy(false);
      setMsg(t.ckPayNotDone);
      return false;
    }

    const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
    if (!r.ok || !j.url) {
      setBusy(false);
      // El servidor ya manda el texto exacto cuando la moneda cambio entre
      // que se dibujo la pagina y el clic; si no lo manda, el generico.
      setMsg(j.error || t.ckPayNotDone);
      return false;
    }

    // Se va de la pagina. Se devuelve true para que el boton NO se suelte: si
    // se soltara, durante el segundo que tarda la navegacion se podria tocar
    // otra vez y crear una segunda preferencia.
    window.location.href = j.url;
    return true;
  }

  return {
    listo: true,          // no hay nada que cargar: el formulario vive en Mercado Pago
    elemento: (
      <p className="ck-mp-aviso" style={{
        margin: "4px 0 14px", fontSize: 13.5, lineHeight: 1.5, color: "#4b5563",
      }}>
        {t.mpAviso}
      </p>
    ),
    pagar,
  };
}
