/**
 * Cómo se lee cada evento de site_events en el panel: textos en castellano,
 * sin códigos ni slugs. Sin dependencias del servidor: lo usan el armado de
 * líneas (event-story.ts) y las pantallas (En vivo, recorrido, Inicio).
 */

export type Tone = "" | "ok" | "bad" | "warn" | "brand" | "muted";
export type Icon =
  | "landing" | "click" | "checkout" | "mail" | "card" | "error" | "ok" | "no" | "wait"
  | "offer" | "done" | "download" | "leave";
/** Filtros del feed. */
export type Cat = "compras" | "postpago" | "errores";

/** Una línea legible: «Compró OTO 1 · Complete Nail Tech Collection · US$ 29». */
export type Line = {
  key: string;
  at: string;
  page: "landing" | "checkout" | "oferta" | "gracias";
  event: string;
  icon: Icon;
  tone: Tone;
  /** «Vio OTO 1», «Pagó», «Error al pagar OTO 2». */
  title: string;
  /** Producto (o lo comprado en el checkout). En modo captura va `itemAlias`. */
  item: string | null;
  itemAlias: string | null;
  /** «US$ 29». */
  amount: string | null;
  /** Medio, motivo del error, email… */
  detail: string | null;
  /** El detalle es un dato personal (email): se tapa en modo captura. */
  personal: boolean;
  /** Paso: Landing, Checkout, OTO 1, Downsell 1, Gracias. */
  step: string;
  /** Versión corta para la línea de la tarjeta. */
  short: string;
  cats: Cat[];
  /** Solo en compras reales: el importe cobrado y su moneda (para sumar lo gastado). */
  value?: number;
  cur?: string;
};

export const FILTERS: [Cat | "todo", string][] = [["todo", "Todo"], ["compras", "Compras"], ["postpago", "Post-pago"], ["errores", "Errores"]];

/** «US$ 29», «US$ 14,50», «29 €». */
export function money(n: unknown, cur: unknown): string | null {
  const v = Number(n);
  if (n === null || n === undefined || !Number.isFinite(v)) return null;
  const c = String(cur || "USD").toUpperCase();
  try {
    const whole = Math.abs(v - Math.round(v)) < 0.005;
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: c, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  } catch { return `${v} ${c}`; }
}

export function secs(s: number) {
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

const METHODS: Record<string, string> = {
  card: "tarjeta", amazon_pay: "Amazon Pay", link: "Link", cashapp: "Cash App", paypal: "PayPal", klarna: "Klarna",
  apple_pay: "Apple Pay", google_pay: "Google Pay", revolut_pay: "Revolut Pay", sepa_debit: "débito SEPA", ideal: "iDEAL",
  bancontact: "Bancontact", eps: "EPS", p24: "Przelewy24", giropay: "giropay", sofort: "Sofort", mobilepay: "MobilePay",
  twint: "TWINT", satispay: "Satispay", afterpay_clearpay: "Afterpay", affirm: "Affirm", us_bank_account: "cuenta bancaria",
  mb_way: "MB WAY", multibanco: "Multibanco", blik: "BLIK", alipay: "Alipay", wechat_pay: "WeChat Pay",
};
export const methodText = (m: string) => METHODS[m] ?? m.replace(/_/g, " ");

/** Cómo se cobró un OTO (data.via de oto_accept). */
export function viaText(via: unknown): string | null {
  if (typeof via !== "string" || !via) return null;
  if (via === "sheet") return "pagó en la hoja de pago";
  if (via === "redirect") return "pagó en la página del medio de pago";
  if (via === "already") return "ya estaba cobrado";
  const m = via.match(/^saved_(.+)$/);
  if (m) return m[1] === "method" ? "1 clic con el medio guardado" : `1 clic con ${methodText(m[1])} guardado`;
  return null;
}

const ERRORS: Record<string, string> = {
  insufficient_funds: "fondos insuficientes",
  card_declined: "el banco rechazó la tarjeta",
  generic_decline: "el banco rechazó la tarjeta",
  do_not_honor: "el banco rechazó la tarjeta",
  declined: "el cobro no pasó",
  lost_card: "tarjeta denunciada como perdida",
  stolen_card: "tarjeta denunciada como robada",
  pickup_card: "el banco pidió retener la tarjeta",
  expired_card: "tarjeta vencida",
  invalid_expiry_year_past: "tarjeta vencida",
  invalid_expiry_month_past: "tarjeta vencida",
  incorrect_cvc: "código de seguridad incorrecto",
  invalid_cvc: "código de seguridad incorrecto",
  incomplete_cvc: "falta el código de seguridad",
  incorrect_number: "número de tarjeta incorrecto",
  invalid_number: "número de tarjeta incorrecto",
  incomplete_number: "número de tarjeta incompleto",
  incomplete_expiry: "falta el vencimiento",
  invalid_expiry_year: "vencimiento inválido",
  invalid_expiry_month: "vencimiento inválido",
  incorrect_zip: "código postal incorrecto",
  incomplete_zip: "falta el código postal",
  processing_error: "error del procesador de la tarjeta",
  authentication_required: "no completó la verificación del banco (3D Secure)",
  payment_intent_authentication_failure: "no completó la verificación del banco (3D Secure)",
  requires_action: "no completó la verificación del banco (3D Secure)",
  fraudulent: "Stripe lo frenó por posible fraude",
  merchant_blacklist: "Stripe lo frenó por posible fraude",
  card_not_supported: "la tarjeta no sirve para esta compra",
  currency_not_supported: "la tarjeta no acepta esta moneda",
  transaction_not_allowed: "el banco no permite esta compra",
  try_again_later: "el banco pidió reintentar más tarde",
  call_issuer: "el banco pide que el cliente lo llame",
  card_velocity_exceeded: "superó el límite de la tarjeta",
  withdrawal_count_limit_exceeded: "superó el límite de la tarjeta",
  invalid_account: "la cuenta de la tarjeta no es válida",
  new_account_information_available: "la tarjeta cambió de datos",
  payment_method_unactivated: "medio de pago no habilitado",
  payment_method_not_available: "medio de pago no disponible",
  validation_error: "faltan datos en el formulario",
  invalid_request_error: "pedido de pago inválido",
  api_connection_error: "se cortó la conexión con Stripe",
  network: "se cortó la conexión",
  stripe_js: "no cargó Stripe en el navegador",
  redirect_failed: "canceló o falló en la página del medio de pago",
  requires_payment_method: "el cobro no pasó",
  canceled: "pago cancelado",
  still_processing: "el pago sigue procesando",
  error: "error del servidor",
  unknown: "motivo desconocido",
};

/** El motivo de un pay_error en castellano. */
export function errorText(raw: unknown): string {
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!code) return "motivo desconocido";
  if (ERRORS[code]) return ERRORS[code];
  // Falló el cobro en 1 clic con el medio guardado: saved_{medio}_{código}.
  if (code.startsWith("saved_")) {
    const known = Object.keys(METHODS).sort((a, b) => b.length - a.length).find((m) => code.startsWith(`saved_${m}_`));
    const method = known ?? code.slice(6).split("_")[0];
    const rest = code.slice(`saved_${method}_`.length);
    return `no se pudo cobrar en 1 clic con ${method === "method" ? "el medio guardado" : methodText(method)} (${ERRORS[rest] ?? "rechazado"})`;
  }
  const http = code.match(/^(?:http|confirm)_(\d{3})$/);
  if (http) return Number(http[1]) >= 500 ? "error del servidor" : "el cobro no pasó";
  if (/decline/i.test(code)) return "el banco rechazó la tarjeta";
  // Mensajes del servidor que ya son texto («Pedido no válido»).
  if (/\s/.test(code) && !/_/.test(code)) return code;
  return "otro motivo";
}

/** Motivo de un pay_error según dónde pasó (checkout: formulario, crear el pago o confirmarlo). */
export function payErrorText(d: Record<string, unknown>): string {
  if (d.stage === "intent") return typeof d.message === "string" && d.message ? `no se pudo crear el pago: ${d.message}` : "no se pudo crear el pago";
  return errorText(d.decline ?? d.code ?? d.type);
}
