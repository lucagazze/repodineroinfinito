/**
 * Contenido de la página post-compra (oferta de 1 clic) de cada producto
 * (products.postcompra_page).
 *
 * El diseño es fijo: el de las OTO de referencia (barra azul arriba,
 * "pago confirmado", titular, carta, video o tapa, galería, caja de la
 * oferta, garantía, "No gracias", barra abajo). Acá solo va el contenido.
 *
 * Todo es opcional. Un texto vacío toma el valor por defecto del idioma del
 * comprador, armado con el nombre, la descripción y la tapa del producto, así
 * un producto sin configurar igual tiene una página completa.
 *
 * Etiquetas que se reemplazan en el servidor, en cualquier texto:
 *   {first-name}   nombre de pila del comprador (si no hay, se quita la etiqueta
 *                  y la coma que la acompaña: "Thank you {first-name}, you're…"
 *                  queda "Thank you, you're…")
 *   {order-number} el número del pedido («#1001»; los viejos, los primeros 8 del id)
 *   {price}        precio de la oferta en la moneda del pedido
 *   {compare}      precio tachado (vacío si no tiene)
 *   {product}      nombre corto del producto
 * Marcado simple: **negrita** en pitch, intro, bullets, boxSubtitle y stats.
 *
 * Lo usan la página /oferta, la vista previa y el MCP: un solo formato.
 */

import type { Locale } from "./i18n";
import { T } from "./i18n";

export type PostcompraPage = {
  /** Barra azul de arriba (fija al hacer scroll). */
  topBar: string;
  /** Titular grande. */
  headline: string;
  /** Línea de agradecimiento debajo del titular. Admite {first-name}. */
  intro: string;
  /** Párrafo corto en la carta blanca. Admite **negrita**. */
  pitch: string;
  /** VSL que arranca mudo. Sin url: se muestra la tapa del producto. */
  video: { url: string; poster: string; label: string; delaySeconds: number };
  /** Páginas de muestra: grilla que abre un visor a pantalla completa. */
  gallery: { title: string; images: string[]; caption: string };
  /** Una línea de datos debajo de la galería. Lo que va después de " — " sale más claro. */
  stats: string;
  /** Franja oscura arriba de la caja de la oferta. */
  boxKicker: string;
  boxTitle: string;
  boxSubtitle: string;
  /** Lo que incluye, con tilde verde. */
  bullets: string[];
  /** Texto del botón. Admite {price}. */
  ctaText: string;
  /** Línea chica debajo del primer botón. */
  ctaNote: string;
  /** Recuadro verde de garantía. Un salto de línea parte en dos renglones. */
  guaranteeNote: string;
  noThanks: string;
  /** Nota chica debajo de "No gracias". */
  footnote: string;
  /** Barra azul de abajo. */
  bottomBar: string;
};

export const EMPTY_PAGE: PostcompraPage = {
  topBar: "",
  headline: "",
  intro: "",
  pitch: "",
  video: { url: "", poster: "", label: "", delaySeconds: 0 },
  gallery: { title: "", images: [], caption: "" },
  stats: "",
  boxKicker: "",
  boxTitle: "",
  boxSubtitle: "",
  bullets: [],
  ctaText: "",
  ctaNote: "",
  guaranteeNote: "",
  noThanks: "",
  footnote: "",
  bottomBar: "",
};

/** Campos y límites, para el MCP y para validar. */
export const POSTCOMPRA_FIELDS = Object.keys(EMPTY_PAGE) as (keyof PostcompraPage)[];

const MAX_LEN: Record<string, number> = { pitch: 900, intro: 500, boxSubtitle: 500, footnote: 400, guaranteeNote: 300, stats: 300, bullet: 400 };
const HTTPS = /^https:\/\/\S+$/;
const MAX_BULLETS = 12;
const MAX_IMAGES = 40;

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

const clean = (key: string, s: string) => s.replace(/<\/?[a-z][^>]*>/gi, "").trim().slice(0, MAX_LEN[key] ?? 240);
const cleanUrl = (s: string) => (HTTPS.test(s.trim()) ? s.trim().slice(0, 1000) : "");

/**
 * Mezcla lo guardado con `base` y descarta lo que no tiene el tipo correcto.
 * `null` en un campo lo vuelve al valor por defecto (vacío). Los arrays se
 * reemplazan enteros. Sirve para leer y para validar lo que llega del MCP.
 */
export function resolvePostcompraPage(raw: unknown, base: PostcompraPage = EMPTY_PAGE): PostcompraPage {
  const src = isObj(raw) ? raw : {};
  const out = structuredClone(base);

  for (const k of ["topBar", "headline", "intro", "pitch", "stats", "boxKicker", "boxTitle", "boxSubtitle",
    "ctaText", "ctaNote", "guaranteeNote", "noThanks", "footnote", "bottomBar"] as const) {
    const v = src[k];
    if (v === null) out[k] = "";
    else if (typeof v === "string") out[k] = clean(k, v);
  }

  if (src.bullets === null) out.bullets = [];
  else if (Array.isArray(src.bullets)) {
    out.bullets = src.bullets.filter((b): b is string => typeof b === "string")
      .map((b) => clean("bullet", b)).filter(Boolean).slice(0, MAX_BULLETS);
  }

  if (src.video === null) out.video = { ...EMPTY_PAGE.video };
  else if (isObj(src.video)) {
    const v = src.video;
    if (v.url === null) out.video.url = "";
    else if (typeof v.url === "string") out.video.url = cleanUrl(v.url);
    if (v.poster === null) out.video.poster = "";
    else if (typeof v.poster === "string") out.video.poster = cleanUrl(v.poster);
    if (v.label === null) out.video.label = "";
    else if (typeof v.label === "string") out.video.label = clean("label", v.label);
    if (v.delaySeconds === null) out.video.delaySeconds = 0;
    else if (typeof v.delaySeconds === "number" && Number.isFinite(v.delaySeconds)) {
      out.video.delaySeconds = Math.min(Math.max(Math.round(v.delaySeconds), 0), 600);
    }
  }

  if (src.gallery === null) out.gallery = { ...EMPTY_PAGE.gallery, images: [] };
  else if (isObj(src.gallery)) {
    const g = src.gallery;
    if (g.title === null) out.gallery.title = "";
    else if (typeof g.title === "string") out.gallery.title = clean("title", g.title);
    if (g.caption === null) out.gallery.caption = "";
    else if (typeof g.caption === "string") out.gallery.caption = clean("caption", g.caption);
    if (g.images === null) out.gallery.images = [];
    else if (Array.isArray(g.images)) {
      out.gallery.images = g.images.filter((u): u is string => typeof u === "string").map(cleanUrl).filter(Boolean).slice(0, MAX_IMAGES);
    }
  }
  return out;
}

/** Cambios parciales sobre lo guardado ("cambiá solo el titular"). */
export function mergePostcompraPage(saved: unknown, patch: unknown): PostcompraPage {
  return resolvePostcompraPage(patch, resolvePostcompraPage(saved));
}

/** Lo que se descartó de un patch (claves desconocidas o valores inválidos), para avisar. */
export function postcompraWarnings(patch: unknown): string[] {
  if (!isObj(patch)) return ["postcompra_page must be an object"];
  const w: string[] = [];
  const known = new Set<string>(POSTCOMPRA_FIELDS);
  for (const k of Object.keys(patch)) if (!known.has(k)) w.push(`postcompra_page.${k} is not a field and was ignored`);
  const sub = (k: "video" | "gallery", fields: string[]) => {
    const v = patch[k];
    if (v !== undefined && v !== null && !isObj(v)) w.push(`postcompra_page.${k} must be an object`);
    if (isObj(v)) for (const f of Object.keys(v)) if (!fields.includes(f)) w.push(`postcompra_page.${k}.${f} is not a field and was ignored`);
  };
  sub("video", ["url", "poster", "label", "delaySeconds"]);
  sub("gallery", ["title", "images", "caption"]);
  const g = patch.gallery;
  if (isObj(g) && Array.isArray(g.images)) {
    const bad = g.images.filter((u) => typeof u !== "string" || !HTTPS.test(u.trim()));
    if (bad.length) w.push(`${bad.length} gallery image(s) dropped: they must be https URLs`);
    if (g.images.length > MAX_IMAGES) w.push(`gallery.images: only the first ${MAX_IMAGES} are kept`);
  }
  const v = patch.video;
  if (isObj(v) && typeof v.url === "string" && v.url.trim() && !HTTPS.test(v.url.trim())) w.push("video.url dropped: it must be an https URL");
  if (Array.isArray(patch.bullets) && patch.bullets.length > MAX_BULLETS) w.push(`bullets: only the first ${MAX_BULLETS} are kept`);
  return w;
}

// ----------------------------------------------------------------- textos

type Defaults = {
  topBar: string;
  eyebrow: string;
  headline: string;
  intro: string;
  videoLabel: string;
  soundTitle: string; soundCta: string;
  playTitle: string; playCta: string;
  galleryTitle: string;
  /** Kits: el título de la grilla de libros y el botón de las páginas de cada uno. */
  contentsTitle: (n: number) => string;
  seePages: (n: number) => string;
  galleryCaption: string;
  viewerHint: string;
  samplePages: (n: number) => string;
  boxKicker: string;
  priceNote: string;
  /** Lo mismo, cuando lo que se ofrece se renueva. */
  priceNoteSub: string;
  ctaText: string;
  ctaNote: string;
  guarantee: (days: number) => string;
  noThanks: string;
  footnote: string;
  preview: string;
  close: string;
  pill: string;
};

const D: Record<Locale, Defaults> = {
  en: {
    topBar: "⚠ For customers who just ordered",
    eyebrow: "✓ Payment confirmed · order {order-number}",
    headline: "BEFORE YOU GO, ONE THING",
    intro: "Thank you {first-name}, your order is confirmed and your files are on their way to your email. Before you close this page: one offer you’ll only see here.",
    videoLabel: "Watch this first",
    soundTitle: "Your video has started", soundCta: "Tap for sound",
    playTitle: "Watch the video", playCta: "Tap to play",
    galleryTitle: "Look inside",
    contentsTitle: (n) => `What you get: ${n} books`,
    seePages: (n) => `See ${n} pages`,
    galleryCaption: "☝ Tap any page to see it full size",
    viewerHint: "Swipe → · tap outside the page to close",
    samplePages: (n) => `${n} sample page${n === 1 ? "" : "s"}`,
    boxKicker: "Add it to your order in one tap",
    priceNote: "One payment · added to the order you just made",
    priceNoteSub: "Recurring · cancel in one click, any time",
    ctaText: "YES — ADD {product} · {price}",
    ctaNote: "One tap · you will not enter your card again",
    guarantee: (d) => `Secure payment${d ? ` · ${d}-day guarantee` : ""} · Instant access\nYou will not enter your card again.`,
    noThanks: "No thanks — continue",
    footnote: "Your order is confirmed either way and your files are already on their way. This page only adds to it.",
    preview: "Preview — buttons do nothing here, nothing is charged.",
    close: "Close",
    pill: "Preview",
  },
  it: {
    topBar: "⚠ Solo per chi ha appena ordinato",
    eyebrow: "✓ Pagamento confermato · ordine {order-number}",
    headline: "PRIMA DI ANDARE, UNA COSA",
    intro: "Grazie {first-name}, il tuo ordine è confermato e i file stanno arrivando per email. Prima di chiudere: un’offerta che vedi solo qui.",
    videoLabel: "Guarda prima questo",
    soundTitle: "Il video è partito", soundCta: "Tocca per l’audio",
    playTitle: "Guarda il video", playCta: "Tocca per avviare",
    galleryTitle: "Guarda dentro",
    contentsTitle: (n) => `Cosa ricevi: ${n} libri`,
    seePages: (n) => `Sfoglia ${n} pagine`,
    galleryCaption: "☝ Tocca una pagina per vederla intera",
    viewerHint: "Scorri → · tocca fuori dalla pagina per chiudere",
    samplePages: (n) => `${n} pagin${n === 1 ? "a" : "e"} di esempio`,
    boxKicker: "Aggiungilo al tuo ordine con un tocco",
    priceNote: "Un solo pagamento · si aggiunge all’ordine appena fatto",
    priceNoteSub: "Abbonamento · disdici in un clic, quando vuoi",
    ctaText: "SÌ — AGGIUNGI {product} · {price}",
    ctaNote: "Un tocco · non devi reinserire la carta",
    guarantee: (d) => `Pagamento sicuro${d ? ` · garanzia di ${d} giorni` : ""} · Accesso immediato\nNon devi reinserire la carta.`,
    noThanks: "No grazie — continua",
    footnote: "Il tuo ordine è confermato in ogni caso e i tuoi file sono già in arrivo. Questa pagina aggiunge solo qualcosa.",
    preview: "Anteprima — qui i pulsanti non fanno nulla, non viene addebitato niente.",
    close: "Chiudi",
    pill: "Anteprima",
  },
  es: {
    topBar: "⚠ Solo para quien acaba de comprar",
    eyebrow: "✓ Pago confirmado · pedido {order-number}",
    headline: "ANTES DE IRTE, UNA COSA",
    intro: "Gracias {first-name}, tu pedido está confirmado y tus archivos ya van a tu email. Antes de cerrar: una oferta que solo ves aquí.",
    videoLabel: "Mira esto primero",
    soundTitle: "Tu vídeo ya ha empezado", soundCta: "Toca para activar el sonido",
    playTitle: "Mira el vídeo", playCta: "Toca para reproducir",
    galleryTitle: "Míralo por dentro",
    contentsTitle: (n) => `Lo que recibes: ${n} libros`,
    seePages: (n) => `Ver ${n} páginas`,
    galleryCaption: "☝ Toca cualquier página para verla completa",
    viewerHint: "Desliza → · toca fuera de la página para cerrar",
    samplePages: (n) => `${n} página${n === 1 ? "" : "s"} de muestra`,
    boxKicker: "Añádelo a tu pedido con un toque",
    priceNote: "Un solo pago · se añade al pedido que acabas de hacer",
    priceNoteSub: "Suscripción · se cancela en un clic, cuando quieras",
    ctaText: "SÍ — AÑADIR {product} · {price}",
    ctaNote: "Un toque · no tienes que volver a introducir la tarjeta",
    guarantee: (d) => `Pago seguro${d ? ` · garantía de ${d} días` : ""} · Acceso inmediato\nNo tienes que volver a introducir la tarjeta.`,
    noThanks: "No, gracias — continuar",
    footnote: "Tu pedido ya está confirmado y tus archivos están en camino. Esta página solo te ofrece algo más.",
    preview: "Vista previa — aquí los botones no hacen nada, no se cobra nada.",
    close: "Cerrar",
    pill: "Vista previa",
  },
  "pt-BR": {
    topBar: "⚠ Só para quem acabou de comprar",
    eyebrow: "✓ Pagamento confirmado · pedido {order-number}",
    headline: "ANTES DE IR, UMA COISA",
    intro: "Obrigado {first-name}, seu pedido está confirmado e seus arquivos já estão indo para o seu e-mail. Antes de fechar: uma oferta que você só vê aqui.",
    videoLabel: "Assista isto primeiro",
    soundTitle: "Seu vídeo já começou", soundCta: "Toque para ativar o som",
    playTitle: "Assista ao vídeo", playCta: "Toque para assistir",
    galleryTitle: "Veja por dentro",
    contentsTitle: (n) => `O que você recebe: ${n} livros`,
    seePages: (n) => `Ver ${n} páginas`,
    galleryCaption: "☝ Toque em qualquer página para vê-la inteira",
    viewerHint: "Deslize → · toque fora da página para fechar",
    samplePages: (n) => `${n} página${n === 1 ? "" : "s"} de amostra`,
    boxKicker: "Adicione ao seu pedido com um toque",
    priceNote: "Pagamento único · adicionado ao pedido que você acabou de fazer",
    priceNoteSub: "Assinatura · cancele em um clique, quando quiser",
    ctaText: "SIM — ADICIONAR {product} · {price}",
    ctaNote: "Um toque · você não precisa digitar o cartão de novo",
    guarantee: (d) => `Pagamento seguro${d ? ` · garantia de ${d} dias` : ""} · Acesso imediato\nVocê não precisa digitar o cartão de novo.`,
    noThanks: "Não, obrigado — continuar",
    footnote: "Seu pedido está confirmado de qualquer forma e seus arquivos já estão a caminho. Esta página só acrescenta algo.",
    preview: "Prévia — aqui os botões não fazem nada, nada é cobrado.",
    close: "Fechar",
    pill: "Prévia",
  },
  fr: {
    topBar: "⚠ Réservé à qui vient de commander",
    eyebrow: "✓ Paiement confirmé · commande {order-number}",
    headline: "AVANT DE PARTIR, UNE CHOSE",
    intro: "Merci {first-name}, ta commande est confirmée et tes fichiers arrivent par e-mail. Avant de fermer : une offre que tu ne verras qu’ici.",
    videoLabel: "Regarde d’abord ceci",
    soundTitle: "Ta vidéo a commencé", soundCta: "Touche pour le son",
    playTitle: "Regarde la vidéo", playCta: "Touche pour lancer",
    galleryTitle: "Regarde à l’intérieur",
    contentsTitle: (n) => `Ce que tu reçois : ${n} livres`,
    seePages: (n) => `Voir ${n} pages`,
    galleryCaption: "☝ Touche une page pour la voir en grand",
    viewerHint: "Glisse → · touche hors de la page pour fermer",
    samplePages: (n) => `${n} page${n === 1 ? "" : "s"} d’exemple`,
    boxKicker: "Ajoute-le à ta commande en un geste",
    priceNote: "Un seul paiement · ajouté à la commande que tu viens de passer",
    priceNoteSub: "Abonnement · résilie en un clic, quand tu veux",
    ctaText: "OUI — AJOUTER {product} · {price}",
    ctaNote: "Un geste · tu n’auras pas à ressaisir ta carte",
    guarantee: (d) => `Paiement sécurisé${d ? ` · garantie ${d} jours` : ""} · Accès immédiat\nTu n’auras pas à ressaisir ta carte.`,
    noThanks: "Non merci — continuer",
    footnote: "Ta commande est confirmée dans tous les cas et tes fichiers sont déjà en route. Cette page ne fait qu’y ajouter quelque chose.",
    preview: "Aperçu — ici les boutons ne font rien, rien n’est débité.",
    close: "Fermer",
    pill: "Aperçu",
  },
  de: {
    topBar: "⚠ Nur direkt nach deiner Bestellung",
    eyebrow: "✓ Zahlung bestätigt · Bestellung {order-number}",
    headline: "BEVOR DU GEHST, NOCH EINE SACHE",
    intro: "Danke {first-name}, deine Bestellung ist bestätigt und deine Dateien sind per E-Mail unterwegs. Bevor du schließt: ein Angebot, das du nur hier siehst.",
    videoLabel: "Schau dir das zuerst an",
    soundTitle: "Dein Video läuft", soundCta: "Tippen für Ton",
    playTitle: "Video ansehen", playCta: "Tippen zum Abspielen",
    galleryTitle: "Ein Blick hinein",
    contentsTitle: (n) => `Das bekommst du: ${n} Bücher`,
    seePages: (n) => `${n} Seiten ansehen`,
    galleryCaption: "☝ Tippe auf eine Seite, um sie groß zu sehen",
    viewerHint: "Wischen → · außerhalb der Seite tippen zum Schließen",
    samplePages: (n) => `${n} Beispielseite${n === 1 ? "" : "n"}`,
    boxKicker: "Mit einem Tipp zu deiner Bestellung",
    priceNote: "Einmalzahlung · wird zu deiner gerade getätigten Bestellung hinzugefügt",
    priceNoteSub: "Abo · jederzeit mit einem Klick kündbar",
    ctaText: "JA — {product} HINZUFÜGEN · {price}",
    ctaNote: "Ein Tipp · du musst deine Karte nicht erneut eingeben",
    guarantee: (d) => `Sichere Zahlung${d ? ` · ${d} Tage Garantie` : ""} · Sofortiger Zugang\nDu musst deine Karte nicht erneut eingeben.`,
    noThanks: "Nein danke — weiter",
    footnote: "Deine Bestellung ist so oder so bestätigt und deine Dateien sind schon unterwegs. Diese Seite ergänzt sie nur.",
    preview: "Vorschau — hier tun die Buttons nichts, es wird nichts belastet.",
    close: "Schließen",
    pill: "Vorschau",
  },
};

// ------------------------------------------------------------- vista final

/** Todo lo que pinta la pantalla, ya resuelto: textos por defecto y etiquetas reemplazadas. */
export type OfferView = {
  locale: Locale;
  productName: string;
  topBar: string;
  eyebrow: string;
  headline: string;
  intro: string;
  pitch: string;
  video: null | {
    url: string; poster: string; label: string; delaySeconds: number;
    soundTitle: string; soundCta: string; playTitle: string; playCta: string;
  };
  /** Tapa del producto: va en lugar del video cuando no hay video. */
  cover: string | null;
  gallery: null | { title: string; images: string[]; caption: string; viewerHint: string; viewerSub: string };
  /** Kit o biblioteca: cada libro por separado (tapa, nombre, descripción y sus páginas). Va en lugar de la tapa. */
  contents: null | { title: string; items: { name: string; description: string; cover: string | null; pages: string[]; seePages: string; pagesSub: string }[] };
  stats: string;
  boxKicker: string;
  boxTitle: string;
  boxSubtitle: string;
  bullets: string[];
  price: string;
  compare: string | null;
  priceNote: string;
  ctaText: string;
  ctaNote: string;
  guaranteeLines: string[];
  noThanks: string;
  footnote: string;
  bottomBar: string;
  ui: OfferUi;
};

export type OfferUi = { added: string; cont: string; failed: string; preview: string; close: string; pill: string };

/** Textos de los estados del botón y de la vista previa, en el idioma del comprador. */
export function offerUi(locale: Locale): OfferUi {
  const d = D[locale] ?? D.en;
  const t = T[locale] ?? T.en;
  return { added: t.upsellAdded, cont: t.continueToDownloads, failed: t.upsellFailed, preview: d.preview, close: d.close, pill: d.pill };
}

export type ViewInput = {
  page: unknown;
  product: { short_name: string; name: string; description: string; image_url: string | null; presale?: boolean | null; presale_days?: number | null; subscription?: boolean | null };
  locale: Locale;
  /** Ya formateados en la moneda del pedido. */
  price: string;
  compare: string | null;
  /** Nombre completo del pedido; se toma el de pila. */
  buyerName: string | null;
  orderId: string;
  /** «#1001» (orderRef). Sin él, la referencia vieja del id. */
  orderNumber?: string;
  guaranteeDays: number;
  storeName: string;
  /** Los libros del kit (otoContents): sin esto, o con menos de 2, se muestra la tapa del producto. */
  contents?: { name: string; description: string; cover: string | null; pages: string[] }[];
};

/** Nombre de pila presentable, o null si no hay uno usable. */
export function firstNameOf(full: string | null | undefined): string | null {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@") || /\d/.test(first) || first.length > 30) return null;
  // "MARIA" o "maria" → "Maria"; "McKenzie" queda como está.
  const flat = first === first.toLowerCase() || first === first.toUpperCase();
  return flat ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first;
}

/** La referencia vieja (8 del id): solo si no se tiene el número del pedido (orderRef). */
export const orderNumberOf = (orderId: string) => orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Reemplaza las etiquetas. Sin nombre, la etiqueta se va con su coma. */
export function fillTags(s: string, tags: { firstName: string | null; orderNumber: string; price: string; compare: string | null; product: string }) {
  let out = s;
  if (!tags.firstName) {
    const atStart = /^\s*\{first-name\}\s*[,!.]?\s*/i.test(out);
    out = out.replace(/^\s*\{first-name\}\s*[,!.]?\s*/i, "").replace(/[ \t]*,?[ \t]*\{first-name\}/gi, "");
    if (atStart) out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out
    .replace(/\{first-name\}/gi, tags.firstName ?? "")
    .replace(/\{order-number\}/gi, tags.orderNumber)
    .replace(/\{price\}/gi, tags.price)
    .replace(/\{compare\}/gi, tags.compare ?? "")
    .replace(/\{product\}/gi, tags.product);
}

export function buildOfferView(i: ViewInput): OfferView {
  const p = resolvePostcompraPage(i.page);
  const d = D[i.locale] ?? D.en;
  const t = T[i.locale] ?? T.en;
  const product = i.product.short_name || i.product.name;
  const tags = {
    firstName: firstNameOf(i.buyerName),
    orderNumber: i.orderNumber ?? `#${orderNumberOf(i.orderId)}`,
    price: i.price,
    compare: i.compare,
    product,
  };
  const f = (s: string) => fillTags(s, tags);
  const or = (own: string, def: string) => f(own || def);

  const description = (i.product.description ?? "").trim();
  const defaultPitch = description ? `**${product}.** ${description}` : `**${product}.**`;
  const images = p.gallery.images;

  return {
    locale: i.locale,
    productName: product,
    topBar: or(p.topBar, d.topBar),
    eyebrow: f(d.eyebrow),
    headline: or(p.headline, d.headline),
    intro: or(p.intro, d.intro),
    pitch: or(p.pitch, defaultPitch),
    video: p.video.url
      ? {
          url: p.video.url,
          poster: p.video.poster || i.product.image_url || "",
          label: or(p.video.label, d.videoLabel),
          delaySeconds: p.video.delaySeconds,
          soundTitle: d.soundTitle, soundCta: d.soundCta, playTitle: d.playTitle, playCta: d.playCta,
        }
      : null,
    cover: i.product.image_url,
    contents: (i.contents?.length ?? 0) >= 2
      ? {
          title: d.contentsTitle(i.contents!.length),
          items: i.contents!.map((b) => ({ ...b, seePages: d.seePages(b.pages.length), pagesSub: d.samplePages(b.pages.length) })),
        }
      : null,
    gallery: images.length
      ? {
          title: or(p.gallery.title, d.galleryTitle),
          images,
          caption: or(p.gallery.caption, d.galleryCaption),
          viewerHint: d.viewerHint,
          viewerSub: d.samplePages(images.length),
        }
      : null,
    stats: f(p.stats),
    boxKicker: or(p.boxKicker, d.boxKicker),
    boxTitle: or(p.boxTitle, product),
    // Sin pitch propio, la descripción ya está en la carta de arriba.
    boxSubtitle: f(p.boxSubtitle || (p.pitch ? description : "")),
    bullets: p.bullets.map(f),
    price: i.price,
    compare: i.compare,
    // «One payment» debajo de una suscripcion era falso, y se contradecia con
    // el boton de al lado («Add it — $9 a month»). Es lo que lee el que esta
    // por arrancar un cobro que se repite.
    priceNote: i.product.subscription ? d.priceNoteSub : d.priceNote,
    ctaText: or(p.ctaText, d.ctaText),
    // Preventa: lo primero que se lee bajo el botón es cuándo llega (055).
    // Nunca un plazo de preventa a la vista del comprador: el aviso va solo en el documento de Drive.
    ctaNote: or(p.ctaNote, d.ctaNote),
    guaranteeLines: or(p.guaranteeNote, d.guarantee(Math.max(0, i.guaranteeDays || 0))).split(/\n+/).map((l) => l.trim()).filter(Boolean),
    noThanks: or(p.noThanks, d.noThanks),
    footnote: or(p.footnote, d.footnote),
    bottomBar: or(p.bottomBar, i.storeName),
    ui: offerUi(i.locale),
  };
}

/** Texto de ayuda para el MCP: qué es cada campo. */
export const POSTCOMPRA_DOC =
  "postcompra_page: content of this product's 1-click post-purchase (OTO) page — fixed design, only the content changes. Partial patch, merged into what is saved (only the keys you pass change; null resets a key to its default; arrays replace the whole list). Every text is optional: empty = a localized default built from the product (name, description, cover). "
  + "Fields: topBar (navy bar at the top, short, ~35 chars), headline (big title, e.g. \"BEFORE YOU GO, ONE THING\"), intro (thank-you line under the title; supports {first-name}), pitch (short paragraph in the white card; **bold** allowed), "
  + "video {url (https mp4; plays muted with a tap-for-sound layer; without it the product cover is shown instead), poster (https image), label (orange line above it), delaySeconds (0 = buy buttons visible at once; N = buy buttons appear when the video reaches second N)}, "
  + "gallery {title, images (https image URLs of real sample pages, max 12; tapping opens a full-screen viewer), caption (hint under the grid)}, stats (one line under the gallery; text after \" — \" is shown lighter), "
  + "boxKicker (dark strip on top of the offer box), boxTitle (default = product name), boxSubtitle, bullets (string[], green check list of what is really inside, max 12), ctaText (buy button; supports {price}), ctaNote (small line under the first button), guaranteeNote (green box; a newline splits it into two lines), noThanks (decline button), footnote (small note under it), bottomBar (navy bar at the bottom). "
  + "Merge tags in any text: {first-name} (removed with its comma when the buyer has no name), {order-number}, {price}, {compare}, {product}. Never invent testimonials, numbers, scarcity or results.";
