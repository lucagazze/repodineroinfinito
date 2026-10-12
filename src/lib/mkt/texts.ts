import type { Locale } from "../i18n";

/**
 * Partes fijas de los mails de campaña, en el idioma del destinatario: pie
 * (por qué le llega, baja), descuento y botones por defecto. Nunca las
 * escribe la IA.
 */
export type MktTexts = {
  why: (brand: string) => string;
  unsubscribe: string;
  /** Línea de la baja en una prueba (el link no da de baja a nadie). */
  testNote: string;
  off: (pct: number) => string;
  validUntil: (until: string) => string;
  cta: string;
  forYou: string;
  hi: (first: string | null) => string;
};

const it: MktTexts = {
  why: (b) => `Ricevi questa email perché hai acquistato su ${b}.`,
  unsubscribe: "Non ricevere più queste email",
  testNote: "Email di prova",
  off: (p) => `−${p}% solo per te`,
  validUntil: (u) => `Sconto valido fino al ${u}.`,
  cta: "Scopri di più",
  forYou: "Scelti per te",
  hi: (f) => (f ? `Ciao ${f}` : "Ciao"),
};
const en: MktTexts = {
  why: (b) => `You're receiving this email because you bought from ${b}.`,
  unsubscribe: "Unsubscribe from these emails",
  testNote: "Test email",
  off: (p) => `−${p}% just for you`,
  validUntil: (u) => `Discount valid until ${u}.`,
  cta: "Take a look",
  forYou: "Picked for you",
  hi: (f) => (f ? `Hi ${f}` : "Hi"),
};
const es: MktTexts = {
  why: (b) => `Recibes este email porque compraste en ${b}.`,
  unsubscribe: "No recibir más estos emails",
  testNote: "Email de prueba",
  off: (p) => `−${p}% solo para ti`,
  validUntil: (u) => `Descuento válido hasta el ${u}.`,
  cta: "Ver más",
  forYou: "Elegidos para ti",
  hi: (f) => (f ? `Hola ${f}` : "Hola"),
};
const pt: MktTexts = {
  why: (b) => `Você recebe este email porque comprou em ${b}.`,
  unsubscribe: "Não receber mais estes emails",
  testNote: "Email de teste",
  off: (p) => `−${p}% só para você`,
  validUntil: (u) => `Desconto válido até ${u}.`,
  cta: "Ver mais",
  forYou: "Escolhidos para você",
  hi: (f) => (f ? `Olá ${f}` : "Olá"),
};
const fr: MktTexts = {
  why: (b) => `Tu reçois cet e-mail parce que tu as acheté sur ${b}.`,
  unsubscribe: "Ne plus recevoir ces e-mails",
  testNote: "E-mail de test",
  off: (p) => `−${p} % rien que pour toi`,
  validUntil: (u) => `Réduction valable jusqu’au ${u}.`,
  cta: "Découvrir",
  forYou: "Choisis pour toi",
  hi: (f) => (f ? `Bonjour ${f}` : "Bonjour"),
};
const de: MktTexts = {
  why: (b) => `Du bekommst diese E-Mail, weil du bei ${b} gekauft hast.`,
  unsubscribe: "Diese E-Mails abbestellen",
  testNote: "Test-E-Mail",
  off: (p) => `−${p} % nur für dich`,
  validUntil: (u) => `Rabatt gültig bis ${u}.`,
  cta: "Jetzt ansehen",
  forYou: "Für dich ausgewählt",
  hi: (f) => (f ? `Hallo ${f}` : "Hallo"),
};

const ALL: Record<Locale, MktTexts> = { it, en, es, "pt-BR": pt, fr, de };
export const mktTexts = (l: string | null | undefined) => ALL[(l ?? "") as Locale] ?? en;

/** País probable de un idioma (para la moneda de quien no tiene país cargado). */
export const COUNTRY_OF: Record<Locale, string> = { it: "IT", fr: "FR", de: "DE", en: "US", es: "ES", "pt-BR": "BR" };
