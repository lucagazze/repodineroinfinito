import type React from "react";
import type { Locale, T } from "@/lib/i18n";
import type { CheckoutSettings } from "@/lib/checkout-settings";
import type { Props } from "./CheckoutClient";

/**
 * El contrato entre el formulario del checkout y la pasarela que cobra.
 *
 * Por que existe: el checkout tiene UN formulario -- campos, bumps, totales,
 * garantia, textos legales -- y dos pasarelas posibles. Si cada pasarela
 * tuviera su propio formulario, la primera vez que cambie un precio o un texto
 * legal una de las dos copias se queda atras, y es la que esta cobrando.
 *
 * Asi que el formulario es uno y lo que se intercambia es el MOTOR: el bloque
 * de campos de la tarjeta y la funcion que cobra. El JSX del checkout no sabe
 * cual de las dos esta montada.
 */

type Dict = (typeof T)[Locale];

/** Lo que el formulario le presta al motor. */
export type CtxMotor = {
  p: Props;
  t: Dict;
  st: CheckoutSettings;
  /** Total ya cotizado en pantalla. El servidor lo vuelve a calcular al cobrar. */
  total: number;
  bumps: string[];
  exitOn: boolean;
  setMsg: (m: string | null) => void;
  setBusy: (b: boolean) => void;
  getCheckout: () => string | null;
  /** Stripe: crea el PaymentIntent y devuelve su client secret. */
  createIntent: (who: Comprador, opts?: { sca?: boolean }) => Promise<string>;
  /** Token del mail de carrito recuperado, si vino por ahi. */
  recoveryToken: string | null;
  /** Apple/Google Pay disponibles. Lo reporta el motor y lo lee el motor, pero
   *  el estado vive en el formulario porque tambien decide el alto de la seccion. */
  express: boolean;
  setExpress: (on: boolean) => void;
  /**
   * Ya se cobro: registra el evento y manda a gracias. Vive en el formulario
   * para que el evento «paid» salga igual con las dos pasarelas.
   */
  aGracias: (ev: { id: string; status: string; via?: string; qs: Record<string, string> }) => void;
  /** true cuando ya se fue a gracias: no se navega dos veces. */
  yendose: React.MutableRefObject<boolean>;
};

export type Comprador = { email?: string; name?: string; phone?: string };

export type Motor = {
  /** false mientras la pasarela no termino de cargar: el boton queda apagado. */
  listo: boolean;
  /** Los campos de la tarjeta, servidos por la pasarela en un iframe aislado. */
  elemento: React.ReactNode;
  /** Cobra. true = ya esta navegando a gracias, no hay que soltar el boton. */
  pagar: (who: Comprador, method: "form" | "express") => Promise<boolean>;
};

/** Un motor es un hook: se invoca una sola vez en el formulario, sin condiciones. */
export type UsarMotor = (c: CtxMotor) => Motor;
