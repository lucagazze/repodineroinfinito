import type { Locale } from "./i18n";

/**
 * Textos del carrito abandonado: el aviso del descuento en el checkout (lo
 * usa el navegador) y el mail de respaldo, a mano, cuando la IA no responde o
 * devuelve algo que no pasa el control. Las partes fijas del mail (precios,
 * vencimiento, pie legal y baja) salen siempre de acá, nunca de la IA.
 */

export type RecoveryTexts = {
  /** Checkout */
  bannerOn: (pct: number, until: string) => string;
  bannerExpired: string;
  bannerUsed: string;
  bannerInvalid: string;
  /** Mail: partes fijas */
  normalPrice: string;
  yourPrice: (pct: number) => string;
  validUntil: (until: string) => string;
  bonusesTitle: string;
  footerWhy: (brand: string) => string;
  unsubscribe: string;
  team: (brand: string) => string;
  /** Mail de respaldo (sin IA) */
  fallback: {
    subject: (product: string, pct: number) => string;
    preheader: (pct: number) => string;
    headline: (pct: number) => string;
    intro: (first: string | null, product: string, pct: number) => string;
    cta: (pct: number) => string;
    closing: string;
  };
  /** Página de baja */
  unsubDone: (brand: string) => string;
  unsubBody: string;
};

const it: RecoveryTexts = {
  bannerOn: (p, u) => `−${p}% · il tuo sconto è applicato · valido fino al ${u}`,
  bannerExpired: "Questo sconto è scaduto: vedi il prezzo normale.",
  bannerUsed: "Questo sconto è già stato usato: vedi il prezzo normale.",
  bannerInvalid: "Il link dello sconto non è valido: vedi il prezzo normale.",
  normalPrice: "Prezzo normale",
  yourPrice: (p) => `Il tuo prezzo con −${p}%`,
  validUntil: (u) => `Sconto valido fino al ${u}.`,
  bonusesTitle: "Inclusi nel tuo ordine",
  footerWhy: (b) => `Ricevi questa email perché hai iniziato un acquisto su ${b}.`,
  unsubscribe: "Non ricevere più queste email",
  team: (b) => `Il team di ${b}`,
  fallback: {
    subject: (p, n) => `${p}: il tuo carrello ti aspetta con il −${n}%`,
    preheader: (n) => `Abbiamo tenuto da parte il tuo ordine con uno sconto del ${n}%.`,
    headline: (n) => `Il tuo ordine ti aspetta, con il −${n}%`,
    intro: (f, p, n) => `${f ? `Ciao ${f}, h` : "H"}ai lasciato ${p} nel carrello. Te lo abbiamo tenuto da parte con uno sconto del ${n}% su quello che avevi scelto.`,
    cta: (n) => `Completa l’ordine con il −${n}%`,
    closing: "Se hai domande, rispondi pure a questa email: ti aiutiamo volentieri.",
  },
  unsubDone: (b) => `Non riceverai più queste email di ${b}.`,
  unsubBody: "Continuerai a ricevere solo le email dei tuoi acquisti (download e ricevute).",
};

const en: RecoveryTexts = {
  bannerOn: (p, u) => `−${p}% · your discount is applied · valid until ${u}`,
  bannerExpired: "This discount has expired: you see the regular price.",
  bannerUsed: "This discount was already used: you see the regular price.",
  bannerInvalid: "This discount link isn't valid: you see the regular price.",
  normalPrice: "Regular price",
  yourPrice: (p) => `Your price with −${p}%`,
  validUntil: (u) => `Discount valid until ${u}.`,
  bonusesTitle: "Included in your order",
  footerWhy: (b) => `You're receiving this email because you started a purchase at ${b}.`,
  unsubscribe: "Stop receiving these emails",
  team: (b) => `The ${b} team`,
  fallback: {
    subject: (p, n) => `${p}: your cart is waiting, now ${n}% off`,
    preheader: (n) => `We saved your order with a ${n}% discount.`,
    headline: (n) => `Your order is waiting, with ${n}% off`,
    intro: (f, p, n) => `${f ? `Hi ${f}, y` : "Y"}ou left ${p} in your cart. We saved it for you with ${n}% off what you had chosen.`,
    cta: (n) => `Complete my order (−${n}%)`,
    closing: "If you have any questions, just reply to this email — we're happy to help.",
  },
  unsubDone: (b) => `You won't receive these emails from ${b} anymore.`,
  unsubBody: "You'll only get emails about your purchases (downloads and receipts).",
};

const es: RecoveryTexts = {
  bannerOn: (p, u) => `−${p}% · tu descuento está aplicado · vence el ${u}`,
  bannerExpired: "Este descuento ha caducado: ves el precio normal.",
  bannerUsed: "Este descuento ya se ha usado: ves el precio normal.",
  bannerInvalid: "El enlace del descuento no es válido: ves el precio normal.",
  normalPrice: "Precio normal",
  yourPrice: (p) => `Tu precio con −${p}%`,
  validUntil: (u) => `Descuento válido hasta el ${u}.`,
  bonusesTitle: "Incluido en tu pedido",
  footerWhy: (b) => `Recibes este email porque empezaste una compra en ${b}.`,
  unsubscribe: "No recibir más estos emails",
  team: (b) => `El equipo de ${b}`,
  fallback: {
    subject: (p, n) => `${p}: tu carrito te espera con ${n}% off`,
    preheader: (n) => `Te guardamos el pedido con ${n}% de descuento.`,
    headline: (n) => `Tu pedido te espera, con −${n}%`,
    intro: (f, p, n) => `${f ? `Hola ${f}, d` : "D"}ejaste ${p} en el carrito. Te lo guardamos con ${n}% de descuento sobre lo que habías elegido.`,
    cta: (n) => `Terminar mi compra (−${n}%)`,
    closing: "Si tienes alguna duda, responde a este email y te ayudamos.",
  },
  unsubDone: (b) => `Ya no recibirás más estos emails de ${b}.`,
  unsubBody: "Solo te llegarán los emails de tus compras (descargas y recibos).",
};

const pt: RecoveryTexts = {
  bannerOn: (p, u) => `−${p}% · seu desconto está aplicado · válido até ${u}`,
  bannerExpired: "Este desconto expirou: você vê o preço normal.",
  bannerUsed: "Este desconto já foi usado: você vê o preço normal.",
  bannerInvalid: "O link do desconto não é válido: você vê o preço normal.",
  normalPrice: "Preço normal",
  yourPrice: (p) => `Seu preço com −${p}%`,
  validUntil: (u) => `Desconto válido até ${u}.`,
  bonusesTitle: "Incluído no seu pedido",
  footerWhy: (b) => `Você recebe este email porque começou uma compra em ${b}.`,
  unsubscribe: "Não receber mais estes emails",
  team: (b) => `Equipe ${b}`,
  fallback: {
    subject: (p, n) => `${p}: seu carrinho te espera com ${n}% off`,
    preheader: (n) => `Guardamos seu pedido com ${n}% de desconto.`,
    headline: (n) => `Seu pedido te espera, com −${n}%`,
    intro: (f, p, n) => `${f ? `Olá ${f}, v` : "V"}ocê deixou ${p} no carrinho. Guardamos para você com ${n}% de desconto no que você escolheu.`,
    cta: (n) => `Finalizar meu pedido (−${n}%)`,
    closing: "Se tiver alguma dúvida, responda este email: ajudamos com prazer.",
  },
  unsubDone: (b) => `Você não vai mais receber estes emails de ${b}.`,
  unsubBody: "Você só vai receber os emails das suas compras (downloads e recibos).",
};

const fr: RecoveryTexts = {
  bannerOn: (p, u) => `−${p} % · ta réduction est appliquée · valable jusqu’au ${u}`,
  bannerExpired: "Cette réduction a expiré : tu vois le prix normal.",
  bannerUsed: "Cette réduction a déjà été utilisée : tu vois le prix normal.",
  bannerInvalid: "Le lien de réduction n’est pas valable : tu vois le prix normal.",
  normalPrice: "Prix normal",
  yourPrice: (p) => `Ton prix avec −${p} %`,
  validUntil: (u) => `Réduction valable jusqu’au ${u}.`,
  bonusesTitle: "Inclus dans ta commande",
  footerWhy: (b) => `Tu reçois cet e-mail parce que tu as commencé un achat sur ${b}.`,
  unsubscribe: "Ne plus recevoir ces e-mails",
  team: (b) => `L’équipe ${b}`,
  fallback: {
    subject: (p, n) => `${p} : ton panier t’attend avec −${n} %`,
    preheader: (n) => `On a gardé ta commande avec ${n} % de réduction.`,
    headline: (n) => `Ta commande t’attend, avec −${n} %`,
    intro: (f, p, n) => `${f ? `Bonjour ${f}, t` : "T"}u as laissé ${p} dans ton panier. On te l’a gardé avec ${n} % de réduction sur ce que tu avais choisi.`,
    cta: (n) => `Terminer ma commande (−${n} %)`,
    closing: "Si tu as une question, réponds simplement à cet e-mail : on t’aide volontiers.",
  },
  unsubDone: (b) => `Tu ne recevras plus ces e-mails de ${b}.`,
  unsubBody: "Tu recevras seulement les e-mails de tes achats (téléchargements et reçus).",
};

const de: RecoveryTexts = {
  bannerOn: (p, u) => `−${p} % · dein Rabatt ist angewendet · gültig bis ${u}`,
  bannerExpired: "Dieser Rabatt ist abgelaufen: du siehst den normalen Preis.",
  bannerUsed: "Dieser Rabatt wurde schon verwendet: du siehst den normalen Preis.",
  bannerInvalid: "Der Rabatt-Link ist nicht gültig: du siehst den normalen Preis.",
  normalPrice: "Normaler Preis",
  yourPrice: (p) => `Dein Preis mit −${p} %`,
  validUntil: (u) => `Rabatt gültig bis ${u}.`,
  bonusesTitle: "In deiner Bestellung enthalten",
  footerWhy: (b) => `Du bekommst diese E-Mail, weil du bei ${b} einen Kauf begonnen hast.`,
  unsubscribe: "Diese E-Mails nicht mehr erhalten",
  team: (b) => `Dein ${b}-Team`,
  fallback: {
    subject: (p, n) => `${p}: dein Warenkorb wartet, jetzt −${n} %`,
    preheader: (n) => `Wir haben deine Bestellung mit ${n} % Rabatt reserviert.`,
    headline: (n) => `Deine Bestellung wartet, mit −${n} %`,
    intro: (f, p, n) => `${f ? `Hallo ${f}, d` : "D"}u hast ${p} im Warenkorb gelassen. Wir haben es dir mit ${n} % Rabatt auf deine Auswahl reserviert.`,
    cta: (n) => `Bestellung abschließen (−${n} %)`,
    closing: "Wenn du Fragen hast, antworte einfach auf diese E-Mail – wir helfen gern.",
  },
  unsubDone: (b) => `Du bekommst diese E-Mails von ${b} nicht mehr.`,
  unsubBody: "Du bekommst nur noch E-Mails zu deinen Käufen (Downloads und Belege).",
};

export const RECOVERY_TEXTS: Record<Locale, RecoveryTexts> = { it, en, es, "pt-BR": pt, fr, de };
export const recoveryTexts = (l: string | null | undefined) => RECOVERY_TEXTS[(l ?? "") as Locale] ?? en;

/** Fecha y hora de vencimiento en el idioma del comprador y, si se sabe, en su zona horaria. */
const TZ: Record<string, string> = {
  IT: "Europe/Rome", FR: "Europe/Paris", DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich", ES: "Europe/Madrid",
  PT: "Europe/Lisbon", GB: "Europe/London", IE: "Europe/Dublin", BE: "Europe/Brussels", NL: "Europe/Amsterdam", LU: "Europe/Luxembourg",
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago",
  CO: "America/Bogota", PE: "America/Lima", BR: "America/Sao_Paulo", AU: "Australia/Sydney", NZ: "Pacific/Auckland",
};
export function formatUntil(iso: string, locale: string, country: string | null | undefined) {
  const tz = TZ[(country ?? "").toUpperCase()];
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz ?? "UTC", timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}
