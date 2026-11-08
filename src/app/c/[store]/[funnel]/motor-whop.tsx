"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { loadWhop } from "@whop/elements";
import { WhopElements, Payments, PaymentElement, BrandingElement, usePayments } from "@whop/elements-react";
import { toMinor } from "@/lib/minor";
import { track as logEvent } from "@/lib/track-client";
import { fbIds } from "@/components/MetaPixel";
import type { Comprador, CtxMotor, Motor } from "./motores";
import type { Props } from "./CheckoutClient";
import { acentoDe, type Acento } from "@/lib/whop-acento";

export { acentoDe };
export type { Acento };

/**
 * Cobrar con Whop.
 *
 * Mismo recorrido que Stripe y las mismas defensas:
 *   1. La tarjeta se carga en campos AISLADOS servidos por Whop. Los numeros no
 *      pasan por este codigo ni por nuestro servidor.
 *   2. createConfirmationToken devuelve una referencia de un solo uso.
 *   3. Esa referencia va a /api/whop/pay, que COTIZA DE NUEVO en el servidor y
 *      cobra. El navegador manda que bumps tildo y que total vio, nunca cuanto
 *      hay que cobrar.
 *   4. Si el banco pide autenticacion, handleNextAction abre la verificacion.
 *   5. La ENTREGA la dispara el webhook payment.succeeded, nunca esta respuesta:
 *      cuando /api/whop/pay contesta, el dinero todavia no entro.
 */

// Una sola carga para toda la pagina: loadWhop() en cada render volveria a bajar
// el script y a recrear los iframes en cada cambio de estado.
const whopElements = loadWhop();

/** Los 12 idiomas que acepta el formulario de Whop; el resto cae a ingles. */
export type Idioma = "en" | "es" | "zh" | "nl" | "pt" | "de" | "hu" | "it" | "fr" | "ja" | "pl" | "tr";
const IDIOMAS: string[] = ["en","es","zh","nl","pt","de","hu","it","fr","ja","pl","tr"];
export const idiomaWhop = (l: string): Idioma => (IDIOMAS.includes(l) ? (l as Idioma) : "en");

/**
 * Si el formulario de Whop todavia esta cargando.
 *
 * La senal correcta es `onLoadingChange` de <Payments>, no un `onReady` del
 * elemento: medido el 20/10/2026, el onReady del PaymentElement no se dispara.
 * Como el aviso llega al proveedor y quien lo necesita es el motor (que vive
 * mas abajo), viaja por contexto.
 */
const Cargando = createContext<{ cargando: boolean; tardo: boolean; reintentar: () => void }>(
  { cargando: true, tardo: false, reintentar: () => {} });

// -------------------------------------------------------------- el motor

export function useMotorWhop(c: CtxMotor): Motor {
  const { p, t, total, bumps, exitOn, setMsg, setBusy, getCheckout, recoveryToken, aGracias, yendose } = c;
  const payments = usePayments();
  const { cargando, tardo, reintentar } = useContext(Cargando);
  const [fallo, setFallo] = useState<string | null>(null);

  async function pagar(who: Comprador, method: "form" | "express"): Promise<boolean> {
    if (!payments) return false;
    logEvent("checkout", "pay_attempt", { method, total, currency: p.currency, bumps: bumps.length, checkout: getCheckout(), via: "whop" });

    // 1. La referencia de la tarjeta. Los datos no pasan por aca.
    let token: string;
    try {
      const r = await payments.createConfirmationToken({
        billingDetails: { email: who.email || undefined, name: who.name || undefined },
      });
      token = (r as { confirmationToken: string }).confirmationToken;
    } catch (e) {
      const m = (e as Error)?.message ?? "";
      // Cerrar la hoja de Apple Pay / Google Pay llega como un rechazo. Es una
      // cancelacion, no un fallo: no se le muestra un error rojo a alguien que
      // simplemente se arrepintio.
      if (/cancell?ed|abort/i.test(m)) { setMsg(null); return false; }
      logEvent("checkout", "pay_error", { stage: "form", message: m.slice(0, 160), via: "whop" });
      setMsg(m || t.ckPayNotDone);
      return false;
    }

    // 2. El cobro. El servidor cotiza de nuevo: `shown` es lo que vio en
    //    pantalla, no lo que hay que cobrar.
    let res: { id?: string; status?: string; clientSecret?: string | null; error?: string; motivo?: string; code?: string };
    try {
      const r = await fetch("/api/whop/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, store: p.store, funnel: p.funnel, bumps, exit: exitOn,
          checkout: getCheckout(), ...(recoveryToken ? { r: recoveryToken } : {}),
          currency: p.currency, country: p.country, shown: total, ...who, ...fbIds(),
        }),
      });
      res = await r.json();
      if (!r.ok) {
        if (res.code === "currency") { window.location.reload(); return true; }
        throw new Error(res.motivo || res.error || t.ckPayNotDone);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      logEvent("checkout", "pay_error", { stage: "intent", message: m.slice(0, 160), via: "whop" });
      setMsg(m);
      return false;
    }

    // 3. El banco pide verificar: se le abre la verificacion y despues se
    //    vuelve a mirar en que quedo.
    const pendiente = res.status !== "paid" && res.status !== "succeeded";
    if (res.clientSecret && pendiente) {
      try {
        // Estatico del objeto global, no del handle que da usePayments.
        const Whop = await whopElements;
        const whop = Whop({ locale: idiomaWhop(p.locale) });
        const r = await whop.payments.handleNextAction({
          // La vuelta del 3D Secure lleva el id del pago, la tienda y el embudo.
          //
          // EL ERROR QUE ESTO EVITA: esta URL era `/gracias` pelada. La pagina
          // de gracias identifica el pedido con refOf(), que necesita uno de
          // payment_intent / session_id / payment / payment_id; sin ninguno
          // corta en «falta el identificador» y NUNCA llega a la linea que
          // redirige al post-pago. O sea que el comprador que pasa por 3DS
          // pagaba, no veia la oferta y ni siquiera sus descargas -- y el 3DS
          // es OBLIGATORIO en Reino Unido y la UE, que son el grueso de las
          // ventas.
          //
          // Va `payment_intent` porque findOrder() busca ese campo probando el
          // valor pelado y con el prefijo `whop:`, que es como se guarda.
          clientSecret: res.clientSecret,
          returnUrl: `${window.location.origin}/gracias?`
            // Sin id no se agrega el parametro vacio: `payment_intent=` haria
            // que refOf() lo tome como presente y findOrder() buscara "".
            + (res.id ? `payment_intent=${encodeURIComponent(res.id)}&` : "")
            + `store=${encodeURIComponent(p.store)}&funnel=${encodeURIComponent(p.funnel)}`,
        });
        // Si redirigio, el navegador ya se fue: no hay que soltar el boton.
        if (r?.redirected) return true;
        const err = r?.lastPaymentError;
        if (err) {
          /*
            EL MOTIVO QUE DA LA PASARELA SE GUARDA Y SE MUESTRA, como en el
            motor de Stripe (que registra code, decline y type, y muestra
            error.message). Aca no se registraba nada: el panel escribia
            «motivo desconocido» y el comprador leia un «no se pudo cobrar»
            que no le dice que corregir.

            Lo que costo: el 6/11/2026, en maths-illustrated, un comprador
            britanico cargo mal el numero de tarjeta. Whop lo dijo con estas
            palabras -- «The card number is incorrect. Please double-check the
            16-digit number on your card and try again.» -- y nadie las vio.
            Se fue sin comprar y el panel no supo por que.
          */
          logEvent("checkout", "pay_error", {
            stage: "confirm", via: "whop",
            code: err.code ?? null, decline: err.decline_code ?? null,
            message: (err.message ?? "").slice(0, 160),
          });
          setMsg(err.message || t.ckPayNotDone);
          return false;
        }
        if (r?.status) res.status = r.status;
      } catch (e) {
        logEvent("checkout", "pay_error", { stage: "action", message: ((e as Error)?.message ?? "").slice(0, 160), via: "whop" });
        setMsg(t.ckAuthRequired);
        return false;
      }
    }

    // 4. Un estado que no sea cobrado ni en proceso no se festeja.
    const ok = ["paid", "succeeded", "processing", "pending", "open"].includes(String(res.status));
    if (!ok) {
      logEvent("checkout", "pay_error", { stage: "status", code: String(res.status ?? "?"), via: "whop" });
      /*
        CERRAR LA VERIFICACION DEL BANCO NO ES UNA TARJETA RECHAZADA.
        Los tipos del SDK lo dicen de la ventana que abre handleNextAction:
        «Dismissing the dialog returns the payment's current status, which can
        remain pending». O sea que `requires_action` aca significa que el
        comprador cerro la verificacion o la dejo vencer, con la tarjeta
        perfectamente buena. Decirle «no se pudo cobrar» lo manda a cambiar de
        tarjeta cuando lo que le falta es aprobar la verificacion.

        Medido el 4/11/2026 en maths-illustrated (GB, telefono, navegador de
        Facebook): dos intentos asi, los dos con la verificacion vencida
        --«The 3D Secure verification timed out because no response was
        received»-- y el mismo cartel generico las dos veces. £13,99 perdidas
        con la tarjeta sana.

        El texto correcto ya existe en los 12 idiomas y dice que toque Pagar de
        nuevo. Eso recien funciona con la clave de idempotencia por intento
        (lib/whop-idem.ts): antes, tocar Pagar de nuevo daba un 400.
      */
      setMsg(String(res.status) === "requires_action" ? t.ckAuthRequired : t.ckPayNotDone);
      return false;
    }

    aGracias({
      id: res.id ?? "", status: String(res.status),
      qs: { store: p.store, funnel: p.funnel, payment: res.id ?? "", status: String(res.status), provider: "whop" },
    });
    return true;
  }

  return {
    /*
     * Hace falta el handle Y que haya terminado de cargar.
     *
     * Ojo con la senal: el `onReady` del PaymentElement NO se dispara (medido
     * el 20/10/2026, con el elemento ya dibujado). La buena es el
     * `onLoadingChange` de <Payments>. Atarlo al evento equivocado dejaba el
     * boton apagado para siempre: formulario a la vista, nadie puede comprar y
     * ni un error en pantalla.
     */
    listo: !!payments && !cargando,
    pagar,
    elemento: (
      <>
        {fallo && <p className="ck-err" role="alert">{fallo}</p>}
        {/*
          Si la pasarela no termina de cargar, el comprador NO se queda mirando
          un recuadro gris para siempre: se le dice que pasa y se le da un boton.
          Un checkout mudo pierde la venta sin dejar rastro de por que.
        */}
        {tardo && !fallo && (
          <p className="ck-err" role="alert" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{t.ckPayFormStuck}</span>
            <button type="button" onClick={reintentar}
              style={{ border: 0, borderRadius: 6, padding: "6px 12px", background: "var(--pay)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              {t.ckRetry}
            </button>
          </p>
        )}
        <div className="ck-paycard">
          {/* El elemento trae su propio aviso de carga; no se tapa con otro. */}
          <PaymentElement onError={(e) => setFallo(e.message || t.ckPayNotDone)} />
          {/*
            OBLIGATORIO, y no es decorativo. Los propios tipos del SDK lo dicen:
            "the payment, card and card fields elements stay in their loading
            state until it is mounted". Sin esto el formulario de tarjeta se
            queda en su esqueleto gris PARA SIEMPRE -- vivo por dentro, emitiendo
            eventos, pero sin mandar nunca su `ready`. Nadie puede comprar.
            Ademas es el aviso de comerciante de registro de Whop (sus terminos
            de comprador), asi que tambien tiene que estar por motivos legales.
          */}
          <BrandingElement />
        </div>
      </>
    ),
  };
}

// ---------------------------------------------------------- el proveedor

/**
 * Monta los campos de Whop alrededor del formulario. Es el equivalente de
 * <Elements> de Stripe, y se renderiza en su lugar: nunca las dos a la vez.
 */
export function ProveedorWhop({
  p, total, children,
}: { p: Props; total: number; children: React.ReactNode }) {
  /*
   * ABSOLUTA, no relativa. La documentacion del SDK lo pide asi ("Https-only,
   * http for localhost"), y con una direccion relativa el elemento no termina
   * de inicializar: se queda en su pantalla de carga sin dar ningun error.
   * En el servidor todavia no hay window, asi que en ese paso queda vacia y el
   * valor real se arma en el navegador.
   */
  const [cargando, setCargando] = useState(true);
  const [tardo, setTardo] = useState(false);
  // Cambiarla fuerza a React a tirar el arbol de Whop y montarlo de cero.
  const [intento, setIntento] = useState(0);
  const temporizador = useRef<number | null>(null);

  // 12 s: con una conexion normal el elemento carga en menos de 2. Pasado ese
  // margen ya no es lentitud, es que algo no va a llegar.
  useEffect(() => {
    if (!cargando) { setTardo(false); return; }
    temporizador.current = window.setTimeout(() => setTardo(true), 12_000);
    return () => { if (temporizador.current) window.clearTimeout(temporizador.current); };
  }, [cargando, intento]);

  const reintentar = () => { setTardo(false); setCargando(true); setIntento((n) => n + 1); };

  const volver = typeof window === "undefined" ? "" :
    `${window.location.origin}/gracias?store=${encodeURIComponent(p.store)}&funnel=${encodeURIComponent(p.funnel)}`;

  return (
    <WhopElements
      elements={whopElements}
      appearance={{ theme: { appearance: "light", accentColor: acentoDe(p.payColor) } }}
      locale={idiomaWhop(p.locale)}
    >
      <Payments
        key={intento}
        accountId={p.whopAccountId!}
        currency={p.currency.toLowerCase()}
        amount={Math.max(1, toMinor(total, p.currency))}
        returnUrl={volver}
        /*
          SIN ACH (debito bancario de EE. UU.).
          No es una cuestion de prolijidad: ACH acredita en dias habiles, y la
          ENTREGA la dispara el webhook `payment.succeeded`, que con ACH llega
          cuando el banco liquida. O sea que quien pagara por ahi leeria una
          promesa de entrega --«instant access» en Physics, «within 48 hours» en
          Maths-- y recibiria el libro la semana siguiente. La promesa se rompe
          sola, sin que nadie se entere hasta que el comprador reclama.

          Tampoco sirve para el post-pago de 1 clic, que es lo que
          `setupFutureUsage` deja armado abajo.

          El SDK no deja apagar metodos sueltos desde el elemento --`order` dice
          de si mismo «does not affect availability», y los unicos `never` son
          los tres monederos--. Lo que si existe es este filtro de cuenta, donde
          `disabled` quita tipos.
        */
        paymentMethodConfiguration={{ disabled: ["us_bank_account"] }}
        // Guarda la tarjeta para el post-pago de 1 clic. No se puede pedir en
        // diferido: sin esto hoy, los compradores de los primeros meses quedan
        // fuera de cualquier upsell que se arme despues.
        setupFutureUsage="off_session"
        onLoadingChange={setCargando}
      >
        <Cargando.Provider value={{ cargando, tardo, reintentar }}>{children}</Cargando.Provider>
      </Payments>
    </WhopElements>
  );
}
