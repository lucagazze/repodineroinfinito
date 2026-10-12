/**
 * Ajustes visuales y de contenido de cada checkout (funnels.settings), los
 * mismos bloques que el editor de Winnerfy: color y marca, barra de
 * compradores, oferta, bonos, datos del comprador, método de pago, order
 * bumps, botón de pagar, garantía y sellos, políticas y oferta de salida.
 *
 * Lo usan la página de pago, el editor del panel y el MCP: un solo formato.
 * Lo que no está guardado toma el valor por defecto, así un checkout viejo
 * se ve igual que antes.
 */

export type CheckoutSettings = {
  /**
   * "2" = diseño de la plataforma anterior (una columna verde, el que convierte hoy).
   * "1" = dos columnas: datos a la izquierda, bumps y resumen a la derecha.
   */
  design: string;
  /** Color y marca */
  colors: { pay: string; accent: string; background: string };
  logo: { show: boolean };
  /** Texto de la franja de arriba ("Compra segura"). Vacío = el de cada idioma. */
  topBar: { show: boolean; text: string };
  /**
   * Barra de compradores. Cuenta real: personas con este checkout abierto en
   * los últimos 30 minutos. Si hay menos de `min`, no se muestra. Nunca un
   * número inventado (en la UE es práctica comercial engañosa).
   */
  buyersBar: { show: boolean; min: number };
  /** Cuenta regresiva. El plazo se guarda en el navegador: recargar no lo reinicia. */
  countdown: { show: boolean; minutes: number; text: string };
  /** Oferta: título propio y si se muestran el precio tachado y el ahorro. */
  offer: { title: string; subtitle: string; showCompareAt: boolean; showSavings: boolean; showImage: boolean };
  bonuses: { show: boolean; title: string };
  /** Datos del comprador */
  buyer: { askPhone: boolean; phoneRequired: boolean; askLastName: boolean };
  /** Método de pago: botones de Apple Pay / Google Pay / Link arriba de la tarjeta. */
  payment: { express: boolean };
  /** Order bumps dentro del checkout. */
  bumps: { title: string; preselect: boolean };
  payButton: { text: string; color: string };
  guarantee: { show: boolean; days: number | null; text: string; image: string; seals: boolean };
  policies: { show: boolean };
  /**
   * Oferta de salida (downsell): aparece una vez cuando el comprador se va sin
   * pagar — al tocar «atrás» (`onBack`) o al sacar el mouse de la página
   * (`onExitIntent`, solo computadora). Si la acepta, el servidor cobra el
   * principal a `price` (en `priceCurrency`; en otras monedas, la misma
   * proporción) o, si `price` es 0, con `discountPercent` de descuento. Se lee
   * de acá, nunca del navegador.
   */
  exitOffer: {
    show: boolean; title: string; text: string; discountPercent: number;
    price: number; priceCurrency: string; onBack: boolean; onExitIntent: boolean;
  };
  /**
   * Recuperación de carritos: a quien dejó el email y no pagó, un mail
   * (escrito por la IA) con `discountPercent` de descuento sobre lo que tenía
   * en el carrito, válido `validHours`, después de `delayMinutes` sin
   * actividad. Apagado en Alemania (la UWG pide consentimiento previo).
   */
  recovery: { enabled: boolean; delayMinutes: number; discountPercent: number; validHours: number };
  /** Idioma fijo para este checkout. Vacío = según el país del comprador. */
  locale: string;
  /** Moneda fija para este checkout (EUR para una oferta alemana). Vacía = según el país del comprador. */
  currency: string;
  /** CSS extra para casos puntuales (se limpia de etiquetas). */
  customCss: string;
};

export const DEFAULT_SETTINGS: CheckoutSettings = {
  design: "2",
  // Vacío = el color de la tienda (brand.payButton) o el de siempre.
  colors: { pay: "", accent: "", background: "" },
  logo: { show: false },
  topBar: { show: true, text: "" },
  buyersBar: { show: true, min: 1 },
  countdown: { show: false, minutes: 15, text: "" },
  offer: { title: "", subtitle: "", showCompareAt: true, showSavings: true, showImage: true },
  bonuses: { show: true, title: "" },
  buyer: { askPhone: false, phoneRequired: false, askLastName: true },
  payment: { express: true },
  bumps: { title: "", preselect: false },
  payButton: { text: "", color: "" },
  guarantee: { show: true, days: null, text: "", image: "", seals: true },
  policies: { show: true },
  exitOffer: { show: false, title: "", text: "", discountPercent: 0, price: 0, priceCurrency: "USD", onBack: true, onExitIntent: true },
  recovery: { enabled: true, delayMinutes: 60, discountPercent: 20, validHours: 72 },
  locale: "",
  currency: "",
  customCss: "",
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Mezcla lo guardado con los valores por defecto y descarta lo que no tiene
 * el tipo correcto. Sirve para leer (página de pago) y para validar lo que
 * llega del panel o del MCP antes de guardarlo.
 */
export function resolveSettings(raw: unknown, base: CheckoutSettings = DEFAULT_SETTINGS): CheckoutSettings {
  const src = isObj(raw) ? raw : {};
  const out = structuredClone(base) as unknown as Plain;
  for (const [section, defaults] of Object.entries(base)) {
    const v = src[section];
    if (v === undefined) continue;
    if (isObj(defaults)) {
      if (!isObj(v)) continue;
      const sec = out[section] as Plain;
      for (const [k, d] of Object.entries(defaults)) {
        const x = v[k];
        if (x === undefined) continue;
        if (typeof d === "boolean" && typeof x === "boolean") sec[k] = x;
        else if ((typeof d === "number" || d === null) && (typeof x === "number" || x === null)) sec[k] = x === null ? null : clampNum(k, x);
        else if (typeof d === "string" && typeof x === "string") sec[k] = cleanStr(k, x);
      }
    } else if (typeof defaults === "string" && typeof v === "string") {
      out[section] = cleanStr(section, v);
    }
  }
  return out as unknown as CheckoutSettings;
}

function clampNum(key: string, n: number) {
  if (!Number.isFinite(n)) return 0;
  if (key === "minutes") return Math.min(Math.max(Math.round(n), 1), 120);
  if (key === "days") return Math.min(Math.max(Math.round(n), 0), 365);
  if (key === "min") return Math.min(Math.max(Math.round(n), 1), 50);
  if (key === "discountPercent") return Math.min(Math.max(Math.round(n), 0), 90);
  if (key === "delayMinutes") return Math.min(Math.max(Math.round(n), 15), 2880);
  if (key === "validHours") return Math.min(Math.max(Math.round(n), 1), 168);
  if (key === "price") return Math.min(Math.max(Math.round(n * 100) / 100, 0), 100000);
  return n;
}

function cleanStr(key: string, s: string) {
  if (key === "design") return s === "1" ? "1" : "2";
  if (key === "priceCurrency") return /^[A-Za-z]{3}$/.test(s.trim()) ? s.trim().toUpperCase() : "USD";
  if (key === "customCss") return s.replace(/<\/?[a-z][^>]*>/gi, "").slice(0, 8000);
  if (["pay", "accent", "background", "color"].includes(key)) return HEX.test(s.trim()) ? s.trim() : "";
  if (key === "image") return /^https:\/\//.test(s.trim()) ? s.trim().slice(0, 500) : "";
  if (key === "locale") return /^[a-z]{2}(-[A-Z]{2})?$/.test(s) ? s : "";
  if (key === "currency") return /^[A-Za-z]{3}$/.test(s.trim()) ? s.trim().toUpperCase() : "";
  return s.slice(0, 600);
}

/** Cambios parciales sobre lo guardado (para "cambiá solo el color del botón"). */
export function mergeSettings(saved: unknown, patch: unknown): CheckoutSettings {
  return resolveSettings(patch, resolveSettings(saved));
}
