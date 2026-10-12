/**
 * Textos del catálogo público (el sitio que revisa Stripe) en en/it/fr/de/es.
 *
 * La estructura legal replica la que la plataforma anterior publicaba y Stripe aceptó:
 * Términos (12 secciones), Privacidad (8), Reembolsos/entrega/cancelación (7).
 * Todo dato del negocio llega por `LegalCtx`; si falta, la frase se omite.
 * Nunca se escribe acá un dato que no salga de la base.
 */

export const CATALOG_LANGS = ["en", "it", "fr", "de", "es"] as const;
export type CatalogLang = (typeof CATALOG_LANGS)[number];

/** Fecha de la última revisión de los textos legales (se muestra localizada). */
export const LAST_UPDATED = "2026-10-05";

export function isCatalogLang(v: unknown): v is CatalogLang {
  return typeof v === "string" && (CATALOG_LANGS as readonly string[]).includes(v);
}

/** Datos del negocio que usan los textos legales. */
export type LegalCtx = {
  /** display_name || name */
  brand: string;
  legalName: string | null;
  address: string | null;
  email: string;
  phone: string | null;
  /** business.reply_hours cuando es un número de horas. */
  replyHours: number | null;
  /** business.reply_hours cuando es texto libre (p. ej. "Mon–Fri 9–18 CET"). */
  replyText: string | null;
  days: number;
  statement: string | null;
  currency: string;
  refundUrl: string;
  /** La dirección legal está en EE. UU.: ley aplicable = EE. UU. (como el original). */
  usLaw: boolean;
};

export type SectionId =
  | "who" | "acceptance" | "products" | "prices" | "secure" | "refunds" | "promotions"
  | "eligibility" | "ip" | "results" | "law" | "contact"
  | "data" | "use" | "third" | "security" | "retention" | "rights"
  | "refundFull" | "beforeDispute" | "delivery";

type Section = { title: string; body: (c: LegalCtx) => string[] };

export type DocId = "terms" | "privacy" | "refund";

export const DOCS: Record<DocId, SectionId[]> = {
  terms: ["who", "acceptance", "products", "prices", "secure", "refunds", "promotions", "eligibility", "ip", "results", "law", "contact"],
  privacy: ["who", "data", "use", "third", "security", "retention", "rights", "contact"],
  refund: ["who", "refundFull", "beforeDispute", "delivery", "eligibility", "promotions", "contact"],
};

type Card = { title: string; body: string; link: string };

/** "Email: x" / "E-mail : x" (el francés lleva espacio insécable antes de los dos puntos). */
export const labelSep = (lang: CatalogLang) => (lang === "fr" ? "\u00a0: " : ": ");

export type CatalogUi = {
  nav: { home: string; terms: string; privacy: string; refund: string; contact: string };
  language: string;
  heroFallback: (days: number) => string;
  whoFor: string;
  operatedBy: string;
  productsCta: string;
  facts: { delivery: string; refund: (d: number) => string; stripe: string; support: string };
  productsTitle: string;
  productsIntro: string;
  currencyNote: string;
  labels: { product: string; addon: string; after: string; bonus: string };
  buyNow: string;
  viewAtCheckout: string;
  includedWith: (name: string) => string;
  oneTime: string;
  empty: string;
  deliveryTitle: string;
  deliveryEmail: string;
  deliveryDigital: string;
  supportTitle: string;
  supportIntro: string;
  email: string;
  phone: string;
  address: string;
  reply: (n: number) => string;
  replyText: (t: string) => string;
  writeEmail: string;
  contactTip: string;
  policiesTitle: string;
  policiesIntro: string;
  cards: { refund: Omit<Card, "body"> & { body: (d: number) => string }; delivery: Card; terms: Card; privacy: Card };
  secureTitle: string;
  secureHttps: string;
  secureStripe: string;
  secureCurrency: (cur: string) => string;
  statement: string;
  weAccept: string;
  rights: (year: number, name: string) => string;
  docs: { terms: string; privacy: string; refund: string; contact: string };
  refundIntro: string;
  contactIntro: string;
  lastUpdated: string;
  contents: string;
  metaHome: (brand: string) => string;
};

export type CatalogTexts = {
  /** Nombre del idioma en ese idioma. */
  langName: string;
  /** Locale para Intl (fechas y números). */
  intl: string;
  ui: CatalogUi;
  sections: Record<SectionId, Section>;
};

// ------------------------------------------------------------------ helpers

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Hay razón social distinta de la marca: "(a trade name of …)". */
const trade = (c: LegalCtx) => !!c.legalName && !same(c.legalName, c.brand);
/** Quién responde por los términos cuando no hay dirección en EE. UU. */
const entity = (c: LegalCtx) => c.legalName || c.brand;

// ----------------------------------------------------------------- english

const en: CatalogTexts = (() => {
  const reach = (c: LegalCtx) => (c.phone ? `${c.email} or ${c.phone}` : c.email);
  const hours = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;
  const reply = (c: LegalCtx) =>
    c.replyHours ? ` We reply within ${hours(c.replyHours)}.` : c.replyText ? ` Reply hours: ${c.replyText}.` : "";
  const deliveryLine =
    "Immediately after your payment is confirmed you receive an email with a secure link to download or access your purchase.";
  const statement = (c: LegalCtx, short = false) =>
    c.statement ? ` The charge appears on your ${short ? "" : "card "}statement as “${c.statement}”.` : "";
  const promotions = [
    "Discounts, crossed-out prices, countdown timers, optional add-ons (“add to your order”) and offers shown after payment are limited-time promotions. The price you pay is always the one displayed at checkout when you confirm, in the currency shown.",
    "Promotions cannot be combined unless stated otherwise, may end without notice and do not apply retroactively to earlier purchases. Included bonuses have no cash value and are not refunded separately.",
    "One-click offers after payment: right after your purchase we may show you a one-time offer. It is charged only if you click the button that accepts it (for example “Yes, add it to my order”), to the same payment method you just used and for the exact amount shown on that page. If you decline or leave the page, nothing is charged. Each accepted offer is a separate charge and you receive its own confirmation email with the download link.",
    "Abandoned-cart discount: if you enter your email at checkout and do not complete the purchase, we may send you one email with a discount (20% unless the email says otherwise) on the products of that cart, valid for the time stated in the email. It cannot be combined with other promotions.",
  ];
  const eligibility = [
    "You must be at least 18 years old and legally able to enter into a contract to make a purchase.",
    "We reserve the right to refuse or cancel an order where we suspect fraud, use of someone else’s payment method or a breach of these terms; in that case the amount charged is refunded.",
  ];

  return {
    langName: "English",
    intl: "en-US",
    ui: {
      nav: { home: "Home", terms: "Terms", privacy: "Privacy", refund: "Refund policy", contact: "Contact" },
      language: "Language",
      heroFallback: (d) =>
        `Digital products delivered instantly by email, with a ${d}-day refund window and secure payment by Stripe.`,
      whoFor: "Who it is for:",
      operatedBy: "Operated by",
      productsCta: "Products and prices ↓",
      facts: {
        delivery: "Instant digital delivery by email",
        refund: (d) => `${d}-day refund window`,
        stripe: "Secure payment with Stripe",
        support: "Support:",
      },
      productsTitle: "Products and prices",
      productsIntro:
        "Everything we sell, with the price you are charged at checkout. Prices are in the currency shown next to each item.",
      currencyNote:
        "Depending on your country, the checkout may present the amount in your local currency at the current exchange rate.",
      labels: { product: "Product", addon: "Optional add-on at checkout", after: "Offered after purchase", bonus: "Bonus included" },
      buyNow: "Buy now →",
      viewAtCheckout: "View at checkout →",
      includedWith: (n) => `Included at no extra cost with ${n}`,
      oneTime: "One-time payment · Digital product",
      empty: "Our catalog is being updated. Write to us for current products and prices.",
      deliveryTitle: "How delivery works",
      deliveryEmail: deliveryLine,
      deliveryDigital: "All products are digital. Nothing is shipped physically.",
      supportTitle: "Customer support",
      supportIntro: "Questions about a purchase, an access link or a refund? Write to us — a person answers.",
      email: "Email",
      phone: "Phone",
      address: "Business address",
      reply: (n) => `We reply within ${hours(n)}`,
      replyText: (t) => `Reply hours: ${t}`,
      writeEmail: "Write to us",
      contactTip:
        "When writing about an order, please use the email address you purchased with and include your order number.",
      policiesTitle: "Policies",
      policiesIntro: "Plain-language versions of the terms that apply to every purchase.",
      cards: {
        refund: { title: "Refund policy", body: (d) => `${d}-day refund window from the purchase date.`, link: "Refund, delivery and cancellation policy →" },
        delivery: { title: "Delivery policy", body: "All products are digital. Nothing is shipped physically.", link: "Delivery policy →" },
        terms: { title: "Terms", body: "The conditions that apply to every purchase.", link: "Terms and Conditions →" },
        privacy: { title: "Privacy", body: "How we collect, use and protect your data.", link: "Privacy Policy →" },
      },
      secureTitle: "Secure checkout",
      secureHttps: "Every page and every payment form is served over HTTPS.",
      secureStripe:
        "Card payments are processed by Stripe. We never see or store your full card number: your card data goes directly to the payment processor.",
      secureCurrency: (cur) =>
        `Prices are listed in ${cur}. Depending on your country, the checkout may present and charge the equivalent amount in your local currency at the current exchange rate.`,
      statement: "On your card statement this purchase appears as",
      weAccept: "We accept",
      rights: (y, n) => `© ${y} ${n}. All rights reserved.`,
      docs: {
        terms: "Terms and Conditions",
        privacy: "Privacy Policy",
        refund: "Refund, delivery and cancellation policy",
        contact: "Contact us",
      },
      refundIntro:
        "How refunds, delivery, cancellations and promotions work for every purchase made through our checkouts.",
      contactIntro: "Support for orders, access links, refunds and any question about our products.",
      lastUpdated: "Last updated:",
      contents: "Contents",
      metaHome: (b) => `${b}: products and prices, delivery, refund policy, terms, privacy and contact.`,
    },
    sections: {
      who: {
        title: "Who we are",
        body: (c) => [
          `This website and the sale of its products are operated by ${c.brand}${trade(c) ? ` (a trade name of ${c.legalName})` : ""}${c.address ? `, located at ${c.address}` : ""}. You can reach us at ${reach(c)}.`,
        ],
      },
      acceptance: {
        title: "Acceptance of these terms",
        body: () => [
          "By making a purchase on any of our checkouts you accept these Terms and Conditions, the Privacy Policy and the Refund, delivery and cancellation policy. We recommend reading them before confirming your order.",
        ],
      },
      products: {
        title: "Products and delivery",
        body: () => [
          "We sell digital products (such as ebooks and other downloadable content) with immediate access. Each product, its description and its price are listed on this website’s home page and on the corresponding checkout. No physical products are shipped.",
          deliveryLine,
        ],
      },
      prices: {
        title: "Prices and payment",
        body: (c) => [
          `Unless the checkout indicates a subscription, the listed price is a one-time payment with no recurring charges. Prices are shown in ${c.currency}; the checkout may present the amount in your local currency at the current exchange rate, and your bank may apply international transaction fees.`,
        ],
      },
      secure: {
        title: "Secure checkout",
        body: (c) => [
          `Payments are processed by Stripe over encrypted connections (HTTPS/TLS). Your card details go directly to the processor: we never see or store them. Prices are listed in ${c.currency}; depending on your country, the checkout may present and charge the equivalent amount in your local currency at the current exchange rate.${statement(c)}`,
        ],
      },
      refunds: {
        title: "Refunds and disputes",
        body: (c) => [
          `The full refund, delivery, cancellation and promotion terms are at ${c.refundUrl}. In short: a ${c.days}-day guarantee from purchase for genuine problems with the product, and if anything goes wrong please contact us before opening a dispute with your bank.`,
        ],
      },
      promotions: { title: "Promotions and limited-time offers", body: () => promotions },
      eligibility: { title: "Eligibility and restrictions", body: () => eligibility },
      ip: {
        title: "Intellectual property",
        body: () => [
          "All content is for personal, non-transferable use. Resale, copying, redistribution or sharing in whole or in part without the owner’s written authorization is prohibited.",
        ],
      },
      results: {
        title: "Results and educational nature",
        body: () => [
          "The content is for informational and educational purposes. Results depend on each person and are not a guarantee of income, performance or any specific outcome. It does not replace individual professional (medical, legal, financial) advice.",
        ],
      },
      law: {
        title: "Governing law",
        body: (c) => [
          `${c.usLaw ? "These terms are governed by the laws of the United States of America" : `These terms are governed by the laws of the country in which ${entity(c)} is established`}, without prejudice to any non-waivable consumer rights you have in your country of residence. We may update these terms; the current version is the one published on this site.`,
        ],
      },
      contact: {
        title: "Contact",
        body: (c) => [
          `Customer support: ${c.email}${c.phone ? ` · ${c.phone}` : ""}.${reply(c)}${c.address ? ` Address: ${c.address}.` : ""}`,
        ],
      },
      data: {
        title: "Data we collect",
        body: () => [
          "We collect the data you provide when purchasing: name, email, phone (if entered), country and the billing details required by the payment processor. We also log technical data about the visit (IP address, browser, pages viewed) for security and statistics.",
        ],
      },
      use: {
        title: "How we use your data",
        body: () => [
          "We use your data to process the purchase, deliver the product, provide support, issue receipts, prevent fraud and, if you agreed, send you communications about our products (you can unsubscribe at any time).",
        ],
      },
      third: {
        title: "Third parties",
        body: () => [
          "We share data only with the providers needed to operate: the payment processor (Stripe), our hosting and infrastructure providers, email delivery services and analytics/advertising tools. We do not sell your data.",
        ],
      },
      security: {
        title: "Security",
        body: () => [
          "Payments are processed on PCI DSS certified platforms; we do not store your card details. All communication is encrypted over HTTPS.",
        ],
      },
      retention: {
        title: "Retention",
        body: () => [
          "We keep purchase data for as long as the business relationship lasts and for the legal periods required for invoicing and fraud prevention; afterwards it is deleted or anonymized.",
        ],
      },
      rights: {
        title: "Your rights",
        body: (c) => [
          `You may request access to, correction, portability or deletion of your data, and object to marketing communications, by writing to ${c.email}. We respond within the applicable legal deadlines.`,
        ],
      },
      refundFull: {
        title: "Refunds and disputes",
        body: (c) => [
          `We offer a ${c.days}-day guarantee counted from the purchase date for genuine problems with the product: a file that does not open or is damaged, content that does not match what the sales page describes, a duplicate charge or a product that was never delivered. In those cases write to ${c.email} from the email used at checkout, quote your order number and tell us what happened: we fix it or refund you.`,
          "The guarantee does not cover reasons unrelated to the product itself. All our products are digital books in PDF format, delivered instantly, and nothing is shipped physically: we do not issue refunds for having expected a printed book, for not having read the product description before buying, or for a change of mind once the files have been delivered.",
          "Refunds are issued to the original payment method, usually within 5 to 10 business days depending on your bank or card issuer. After the guarantee period no refunds are issued, as these are digital products with immediate access.",
        ],
      },
      beforeDispute: {
        title: "Before opening a dispute",
        body: (c) => [
          `If you do not recognize a charge or something went wrong with your purchase, please contact us first at ${c.email}: ${c.replyHours ? `we reply within ${hours(c.replyHours)} and ` : "we "}can refund you directly without you having to open a dispute with your bank.${statement(c, true)}`,
        ],
      },
      delivery: {
        title: "Delivery policy",
        body: (c) => [
          deliveryLine,
          "All products are digital. Nothing is shipped physically.",
          `If you do not receive access within a few minutes of paying, check your spam or promotions folder and, if it is still missing, write to ${c.email} from the email used at checkout.`,
        ],
      },
    },
  };
})();

// ----------------------------------------------------------------- italiano

const it: CatalogTexts = (() => {
  const reach = (c: LegalCtx) => (c.phone ? `${c.email} o al numero ${c.phone}` : c.email);
  const hours = (n: number) => `${n} ${n === 1 ? "ora" : "ore"}`;
  const reply = (c: LegalCtx) =>
    c.replyHours ? ` Rispondiamo entro ${hours(c.replyHours)}.` : c.replyText ? ` Orari di risposta: ${c.replyText}.` : "";
  const deliveryLine =
    "Subito dopo la conferma del pagamento ricevi un’email con un link sicuro per scaricare il tuo acquisto o accedervi.";
  const statement = (c: LegalCtx, short = false) =>
    c.statement ? ` L’addebito compare sull’estratto conto${short ? "" : " della carta"} come «${c.statement}».` : "";
  const promotions = [
    "Sconti, prezzi barrati, timer con conto alla rovescia, prodotti aggiuntivi facoltativi («aggiungi al tuo ordine») e offerte mostrate dopo il pagamento sono promozioni a tempo limitato. Il prezzo che paghi è sempre quello mostrato nel checkout al momento della conferma, nella valuta indicata.",
    "Salvo diversa indicazione le promozioni non sono cumulabili, possono terminare senza preavviso e non si applicano retroattivamente agli acquisti precedenti. I bonus inclusi non hanno valore monetario e non vengono rimborsati separatamente.",
    "Offerte con un clic dopo il pagamento: subito dopo l’acquisto possiamo mostrarti un’offerta unica. Viene addebitata solo se clicchi il pulsante che la accetta (per esempio «Sì, aggiungila al mio ordine»), sullo stesso metodo di pagamento appena usato e per l’importo esatto indicato in quella pagina. Se la rifiuti o chiudi la pagina, non viene addebitato nulla. Ogni offerta accettata è un addebito separato e ricevi la sua email di conferma con il link per scaricarla.",
    "Sconto del carrello abbandonato: se inserisci la tua email nel checkout e non completi l’acquisto, possiamo inviarti una sola email con uno sconto (20%, salvo diversa indicazione nell’email) sui prodotti di quel carrello, valido per il tempo indicato nell’email. Non è cumulabile con altre promozioni.",
  ];
  const eligibility = [
    "Per effettuare un acquisto devi avere almeno 18 anni e la capacità legale di concludere un contratto.",
    "Ci riserviamo il diritto di rifiutare o annullare un ordine in caso di sospetta frode, di utilizzo di un metodo di pagamento altrui o di violazione dei presenti termini; in tal caso l’importo addebitato viene rimborsato.",
  ];

  return {
    langName: "Italiano",
    intl: "it-IT",
    ui: {
      nav: { home: "Home", terms: "Termini", privacy: "Privacy", refund: "Rimborsi", contact: "Contatti" },
      language: "Lingua",
      heroFallback: (d) =>
        `Prodotti digitali consegnati subito via email, con ${d} giorni per chiedere il rimborso e pagamento sicuro con Stripe.`,
      whoFor: "A chi si rivolge:",
      operatedBy: "Gestito da",
      productsCta: "Prodotti e prezzi ↓",
      facts: {
        delivery: "Consegna digitale immediata via email",
        refund: (d) => `${d} giorni per chiedere il rimborso`,
        stripe: "Pagamento sicuro con Stripe",
        support: "Assistenza:",
      },
      productsTitle: "Prodotti e prezzi",
      productsIntro:
        "Tutto ciò che vendiamo, con il prezzo che ti viene addebitato al checkout. I prezzi sono nella valuta indicata accanto a ogni articolo.",
      currencyNote:
        "A seconda del tuo paese, il checkout può mostrare l’importo nella tua valuta locale al tasso di cambio corrente.",
      labels: { product: "Prodotto", addon: "Aggiunta facoltativa al checkout", after: "Offerto dopo l’acquisto", bonus: "Bonus incluso" },
      buyNow: "Acquista ora →",
      viewAtCheckout: "Vedi nel checkout →",
      includedWith: (n) => `Incluso senza costi aggiuntivi con ${n}`,
      oneTime: "Pagamento unico · Prodotto digitale",
      empty: "Il catalogo è in aggiornamento. Scrivici per conoscere i prodotti e i prezzi attuali.",
      deliveryTitle: "Come funziona la consegna",
      deliveryEmail: deliveryLine,
      deliveryDigital: "Tutti i prodotti sono digitali. Non viene spedito nulla fisicamente.",
      supportTitle: "Assistenza clienti",
      supportIntro: "Domande su un acquisto, un link di accesso o un rimborso? Scrivici: ti risponde una persona.",
      email: "Email",
      phone: "Telefono",
      address: "Indirizzo",
      reply: (n) => `Rispondiamo entro ${hours(n)}`,
      replyText: (t) => `Orari di risposta: ${t}`,
      writeEmail: "Scrivici",
      contactTip:
        "Se ci scrivi per un ordine, usa l’indirizzo email con cui hai acquistato e indica il numero d’ordine.",
      policiesTitle: "Politiche",
      policiesIntro: "Le condizioni che si applicano a ogni acquisto, spiegate in modo semplice.",
      cards: {
        refund: { title: "Politica di rimborso", body: (d) => `${d} giorni dalla data di acquisto per chiedere il rimborso.`, link: "Politica di rimborso, consegna e cancellazione →" },
        delivery: { title: "Politica di consegna", body: "Tutti i prodotti sono digitali. Non viene spedito nulla fisicamente.", link: "Politica di consegna →" },
        terms: { title: "Termini", body: "Le condizioni che si applicano a ogni acquisto.", link: "Termini e condizioni →" },
        privacy: { title: "Privacy", body: "Come raccogliamo, utilizziamo e proteggiamo i tuoi dati.", link: "Informativa sulla privacy →" },
      },
      secureTitle: "Checkout sicuro",
      secureHttps: "Ogni pagina e ogni modulo di pagamento sono serviti tramite HTTPS.",
      secureStripe:
        "I pagamenti con carta sono elaborati da Stripe. Non vediamo né conserviamo mai il numero completo della tua carta: i dati vanno direttamente al processore di pagamento.",
      secureCurrency: (cur) =>
        `I prezzi sono indicati in ${cur}. A seconda del tuo paese, il checkout può mostrare e addebitare l’importo equivalente nella tua valuta locale al tasso di cambio corrente.`,
      statement: "Sull’estratto conto della carta questo acquisto compare come",
      weAccept: "Accettiamo",
      rights: (y, n) => `© ${y} ${n}. Tutti i diritti riservati.`,
      docs: {
        terms: "Termini e condizioni",
        privacy: "Informativa sulla privacy",
        refund: "Politica di rimborso, consegna e cancellazione",
        contact: "Contattaci",
      },
      refundIntro:
        "Come funzionano rimborsi, consegna, cancellazioni e promozioni per ogni acquisto effettuato tramite i nostri checkout.",
      contactIntro: "Assistenza per ordini, link di accesso, rimborsi e qualsiasi domanda sui nostri prodotti.",
      lastUpdated: "Ultimo aggiornamento:",
      contents: "Indice",
      metaHome: (b) => `${b}: prodotti e prezzi, consegna, politica di rimborso, termini, privacy e contatti.`,
    },
    sections: {
      who: {
        title: "Chi siamo",
        body: (c) => [
          `Questo sito e la vendita dei suoi prodotti sono gestiti da ${c.brand}${trade(c) ? ` (marchio commerciale di ${c.legalName})` : ""}${c.address ? `, con sede in ${c.address}` : ""}. Puoi contattarci all’indirizzo ${reach(c)}.`,
        ],
      },
      acceptance: {
        title: "Accettazione dei termini",
        body: () => [
          "Effettuando un acquisto su uno qualsiasi dei nostri checkout accetti i presenti Termini e condizioni, l’Informativa sulla privacy e la Politica di rimborso, consegna e cancellazione. Ti consigliamo di leggerli prima di confermare l’ordine.",
        ],
      },
      products: {
        title: "Prodotti e consegna",
        body: () => [
          "Vendiamo prodotti digitali (come ebook e altri contenuti scaricabili) con accesso immediato. Ogni prodotto, la sua descrizione e il suo prezzo sono indicati nella home page di questo sito e nel checkout corrispondente. Non spediamo prodotti fisici.",
          deliveryLine,
        ],
      },
      prices: {
        title: "Prezzi e pagamento",
        body: (c) => [
          `Salvo che il checkout indichi un abbonamento, il prezzo indicato è un pagamento unico, senza addebiti ricorrenti. I prezzi sono espressi in ${c.currency}; il checkout può mostrare l’importo nella tua valuta locale al tasso di cambio corrente e la tua banca può applicare commissioni sulle transazioni internazionali.`,
        ],
      },
      secure: {
        title: "Checkout sicuro",
        body: (c) => [
          `I pagamenti sono elaborati da Stripe tramite connessioni cifrate (HTTPS/TLS). I dati della tua carta vanno direttamente al processore di pagamento: non li vediamo né li conserviamo. I prezzi sono espressi in ${c.currency}; a seconda del tuo paese, il checkout può mostrare e addebitare l’importo equivalente nella tua valuta locale al tasso di cambio corrente.${statement(c)}`,
        ],
      },
      refunds: {
        title: "Rimborsi e contestazioni",
        body: (c) => [
          `Le condizioni complete su rimborsi, consegna, cancellazioni e promozioni sono disponibili su ${c.refundUrl}. In breve: garanzia di ${c.days} giorni dall’acquisto per problemi reali con il prodotto e, se qualcosa va storto, ti chiediamo di contattarci prima di aprire una contestazione con la tua banca.`,
        ],
      },
      promotions: { title: "Promozioni e offerte a tempo limitato", body: () => promotions },
      eligibility: { title: "Requisiti e limitazioni", body: () => eligibility },
      ip: {
        title: "Proprietà intellettuale",
        body: () => [
          "Tutti i contenuti sono destinati a un uso personale e non trasferibile. Sono vietati la rivendita, la copia, la ridistribuzione o la condivisione, totale o parziale, senza l’autorizzazione scritta del titolare.",
        ],
      },
      results: {
        title: "Risultati e natura educativa",
        body: () => [
          "I contenuti hanno finalità informative ed educative. I risultati dipendono da ciascuna persona e non costituiscono una garanzia di guadagno, rendimento o di alcun esito specifico. Non sostituiscono la consulenza professionale individuale (medica, legale o finanziaria).",
        ],
      },
      law: {
        title: "Legge applicabile",
        body: (c) => [
          `${c.usLaw ? "I presenti termini sono regolati dalle leggi degli Stati Uniti d’America" : `I presenti termini sono regolati dalle leggi del paese in cui ha sede ${entity(c)}`}, fatti salvi i diritti inderogabili che la normativa a tutela dei consumatori del tuo paese di residenza ti riconosce. Possiamo aggiornare questi termini; la versione in vigore è quella pubblicata su questo sito.`,
        ],
      },
      contact: {
        title: "Contatti",
        body: (c) => [
          `Assistenza clienti: ${c.email}${c.phone ? ` · ${c.phone}` : ""}.${reply(c)}${c.address ? ` Indirizzo: ${c.address}.` : ""}`,
        ],
      },
      data: {
        title: "Dati che raccogliamo",
        body: () => [
          "Raccogliamo i dati che fornisci al momento dell’acquisto: nome, email, telefono (se indicato), paese e i dati di fatturazione richiesti dal processore di pagamento. Registriamo inoltre dati tecnici sulla visita (indirizzo IP, browser, pagine visitate) a fini di sicurezza e statistici.",
        ],
      },
      use: {
        title: "Come utilizziamo i tuoi dati",
        body: () => [
          "Utilizziamo i tuoi dati per elaborare l’acquisto, consegnare il prodotto, fornire assistenza, emettere ricevute, prevenire le frodi e, se hai dato il consenso, inviarti comunicazioni sui nostri prodotti (puoi annullare l’iscrizione in qualsiasi momento).",
        ],
      },
      third: {
        title: "Terze parti",
        body: () => [
          "Condividiamo i dati solo con i fornitori necessari per operare: il processore di pagamento (Stripe), i nostri fornitori di hosting e infrastruttura, i servizi di invio email e gli strumenti di analisi e pubblicità. Non vendiamo i tuoi dati.",
        ],
      },
      security: {
        title: "Sicurezza",
        body: () => [
          "I pagamenti sono elaborati su piattaforme certificate PCI DSS; non conserviamo i dati della tua carta. Tutte le comunicazioni sono cifrate tramite HTTPS.",
        ],
      },
      retention: {
        title: "Conservazione",
        body: () => [
          "Conserviamo i dati di acquisto per la durata del rapporto commerciale e per i periodi previsti dalla legge per la fatturazione e la prevenzione delle frodi; successivamente vengono cancellati o resi anonimi.",
        ],
      },
      rights: {
        title: "I tuoi diritti",
        body: (c) => [
          `Puoi richiedere l’accesso, la rettifica, la portabilità o la cancellazione dei tuoi dati e opporti alle comunicazioni di marketing scrivendo a ${c.email}. Rispondiamo entro i termini previsti dalla legge applicabile.`,
        ],
      },
      refundFull: {
        title: "Rimborsi e contestazioni",
        body: (c) => [
          `Offriamo una garanzia di ${c.days} giorni dalla data di acquisto per problemi reali con il prodotto: un file che non si apre o è danneggiato, un contenuto che non corrisponde a quanto descritto nella pagina di vendita, un addebito doppio o un prodotto mai consegnato. In questi casi scrivi a ${c.email} dall’indirizzo email usato al checkout, indicando il numero d’ordine e spiegandoci cosa è successo: risolviamo il problema o ti rimborsiamo.`,
          "La garanzia non copre motivi estranei al prodotto. Tutti i nostri prodotti sono libri digitali in formato PDF, consegnati subito, e non viene spedito nulla: non effettuiamo rimborsi per aver pensato che fosse un libro stampato, per non aver letto la descrizione del prodotto prima dell’acquisto o per un ripensamento dopo la consegna dei file.",
          "I rimborsi vengono effettuati sul metodo di pagamento originale, di solito entro 5-10 giorni lavorativi a seconda della banca o dell’emittente della carta. Trascorso il periodo di garanzia non sono previsti rimborsi, trattandosi di prodotti digitali con accesso immediato.",
        ],
      },
      beforeDispute: {
        title: "Prima di aprire una contestazione",
        body: (c) => [
          `Se non riconosci un addebito o qualcosa è andato storto con il tuo acquisto, contattaci prima a ${c.email}: ${c.replyHours ? `rispondiamo entro ${hours(c.replyHours)} e ` : ""}possiamo rimborsarti direttamente, senza che tu debba aprire una contestazione con la tua banca.${statement(c, true)}`,
        ],
      },
      delivery: {
        title: "Politica di consegna",
        body: (c) => [
          deliveryLine,
          "Tutti i prodotti sono digitali. Non viene spedito nulla fisicamente.",
          `Se non ricevi l’accesso entro pochi minuti dal pagamento, controlla la cartella spam o promozioni e, se ancora non lo trovi, scrivi a ${c.email} dall’indirizzo email usato al checkout.`,
        ],
      },
    },
  };
})();

// ----------------------------------------------------------------- français

const frRaw: CatalogTexts = (() => {
  const reach = (c: LegalCtx) => (c.phone ? `${c.email} ou au ${c.phone}` : c.email);
  const hours = (n: number) => `${n} ${n === 1 ? "heure" : "heures"}`;
  const reply = (c: LegalCtx) =>
    c.replyHours ? ` Nous répondons sous ${hours(c.replyHours)}.` : c.replyText ? ` Horaires de réponse : ${c.replyText}.` : "";
  const deliveryLine =
    "Dès la confirmation de votre paiement, vous recevez un e-mail contenant un lien sécurisé pour télécharger votre achat ou y accéder.";
  const statement = (c: LegalCtx, short = false) =>
    c.statement ? ` Le prélèvement apparaît sur votre relevé${short ? "" : " bancaire"} sous le libellé « ${c.statement} ».` : "";
  const promotions = [
    "Les remises, prix barrés, comptes à rebours, produits complémentaires facultatifs (« ajouter à votre commande ») et offres présentées après le paiement sont des promotions à durée limitée. Le prix que vous payez est toujours celui affiché sur la page de paiement au moment de la confirmation, dans la devise indiquée.",
    "Sauf mention contraire, les promotions ne sont pas cumulables, peuvent prendre fin sans préavis et ne s’appliquent pas rétroactivement aux achats antérieurs. Les bonus inclus n’ont aucune valeur monétaire et ne sont pas remboursés séparément.",
    "Offres en un clic après le paiement : juste après votre achat, nous pouvons vous présenter une offre unique. Elle n’est débitée que si vous cliquez sur le bouton qui l’accepte (par exemple « Oui, l’ajouter à ma commande »), sur le même moyen de paiement que vous venez d’utiliser et pour le montant exact affiché sur cette page. Si vous la refusez ou quittez la page, rien n’est débité. Chaque offre acceptée est un débit séparé et vous recevez son propre e-mail de confirmation avec le lien de téléchargement.",
    "Remise sur panier abandonné : si vous saisissez votre e-mail au paiement sans finaliser l’achat, nous pouvons vous envoyer un seul e-mail avec une remise (20 %, sauf indication contraire dans l’e-mail) sur les produits de ce panier, valable pendant la durée indiquée dans l’e-mail. Elle n’est pas cumulable avec d’autres promotions.",
  ];
  const eligibility = [
    "Pour effectuer un achat, vous devez avoir au moins 18 ans et la capacité juridique de conclure un contrat.",
    "Nous nous réservons le droit de refuser ou d’annuler une commande en cas de suspicion de fraude, d’utilisation du moyen de paiement d’un tiers ou de violation des présentes conditions ; dans ce cas, le montant débité est remboursé.",
  ];

  return {
    langName: "Français",
    intl: "fr-FR",
    ui: {
      nav: { home: "Accueil", terms: "Conditions", privacy: "Confidentialité", refund: "Remboursements", contact: "Contact" },
      language: "Langue",
      heroFallback: (d) =>
        `Des produits numériques livrés immédiatement par e-mail, avec ${d} jours pour demander un remboursement et un paiement sécurisé par Stripe.`,
      whoFor: "Pour qui :",
      operatedBy: "Exploité par",
      productsCta: "Produits et prix ↓",
      facts: {
        delivery: "Livraison numérique immédiate par e-mail",
        refund: (d) => `${d} jours pour demander un remboursement`,
        stripe: "Paiement sécurisé par Stripe",
        support: "Support :",
      },
      productsTitle: "Produits et prix",
      productsIntro:
        "Tout ce que nous vendons, avec le prix qui vous est facturé lors du paiement. Les prix sont exprimés dans la devise indiquée à côté de chaque article.",
      currencyNote:
        "Selon votre pays, la page de paiement peut afficher le montant dans votre devise locale au taux de change en vigueur.",
      labels: { product: "Produit", addon: "Option facultative au paiement", after: "Proposé après l’achat", bonus: "Bonus inclus" },
      buyNow: "Acheter →",
      viewAtCheckout: "Voir sur la page de paiement →",
      includedWith: (n) => `Inclus sans frais supplémentaires avec ${n}`,
      oneTime: "Paiement unique · Produit numérique",
      empty: "Notre catalogue est en cours de mise à jour. Écrivez-nous pour connaître les produits et prix actuels.",
      deliveryTitle: "Comment se passe la livraison",
      deliveryEmail: deliveryLine,
      deliveryDigital: "Tous les produits sont numériques. Aucun envoi physique n’est effectué.",
      supportTitle: "Service client",
      supportIntro:
        "Une question sur un achat, un lien d’accès ou un remboursement ? Écrivez-nous : une vraie personne vous répond.",
      email: "E-mail",
      phone: "Téléphone",
      address: "Adresse",
      reply: (n) => `Nous répondons sous ${hours(n)}`,
      replyText: (t) => `Horaires de réponse : ${t}`,
      writeEmail: "Nous écrire",
      contactTip:
        "Pour toute question sur une commande, écrivez-nous depuis l’adresse e-mail utilisée lors de l’achat et indiquez votre numéro de commande.",
      policiesTitle: "Politiques",
      policiesIntro: "Les conditions applicables à chaque achat, en langage clair.",
      cards: {
        refund: { title: "Politique de remboursement", body: (d) => `${d} jours à compter de la date d’achat pour demander un remboursement.`, link: "Politique de remboursement, de livraison et d’annulation →" },
        delivery: { title: "Politique de livraison", body: "Tous les produits sont numériques. Aucun envoi physique n’est effectué.", link: "Politique de livraison →" },
        terms: { title: "Conditions", body: "Les conditions applicables à chaque achat.", link: "Conditions générales de vente →" },
        privacy: { title: "Confidentialité", body: "Comment nous collectons, utilisons et protégeons vos données.", link: "Politique de confidentialité →" },
      },
      secureTitle: "Paiement sécurisé",
      secureHttps: "Chaque page et chaque formulaire de paiement sont servis en HTTPS.",
      secureStripe:
        "Les paiements par carte sont traités par Stripe. Nous ne voyons ni ne conservons jamais le numéro complet de votre carte : vos données bancaires sont transmises directement au prestataire de paiement.",
      secureCurrency: (cur) =>
        `Les prix sont indiqués en ${cur}. Selon votre pays, la page de paiement peut afficher et débiter le montant équivalent dans votre devise locale au taux de change en vigueur.`,
      statement: "Sur votre relevé bancaire, cet achat apparaît sous le libellé",
      weAccept: "Moyens de paiement acceptés",
      rights: (y, n) => `© ${y} ${n}. Tous droits réservés.`,
      docs: {
        terms: "Conditions générales de vente",
        privacy: "Politique de confidentialité",
        refund: "Politique de remboursement, de livraison et d’annulation",
        contact: "Nous contacter",
      },
      refundIntro:
        "Comment fonctionnent les remboursements, la livraison, les annulations et les promotions pour tout achat effectué via nos pages de paiement.",
      contactIntro: "Assistance pour les commandes, les liens d’accès, les remboursements et toute question sur nos produits.",
      lastUpdated: "Dernière mise à jour :",
      contents: "Sommaire",
      metaHome: (b) => `${b} : produits et prix, livraison, politique de remboursement, conditions, confidentialité et contact.`,
    },
    sections: {
      who: {
        title: "Qui sommes-nous",
        body: (c) => [
          `Ce site et la vente de ses produits sont exploités par ${c.brand}${trade(c) ? ` (nom commercial de ${c.legalName})` : ""}${c.address ? `, dont l’adresse est ${c.address}` : ""}. Vous pouvez nous contacter à l’adresse ${reach(c)}.`,
        ],
      },
      acceptance: {
        title: "Acceptation des conditions",
        body: () => [
          "En effectuant un achat sur l’une de nos pages de paiement, vous acceptez les présentes Conditions générales de vente, la Politique de confidentialité et la Politique de remboursement, de livraison et d’annulation. Nous vous recommandons de les lire avant de confirmer votre commande.",
        ],
      },
      products: {
        title: "Produits et livraison",
        body: () => [
          "Nous vendons des produits numériques (tels que des livres électroniques et d’autres contenus téléchargeables) avec un accès immédiat. Chaque produit, sa description et son prix figurent sur la page d’accueil de ce site et sur la page de paiement correspondante. Aucun produit physique n’est expédié.",
          deliveryLine,
        ],
      },
      prices: {
        title: "Prix et paiement",
        body: (c) => [
          `Sauf si la page de paiement indique un abonnement, le prix affiché correspond à un paiement unique, sans prélèvement récurrent. Les prix sont indiqués en ${c.currency} ; la page de paiement peut afficher le montant dans votre devise locale au taux de change en vigueur, et votre banque peut appliquer des frais sur les transactions internationales.`,
        ],
      },
      secure: {
        title: "Paiement sécurisé",
        body: (c) => [
          `Les paiements sont traités par Stripe via des connexions chiffrées (HTTPS/TLS). Les données de votre carte sont transmises directement au prestataire de paiement : nous ne les voyons ni ne les conservons jamais. Les prix sont indiqués en ${c.currency} ; selon votre pays, la page de paiement peut afficher et débiter le montant équivalent dans votre devise locale au taux de change en vigueur.${statement(c)}`,
        ],
      },
      refunds: {
        title: "Remboursements et litiges",
        body: (c) => [
          `Les conditions complètes de remboursement, de livraison, d’annulation et de promotion sont disponibles à l’adresse ${c.refundUrl}. En résumé : une garantie de ${c.days} jours à compter de l’achat pour les problèmes réels liés au produit et, en cas de problème, merci de nous contacter avant d’ouvrir une contestation auprès de votre banque.`,
        ],
      },
      promotions: { title: "Promotions et offres à durée limitée", body: () => promotions },
      eligibility: { title: "Conditions d’achat et restrictions", body: () => eligibility },
      ip: {
        title: "Propriété intellectuelle",
        body: () => [
          "Tous les contenus sont destinés à un usage personnel et non cessible. Toute revente, copie, redistribution ou tout partage, total ou partiel, sans l’autorisation écrite du titulaire des droits est interdit.",
        ],
      },
      results: {
        title: "Résultats et caractère pédagogique",
        body: () => [
          "Les contenus ont une finalité informative et pédagogique. Les résultats dépendent de chaque personne et ne constituent pas une garantie de revenus, de performance ou d’un résultat particulier. Ils ne remplacent pas un conseil professionnel individuel (médical, juridique ou financier).",
        ],
      },
      law: {
        title: "Droit applicable",
        body: (c) => [
          `${c.usLaw ? "Les présentes conditions sont régies par les lois des États-Unis d’Amérique" : `Les présentes conditions sont régies par les lois du pays d’établissement de ${entity(c)}`}, sans préjudice des droits impératifs dont vous bénéficiez en tant que consommateur dans votre pays de résidence. Nous pouvons mettre à jour ces conditions ; la version en vigueur est celle publiée sur ce site.`,
        ],
      },
      contact: {
        title: "Contact",
        body: (c) => [
          `Service client : ${c.email}${c.phone ? ` · ${c.phone}` : ""}.${reply(c)}${c.address ? ` Adresse : ${c.address}.` : ""}`,
        ],
      },
      data: {
        title: "Données collectées",
        body: () => [
          "Nous collectons les données que vous fournissez lors de l’achat : nom, adresse e-mail, téléphone (s’il est renseigné), pays et les informations de facturation exigées par le prestataire de paiement. Nous enregistrons également des données techniques sur la visite (adresse IP, navigateur, pages consultées) à des fins de sécurité et de statistiques.",
        ],
      },
      use: {
        title: "Utilisation de vos données",
        body: () => [
          "Nous utilisons vos données pour traiter l’achat, livrer le produit, assurer le support, émettre les reçus, prévenir la fraude et, si vous y avez consenti, vous envoyer des communications sur nos produits (vous pouvez vous désinscrire à tout moment).",
        ],
      },
      third: {
        title: "Tiers",
        body: () => [
          "Nous ne partageons les données qu’avec les prestataires nécessaires à notre activité : le prestataire de paiement (Stripe), nos fournisseurs d’hébergement et d’infrastructure, les services d’envoi d’e-mails et les outils d’analyse et de publicité. Nous ne vendons pas vos données.",
        ],
      },
      security: {
        title: "Sécurité",
        body: () => [
          "Les paiements sont traités sur des plateformes certifiées PCI DSS ; nous ne conservons pas les données de votre carte. Toutes les communications sont chiffrées via HTTPS.",
        ],
      },
      retention: {
        title: "Conservation",
        body: () => [
          "Nous conservons les données d’achat pendant toute la durée de la relation commerciale et pendant les délais légaux applicables à la facturation et à la prévention de la fraude ; elles sont ensuite supprimées ou anonymisées.",
        ],
      },
      rights: {
        title: "Vos droits",
        body: (c) => [
          `Vous pouvez demander l’accès à vos données, leur rectification, leur portabilité ou leur suppression, et vous opposer aux communications marketing, en écrivant à ${c.email}. Nous répondons dans les délais légaux applicables.`,
        ],
      },
      refundFull: {
        title: "Remboursements et litiges",
        body: (c) => [
          `Nous offrons une garantie de ${c.days} jours à compter de la date d’achat pour les problèmes réels liés au produit : un fichier qui ne s’ouvre pas ou est endommagé, un contenu qui ne correspond pas à la description de la page de vente, un double prélèvement ou un produit jamais livré. Dans ces cas, écrivez à ${c.email} depuis l’adresse e-mail utilisée lors du paiement, en indiquant votre numéro de commande et ce qui s’est passé : nous réglons le problème ou nous vous remboursons.`,
          "La garantie ne couvre pas les motifs étrangers au produit. Tous nos produits sont des livres numériques au format PDF, livrés immédiatement, et rien n’est expédié : nous ne remboursons pas parce que vous attendiez un livre imprimé, parce que vous n’avez pas lu la description du produit avant l’achat, ni pour un changement d’avis une fois les fichiers livrés.",
          "Les remboursements sont effectués sur le moyen de paiement d’origine, généralement sous 5 à 10 jours ouvrés selon votre banque ou l’émetteur de votre carte. Passé le délai de garantie, aucun remboursement n’est accordé, s’agissant de produits numériques à accès immédiat.",
        ],
      },
      beforeDispute: {
        title: "Avant d’ouvrir une contestation",
        body: (c) => [
          `Si vous ne reconnaissez pas un prélèvement ou si un problème est survenu lors de votre achat, contactez-nous d’abord à ${c.email} : ${c.replyHours ? `nous répondons sous ${hours(c.replyHours)} et ` : "nous "}pouvons vous rembourser directement, sans que vous ayez à ouvrir une contestation auprès de votre banque.${statement(c, true)}`,
        ],
      },
      delivery: {
        title: "Politique de livraison",
        body: (c) => [
          deliveryLine,
          "Tous les produits sont numériques. Aucun envoi physique n’est effectué.",
          `Si vous ne recevez pas l’accès dans les minutes qui suivent le paiement, vérifiez votre dossier spam ou promotions et, s’il reste introuvable, écrivez à ${c.email} depuis l’adresse e-mail utilisée lors du paiement.`,
        ],
      },
    },
  };
})();

/** Espace insécable avant « : ; ! ? », dans les guillemets et dans « e-mail ». */
function frTypo(s: string): string {
  return s
    .replace(/ ([:;!?»])/g, "\u00a0$1")
    .replace(/« /g, "«\u00a0")
    .replace(/\be-mail/g, "e\u2011mail"); // «e-mail» sin corte de línea en el guion
}
function deepTypo<T>(v: T): T {
  if (typeof v === "string") return frTypo(v) as T;
  if (typeof v === "function")
    return ((...a: unknown[]) => deepTypo((v as (...x: unknown[]) => unknown)(...a))) as T;
  if (Array.isArray(v)) return v.map(deepTypo) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepTypo(x)])) as T;
  return v;
}
const fr = deepTypo(frRaw);

// ------------------------------------------------------------------ deutsch

const de: CatalogTexts = (() => {
  const reach = (c: LegalCtx) => (c.phone ? `${c.email} oder telefonisch unter ${c.phone}` : c.email);
  const hours = (n: number) => `${n} ${n === 1 ? "Stunde" : "Stunden"}`;
  const reply = (c: LegalCtx) =>
    c.replyHours ? ` Wir antworten innerhalb von ${hours(c.replyHours)}.` : c.replyText ? ` Antwortzeiten: ${c.replyText}.` : "";
  const deliveryLine =
    "Unmittelbar nach Bestätigung Ihrer Zahlung erhalten Sie eine E-Mail mit einem sicheren Link, über den Sie Ihren Kauf herunterladen oder darauf zugreifen können.";
  const statement = (c: LegalCtx, short = false) =>
    c.statement ? ` Die Abbuchung erscheint auf Ihrer ${short ? "Abrechnung" : "Kartenabrechnung"} als „${c.statement}“.` : "";
  const promotions = [
    "Rabatte, durchgestrichene Preise, Countdown-Timer, optionale Zusatzprodukte („zur Bestellung hinzufügen“) und nach der Zahlung angezeigte Angebote sind zeitlich begrenzte Aktionen. Sie zahlen immer den Preis, der im Checkout zum Zeitpunkt Ihrer Bestätigung in der angegebenen Währung angezeigt wird.",
    "Sofern nicht anders angegeben, sind Aktionen nicht miteinander kombinierbar, können ohne Vorankündigung enden und gelten nicht rückwirkend für frühere Käufe. Enthaltene Boni haben keinen Geldwert und werden nicht separat erstattet.",
    "Angebote mit einem Klick nach der Zahlung: Direkt nach Ihrem Kauf können wir Ihnen ein einmaliges Angebot zeigen. Es wird nur berechnet, wenn Sie auf die Schaltfläche klicken, mit der Sie es annehmen (zum Beispiel „Ja, zu meiner Bestellung hinzufügen“), über dieselbe Zahlungsmethode, die Sie gerade verwendet haben, und in genau der auf dieser Seite angezeigten Höhe. Wenn Sie ablehnen oder die Seite verlassen, wird nichts berechnet. Jedes angenommene Angebot ist eine eigene Belastung, und Sie erhalten dafür eine eigene Bestätigungs-E-Mail mit dem Download-Link.",
    "Rabatt für abgebrochene Bestellungen: Wenn Sie an der Kasse Ihre E-Mail-Adresse eingeben und den Kauf nicht abschließen, können wir Ihnen eine einzige E-Mail mit einem Rabatt auf die Produkte dieses Warenkorbs senden, gültig für den in der E-Mail genannten Zeitraum. Er ist nicht mit anderen Aktionen kombinierbar.",
  ];
  const eligibility = [
    "Für einen Kauf müssen Sie mindestens 18 Jahre alt und voll geschäftsfähig sein.",
    "Wir behalten uns das Recht vor, eine Bestellung abzulehnen oder zu stornieren, wenn der Verdacht auf Betrug, auf die Nutzung eines fremden Zahlungsmittels oder auf einen Verstoß gegen diese Bedingungen besteht; in diesem Fall wird der belastete Betrag erstattet.",
  ];

  return {
    langName: "Deutsch",
    intl: "de-DE",
    ui: {
      nav: { home: "Start", terms: "AGB", privacy: "Datenschutz", refund: "Rückerstattung", contact: "Kontakt" },
      language: "Sprache",
      heroFallback: (d) =>
        `Digitale Produkte, sofort per E-Mail geliefert, mit ${d} Tagen Rückerstattungsfrist und sicherer Zahlung über Stripe.`,
      whoFor: "Für wen:",
      operatedBy: "Betrieben von",
      productsCta: "Produkte und Preise ↓",
      facts: {
        delivery: "Sofortige digitale Lieferung per E-Mail",
        refund: (d) => `${d} Tage Rückerstattungsfrist`,
        stripe: "Sichere Zahlung über Stripe",
        support: "Support:",
      },
      productsTitle: "Produkte und Preise",
      productsIntro:
        "Alles, was wir verkaufen, mit dem Preis, der Ihnen im Checkout berechnet wird. Die Preise gelten in der neben dem jeweiligen Artikel angegebenen Währung.",
      currencyNote:
        "Je nach Land kann der Checkout den Betrag zum aktuellen Wechselkurs in Ihrer Landeswährung anzeigen.",
      labels: { product: "Produkt", addon: "Optionale Ergänzung im Checkout", after: "Angebot nach dem Kauf", bonus: "Inklusive Bonus" },
      buyNow: "Jetzt kaufen →",
      viewAtCheckout: "Im Checkout ansehen →",
      includedWith: (n) => `Ohne Aufpreis enthalten bei ${n}`,
      oneTime: "Einmalzahlung · Digitales Produkt",
      empty: "Unser Katalog wird gerade aktualisiert. Schreiben Sie uns für aktuelle Produkte und Preise.",
      deliveryTitle: "So funktioniert die Lieferung",
      deliveryEmail: deliveryLine,
      deliveryDigital: "Alle Produkte sind digital. Es wird nichts physisch versandt.",
      supportTitle: "Kundenservice",
      supportIntro:
        "Fragen zu einem Kauf, einem Zugangslink oder einer Rückerstattung? Schreiben Sie uns – Ihnen antwortet ein Mensch.",
      email: "E-Mail",
      phone: "Telefon",
      address: "Geschäftsadresse",
      reply: (n) => `Wir antworten innerhalb von ${hours(n)}`,
      replyText: (t) => `Antwortzeiten: ${t}`,
      writeEmail: "Schreiben Sie uns",
      contactTip:
        "Wenn Sie uns zu einer Bestellung schreiben, verwenden Sie bitte die E-Mail-Adresse, mit der Sie gekauft haben, und geben Sie Ihre Bestellnummer an.",
      policiesTitle: "Richtlinien",
      policiesIntro: "Die Bedingungen, die für jeden Kauf gelten, in verständlicher Sprache.",
      cards: {
        refund: { title: "Rückerstattung", body: (d) => `${d} Tage ab Kaufdatum, um eine Rückerstattung zu beantragen.`, link: "Richtlinie zu Rückerstattung, Lieferung und Stornierung →" },
        delivery: { title: "Lieferung", body: "Alle Produkte sind digital. Es wird nichts physisch versandt.", link: "Lieferbedingungen →" },
        terms: { title: "AGB", body: "Die Bedingungen, die für jeden Kauf gelten.", link: "Allgemeine Geschäftsbedingungen →" },
        privacy: { title: "Datenschutz", body: "Wie wir Ihre Daten erheben, verwenden und schützen.", link: "Datenschutzerklärung →" },
      },
      secureTitle: "Sicherer Checkout",
      secureHttps: "Jede Seite und jedes Zahlungsformular wird über HTTPS ausgeliefert.",
      secureStripe:
        "Kartenzahlungen werden von Stripe abgewickelt. Wir sehen oder speichern niemals Ihre vollständige Kartennummer: Ihre Kartendaten gehen direkt an den Zahlungsdienstleister.",
      secureCurrency: (cur) =>
        `Die Preise werden in ${cur} angegeben. Je nach Land kann der Checkout den entsprechenden Betrag zum aktuellen Wechselkurs in Ihrer Landeswährung anzeigen und belasten.`,
      statement: "Auf Ihrer Kartenabrechnung erscheint dieser Kauf als",
      weAccept: "Wir akzeptieren",
      rights: (y, n) => `© ${y} ${n}. Alle Rechte vorbehalten.`,
      docs: {
        terms: "Allgemeine Geschäftsbedingungen",
        privacy: "Datenschutzerklärung",
        refund: "Richtlinie zu Rückerstattung, Lieferung und Stornierung",
        contact: "Kontakt",
      },
      refundIntro:
        "Wie Rückerstattungen, Lieferung, Stornierungen und Aktionen bei jedem Kauf über unsere Checkouts funktionieren.",
      contactIntro: "Hilfe zu Bestellungen, Zugangslinks, Rückerstattungen und allen Fragen zu unseren Produkten.",
      lastUpdated: "Zuletzt aktualisiert:",
      contents: "Inhalt",
      metaHome: (b) => `${b}: Produkte und Preise, Lieferung, Rückerstattung, AGB, Datenschutz und Kontakt.`,
    },
    sections: {
      who: {
        title: "Wer wir sind",
        body: (c) => [
          `Diese Website und der Verkauf der angebotenen Produkte werden von ${c.brand}${trade(c) ? ` (ein Handelsname von ${c.legalName})` : ""} betrieben${c.address ? `, Anschrift: ${c.address}` : ""}. Sie erreichen uns unter ${reach(c)}.`,
        ],
      },
      acceptance: {
        title: "Annahme dieser Bedingungen",
        body: () => [
          "Mit einem Kauf über einen unserer Checkouts akzeptieren Sie diese Allgemeinen Geschäftsbedingungen, die Datenschutzerklärung sowie die Richtlinie zu Rückerstattung, Lieferung und Stornierung. Wir empfehlen Ihnen, diese vor der Bestätigung Ihrer Bestellung zu lesen.",
        ],
      },
      products: {
        title: "Produkte und Lieferung",
        body: () => [
          "Wir verkaufen digitale Produkte (zum Beispiel E-Books und andere herunterladbare Inhalte) mit sofortigem Zugang. Jedes Produkt, seine Beschreibung und sein Preis sind auf der Startseite dieser Website und im jeweiligen Checkout aufgeführt. Es werden keine physischen Produkte versandt.",
          deliveryLine,
        ],
      },
      prices: {
        title: "Preise und Zahlung",
        body: (c) => [
          `Sofern im Checkout kein Abonnement angegeben ist, handelt es sich beim angegebenen Preis um eine Einmalzahlung ohne wiederkehrende Belastungen. Die Preise werden in ${c.currency} angegeben; der Checkout kann den Betrag zum aktuellen Wechselkurs in Ihrer Landeswährung anzeigen, und Ihre Bank kann Gebühren für internationale Transaktionen berechnen.`,
        ],
      },
      secure: {
        title: "Sicherer Checkout",
        body: (c) => [
          `Zahlungen werden von Stripe über verschlüsselte Verbindungen (HTTPS/TLS) abgewickelt. Ihre Kartendaten gehen direkt an den Zahlungsdienstleister: Wir sehen und speichern sie nie. Die Preise werden in ${c.currency} angegeben; je nach Land kann der Checkout den entsprechenden Betrag zum aktuellen Wechselkurs in Ihrer Landeswährung anzeigen und belasten.${statement(c)}`,
        ],
      },
      refunds: {
        title: "Rückerstattungen und Rückbuchungen",
        body: (c) => [
          `Die vollständigen Bedingungen zu Rückerstattung, Lieferung, Stornierung und Aktionen finden Sie unter ${c.refundUrl}. Kurz gesagt: ${c.days} Tage Garantie ab Kauf bei echten Problemen mit dem Produkt, und falls etwas schiefgeht, kontaktieren Sie uns bitte, bevor Sie bei Ihrer Bank eine Rückbuchung beantragen.`,
        ],
      },
      promotions: { title: "Aktionen und zeitlich begrenzte Angebote", body: () => promotions },
      eligibility: { title: "Voraussetzungen und Einschränkungen", body: () => eligibility },
      ip: {
        title: "Geistiges Eigentum",
        body: () => [
          "Alle Inhalte sind ausschließlich für den persönlichen, nicht übertragbaren Gebrauch bestimmt. Weiterverkauf, Vervielfältigung, Weiterverbreitung oder Weitergabe – ganz oder teilweise – ohne schriftliche Genehmigung des Rechteinhabers sind untersagt.",
        ],
      },
      results: {
        title: "Ergebnisse und Bildungscharakter",
        body: () => [
          "Die Inhalte dienen Informations- und Bildungszwecken. Ergebnisse hängen von der einzelnen Person ab und stellen keine Garantie für Einkommen, Leistung oder ein bestimmtes Ergebnis dar. Sie ersetzen keine individuelle fachliche (medizinische, rechtliche oder finanzielle) Beratung.",
        ],
      },
      law: {
        title: "Anwendbares Recht",
        body: (c) => [
          `${c.usLaw ? "Diese Bedingungen unterliegen dem Recht der Vereinigten Staaten von Amerika" : `Diese Bedingungen unterliegen dem Recht des Landes, in dem ${entity(c)} niedergelassen ist`}, unbeschadet zwingender Verbraucherschutzrechte, die Ihnen in Ihrem Wohnsitzland zustehen. Wir können diese Bedingungen aktualisieren; maßgeblich ist die auf dieser Website veröffentlichte Fassung.`,
        ],
      },
      contact: {
        title: "Kontakt",
        body: (c) => [
          `Kundenservice: ${c.email}${c.phone ? ` · ${c.phone}` : ""}.${reply(c)}${c.address ? ` Anschrift: ${c.address}.` : ""}`,
        ],
      },
      data: {
        title: "Welche Daten wir erheben",
        body: () => [
          "Wir erheben die Daten, die Sie beim Kauf angeben: Name, E-Mail-Adresse, Telefonnummer (falls angegeben), Land sowie die vom Zahlungsdienstleister benötigten Rechnungsdaten. Außerdem erfassen wir technische Daten zu Ihrem Besuch (IP-Adresse, Browser, aufgerufene Seiten) zu Sicherheits- und Statistikzwecken.",
        ],
      },
      use: {
        title: "Wie wir Ihre Daten verwenden",
        body: () => [
          "Wir verwenden Ihre Daten, um den Kauf abzuwickeln, das Produkt bereitzustellen, Support zu leisten, Belege auszustellen, Betrug vorzubeugen und – sofern Sie eingewilligt haben – Ihnen Informationen zu unseren Produkten zu senden (Sie können sich jederzeit abmelden).",
        ],
      },
      third: {
        title: "Dritte",
        body: () => [
          "Wir geben Daten nur an die für den Betrieb erforderlichen Dienstleister weiter: den Zahlungsdienstleister (Stripe), unsere Hosting- und Infrastrukturanbieter, E-Mail-Versanddienste sowie Analyse- und Werbetools. Wir verkaufen Ihre Daten nicht.",
        ],
      },
      security: {
        title: "Sicherheit",
        body: () => [
          "Zahlungen werden über PCI-DSS-zertifizierte Plattformen abgewickelt; wir speichern Ihre Kartendaten nicht. Die gesamte Kommunikation ist per HTTPS verschlüsselt.",
        ],
      },
      retention: {
        title: "Aufbewahrung",
        body: () => [
          "Wir bewahren Kaufdaten für die Dauer der Geschäftsbeziehung sowie für die gesetzlich vorgeschriebenen Fristen zur Rechnungsstellung und Betrugsprävention auf; danach werden sie gelöscht oder anonymisiert.",
        ],
      },
      rights: {
        title: "Ihre Rechte",
        body: (c) => [
          `Sie können Auskunft über Ihre Daten sowie deren Berichtigung, Übertragung oder Löschung verlangen und Marketingmitteilungen widersprechen, indem Sie an ${c.email} schreiben. Wir antworten innerhalb der geltenden gesetzlichen Fristen.`,
        ],
      },
      refundFull: {
        title: "Rückerstattungen und Rückbuchungen",
        body: (c) => [
          `Wir bieten ab Kaufdatum ${c.days} Tage Garantie bei echten Problemen mit dem Produkt: eine Datei, die sich nicht öffnen lässt oder beschädigt ist, ein Inhalt, der nicht der Beschreibung auf der Verkaufsseite entspricht, eine doppelte Abbuchung oder ein nie geliefertes Produkt. Schreiben Sie in diesen Fällen von der beim Checkout verwendeten E-Mail-Adresse an ${c.email}, nennen Sie Ihre Bestellnummer und schildern Sie, was passiert ist: Wir beheben das Problem oder erstatten Ihnen den Betrag.`,
          "Die Garantie gilt nicht für Gründe, die nichts mit dem Produkt selbst zu tun haben. Alle unsere Produkte sind digitale Bücher im PDF-Format, die sofort geliefert werden; es wird nichts verschickt. Wir erstatten nicht, weil ein gedrucktes Buch erwartet wurde, weil die Produktbeschreibung vor dem Kauf nicht gelesen wurde, oder bei einer Meinungsänderung nach der Lieferung der Dateien.",
          "Erstattungen erfolgen auf das ursprüngliche Zahlungsmittel, in der Regel innerhalb von 5 bis 10 Werktagen, je nach Bank oder Kartenaussteller. Nach Ablauf der Garantiezeit erfolgen keine Erstattungen, da es sich um digitale Produkte mit sofortigem Zugang handelt.",
        ],
      },
      beforeDispute: {
        title: "Bevor Sie eine Rückbuchung beantragen",
        body: (c) => [
          `Wenn Sie eine Abbuchung nicht zuordnen können oder bei Ihrem Kauf etwas schiefgelaufen ist, kontaktieren Sie uns bitte zuerst unter ${c.email}: ${c.replyHours ? `Wir antworten innerhalb von ${hours(c.replyHours)} und ` : "Wir "}können Ihnen den Betrag direkt erstatten, ohne dass Sie bei Ihrer Bank eine Rückbuchung beantragen müssen.${statement(c, true)}`,
        ],
      },
      delivery: {
        title: "Lieferbedingungen",
        body: (c) => [
          deliveryLine,
          "Alle Produkte sind digital. Es wird nichts physisch versandt.",
          `Wenn Sie wenige Minuten nach der Zahlung noch keinen Zugang erhalten haben, prüfen Sie bitte Ihren Spam- oder Werbeordner und schreiben Sie, falls er weiterhin fehlt, von der beim Checkout verwendeten E-Mail-Adresse an ${c.email}.`,
        ],
      },
    },
  };
})();

// ------------------------------------------------------------------ español

const es: CatalogTexts = (() => {
  const reach = (c: LegalCtx) => (c.phone ? `${c.email} o al ${c.phone}` : c.email);
  const hours = (n: number) => `${n} ${n === 1 ? "hora" : "horas"}`;
  const reply = (c: LegalCtx) =>
    c.replyHours ? ` Respondemos en un plazo de ${hours(c.replyHours)}.` : c.replyText ? ` Horario de respuesta: ${c.replyText}.` : "";
  const deliveryLine =
    "Inmediatamente después de confirmarse su pago, recibirá un correo electrónico con un enlace seguro para descargar su compra o acceder a ella.";
  const statement = (c: LegalCtx, short = false) =>
    c.statement ? ` El cargo aparece en ${short ? "su resumen" : "el resumen de su tarjeta"} como «${c.statement}».` : "";
  const promotions = [
    "Los descuentos, precios tachados, temporizadores de cuenta regresiva, complementos opcionales («añadir a su pedido») y ofertas mostradas después del pago son promociones por tiempo limitado. El precio que paga es siempre el que se muestra en la página de pago al confirmar, en la moneda indicada.",
    "Salvo indicación en contrario, las promociones no son acumulables, pueden finalizar sin previo aviso y no se aplican retroactivamente a compras anteriores. Los bonos incluidos no tienen valor monetario y no se reembolsan por separado.",
    "Ofertas de un clic después del pago: justo después de su compra podemos mostrarle una oferta única. Solo se cobra si hace clic en el botón que la acepta (por ejemplo «Sí, añadirla a mi pedido»), en el mismo medio de pago que acaba de usar y por el importe exacto que se muestra en esa página. Si la rechaza o cierra la página, no se cobra nada. Cada oferta aceptada es un cargo aparte y recibe su propio correo de confirmación con el enlace de descarga.",
    "Descuento por carrito abandonado: si introduce su correo en el pago y no completa la compra, podemos enviarle un único correo con un descuento (20 %, salvo que el correo indique otro) sobre los productos de ese carrito, válido durante el plazo que figura en el correo. No es acumulable con otras promociones.",
  ];
  const eligibility = [
    "Para realizar una compra debe tener al menos 18 años y capacidad legal para celebrar un contrato.",
    "Nos reservamos el derecho de rechazar o cancelar un pedido cuando sospechemos fraude, el uso del medio de pago de otra persona o un incumplimiento de estos términos; en ese caso, se reembolsa el importe cobrado.",
  ];

  return {
    langName: "Español",
    intl: "es-ES",
    ui: {
      nav: { home: "Inicio", terms: "Términos", privacy: "Privacidad", refund: "Reembolsos", contact: "Contacto" },
      language: "Idioma",
      heroFallback: (d) =>
        `Productos digitales entregados al instante por correo electrónico, con ${d} días para solicitar el reembolso y pago seguro con Stripe.`,
      whoFor: "A quién está dirigido:",
      operatedBy: "Operado por",
      productsCta: "Productos y precios ↓",
      facts: {
        delivery: "Entrega digital inmediata por correo electrónico",
        refund: (d) => `${d} días para solicitar el reembolso`,
        stripe: "Pago seguro con Stripe",
        support: "Soporte:",
      },
      productsTitle: "Productos y precios",
      productsIntro:
        "Todo lo que vendemos, con el precio que se le cobra en la página de pago. Los precios están en la moneda indicada junto a cada artículo.",
      currencyNote:
        "Según su país, la página de pago puede mostrar el importe en su moneda local al tipo de cambio vigente.",
      labels: { product: "Producto", addon: "Complemento opcional en el pago", after: "Ofrecido después de la compra", bonus: "Bono incluido" },
      buyNow: "Comprar ahora →",
      viewAtCheckout: "Ver en la página de pago →",
      includedWith: (n) => `Incluido sin costo adicional con ${n}`,
      oneTime: "Pago único · Producto digital",
      empty: "Nuestro catálogo se está actualizando. Escríbanos para conocer los productos y precios vigentes.",
      deliveryTitle: "Cómo funciona la entrega",
      deliveryEmail: deliveryLine,
      deliveryDigital: "Todos los productos son digitales. No se realizan envíos físicos.",
      supportTitle: "Atención al cliente",
      supportIntro:
        "¿Preguntas sobre una compra, un enlace de acceso o un reembolso? Escríbanos: le responde una persona.",
      email: "Correo electrónico",
      phone: "Teléfono",
      address: "Dirección comercial",
      reply: (n) => `Respondemos en un plazo de ${hours(n)}`,
      replyText: (t) => `Horario de respuesta: ${t}`,
      writeEmail: "Escríbanos",
      contactTip:
        "Si nos escribe por un pedido, use el correo electrónico con el que realizó la compra e indique su número de pedido.",
      policiesTitle: "Políticas",
      policiesIntro: "Las condiciones que se aplican a cada compra, en lenguaje claro.",
      cards: {
        refund: { title: "Política de reembolsos", body: (d) => `${d} días desde la fecha de compra para solicitar un reembolso.`, link: "Política de reembolsos, entregas y cancelaciones →" },
        delivery: { title: "Política de entrega", body: "Todos los productos son digitales. No se realizan envíos físicos.", link: "Política de entrega →" },
        terms: { title: "Términos", body: "Las condiciones que se aplican a cada compra.", link: "Términos y Condiciones →" },
        privacy: { title: "Privacidad", body: "Cómo recopilamos, usamos y protegemos sus datos.", link: "Política de Privacidad →" },
      },
      secureTitle: "Pago seguro",
      secureHttps: "Todas las páginas y formularios de pago se sirven mediante HTTPS.",
      secureStripe:
        "Los pagos con tarjeta son procesados por Stripe. Nunca vemos ni almacenamos el número completo de su tarjeta: los datos van directamente al procesador de pagos.",
      secureCurrency: (cur) =>
        `Los precios se expresan en ${cur}. Según su país, la página de pago puede mostrar y cobrar el importe equivalente en su moneda local al tipo de cambio vigente.`,
      statement: "En el resumen de su tarjeta, esta compra aparece como",
      weAccept: "Aceptamos",
      rights: (y, n) => `© ${y} ${n}. Todos los derechos reservados.`,
      docs: {
        terms: "Términos y Condiciones",
        privacy: "Política de Privacidad",
        refund: "Política de reembolsos, entregas y cancelaciones",
        contact: "Contacto",
      },
      refundIntro:
        "Cómo funcionan los reembolsos, la entrega, las cancelaciones y las promociones en cada compra realizada a través de nuestras páginas de pago.",
      contactIntro: "Ayuda con pedidos, enlaces de acceso, reembolsos y cualquier pregunta sobre nuestros productos.",
      lastUpdated: "Última actualización:",
      contents: "Índice",
      metaHome: (b) => `${b}: productos y precios, entrega, política de reembolsos, términos, privacidad y contacto.`,
    },
    sections: {
      who: {
        title: "Quiénes somos",
        body: (c) => [
          `Este sitio web y la venta de sus productos son operados por ${c.brand}${trade(c) ? ` (nombre comercial de ${c.legalName})` : ""}${c.address ? `, con domicilio en ${c.address}` : ""}. Puede contactarnos en ${reach(c)}.`,
        ],
      },
      acceptance: {
        title: "Aceptación de estos términos",
        body: () => [
          "Al realizar una compra en cualquiera de nuestras páginas de pago, usted acepta estos Términos y Condiciones, la Política de Privacidad y la Política de reembolsos, entregas y cancelaciones. Le recomendamos leerlos antes de confirmar su pedido.",
        ],
      },
      products: {
        title: "Productos y entrega",
        body: () => [
          "Vendemos productos digitales (como libros electrónicos y otros contenidos descargables) con acceso inmediato. Cada producto, su descripción y su precio figuran en la página de inicio de este sitio y en la página de pago correspondiente. No se envían productos físicos.",
          deliveryLine,
        ],
      },
      prices: {
        title: "Precios y pago",
        body: (c) => [
          `Salvo que la página de pago indique una suscripción, el precio indicado es un pago único, sin cargos recurrentes. Los precios se expresan en ${c.currency}; la página de pago puede mostrar el importe en su moneda local al tipo de cambio vigente, y su banco puede aplicar comisiones por transacciones internacionales.`,
        ],
      },
      secure: {
        title: "Pago seguro",
        body: (c) => [
          `Los pagos son procesados por Stripe mediante conexiones cifradas (HTTPS/TLS). Los datos de su tarjeta van directamente al procesador de pagos: nunca los vemos ni los almacenamos. Los precios se expresan en ${c.currency}; según su país, la página de pago puede mostrar y cobrar el importe equivalente en su moneda local al tipo de cambio vigente.${statement(c)}`,
        ],
      },
      refunds: {
        title: "Reembolsos y disputas",
        body: (c) => [
          `Las condiciones completas de reembolso, entrega, cancelación y promociones están disponibles en ${c.refundUrl}. En resumen: garantía de ${c.days} días desde la compra para problemas reales con el producto y, si algo sale mal, le pedimos que nos contacte antes de abrir una disputa con su banco.`,
        ],
      },
      promotions: { title: "Promociones y ofertas por tiempo limitado", body: () => promotions },
      eligibility: { title: "Requisitos y restricciones", body: () => eligibility },
      ip: {
        title: "Propiedad intelectual",
        body: () => [
          "Todo el contenido es para uso personal e intransferible. Se prohíbe su reventa, copia, redistribución o difusión, total o parcial, sin la autorización por escrito del titular.",
        ],
      },
      results: {
        title: "Resultados y carácter educativo",
        body: () => [
          "El contenido tiene fines informativos y educativos. Los resultados dependen de cada persona y no constituyen una garantía de ingresos, rendimiento ni de ningún resultado concreto. No sustituye el asesoramiento profesional individual (médico, legal o financiero).",
        ],
      },
      law: {
        title: "Ley aplicable",
        body: (c) => [
          `${c.usLaw ? "Estos términos se rigen por las leyes de los Estados Unidos de América" : `Estos términos se rigen por las leyes del país en el que está establecido ${entity(c)}`}, sin perjuicio de los derechos irrenunciables que le correspondan como consumidor en su país de residencia. Podemos actualizar estos términos; la versión vigente es la publicada en este sitio.`,
        ],
      },
      contact: {
        title: "Contacto",
        body: (c) => [
          `Atención al cliente: ${c.email}${c.phone ? ` · ${c.phone}` : ""}.${reply(c)}${c.address ? ` Dirección: ${c.address}.` : ""}`,
        ],
      },
      data: {
        title: "Datos que recopilamos",
        body: () => [
          "Recopilamos los datos que usted proporciona al comprar: nombre, correo electrónico, teléfono (si lo indica), país y los datos de facturación que exige el procesador de pagos. También registramos datos técnicos de la visita (dirección IP, navegador, páginas visitadas) con fines de seguridad y estadísticos.",
        ],
      },
      use: {
        title: "Cómo usamos sus datos",
        body: () => [
          "Usamos sus datos para procesar la compra, entregar el producto, brindar soporte, emitir comprobantes, prevenir el fraude y, si usted lo autorizó, enviarle comunicaciones sobre nuestros productos (puede darse de baja en cualquier momento).",
        ],
      },
      third: {
        title: "Terceros",
        body: () => [
          "Compartimos datos solo con los proveedores necesarios para operar: el procesador de pagos (Stripe), nuestros proveedores de alojamiento e infraestructura, los servicios de envío de correo electrónico y las herramientas de analítica y publicidad. No vendemos sus datos.",
        ],
      },
      security: {
        title: "Seguridad",
        body: () => [
          "Los pagos se procesan en plataformas con certificación PCI DSS; no almacenamos los datos de su tarjeta. Todas las comunicaciones están cifradas mediante HTTPS.",
        ],
      },
      retention: {
        title: "Conservación",
        body: () => [
          "Conservamos los datos de compra mientras dure la relación comercial y durante los plazos legales exigidos para la facturación y la prevención del fraude; después, se eliminan o se anonimizan.",
        ],
      },
      rights: {
        title: "Sus derechos",
        body: (c) => [
          `Puede solicitar el acceso, la rectificación, la portabilidad o la supresión de sus datos, y oponerse a las comunicaciones comerciales, escribiendo a ${c.email}. Respondemos dentro de los plazos legales aplicables.`,
        ],
      },
      refundFull: {
        title: "Reembolsos y disputas",
        body: (c) => [
          `Ofrecemos una garantía de ${c.days} días contados desde la fecha de compra para problemas reales con el producto: un archivo que no abre o está dañado, un contenido que no coincide con lo descrito en la página de venta, un cobro duplicado o un producto que nunca se entregó. En esos casos escriba a ${c.email} desde el correo electrónico utilizado en la compra, indicando su número de pedido y qué sucedió: lo solucionamos o le reembolsamos.`,
          "La garantía no cubre motivos ajenos al producto. Todos nuestros productos son libros digitales en formato PDF, entregados al instante, y no se envía nada físico: no realizamos reembolsos por haber esperado un libro impreso, por no haber leído la descripción del producto antes de comprar ni por arrepentimiento una vez entregados los archivos.",
          "Los reembolsos se realizan al medio de pago original, normalmente en un plazo de 5 a 10 días hábiles según su banco o el emisor de su tarjeta. Una vez vencido el plazo de garantía no se realizan reembolsos, ya que se trata de productos digitales de acceso inmediato.",
        ],
      },
      beforeDispute: {
        title: "Antes de abrir una disputa",
        body: (c) => [
          `Si no reconoce un cargo o algo salió mal con su compra, contáctenos primero en ${c.email}: ${c.replyHours ? `respondemos en un plazo de ${hours(c.replyHours)} y ` : ""}podemos reembolsarle directamente, sin que tenga que abrir una disputa con su banco.${statement(c, true)}`,
        ],
      },
      delivery: {
        title: "Política de entrega",
        body: (c) => [
          deliveryLine,
          "Todos los productos son digitales. No se realizan envíos físicos.",
          `Si no recibe el acceso a los pocos minutos de pagar, revise su carpeta de spam o de promociones y, si sigue sin aparecer, escriba a ${c.email} desde el correo electrónico utilizado en la compra.`,
        ],
      },
    },
  };
})();

export const CATALOG_TEXTS: Record<CatalogLang, CatalogTexts> = { en, it, fr, de, es };

export function catalogTexts(lang: CatalogLang): CatalogTexts {
  return CATALOG_TEXTS[lang] ?? en;
}

/** Secciones numeradas de un documento legal, ya con los datos del negocio. */
export function legalSections(lang: CatalogLang, doc: DocId, ctx: LegalCtx) {
  const t = catalogTexts(lang);
  return DOCS[doc].map((id, i) => ({
    id,
    n: i + 1,
    title: t.sections[id].title,
    paras: t.sections[id].body(ctx),
  }));
}
