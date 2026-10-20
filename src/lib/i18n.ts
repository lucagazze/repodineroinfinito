/**
 * Idioma del comprador.
 *
 * Una tienda puede vender sobre todo en un país, pero la landing la abre gente de
 * cualquier lado. Elegimos idioma por `Accept-Language` y, si el checkout ya
 * ocurrió, por el país que Stripe reporta — que es más confiable que el
 * navegador cuando alguien viaja o tiene el SO en otro idioma.
 */

export const LOCALES = ["it", "en", "es", "pt-BR", "fr", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "it";

/** País → idioma. Solo los que nos importan; el resto cae en inglés. */
const COUNTRY_LOCALE: Record<string, Locale> = {
  IT: "it", SM: "it", VA: "it",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr",
  DE: "de", AT: "de", LI: "de", CH: "de",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", UY: "es", PY: "es", BO: "es", EC: "es", VE: "es",
  CR: "es", PA: "es", GT: "es", DO: "es", SV: "es", HN: "es", NI: "es",
  BR: "pt-BR", PT: "pt-BR", AO: "pt-BR", MZ: "pt-BR",
};

/** País → moneda de cobro. El resto usa USD con Adaptive Pricing. */
const COUNTRY_CURRENCY: Record<string, string> = {
  IT: "EUR", ES: "EUR", PT: "EUR", FR: "EUR", DE: "EUR", AT: "EUR",
  NL: "EUR", BE: "EUR", IE: "EUR", GR: "EUR", FI: "EUR", SK: "EUR",
  SI: "EUR", LU: "EUR", MT: "EUR", CY: "EUR", EE: "EUR", LV: "EUR", LT: "EUR",
};

export function localeFromCountry(country?: string | null): Locale {
  if (!country) return DEFAULT_LOCALE;
  return COUNTRY_LOCALE[country.toUpperCase()] ?? "en";
}

export function currencyFromCountry(country?: string | null): string {
  if (!country) return "USD";
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";
}

/** Parsea Accept-Language y devuelve el primero que soportamos. */
export function localeFromHeader(header?: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of wanted) {
    if (tag.startsWith("it")) return "it";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("de")) return "de";
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

/**
 * Locale para Stripe Checkout. El tipo literal importa: Stripe tipa este
 * campo como una unión cerrada y no acepta un `string` cualquiera.
 */
export function stripeLocale(l: Locale): "it" | "en" | "es" | "pt-BR" | "fr" | "de" {
  return l;
}

type Dict = {
  thanksTitle: string;
  thanksTitleNamed: string;
  ready: string;
  alsoSent: string;
  download: string;
  included: string;
  emailHelp: string;
  processing: string;
  processingBody: string;
  notFound: string;
  missingId: string;
  guarantee: (d: number) => string;
  /** upsell */
  upsellKicker: string;
  upsellAdd: string;
  upsellNo: string;
  upsellOneClick: string;
  upsellAdded: string;
  continueToDownloads: string;
  upsellFailed: string;
  /** email */
  mailSubject: (store: string) => string;
  mailHi: (name: string | null) => string;
  mailReady: (store: string) => string;
  mailOpen: (p: string) => string;
  mailIncluded: string;
  mailFallback: string;
  mailGuarantee: (d: number) => string;
  mailOrder: string;
  mailSupport: string;
  mailPreheader: (product: string) => string;
  mailHeadline: string;
  mailThanks: (name: string | null, store: string) => string;
  mailYourOrder: string;
  mailDownload: string;
  mailInside: string;
  /** Preventa (055): la línea de la oferta y del bump, y la etiqueta del mail. */
  presaleNote: (days: number) => string;
  presaleBadge: (days: number) => string;
  mailPaid: string;
  mailGuaranteeTitle: (d: number) => string;
  mailGuaranteeBody: string;
  mailTip: string;
  recSubject: (product: string) => string;
  recPreheader: string;
  recHeadline: string;
  recBody: (product: string) => string;
  recCta: string;
  recFoot: string;
  /** checkout propio */
  ckSecure: string;
  ckBuying: (n: number) => string;
  ckPersonal: string;
  ckEmail: string;
  ckEmailHelp: string;
  ckFirstName: string;
  ckLastName: string;
  ckPhone: string;
  ckPayMethod: string;
  ckPay: (total: string) => string;
  ckProcessing: string;
  /** El banco rechazó porque pide verificar (authentication_required): mensaje claro en vez del de Stripe para programadores. */
  ckAuthRequired: string;
  /** Al volver de Klarna, Cash App, Amazon Pay… sin completar el pago. */
  ckPayNotDone: string;
  /** El formulario de la pasarela no termino de cargar (no es un pago fallido). */
  ckPayFormStuck: string;
  ckRetry: string;
  ckAddToOrder: string;
  ckAdded: string;
  ckBumpsTitle: string;
  ckExpires: (t: string) => string;
  ckSummary: string;
  ckIncludesFree: string;
  ckFree: string;
  ckTotal: string;
  ckSave: (x: string) => string;
  ckSecurePay: string;
  ckSoldBy: string;
  ckTerms: string;
  ckPrivacy: string;
  ckRefunds: string;
  ckStatement: (name: string) => string;
  ckOrPayOther: string;
  ckSupport: string;
  ckAmountsIn: (cur: string) => string;
  ckSecureProcessed: string;
};

export const T: Record<Locale, Dict> = {
  it: {
    thanksTitle: "Grazie!",
    thanksTitleNamed: "Grazie",
    ready: "è pronto.",
    alsoSent: "Te l'abbiamo mandato anche a",
    download: "Scarica",
    included: "Incluso nel tuo ordine:",
    emailHelp:
      "Non trovi l'email? Controlla lo spam. Il link qui sopra funziona comunque.",
    processing: "Stiamo elaborando il pagamento",
    processingBody:
      "Alcuni metodi impiegano fino a 24 ore. Appena arriva, ti mandiamo l'accesso via email.",
    notFound: "Non troviamo il tuo ordine",
    missingId: "Manca l'identificativo dell'acquisto",
    guarantee: (d) => `Garanzia di ${d} giorni`,
    upsellKicker: "Offerta riservata a chi ha appena acquistato",
    upsellAdd: "Sì, aggiungilo al mio ordine",
    upsellNo: "No, grazie",
    upsellOneClick:
      "Un clic: usiamo la carta che hai appena usato. Nessun dato da reinserire.",
    upsellAdded: "Aggiunto al tuo ordine",
    continueToDownloads: "Vai ai tuoi download",
    upsellFailed: "Non siamo riusciti ad addebitare la carta. Il tuo ordine è comunque confermato.",
    mailSubject: (s) => `Il tuo download da ${s} è pronto`,
    mailHi: (n) => (n ? `Ciao ${n},` : "Ciao,"),
    mailReady: (s) => `Il tuo materiale da <strong>${s}</strong> è pronto.`,
    mailOpen: (p) => `Apri ${p}`,
    mailIncluded: "Incluso nel tuo ordine:",
    mailFallback: "Se il pulsante non funziona, copia questo link:",
    mailGuarantee: (d) =>
      `Garanzia di ${d} giorni per problemi reali con il prodotto: rispondi a questa email e raccontaci cosa è successo.`,
    mailOrder: "Ordine",
    mailSupport: "Serve aiuto? Rispondi a questa email.",
    mailPreheader: (p) => `${p} è pronto: aprilo da qui in un clic.`,
    mailHeadline: "Il tuo materiale è pronto",
    mailThanks: (n, s) => `${n ? `Ciao ${n}, grazie` : "Grazie"} per il tuo acquisto su ${s}.`,
    mailYourOrder: "Il tuo ordine",
    mailDownload: "Scarica",
    mailInside: "Dentro la cartella",
    presaleNote: (d) => `📦 In prevendita · ti arriva via email entro ${d} giorni`,
    presaleBadge: (d) => `Arriva entro ${d} giorni`,
    mailPaid: "Totale pagato",
    mailGuaranteeTitle: (d) => `Garanzia di ${d} giorni`,
    mailGuaranteeBody: "Se c'è un problema reale (un file che non si apre o un contenuto diverso da quello descritto), rispondi a questa email e raccontaci cosa è successo: lo risolviamo o ti rimborsiamo. È un PDF digitale e non spediamo nulla: aspettarsi un libro stampato o cambiare idea dopo il download non danno diritto al rimborso.",
    mailTip: "Consiglio: salva la cartella sul tuo Google Drive per averla sempre con te, anche offline.",
    recSubject: (p) => `Hai lasciato ${p} nel carrello`,
    recPreheader: "Il tuo ordine è ancora lì, con lo stesso prezzo.",
    recHeadline: "Hai dimenticato qualcosa?",
    recBody: (p) => `Hai iniziato l’acquisto di ${p} ma non l’hai completato. L’abbiamo tenuto da parte per te, allo stesso prezzo.`,
    recCta: "Completa l’acquisto",
    recFoot: "Se hai avuto un problema con il pagamento, rispondi a questa email e ti aiutiamo.",
    ckSecure: "Checkout sicuro",
    ckBuying: (n) => `${n} ${n === 1 ? "persona sta acquistando" : "persone stanno acquistando"} in questo momento`,
    ckPersonal: "Dati personali",
    ckEmail: "Email",
    ckEmailHelp: "Qui riceverai il materiale subito dopo l'acquisto",
    ckFirstName: "Nome",
    ckLastName: "Cognome",
    ckPhone: "Telefono",
    ckPayMethod: "Metodo di pagamento",
    ckPay: (t) => `Paga ${t}`,
    ckProcessing: "Elaborazione…",
    ckAuthRequired: "La tua banca chiede di confermare il pagamento. Tocca di nuovo «Paga» e approva la verifica nell’app della banca, oppure usa un’altra carta.",
    ckPayNotDone: "Il pagamento non è stato completato. Riprova o scegli un altro metodo di pagamento.",
    ckPayFormStuck: "Non siamo riusciti a caricare il modulo di pagamento. Controlla la connessione e riprova.",
    ckRetry: "Riprova",
    ckAddToOrder: "+ Aggiungi al mio ordine",
    ckAdded: "✓ Aggiunto",
    ckBumpsTitle: "AGGIUNGI AL TUO ORDINE",
    ckExpires: (t) => `L’offerta scade tra ${t}`,
    ckSummary: "Riepilogo dell'ordine",
    ckIncludesFree: "INCLUDE GRATIS",
    ckFree: "GRATIS",
    ckTotal: "Totale",
    ckSave: (x) => `Risparmi ${x}`,
    ckSecurePay: "Pagamento sicuro",
    ckSoldBy: "Venduto da",
    ckTerms: "Termini e condizioni",
    ckPrivacy: "Informativa sulla privacy",
    ckRefunds: "Rimborsi",
    ckStatement: (n) => `Sull’estratto conto comparirà come ${n}.`,
    ckOrPayOther: "oppure paga in un altro modo",
    ckSupport: "Assistenza",
    ckAmountsIn: (c) => `Importi in ${c}.`,
    ckSecureProcessed: "Pagamento elaborato in modo sicuro.",
  },
  en: {
    thanksTitle: "Thank you!",
    thanksTitleNamed: "Thank you",
    ready: "is ready.",
    alsoSent: "We also sent it to",
    download: "Download",
    included: "Included with your order:",
    emailHelp:
      "Email not there? Check spam. The link above works either way.",
    processing: "Your payment is being processed",
    processingBody:
      "Some methods take up to 24 hours. As soon as it clears, we email you the access.",
    notFound: "We could not find your order",
    missingId: "Missing purchase identifier",
    guarantee: (d) => `${d}-day guarantee`,
    upsellKicker: "Reserved for customers who just bought",
    upsellAdd: "Yes, add it to my order",
    upsellNo: "No, thanks",
    upsellOneClick:
      "One click: we use the card you just used. Nothing to re-enter.",
    upsellAdded: "Added to your order",
    continueToDownloads: "Go to your downloads",
    upsellFailed: "We could not charge your card. Your order is still confirmed.",
    mailSubject: (s) => `Your download from ${s} is ready`,
    mailHi: (n) => (n ? `Hi ${n},` : "Hi,"),
    mailReady: (s) => `Your material from <strong>${s}</strong> is ready.`,
    mailOpen: (p) => `Open ${p}`,
    mailIncluded: "Included with your order:",
    mailFallback: "If the button does not work, copy this link:",
    mailGuarantee: (d) =>
      `${d}-day guarantee for genuine problems with the product: reply to this email and tell us what happened.`,
    mailOrder: "Order",
    mailSupport: "Need help? Just reply to this email.",
    mailPreheader: (p) => `${p} is ready: open it from here in one click.`,
    mailHeadline: "Your material is ready",
    mailThanks: (n, s) => `${n ? `Hi ${n}, thanks` : "Thanks"} for your purchase from ${s}.`,
    mailYourOrder: "Your order",
    mailDownload: "Download",
    mailInside: "Inside the folder",
    presaleNote: (d) => `📦 Pre-order · delivered to your email within ${d} days`,
    presaleBadge: (d) => `Arrives within ${d} days`,
    mailPaid: "Total paid",
    mailGuaranteeTitle: (d) => `${d}-day guarantee`,
    mailGuaranteeBody: "If something is genuinely wrong (a file won't open, or the content isn't what we describe), reply to this email and tell us what happened: we'll fix it or refund you. It's a digital PDF and nothing is shipped, so expecting a printed book or changing your mind after downloading aren't grounds for a refund.",
    mailTip: "Tip: save the folder to your Google Drive so you always have it, even offline.",
    recSubject: (p) => `You left ${p} in your cart`,
    recPreheader: "Your order is still there, at the same price.",
    recHeadline: "Did you forget something?",
    recBody: (p) => `You started buying ${p} but did not finish. We saved it for you, at the same price.`,
    recCta: "Complete your purchase",
    recFoot: "If something went wrong with the payment, reply to this email and we will help you.",
    ckSecure: "Secure checkout",
    ckBuying: (n) => `${n} ${n === 1 ? "person is buying" : "people are buying"} right now`,
    ckPersonal: "Your details",
    ckEmail: "Email",
    ckEmailHelp: "You will get your material here right after checkout",
    ckFirstName: "First name",
    ckLastName: "Last name",
    ckPhone: "Phone",
    ckPayMethod: "Payment method",
    ckPay: (t) => `Pay ${t}`,
    ckProcessing: "Processing…",
    ckAuthRequired: "Your bank needs you to confirm this payment. Tap Pay again and approve the check in your banking app, or use another card.",
    ckPayNotDone: "Your payment wasn't completed. Please try again or choose another payment method.",
    ckPayFormStuck: "We couldn't load the payment form. Check your connection and try again.",
    ckRetry: "Try again",
    ckAddToOrder: "+ Add to my order",
    ckAdded: "✓ Added",
    ckBumpsTitle: "ADD TO YOUR ORDER",
    ckExpires: (t) => `Offer expires in ${t}`,
    ckSummary: "Order summary",
    ckIncludesFree: "INCLUDES FREE",
    ckFree: "FREE",
    ckTotal: "Total",
    ckSave: (x) => `You save ${x}`,
    ckSecurePay: "Secure payment",
    ckSoldBy: "Sold by",
    ckTerms: "Terms and Conditions",
    ckPrivacy: "Privacy Policy",
    ckRefunds: "Refunds",
    ckStatement: (n) => `On your statement this appears as ${n}.`,
    ckOrPayOther: "or pay another way",
    ckSupport: "Support",
    ckAmountsIn: (c) => `Amounts in ${c}.`,
    ckSecureProcessed: "Payment processed securely.",
  },
  es: {
    thanksTitle: "¡Gracias!",
    thanksTitleNamed: "Gracias",
    ready: "ya está listo.",
    alsoSent: "También te lo hemos enviado a",
    download: "Descargar",
    included: "Incluido en tu pedido:",
    emailHelp:
      "¿No te ha llegado el email? Mira en spam. El enlace de arriba funciona igual.",
    processing: "Estamos procesando tu pago",
    processingBody:
      "Algunos métodos tardan hasta 24 horas. En cuanto se acredite, te enviamos el acceso por email.",
    notFound: "No encontramos tu pedido",
    missingId: "Falta el identificador de la compra",
    guarantee: (d) => `Garantía de ${d} días`,
    upsellKicker: "Oferta reservada para quien acaba de comprar",
    upsellAdd: "Sí, añádelo a mi pedido",
    upsellNo: "No, gracias",
    upsellOneClick:
      "Un clic: usamos la misma tarjeta. No tienes que introducir nada de nuevo.",
    upsellAdded: "Añadido a tu pedido",
    continueToDownloads: "Ir a mis descargas",
    upsellFailed: "No pudimos cobrar la tarjeta. Tu pedido igual está confirmado.",
    mailSubject: (s) => `Tu descarga de ${s} ya está lista`,
    mailHi: (n) => (n ? `Hola ${n},` : "Hola,"),
    mailReady: (s) => `Tu material de <strong>${s}</strong> ya está listo.`,
    mailOpen: (p) => `Abrir ${p}`,
    mailIncluded: "Incluido en tu pedido:",
    mailFallback: "Si el botón no funciona, copia este enlace:",
    mailGuarantee: (d) =>
      `Garantía de ${d} días por problemas reales con el producto: responde a este email y cuéntanos qué ha pasado.`,
    mailOrder: "Pedido",
    mailSupport: "¿Necesitas ayuda? Responde a este email.",
    mailPreheader: (p) => `${p} ya está listo: ábrelo desde aquí en un clic.`,
    mailHeadline: "Tu material ya está listo",
    mailThanks: (n, s) => `${n ? `Hola ${n}, gracias` : "Gracias"} por tu compra en ${s}.`,
    mailYourOrder: "Tu pedido",
    mailDownload: "Descargar",
    mailInside: "Dentro de la carpeta",
    presaleNote: (d) => `📦 Preventa · te llega por email en ${d} días`,
    presaleBadge: (d) => `Llega en ${d} días`,
    mailPaid: "Total pagado",
    mailGuaranteeTitle: (d) => `Garantía de ${d} días`,
    mailGuaranteeBody: "Si hay un problema real (un archivo que no abre o un contenido distinto al que describimos), responde a este email y cuéntanos qué ha pasado: lo solucionamos o te devolvemos el dinero. Es un PDF digital y no se envía nada físico: esperar un libro impreso o arrepentirse después de descargarlo no son motivo de reembolso.",
    mailTip: "Consejo: guarda la carpeta en tu Google Drive para tenerla siempre, incluso sin conexión.",
    recSubject: (p) => `Te has dejado ${p} en el carrito`,
    recPreheader: "Tu pedido sigue ahí, al mismo precio.",
    recHeadline: "¿Se te ha olvidado algo?",
    recBody: (p) => `Empezaste a comprar ${p} pero no terminaste. Te lo guardamos al mismo precio.`,
    recCta: "Terminar la compra",
    recFoot: "Si has tenido un problema con el pago, responde a este email y te ayudamos.",
    ckSecure: "Checkout seguro",
    ckBuying: (n) => `${n} ${n === 1 ? "persona está comprando" : "personas están comprando"} ahora mismo`,
    ckPersonal: "Datos personales",
    ckEmail: "Correo electrónico",
    ckEmailHelp: "Aquí recibirás tu producto inmediatamente después de la compra",
    ckFirstName: "Nombre",
    ckLastName: "Apellidos",
    ckPhone: "Teléfono",
    ckPayMethod: "Método de pago",
    ckPay: (t) => `Pagar ${t}`,
    ckProcessing: "Procesando…",
    ckAuthRequired: "Tu banco pide que confirmes el pago. Pulsa de nuevo «Pagar» y aprueba la verificación en la app de tu banco, o usa otra tarjeta.",
    ckPayNotDone: "El pago no se completó. Inténtalo de nuevo o elige otro método de pago.",
    ckPayFormStuck: "No pudimos cargar el formulario de pago. Revisá la conexión y probá de nuevo.",
    ckRetry: "Reintentar",
    ckAddToOrder: "+ Añadir a mi pedido",
    ckAdded: "✓ Añadido",
    ckBumpsTitle: "AÑADE A TU PEDIDO",
    ckExpires: (t) => `La oferta expira en ${t}`,
    ckSummary: "Resumen del pedido",
    ckIncludesFree: "INCLUYE GRATIS",
    ckFree: "GRATIS",
    ckTotal: "Precio total",
    ckSave: (x) => `Ahorras ${x}`,
    ckSecurePay: "Pago seguro",
    ckSoldBy: "Vendido por",
    ckTerms: "Términos y condiciones",
    ckPrivacy: "Política de privacidad",
    ckRefunds: "Reembolsos",
    ckStatement: (n) => `En el extracto de tu tarjeta aparecerá como ${n}.`,
    ckOrPayOther: "o paga de otra forma",
    ckSupport: "Soporte",
    ckAmountsIn: (c) => `Importes en ${c}.`,
    ckSecureProcessed: "Pago procesado de forma segura.",
  },
  "pt-BR": {
    thanksTitle: "Obrigado!",
    thanksTitleNamed: "Obrigado",
    ready: "está pronto.",
    alsoSent: "Também enviamos para",
    download: "Baixar",
    included: "Incluído no seu pedido:",
    emailHelp:
      "Não achou o email? Confira o spam. O link acima funciona de qualquer forma.",
    processing: "Seu pagamento está sendo processado",
    processingBody:
      "Alguns métodos levam até 24 horas. Assim que cair, enviamos o acesso por email.",
    notFound: "Não encontramos seu pedido",
    missingId: "Falta o identificador da compra",
    guarantee: (d) => `Garantia de ${d} dias`,
    upsellKicker: "Oferta reservada para quem acabou de comprar",
    upsellAdd: "Sim, quero adicionar",
    upsellNo: "Não, obrigado",
    upsellOneClick:
      "Um clique: usamos o mesmo cartão. Nada para digitar de novo.",
    upsellAdded: "Adicionado ao seu pedido",
    continueToDownloads: "Ir para meus downloads",
    upsellFailed: "Não conseguimos cobrar o cartão. Seu pedido continua confirmado.",
    mailSubject: (s) => `Seu download da ${s} está pronto`,
    mailHi: (n) => (n ? `Olá ${n},` : "Olá,"),
    mailReady: (s) => `Seu material da <strong>${s}</strong> está pronto.`,
    mailOpen: (p) => `Abrir ${p}`,
    mailIncluded: "Incluído no seu pedido:",
    mailFallback: "Se o botão não funcionar, copie este link:",
    mailGuarantee: (d) =>
      `Garantia de ${d} dias para problemas reais com o produto: responda este email e conte o que aconteceu.`,
    mailOrder: "Pedido",
    mailSupport: "Precisa de ajuda? Responda este email.",
    mailPreheader: (p) => `${p} está pronto: abra daqui em um clique.`,
    mailHeadline: "Seu material está pronto",
    mailThanks: (n, s) => `${n ? `Olá ${n}, obrigado` : "Obrigado"} pela sua compra na ${s}.`,
    mailYourOrder: "Seu pedido",
    mailDownload: "Baixar",
    mailInside: "Dentro da pasta",
    presaleNote: (d) => `📦 Pré-venda · chega no seu e-mail em até ${d} dias`,
    presaleBadge: (d) => `Chega em até ${d} dias`,
    mailPaid: "Total pago",
    mailGuaranteeTitle: (d) => `Garantia de ${d} dias`,
    mailGuaranteeBody: "Se houver um problema real (um arquivo que não abre ou um conteúdo diferente do descrito), responda este email e conte o que aconteceu: resolvemos ou devolvemos seu dinheiro. É um PDF digital e nada é enviado: esperar um livro impresso ou mudar de ideia depois do download não dão direito a reembolso.",
    mailTip: "Dica: salve a pasta no seu Google Drive para ter sempre com você, mesmo offline.",
    recSubject: (p) => `Você deixou ${p} no carrinho`,
    recPreheader: "Seu pedido continua lá, pelo mesmo preço.",
    recHeadline: "Esqueceu alguma coisa?",
    recBody: (p) => `Você começou a comprar ${p} mas não terminou. Guardamos para você, pelo mesmo preço.`,
    recCta: "Finalizar a compra",
    recFoot: "Se teve algum problema com o pagamento, responda este email e ajudamos você.",
    ckSecure: "Checkout seguro",
    ckBuying: (n) => `${n} ${n === 1 ? "pessoa está comprando" : "pessoas estão comprando"} agora`,
    ckPersonal: "Seus dados",
    ckEmail: "Email",
    ckEmailHelp: "Você recebe o material aqui logo após a compra",
    ckFirstName: "Nome",
    ckLastName: "Sobrenome",
    ckPhone: "Telefone",
    ckPayMethod: "Forma de pagamento",
    ckPay: (t) => `Pagar ${t}`,
    ckProcessing: "Processando…",
    ckAuthRequired: "Seu banco pede para confirmar o pagamento. Toque de novo em Pagar e aprove a verificação no app do banco, ou use outro cartão.",
    ckPayNotDone: "O pagamento não foi concluído. Tente novamente ou escolha outra forma de pagamento.",
    ckPayFormStuck: "Não conseguimos carregar o formulário de pagamento. Verifique a conexão e tente de novo.",
    ckRetry: "Tentar de novo",
    ckAddToOrder: "+ Adicionar ao pedido",
    ckAdded: "✓ Adicionado",
    ckBumpsTitle: "ADICIONE AO SEU PEDIDO",
    ckExpires: (t) => `A oferta expira em ${t}`,
    ckSummary: "Resumo do pedido",
    ckIncludesFree: "INCLUI GRÁTIS",
    ckFree: "GRÁTIS",
    ckTotal: "Total",
    ckSave: (x) => `Você economiza ${x}`,
    ckSecurePay: "Pagamento seguro",
    ckSoldBy: "Vendido por",
    ckTerms: "Termos e condições",
    ckPrivacy: "Política de privacidade",
    ckRefunds: "Reembolsos",
    ckStatement: (n) => `Na fatura aparece como ${n}.`,
    ckOrPayOther: "ou pague de outra forma",
    ckSupport: "Suporte",
    ckAmountsIn: (c) => `Valores em ${c}.`,
    ckSecureProcessed: "Pagamento processado com segurança.",
  },
  fr: {
    thanksTitle: "Merci !",
    thanksTitleNamed: "Merci",
    ready: "est prêt.",
    alsoSent: "Nous l'avons aussi envoyé à",
    download: "Télécharger",
    included: "Inclus dans ta commande :",
    emailHelp: "Tu ne trouves pas l'e-mail ? Regarde dans les spams. Le lien ci-dessus fonctionne de toute façon.",
    processing: "Ton paiement est en cours de traitement",
    processingBody: "Certains moyens de paiement prennent jusqu'à 24 heures. Dès qu'il est validé, nous t'envoyons l'accès par e-mail.",
    notFound: "Nous ne trouvons pas ta commande",
    missingId: "Identifiant d'achat manquant",
    guarantee: (d) => `Garantie de ${d} jours`,
    upsellKicker: "Offre réservée à ceux qui viennent d'acheter",
    upsellAdd: "Oui, ajoute-le à ma commande",
    upsellNo: "Non, merci",
    upsellOneClick: "Un clic : nous utilisons la carte que tu viens d'utiliser. Rien à ressaisir.",
    upsellAdded: "Ajouté à ta commande",
    continueToDownloads: "Aller à mes téléchargements",
    upsellFailed: "Nous n'avons pas pu débiter ta carte. Ta commande reste confirmée.",
    mailSubject: (s) => `Ton téléchargement ${s} est prêt`,
    mailHi: (n) => (n ? `Bonjour ${n},` : "Bonjour,"),
    mailReady: (s) => `Ton contenu <strong>${s}</strong> est prêt.`,
    mailOpen: (p) => `Ouvrir ${p}`,
    mailIncluded: "Inclus dans ta commande :",
    mailFallback: "Si le bouton ne fonctionne pas, copie ce lien :",
    mailGuarantee: (d) =>
      `Garantie de ${d} jours pour les vrais problèmes liés au produit : réponds à cet e-mail et raconte-nous ce qui s'est passé.`,
    mailOrder: "Commande",
    mailSupport: "Besoin d'aide ? Réponds à cet e-mail.",
    mailPreheader: (p) => `${p} est prêt : ouvre-le d'ici en un clic.`,
    mailHeadline: "Ton contenu est prêt",
    mailThanks: (n, s) => `${n ? `Bonjour ${n}, merci` : "Merci"} pour ton achat sur ${s}.`,
    mailYourOrder: "Ta commande",
    mailDownload: "Télécharger",
    mailInside: "Dans le dossier",
    presaleNote: (d) => `📦 Prévente · tu le reçois par e-mail sous ${d} jours`,
    presaleBadge: (d) => `Arrive sous ${d} jours`,
    mailPaid: "Total payé",
    mailGuaranteeTitle: (d) => `Garantie de ${d} jours`,
    mailGuaranteeBody: "S'il y a un vrai problème (un fichier qui ne s'ouvre pas ou un contenu différent de celui décrit), réponds à cet e-mail et raconte-nous ce qui s'est passé : on le règle ou on te rembourse. C'est un PDF numérique et rien n'est expédié : attendre un livre imprimé ou changer d'avis après le téléchargement ne donnent pas droit à un remboursement.",
    mailTip: "Astuce : enregistre le dossier dans ton Google Drive pour l'avoir toujours avec toi, même hors ligne.",
    recSubject: (p) => `Tu as laissé ${p} dans ton panier`,
    recPreheader: "Ta commande t'attend toujours, au même prix.",
    recHeadline: "Tu as oublié quelque chose ?",
    recBody: (p) => `Tu as commencé l'achat de ${p} sans le terminer. Nous l'avons gardé pour toi, au même prix.`,
    recCta: "Terminer mon achat",
    recFoot: "Si tu as eu un problème avec le paiement, réponds à cet e-mail et nous t'aidons.",
    ckSecure: "Paiement sécurisé",
    ckBuying: (n) => `${n} ${n === 1 ? "personne est en train d'acheter" : "personnes sont en train d'acheter"} en ce moment`,
    ckPersonal: "Tes informations",
    ckEmail: "E-mail",
    ckEmailHelp: "C'est ici que tu recevras ton contenu juste après l'achat",
    ckFirstName: "Prénom",
    ckLastName: "Nom",
    ckPhone: "Téléphone",
    ckPayMethod: "Moyen de paiement",
    ckPay: (t) => `Payer ${t}`,
    ckProcessing: "Traitement…",
    ckAuthRequired: "Votre banque demande de confirmer le paiement. Touchez à nouveau « Payer » et validez la vérification dans l’application de votre banque, ou utilisez une autre carte.",
    ckPayNotDone: "Le paiement n'a pas abouti. Réessayez ou choisissez un autre moyen de paiement.",
    ckPayFormStuck: "Nous n'avons pas pu charger le formulaire de paiement. Vérifiez votre connexion et réessayez.",
    ckRetry: "Réessayer",
    ckAddToOrder: "+ Ajouter à ma commande",
    ckAdded: "✓ Ajouté",
    ckBumpsTitle: "AJOUTE À TA COMMANDE",
    ckExpires: (t) => `L'offre expire dans ${t}`,
    ckSummary: "Récapitulatif de la commande",
    ckIncludesFree: "INCLUS GRATUITEMENT",
    ckFree: "GRATUIT",
    ckTotal: "Total",
    ckSave: (x) => `Tu économises ${x}`,
    ckSecurePay: "Paiement sécurisé",
    ckSoldBy: "Vendu par",
    ckTerms: "Conditions générales",
    ckPrivacy: "Politique de confidentialité",
    ckRefunds: "Remboursements",
    ckStatement: (n) => `Sur ton relevé bancaire, l'achat apparaîtra sous le nom ${n}.`,
    ckOrPayOther: "ou payer autrement",
    ckSupport: "Assistance",
    ckAmountsIn: (c) => `Montants en ${c}.`,
    ckSecureProcessed: "Paiement traité de façon sécurisée.",
  },
  de: {
    thanksTitle: "Danke!",
    thanksTitleNamed: "Danke",
    ready: "ist bereit.",
    alsoSent: "Wir haben es dir auch geschickt an",
    download: "Herunterladen",
    included: "In deiner Bestellung enthalten:",
    emailHelp: "Keine E-Mail da? Schau im Spam-Ordner nach. Der Link oben funktioniert so oder so.",
    processing: "Deine Zahlung wird verarbeitet",
    processingBody: "Manche Zahlungsarten brauchen bis zu 24 Stunden. Sobald sie bestätigt ist, schicken wir dir den Zugang per E-Mail.",
    notFound: "Wir finden deine Bestellung nicht",
    missingId: "Kauf-ID fehlt",
    guarantee: (d) => `${d} Tage Garantie`,
    upsellKicker: "Angebot nur für Käufer, die gerade bestellt haben",
    upsellAdd: "Ja, zu meiner Bestellung hinzufügen",
    upsellNo: "Nein, danke",
    upsellOneClick: "Ein Klick: Wir nutzen die Karte, mit der du gerade bezahlt hast. Nichts neu eingeben.",
    upsellAdded: "Zu deiner Bestellung hinzugefügt",
    continueToDownloads: "Zu meinen Downloads",
    upsellFailed: "Wir konnten deine Karte nicht belasten. Deine Bestellung ist trotzdem bestätigt.",
    mailSubject: (s) => `Dein Download von ${s} ist bereit`,
    mailHi: (n) => (n ? `Hallo ${n},` : "Hallo,"),
    mailReady: (s) => `Dein Material von <strong>${s}</strong> ist bereit.`,
    mailOpen: (p) => `${p} öffnen`,
    mailIncluded: "In deiner Bestellung enthalten:",
    mailFallback: "Wenn der Button nicht funktioniert, kopiere diesen Link:",
    mailGuarantee: (d) =>
      `${d} Tage Garantie bei echten Problemen mit dem Produkt: Antworte auf diese E-Mail und erzähl uns, was passiert ist.`,
    mailOrder: "Bestellung",
    mailSupport: "Brauchst du Hilfe? Antworte auf diese E-Mail.",
    mailPreheader: (p) => `${p} ist bereit: mit einem Klick hier öffnen.`,
    mailHeadline: "Dein Material ist bereit",
    mailThanks: (n, s) => `${n ? `Hallo ${n}, danke` : "Danke"} für deinen Kauf bei ${s}.`,
    mailYourOrder: "Deine Bestellung",
    mailDownload: "Herunterladen",
    mailInside: "Im Ordner",
    presaleNote: (d) => `📦 Vorverkauf · kommt innerhalb von ${d} Tagen per E-Mail`,
    presaleBadge: (d) => `Kommt in ${d} Tagen`,
    mailPaid: "Bezahlt",
    mailGuaranteeTitle: (d) => `${d} Tage Garantie`,
    mailGuaranteeBody: "Wenn es ein echtes Problem gibt (eine Datei lässt sich nicht öffnen oder der Inhalt entspricht nicht der Beschreibung), antworte auf diese E-Mail und erzähl uns, was passiert ist: Wir lösen es oder erstatten dir den Betrag. Es ist ein digitales PDF und es wird nichts verschickt: Ein erwartetes gedrucktes Buch oder eine Meinungsänderung nach dem Download sind kein Erstattungsgrund.",
    mailTip: "Tipp: Speichere den Ordner in deinem Google Drive, dann hast du ihn immer dabei, auch offline.",
    recSubject: (p) => `${p} liegt noch in deinem Warenkorb`,
    recPreheader: "Deine Bestellung wartet noch auf dich, zum gleichen Preis.",
    recHeadline: "Hast du etwas vergessen?",
    recBody: (p) => `Du hast den Kauf von ${p} begonnen, aber nicht abgeschlossen. Wir haben ihn für dich aufbewahrt, zum gleichen Preis.`,
    recCta: "Kauf abschließen",
    recFoot: "Wenn es ein Problem mit der Zahlung gab, antworte auf diese E-Mail und wir helfen dir.",
    ckSecure: "Sicherer Checkout",
    ckBuying: (n) => `${n} ${n === 1 ? "Person kauft" : "Personen kaufen"} gerade`,
    ckPersonal: "Deine Daten",
    ckEmail: "E-Mail",
    ckEmailHelp: "Hierhin schicken wir dir dein Material direkt nach dem Kauf",
    ckFirstName: "Vorname",
    ckLastName: "Nachname",
    ckPhone: "Telefon",
    ckPayMethod: "Zahlungsart",
    ckPay: (t) => `${t} bezahlen`,
    ckProcessing: "Wird verarbeitet…",
    ckAuthRequired: "Deine Bank möchte, dass du die Zahlung bestätigst. Tippe noch einmal auf „Bezahlen“ und bestätige die Prüfung in deiner Banking-App, oder nimm eine andere Karte.",
    ckPayNotDone: "Die Zahlung wurde nicht abgeschlossen. Versuch es noch einmal oder wähle eine andere Zahlungsart.",
    ckPayFormStuck: "Das Zahlungsformular konnte nicht geladen werden. Prüf deine Verbindung und versuch es erneut.",
    ckRetry: "Erneut versuchen",
    ckAddToOrder: "+ Zur Bestellung hinzufügen",
    ckAdded: "✓ Hinzugefügt",
    ckBumpsTitle: "ZU DEINER BESTELLUNG HINZUFÜGEN",
    ckExpires: (t) => `Angebot endet in ${t}`,
    ckSummary: "Bestellübersicht",
    ckIncludesFree: "GRATIS DABEI",
    ckFree: "GRATIS",
    ckTotal: "Gesamt",
    ckSave: (x) => `Du sparst ${x}`,
    ckSecurePay: "Sichere Zahlung",
    ckSoldBy: "Verkauft von",
    ckTerms: "AGB",
    ckPrivacy: "Datenschutzerklärung",
    ckRefunds: "Rückerstattung",
    ckStatement: (n) => `Auf deiner Abrechnung erscheint der Kauf als ${n}.`,
    ckOrPayOther: "oder anders bezahlen",
    ckSupport: "Support",
    ckAmountsIn: (c) => `Beträge in ${c}.`,
    ckSecureProcessed: "Zahlung sicher verarbeitet.",
  },
};

/**
 * Idioma de la página para un comprador, como hace la plataforma anterior:
 *   1. el idioma fijo del checkout, si tiene uno;
 *   2. el de su país (por IP): quien abre desde Italia lo ve en italiano;
 *   3. el del navegador, para los países sin idioma propio en la lista;
 *   4. el de la tienda.
 */
export function pickLocale(o: { fixed?: string | null; acceptLanguage?: string | null; country?: string | null; storeDefault?: string | null }): Locale {
  const ok = (l?: string | null): l is Locale => !!l && (LOCALES as readonly string[]).includes(l);
  if (ok(o.fixed)) return o.fixed;
  const cc = o.country?.toUpperCase();
  if (cc && COUNTRY_LOCALE[cc]) return COUNTRY_LOCALE[cc];
  const fromBrowser = browserLocale(o.acceptLanguage);
  if (fromBrowser) return fromBrowser;
  if (ok(o.storeDefault)) return o.storeDefault;
  return "en";
}

/** El primer idioma soportado de Accept-Language, o null si ninguno. */
export function browserLocale(header?: string | null): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    if (tag.startsWith("it")) return "it";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("de")) return "de";
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return null;
}

/** Formatea importes en la moneda y el idioma del comprador. */
export function money(amount: number, currency: string, locale: Locale) {
  // Dólares en español con formato latinoamericano ("US$ 27", no "27 US$"):
  // quien paga en USD en español es casi siempre de Latinoamérica.
  const tag = locale === "pt-BR" ? "pt-BR" : locale === "it" ? "it-IT" : locale === "fr" ? "fr-FR" : locale === "de" ? "de-DE"
    : locale === "es" ? (currency.toUpperCase() === "USD" ? "es-AR" : "es-ES") : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
