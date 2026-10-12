import type { Locale } from "./i18n";

/** Textos de «Mi biblioteca» en los idiomas del checkout. */
export type LibTexts = {
  title: string; loginTitle: string; loginSub: string; emailPh: string; send: string; sending: string;
  sent: (email: string) => string; badEmail: string; tooMany: string;
  hello: (name: string) => string; count: (n: number) => string; logout: string;
  yours: string; download: string; open: string; pages: (n: number) => string;
  presale: string; presaleSub: string; presaleBtn: string; inKit: string;
  collection: (name: string) => string; progress: (have: number, total: number) => string;
  unlock: string; unlocking: string; unlocked: string; locked: string; oneClick: string;
  more: string; discover: string; help: string; helpSub: string; write: string; sameTopic: string; forYou: string;
  adminBar: (email: string) => string; adminNoBuy: string; empty: string; emptySub: string; expired: string;
  mailSubject: (brand: string) => string; mailIntro: string; mailButton: string; mailNote: string;
  payError: string;
  tabBooks: string; tabOrders: string; tabShop: string; shopAll: string; seeShop: string; shopSearch: string; shuffle: string; noMatch: (q: string) => string; shuffleLabel: string;
  allTopics: string; preview: string; samplePages: string; close: string; loading: string; collectionsTitle: string; catalogKicker: string; catalogTitle: string; catalogSub: string; alreadyBought: string; signIn: string; seeBook: string; language: string;
  memberSince: (date: string) => string; ordersCount: (n: number) => string;
  ordersSub: string; noOrders: string; paid: string; refunded: string; kindExtra: string; kindAdded: string; kindGift: string;
  shopSub: string; shopEmpty: string; buyTitle: string; payNow: (label: string) => string; buyNote: string; cancel: string;
  secure: string; includes: (n: number) => string; gifts: (n: number) => string; seeOffer: string; buy: string;
  checkMail: string; otherEmail: string; trouble: string;
};

const it: LibTexts = {
  title: "La tua biblioteca", loginTitle: "Entra nella tua biblioteca", loginSub: "Scrivi l'email con cui hai acquistato per entrare.",
  emailPh: "La tua email", send: "Entra", sending: "Un attimo…",
  sent: (e) => `Fatto! Se ${e} ha degli acquisti, tra un minuto ti arriva il link. Controlla anche spam e promozioni.`,
  badEmail: "Scrivi un'email valida.", tooMany: "Ti abbiamo già mandato il link da poco: controlla la posta (anche spam).",
  hello: (n) => (n ? `Ciao ${n}` : "Ciao"), count: (n) => (n === 1 ? "Hai 1 libro" : `Hai ${n} libri`), logout: "Esci",
  yours: "I tuoi libri", download: "Scarica", open: "Apri", pages: (n) => `${n} pagine`,
  presale: "In arrivo", presaleSub: "Il contenuto sarà disponibile tra 2 giorni. Ti avvisiamo via email.", presaleBtn: "Disponibile tra 2 giorni", inKit: "Nel kit",
  collection: (n) => `Completa la collezione · ${n}`, progress: (h, t) => `Ne hai ${h} su ${t}`,
  unlock: "Sblocca", unlocking: "Un attimo…", unlocked: "Sbloccato ✓", locked: "Bloccato", oneClick: "Con la stessa carta, in un clic. Ti arriva subito via email.",
  more: "Altri libri per te", discover: "Scopri", sameTopic: "Stesso argomento", forYou: "Scelto per te",
  help: "Ti serve aiuto?", helpSub: "Un file non si apre o manca qualcosa? Scrivici e lo risolviamo.", write: "Scrivici",
  adminBar: (e) => `Vista amministratore · ${e}`, adminNoBuy: "Vista amministratore: qui non si compra.",
  empty: "Non troviamo acquisti con questa email", emptySub: "Se hai usato un'altra email, prova con quella.", expired: "Il link è scaduto: chiedine uno nuovo.",
  mailSubject: (b) => `Il tuo accesso a ${b}`, mailIntro: "Ecco il tuo link per entrare nella tua biblioteca: lì trovi tutti i tuoi libri, sempre pronti da scaricare.",
  mailButton: "Entra nella biblioteca", mailNote: "Il link vale 48 ore. Se non l'hai chiesto tu, ignora questa email.",
  payError: "Il pagamento non è andato a buon fine. Riprova o usa un altro metodo.",
  tabBooks: "I miei libri", tabOrders: "I miei ordini", tabShop: "Negozio", shopAll: "Tutti i libri", seeShop: "Vedi tutto il negozio", shopSearch: "Cerca un libro o un argomento…", shuffle: "Sorprendimi", noMatch: (x) => `Nessun libro corrisponde a «${x}».`, shuffleLabel: "Mescola i libri", allTopics: "Tutti", preview: "Sfoglia", samplePages: "Pagine di esempio", close: "Chiudi", loading: "Caricamento…", collectionsTitle: "Completa le tue collezioni", catalogKicker: "Libri illustrati", catalogTitle: "Tutti i nostri libri illustrati", catalogSub: "Ogni argomento spiegato con i disegni, un'idea per pagina. Cerca, sfoglia le pagine e scegli il tuo.", alreadyBought: "Hai già acquistato? Entra con la tua email", signIn: "Entra", seeBook: "Scopri il libro", language: "Lingua",
  memberSince: (d) => `Cliente dal ${d}`, ordersCount: (n) => (n === 1 ? "1 ordine" : `${n} ordini`),
  ordersSub: "Ogni acquisto, quando l'hai fatto e quanto hai pagato.", noOrders: "Non ci sono ancora ordini.", paid: "Pagato", refunded: "Rimborsato",
  kindExtra: "Extra", kindAdded: "Aggiunto", kindGift: "Regalo",
  shopSub: "Completa le tue collezioni e scopri altri libri: si sbloccano subito.", shopEmpty: "Hai già tutto. Grazie! 💜",
  buyTitle: "Conferma l'acquisto", payNow: (l) => `Paga ${l}`, buyNote: "Lo trovi subito nella tua biblioteca e ti arriva anche via email.", cancel: "Annulla",
  secure: "Pagamento sicuro con Stripe", includes: (n) => (n === 1 ? "1 libro" : `${n} libri`), gifts: (n) => (n === 1 ? "+ 1 regalo" : `+ ${n} regali`),
  seeOffer: "Vedi l'offerta", buy: "Acquista",
  checkMail: "Controlla la tua email", otherEmail: "Usa un'altra email", trouble: "Problemi ad entrare? Scrivici:",
};

const en: LibTexts = {
  title: "Your library", loginTitle: "Enter your library", loginSub: "Enter the email you used to buy to get in.",
  emailPh: "Your email", send: "Enter", sending: "One moment…",
  sent: (e) => `Done! If ${e} has purchases, the link arrives in a minute. Check spam and promotions too.`,
  badEmail: "Enter a valid email.", tooMany: "We just sent you a link: check your inbox (and spam).",
  hello: (n) => (n ? `Hi ${n}` : "Hi"), count: (n) => (n === 1 ? "You have 1 book" : `You have ${n} books`), logout: "Sign out",
  yours: "Your books", download: "Download", open: "Open", pages: (n) => `${n} pages`,
  presale: "Coming soon", presaleSub: "The content will be ready in 2 days. We'll let you know by email.", presaleBtn: "Available in 2 days", inKit: "In the kit",
  collection: (n) => `Complete the collection · ${n}`, progress: (h, t) => `You have ${h} of ${t}`,
  unlock: "Unlock", unlocking: "One moment…", unlocked: "Unlocked ✓", locked: "Locked", oneClick: "Same card, one click. It reaches you right away by email.",
  more: "More books for you", discover: "Discover", sameTopic: "Same topic", forYou: "Picked for you",
  help: "Need help?", helpSub: "A file won't open or something is missing? Write to us and we'll fix it.", write: "Write to us",
  adminBar: (e) => `Admin view · ${e}`, adminNoBuy: "Admin view: no purchases here.",
  empty: "We can't find purchases for this email", emptySub: "If you used another email, try that one.", expired: "This link has expired: ask for a new one.",
  mailSubject: (b) => `Your access to ${b}`, mailIntro: "Here is your link to your library: all your books are there, ready to download anytime.",
  mailButton: "Open my library", mailNote: "The link is valid for 48 hours. If you didn't ask for it, ignore this email.",
  payError: "The payment didn't go through. Try again or use another method.",
  tabBooks: "My books", tabOrders: "My orders", tabShop: "Shop", shopAll: "All books", seeShop: "See the whole shop", shopSearch: "Search a book or topic…", shuffle: "Surprise me", noMatch: (x) => `No books match «${x}».`, shuffleLabel: "Shuffle the books", allTopics: "All", preview: "Look inside", samplePages: "Sample pages", close: "Close", loading: "Loading…", collectionsTitle: "Complete your collections", catalogKicker: "Illustrated books", catalogTitle: "All our illustrated books", catalogSub: "Every topic explained with drawings, one idea per page. Search, look inside and choose yours.", alreadyBought: "Already bought? Sign in with your email", signIn: "Sign in", seeBook: "See the book", language: "Language",
  memberSince: (d) => `Customer since ${d}`, ordersCount: (n) => (n === 1 ? "1 order" : `${n} orders`),
  ordersSub: "Every purchase, when you made it and how much you paid.", noOrders: "No orders yet.", paid: "Paid", refunded: "Refunded",
  kindExtra: "Extra", kindAdded: "Added", kindGift: "Gift",
  shopSub: "Complete your collections and discover more books: they unlock instantly.", shopEmpty: "You already have everything. Thank you! 💜",
  buyTitle: "Confirm your purchase", payNow: (l) => `Pay ${l}`, buyNote: "It appears in your library right away and we also email it to you.", cancel: "Cancel",
  secure: "Secure payment with Stripe", includes: (n) => (n === 1 ? "1 book" : `${n} books`), gifts: (n) => (n === 1 ? "+ 1 gift" : `+ ${n} gifts`),
  seeOffer: "See the offer", buy: "Buy",
  checkMail: "Check your email", otherEmail: "Use another email", trouble: "Trouble signing in? Write to us:",
};

const es: LibTexts = {
  title: "Tu biblioteca", loginTitle: "Entrá a tu biblioteca", loginSub: "Escribí el email con el que compraste para entrar.",
  emailPh: "Tu email", send: "Entrar", sending: "Un momento…",
  sent: (e) => `¡Listo! Si ${e} tiene compras, en un minuto te llega el link. Revisá también spam y promociones.`,
  badEmail: "Escribí un email válido.", tooMany: "Ya te mandamos el link hace poco: revisá tu correo (también spam).",
  hello: (n) => (n ? `Hola ${n}` : "Hola"), count: (n) => (n === 1 ? "Tenés 1 libro" : `Tenés ${n} libros`), logout: "Salir",
  yours: "Tus libros", download: "Descargar", open: "Abrir", pages: (n) => `${n} páginas`,
  presale: "Llega pronto", presaleSub: "El contenido va a estar en 2 días. Te avisamos por email.", presaleBtn: "Disponible en 2 días", inKit: "En el kit",
  collection: (n) => `Completá la colección · ${n}`, progress: (h, t) => `Tenés ${h} de ${t}`,
  unlock: "Desbloquear", unlocking: "Un momento…", unlocked: "Desbloqueado ✓", locked: "Bloqueado", oneClick: "Con la misma tarjeta, en un clic. Te llega al instante por email.",
  more: "Más libros para vos", discover: "Ver", sameTopic: "Mismo tema", forYou: "Elegido para vos",
  help: "¿Necesitás ayuda?", helpSub: "¿Un archivo no abre o falta algo? Escribinos y lo resolvemos.", write: "Escribinos",
  adminBar: (e) => `Vista de administrador · ${e}`, adminNoBuy: "Vista de administrador: acá no se compra.",
  empty: "No encontramos compras con este email", emptySub: "Si usaste otro email, probá con ese.", expired: "El link venció: pedí uno nuevo.",
  mailSubject: (b) => `Tu acceso a ${b}`, mailIntro: "Este es tu link para entrar a tu biblioteca: ahí están todos tus libros, siempre listos para descargar.",
  mailButton: "Entrar a mi biblioteca", mailNote: "El link vale 48 horas. Si no lo pediste, ignorá este email.",
  payError: "El pago no se pudo hacer. Probá de nuevo o usá otro medio.",
  tabBooks: "Mis libros", tabOrders: "Mis pedidos", tabShop: "Tienda", shopAll: "Todos los libros", seeShop: "Ver toda la tienda", shopSearch: "Buscá un libro o un tema…", shuffle: "Sorprendeme", noMatch: (x) => `Ningún libro coincide con «${x}».`, shuffleLabel: "Mezclar los libros", allTopics: "Todos", preview: "Hojear", samplePages: "Páginas de muestra", close: "Cerrar", loading: "Cargando…", collectionsTitle: "Completá tus colecciones", catalogKicker: "Libros ilustrados", catalogTitle: "Todos nuestros libros ilustrados", catalogSub: "Cada tema explicado con dibujos, una idea por página. Buscá, mirá las páginas y elegí el tuyo.", alreadyBought: "¿Ya compraste? Entrá con tu email", signIn: "Entrar", seeBook: "Ver el libro", language: "Idioma",
  memberSince: (d) => `Cliente desde el ${d}`, ordersCount: (n) => (n === 1 ? "1 pedido" : `${n} pedidos`),
  ordersSub: "Cada compra, cuándo la hiciste y cuánto pagaste.", noOrders: "Todavía no hay pedidos.", paid: "Pagado", refunded: "Reembolsado",
  kindExtra: "Extra", kindAdded: "Agregado", kindGift: "Regalo",
  shopSub: "Completá tus colecciones y descubrí más libros: se desbloquean al instante.", shopEmpty: "Ya tenés todo. ¡Gracias! 💜",
  buyTitle: "Confirmá tu compra", payNow: (l) => `Pagar ${l}`, buyNote: "Aparece al instante en tu biblioteca y también te llega por email.", cancel: "Cancelar",
  secure: "Pago seguro con Stripe", includes: (n) => (n === 1 ? "1 libro" : `${n} libros`), gifts: (n) => (n === 1 ? "+ 1 regalo" : `+ ${n} regalos`),
  seeOffer: "Ver la oferta", buy: "Comprar",
  checkMail: "Revisá tu correo", otherEmail: "Usar otro email", trouble: "¿Problemas para entrar? Escribinos:",
};

const pt: LibTexts = {
  title: "Sua biblioteca", loginTitle: "Entre na sua biblioteca", loginSub: "Digite o e-mail que você usou na compra para entrar.",
  emailPh: "Seu e-mail", send: "Entrar", sending: "Um momento…",
  sent: (e) => `Pronto! Se ${e} tem compras, o link chega em um minuto. Confira também spam e promoções.`,
  badEmail: "Digite um e-mail válido.", tooMany: "Acabamos de enviar o link: confira seu e-mail (e o spam).",
  hello: (n) => (n ? `Olá, ${n}` : "Olá"), count: (n) => (n === 1 ? "Você tem 1 livro" : `Você tem ${n} livros`), logout: "Sair",
  yours: "Seus livros", download: "Baixar", open: "Abrir", pages: (n) => `${n} páginas`,
  presale: "Em breve", presaleSub: "O conteúdo estará disponível em 2 dias. Avisamos por e-mail.", presaleBtn: "Disponível em 2 dias", inKit: "No kit",
  collection: (n) => `Complete a coleção · ${n}`, progress: (h, t) => `Você tem ${h} de ${t}`,
  unlock: "Desbloquear", unlocking: "Um momento…", unlocked: "Desbloqueado ✓", locked: "Bloqueado", oneClick: "Mesmo cartão, um clique. Chega na hora por e-mail.",
  more: "Mais livros para você", discover: "Ver", sameTopic: "Mesmo tema", forYou: "Escolhido para você",
  help: "Precisa de ajuda?", helpSub: "Um arquivo não abre ou falta algo? Escreva para nós e resolvemos.", write: "Fale conosco",
  adminBar: (e) => `Visão de administrador · ${e}`, adminNoBuy: "Visão de administrador: aqui não se compra.",
  empty: "Não encontramos compras com este e-mail", emptySub: "Se usou outro e-mail, tente com ele.", expired: "O link expirou: peça um novo.",
  mailSubject: (b) => `Seu acesso a ${b}`, mailIntro: "Aqui está o link da sua biblioteca: todos os seus livros estão lá, prontos para baixar.",
  mailButton: "Entrar na biblioteca", mailNote: "O link vale 48 horas. Se não foi você que pediu, ignore este e-mail.",
  payError: "O pagamento não foi concluído. Tente de novo ou use outro método.",
  tabBooks: "Meus livros", tabOrders: "Meus pedidos", tabShop: "Loja", shopAll: "Todos os livros", seeShop: "Ver a loja inteira", shopSearch: "Procure um livro ou um tema…", shuffle: "Me surpreenda", noMatch: (x) => `Nenhum livro corresponde a «${x}».`, shuffleLabel: "Embaralhar os livros", allTopics: "Todos", preview: "Folhear", samplePages: "Páginas de amostra", close: "Fechar", loading: "Carregando…", collectionsTitle: "Complete suas coleções", catalogKicker: "Livros ilustrados", catalogTitle: "Todos os nossos livros ilustrados", catalogSub: "Cada tema explicado com desenhos, uma ideia por página. Procure, folheie e escolha o seu.", alreadyBought: "Já comprou? Entre com seu e-mail", signIn: "Entrar", seeBook: "Ver o livro", language: "Idioma",
  memberSince: (d) => `Cliente desde ${d}`, ordersCount: (n) => (n === 1 ? "1 pedido" : `${n} pedidos`),
  ordersSub: "Cada compra, quando você fez e quanto pagou.", noOrders: "Ainda não há pedidos.", paid: "Pago", refunded: "Reembolsado",
  kindExtra: "Extra", kindAdded: "Adicionado", kindGift: "Presente",
  shopSub: "Complete suas coleções e descubra mais livros: são liberados na hora.", shopEmpty: "Você já tem tudo. Obrigado! 💜",
  buyTitle: "Confirme sua compra", payNow: (l) => `Pagar ${l}`, buyNote: "Aparece na hora na sua biblioteca e também chega por e-mail.", cancel: "Cancelar",
  secure: "Pagamento seguro com Stripe", includes: (n) => (n === 1 ? "1 livro" : `${n} livros`), gifts: (n) => (n === 1 ? "+ 1 presente" : `+ ${n} presentes`),
  seeOffer: "Ver a oferta", buy: "Comprar",
  checkMail: "Confira seu e-mail", otherEmail: "Usar outro e-mail", trouble: "Problemas para entrar? Fale conosco:",
};

const fr: LibTexts = {
  title: "Votre bibliothèque", loginTitle: "Accédez à votre bibliothèque", loginSub: "Saisissez l'e-mail utilisé lors de votre achat pour entrer.",
  emailPh: "Votre e-mail", send: "Entrer", sending: "Un instant…",
  sent: (e) => `C'est fait ! Si ${e} a des achats, le lien arrive dans une minute. Vérifiez aussi les spams et promotions.`,
  badEmail: "Saisissez un e-mail valide.", tooMany: "Nous venons de vous envoyer le lien : vérifiez votre boîte (et les spams).",
  hello: (n) => (n ? `Bonjour ${n}` : "Bonjour"), count: (n) => (n === 1 ? "Vous avez 1 livre" : `Vous avez ${n} livres`), logout: "Se déconnecter",
  yours: "Vos livres", download: "Télécharger", open: "Ouvrir", pages: (n) => `${n} pages`,
  presale: "Bientôt disponible", presaleSub: "Le contenu sera disponible dans 2 jours. Nous vous prévenons par e-mail.", presaleBtn: "Disponible dans 2 jours", inKit: "Dans le kit",
  collection: (n) => `Complétez la collection · ${n}`, progress: (h, t) => `Vous en avez ${h} sur ${t}`,
  unlock: "Débloquer", unlocking: "Un instant…", unlocked: "Débloqué ✓", locked: "Verrouillé", oneClick: "Même carte, un clic. Vous le recevez tout de suite par e-mail.",
  more: "D'autres livres pour vous", discover: "Découvrir", sameTopic: "Même sujet", forYou: "Choisi pour vous",
  help: "Besoin d'aide ?", helpSub: "Un fichier ne s'ouvre pas ou il manque quelque chose ? Écrivez-nous, on s'en occupe.", write: "Nous écrire",
  adminBar: (e) => `Vue administrateur · ${e}`, adminNoBuy: "Vue administrateur : pas d'achat ici.",
  empty: "Aucun achat trouvé avec cet e-mail", emptySub: "Si vous avez utilisé un autre e-mail, essayez avec celui-là.", expired: "Le lien a expiré : demandez-en un nouveau.",
  mailSubject: (b) => `Votre accès à ${b}`, mailIntro: "Voici votre lien vers votre bibliothèque : tous vos livres y sont, prêts à être téléchargés.",
  mailButton: "Ouvrir ma bibliothèque", mailNote: "Le lien est valable 48 heures. Si vous ne l'avez pas demandé, ignorez cet e-mail.",
  payError: "Le paiement n'a pas abouti. Réessayez ou utilisez un autre moyen.",
  tabBooks: "Mes livres", tabOrders: "Mes commandes", tabShop: "Boutique", shopAll: "Tous les livres", seeShop: "Voir toute la boutique", shopSearch: "Rechercher un livre ou un sujet…", shuffle: "Surprenez-moi", noMatch: (x) => `Aucun livre ne correspond à « ${x} ».`, shuffleLabel: "Mélanger les livres", allTopics: "Tous", preview: "Feuilleter", samplePages: "Pages d'exemple", close: "Fermer", loading: "Chargement…", collectionsTitle: "Complétez vos collections", catalogKicker: "Livres illustrés", catalogTitle: "Tous nos livres illustrés", catalogSub: "Chaque sujet expliqué en dessins, une idée par page. Cherchez, feuilletez et choisissez le vôtre.", alreadyBought: "Déjà acheté ? Connectez-vous avec votre e-mail", signIn: "Se connecter", seeBook: "Voir le livre", language: "Langue",
  memberSince: (d) => `Client depuis le ${d}`, ordersCount: (n) => (n === 1 ? "1 commande" : `${n} commandes`),
  ordersSub: "Chaque achat, sa date et le montant payé.", noOrders: "Pas encore de commande.", paid: "Payé", refunded: "Remboursé",
  kindExtra: "Extra", kindAdded: "Ajouté", kindGift: "Cadeau",
  shopSub: "Complétez vos collections et découvrez d'autres livres : ils se débloquent tout de suite.", shopEmpty: "Vous avez déjà tout. Merci ! 💜",
  buyTitle: "Confirmez votre achat", payNow: (l) => `Payer ${l}`, buyNote: "Il apparaît tout de suite dans votre bibliothèque et vous le recevez aussi par e-mail.", cancel: "Annuler",
  secure: "Paiement sécurisé avec Stripe", includes: (n) => (n === 1 ? "1 livre" : `${n} livres`), gifts: (n) => (n === 1 ? "+ 1 cadeau" : `+ ${n} cadeaux`),
  seeOffer: "Voir l'offre", buy: "Acheter",
  checkMail: "Vérifiez vos e-mails", otherEmail: "Utiliser un autre e-mail", trouble: "Un souci pour vous connecter ? Écrivez-nous :",
};

const de: LibTexts = {
  title: "Deine Bibliothek", loginTitle: "Zu deiner Bibliothek", loginSub: "Gib die E-Mail-Adresse ein, mit der du gekauft hast, und du bist drin.",
  emailPh: "Deine E-Mail", send: "Bibliothek öffnen", sending: "Einen Moment…",
  sent: (e) => `Fertig! Wenn ${e} Käufe hat, kommt der Link in einer Minute. Schau auch im Spam- und Werbeordner nach.`,
  badEmail: "Gib eine gültige E-Mail ein.", tooMany: "Wir haben dir gerade einen Link geschickt: Schau in dein Postfach (auch Spam).",
  hello: (n) => (n ? `Hallo ${n}` : "Hallo"), count: (n) => (n === 1 ? "Du hast 1 Buch" : `Du hast ${n} Bücher`), logout: "Abmelden",
  yours: "Deine Bücher", download: "Herunterladen", open: "Öffnen", pages: (n) => `${n} Seiten`,
  presale: "Kommt bald", presaleSub: "Der Inhalt ist in 2 Tagen da. Wir sagen dir per E-Mail Bescheid.", presaleBtn: "Verfügbar in 2 Tagen", inKit: "Im Set",
  collection: (n) => `Vervollständige die Sammlung · ${n}`, progress: (h, t) => `Du hast ${h} von ${t}`,
  unlock: "Freischalten", unlocking: "Einen Moment…", unlocked: "Freigeschaltet ✓", locked: "Gesperrt", oneClick: "Gleiche Karte, ein Klick. Du bekommst es sofort per E-Mail.",
  more: "Weitere Bücher für dich", discover: "Ansehen", sameTopic: "Gleiches Thema", forYou: "Für dich ausgewählt",
  help: "Brauchst du Hilfe?", helpSub: "Eine Datei lässt sich nicht öffnen oder etwas fehlt? Schreib uns, wir lösen das.", write: "Schreib uns",
  adminBar: (e) => `Admin-Ansicht · ${e}`, adminNoBuy: "Admin-Ansicht: Hier wird nicht gekauft.",
  empty: "Wir finden keine Käufe mit dieser E-Mail", emptySub: "Wenn du eine andere E-Mail benutzt hast, versuch es mit dieser.", expired: "Der Link ist abgelaufen: Fordere einen neuen an.",
  mailSubject: (b) => `Dein Zugang zu ${b}`, mailIntro: "Hier ist dein Link zu deiner Bibliothek: Dort findest du alle deine Bücher, jederzeit zum Herunterladen.",
  mailButton: "Zur Bibliothek", mailNote: "Der Link ist 48 Stunden gültig. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail.",
  payError: "Die Zahlung hat nicht geklappt. Versuch es noch einmal oder nimm eine andere Zahlungsart.",
  tabBooks: "Meine Bücher", tabOrders: "Meine Bestellungen", tabShop: "Shop", shopAll: "Alle Bücher", seeShop: "Ganzen Shop ansehen", shopSearch: "Buch oder Thema suchen…", shuffle: "Überrasch mich", noMatch: (x) => `Kein Buch passt zu „${x}“.`, shuffleLabel: "Bücher mischen", allTopics: "Alle", preview: "Reinblättern", samplePages: "Beispielseiten", close: "Schließen", loading: "Wird geladen…", collectionsTitle: "Vervollständige deine Sammlungen", catalogKicker: "Illustrierte Bücher", catalogTitle: "Alle unsere illustrierten Bücher", catalogSub: "Jedes Thema mit Zeichnungen erklärt, eine Idee pro Seite. Such, blätter rein und wähl dein Buch.", alreadyBought: "Schon gekauft? Melde dich mit deiner E-Mail an", signIn: "Anmelden", seeBook: "Zum Buch", language: "Sprache",
  memberSince: (d) => `Kunde seit ${d}`, ordersCount: (n) => (n === 1 ? "1 Bestellung" : `${n} Bestellungen`),
  ordersSub: "Jeder Kauf, wann du ihn gemacht hast und wie viel du bezahlt hast.", noOrders: "Noch keine Bestellungen.", paid: "Bezahlt", refunded: "Erstattet",
  kindExtra: "Extra", kindAdded: "Hinzugefügt", kindGift: "Geschenk",
  shopSub: "Vervollständige deine Sammlungen und entdecke weitere Bücher: Sie werden sofort freigeschaltet.", shopEmpty: "Du hast schon alles. Danke! 💜",
  buyTitle: "Kauf bestätigen", payNow: (l) => `${l} bezahlen`, buyNote: "Es ist sofort in deiner Bibliothek und kommt auch per E-Mail.", cancel: "Abbrechen",
  secure: "Sichere Zahlung mit Stripe", includes: (n) => (n === 1 ? "1 Buch" : `${n} Bücher`), gifts: (n) => (n === 1 ? "+ 1 Geschenk" : `+ ${n} Geschenke`),
  seeOffer: "Angebot ansehen", buy: "Kaufen",
  checkMail: "Schau in dein Postfach", otherEmail: "Andere E-Mail verwenden", trouble: "Probleme beim Anmelden? Schreib uns:",
};

// Polaco y neerlandés: mismo tono que el checkout de cada país.
const pl: LibTexts = {
  title: "Twoja biblioteka", loginTitle: "Wejdź do swojej biblioteki", loginSub: "Wpisz e-mail podany przy zakupie, aby wejść.",
  emailPh: "Twój e-mail", send: "Wejdź", sending: "Chwileczkę…",
  sent: (e) => `Gotowe! Jeśli ${e} ma zakupy, link przyjdzie za minutę. Sprawdź też spam i oferty.`,
  badEmail: "Wpisz poprawny e-mail.", tooMany: "Przed chwilą wysłaliśmy Ci link: sprawdź skrzynkę (także spam).",
  hello: (n) => (n ? `Cześć ${n}` : "Cześć"), count: (n) => (n === 1 ? "Masz 1 książkę" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `Masz ${n} książki` : `Masz ${n} książek`), logout: "Wyloguj",
  yours: "Twoje książki", download: "Pobierz", open: "Otwórz", pages: (n) => `${n} stron`,
  presale: "Wkrótce", presaleSub: "Treść będzie gotowa za 2 dni. Damy Ci znać e-mailem.", presaleBtn: "Dostępne za 2 dni", inKit: "W zestawie",
  collection: (n) => `Uzupełnij kolekcję · ${n}`, progress: (h, t) => `Masz ${h} z ${t}`,
  unlock: "Odblokuj", unlocking: "Chwileczkę…", unlocked: "Odblokowane ✓", locked: "Zablokowane", oneClick: "Ta sama karta, jedno kliknięcie. Dostaniesz to od razu e-mailem.",
  more: "Więcej książek dla Ciebie", discover: "Zobacz", sameTopic: "Ten sam temat", forYou: "Wybrane dla Ciebie",
  help: "Potrzebujesz pomocy?", helpSub: "Plik się nie otwiera albo czegoś brakuje? Napisz do nas, a to naprawimy.", write: "Napisz do nas",
  adminBar: (e) => `Widok administratora · ${e}`, adminNoBuy: "Widok administratora: tu się nie kupuje.",
  empty: "Nie znaleźliśmy zakupów z tym e-mailem", emptySub: "Jeśli użyłeś innego e-maila, spróbuj z nim.", expired: "Link wygasł: poproś o nowy.",
  mailSubject: (b) => `Twój dostęp do ${b}`, mailIntro: "Oto Twój link do biblioteki: są tam wszystkie Twoje książki, zawsze gotowe do pobrania.",
  mailButton: "Wejdź do biblioteki", mailNote: "Link jest ważny 48 godzin. Jeśli to nie Ty o niego prosiłeś, zignoruj tę wiadomość.",
  payError: "Płatność się nie udała. Spróbuj ponownie albo użyj innej metody.",
  tabBooks: "Moje książki", tabOrders: "Moje zamówienia", tabShop: "Sklep", shopAll: "Wszystkie książki", seeShop: "Zobacz cały sklep", shopSearch: "Szukaj książki lub tematu…", shuffle: "Zaskocz mnie", noMatch: (x) => `Żadna książka nie pasuje do „${x}”.`, shuffleLabel: "Przetasuj książki", allTopics: "Wszystkie", preview: "Zajrzyj do środka", samplePages: "Przykładowe strony", close: "Zamknij", loading: "Ładowanie…", collectionsTitle: "Uzupełnij swoje kolekcje", catalogKicker: "Książki ilustrowane", catalogTitle: "Wszystkie nasze ilustrowane książki", catalogSub: "Każdy temat wyjaśniony rysunkami, jedna myśl na stronę. Wyszukaj, zajrzyj do środka i wybierz swoją.", alreadyBought: "Masz już zakup? Wejdź przez e-mail", signIn: "Zaloguj się", seeBook: "Zobacz książkę", language: "Język",
  memberSince: (d) => `Klient od ${d}`, ordersCount: (n) => (n === 1 ? "1 zamówienie" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} zamówienia` : `${n} zamówień`),
  ordersSub: "Każdy zakup: kiedy go zrobiłeś i ile zapłaciłeś.", noOrders: "Nie ma jeszcze zamówień.", paid: "Opłacone", refunded: "Zwrócone",
  kindExtra: "Dodatek", kindAdded: "Dodane", kindGift: "Prezent",
  shopSub: "Uzupełnij kolekcje i odkryj kolejne książki: odblokowują się od razu.", shopEmpty: "Masz już wszystko. Dziękujemy! 💜",
  buyTitle: "Potwierdź zakup", payNow: (l) => `Zapłać ${l}`, buyNote: "Od razu pojawi się w Twojej bibliotece i przyjdzie też e-mailem.", cancel: "Anuluj",
  secure: "Bezpieczna płatność przez Stripe", includes: (n) => (n === 1 ? "1 książka" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} książki` : `${n} książek`),
  gifts: (n) => (n === 1 ? "+ 1 prezent" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `+ ${n} prezenty` : `+ ${n} prezentów`),
  seeOffer: "Zobacz ofertę", buy: "Kup",
  checkMail: "Sprawdź swoją skrzynkę", otherEmail: "Użyj innego e-maila", trouble: "Problem z wejściem? Napisz do nas:",
};

const nl: LibTexts = {
  title: "Je bibliotheek", loginTitle: "Open je bibliotheek", loginSub: "Vul het e-mailadres in waarmee je hebt gekocht om binnen te komen.",
  emailPh: "Je e-mailadres", send: "Openen", sending: "Even geduld…",
  sent: (e) => `Klaar! Als ${e} aankopen heeft, krijg je binnen een minuut de link. Kijk ook in je spam en promoties.`,
  badEmail: "Vul een geldig e-mailadres in.", tooMany: "We hebben je net een link gestuurd: kijk in je inbox (ook in spam).",
  hello: (n) => (n ? `Hoi ${n}` : "Hoi"), count: (n) => (n === 1 ? "Je hebt 1 boek" : `Je hebt ${n} boeken`), logout: "Uitloggen",
  yours: "Je boeken", download: "Downloaden", open: "Openen", pages: (n) => `${n} pagina's`,
  presale: "Binnenkort", presaleSub: "De inhoud is over 2 dagen klaar. We laten het je per e-mail weten.", presaleBtn: "Beschikbaar over 2 dagen", inKit: "In de set",
  collection: (n) => `Maak de collectie compleet · ${n}`, progress: (h, t) => `Je hebt ${h} van ${t}`,
  unlock: "Ontgrendelen", unlocking: "Even geduld…", unlocked: "Ontgrendeld ✓", locked: "Vergrendeld", oneClick: "Dezelfde kaart, één klik. Je krijgt het meteen per e-mail.",
  more: "Meer boeken voor jou", discover: "Bekijken", sameTopic: "Zelfde onderwerp", forYou: "Voor jou gekozen",
  help: "Hulp nodig?", helpSub: "Gaat een bestand niet open of mist er iets? Schrijf ons en we lossen het op.", write: "Schrijf ons",
  adminBar: (e) => `Beheerdersweergave · ${e}`, adminNoBuy: "Beheerdersweergave: hier wordt niet gekocht.",
  empty: "We vinden geen aankopen met dit e-mailadres", emptySub: "Heb je een ander e-mailadres gebruikt? Probeer dat dan.", expired: "De link is verlopen: vraag een nieuwe aan.",
  mailSubject: (b) => `Je toegang tot ${b}`, mailIntro: "Hier is je link naar je bibliotheek: al je boeken staan daar, altijd klaar om te downloaden.",
  mailButton: "Open mijn bibliotheek", mailNote: "De link is 48 uur geldig. Heb je hem niet aangevraagd? Negeer dan deze e-mail.",
  payError: "De betaling is niet gelukt. Probeer het opnieuw of gebruik een andere betaalmethode.",
  tabBooks: "Mijn boeken", tabOrders: "Mijn bestellingen", tabShop: "Winkel", shopAll: "Alle boeken", seeShop: "Bekijk de hele winkel", shopSearch: "Zoek een boek of onderwerp…", shuffle: "Verras me", noMatch: (x) => `Geen boeken gevonden voor ‘${x}’.`, shuffleLabel: "Boeken husselen", allTopics: "Alle", preview: "Inkijken", samplePages: "Voorbeeldpagina's", close: "Sluiten", loading: "Laden…", collectionsTitle: "Maak je collecties compleet", catalogKicker: "Geïllustreerde boeken", catalogTitle: "Al onze geïllustreerde boeken", catalogSub: "Elk onderwerp uitgelegd met tekeningen, één idee per pagina. Zoek, kijk erin en kies het jouwe.", alreadyBought: "Al gekocht? Log in met je e-mail", signIn: "Inloggen", seeBook: "Bekijk het boek", language: "Taal",
  memberSince: (d) => `Klant sinds ${d}`, ordersCount: (n) => (n === 1 ? "1 bestelling" : `${n} bestellingen`),
  ordersSub: "Elke aankoop: wanneer je hem deed en hoeveel je betaalde.", noOrders: "Nog geen bestellingen.", paid: "Betaald", refunded: "Terugbetaald",
  kindExtra: "Extra", kindAdded: "Toegevoegd", kindGift: "Cadeau",
  shopSub: "Maak je collecties compleet en ontdek meer boeken: ze worden meteen ontgrendeld.", shopEmpty: "Je hebt alles al. Bedankt! 💜",
  buyTitle: "Bevestig je aankoop", payNow: (l) => `Betaal ${l}`, buyNote: "Het staat meteen in je bibliotheek en je krijgt het ook per e-mail.", cancel: "Annuleren",
  secure: "Veilig betalen met Stripe", includes: (n) => (n === 1 ? "1 boek" : `${n} boeken`), gifts: (n) => (n === 1 ? "+ 1 cadeau" : `+ ${n} cadeaus`),
  seeOffer: "Bekijk het aanbod", buy: "Kopen",
  checkMail: "Kijk in je e-mail", otherEmail: "Ander e-mailadres gebruiken", trouble: "Lukt het inloggen niet? Schrijf ons:",
};

const ALL: Record<string, LibTexts> = { it, en, es, "pt-BR": pt, pt, fr, de, pl, nl };
export const libTexts = (locale: string | null | undefined): LibTexts => ALL[locale ?? ""] ?? ALL[(locale ?? "").slice(0, 2)] ?? en;
export const libLocale = (locale: string | null | undefined): Locale => {
  const l = (locale ?? "").trim();
  if (l === "pt-BR" || l.startsWith("pt")) return "pt-BR" as Locale;
  const two = l.slice(0, 2);
  return (["it", "en", "es", "fr", "de", "pl", "nl"].includes(two) ? two : "en") as Locale;
};

/** Los idiomas del selector de la biblioteca. */
export const LIB_LANGS: [string, string][] = [["it", "Italiano"], ["en", "English"], ["es", "Español"], ["pt-BR", "Português"], ["fr", "Français"], ["de", "Deutsch"], ["pl", "Polski"], ["nl", "Nederlands"]];
export const LANG_COOKIE = "bib_lang";

/**
 * El idioma de la biblioteca:
 * el que eligió en el selector; si no, el primero del navegador que tengamos; si no, el de su compra o la tienda.
 */
export function uiLocale(chosen: string | null | undefined, acceptLanguage: string | null | undefined, fallback: string | null | undefined): Locale {
  return deviceLocale(chosen, acceptLanguage) ?? libLocale(fallback);
}

/** El idioma que eligió o el de su dispositivo; null si ninguno es de los nuestros (entonces decide su compra o la tienda). */
export function deviceLocale(chosen: string | null | undefined, acceptLanguage: string | null | undefined): Locale | null {
  if (chosen && LIB_LANGS.some(([k]) => k === chosen)) return libLocale(chosen);
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (["it", "en", "es", "pt", "fr", "de", "pl", "nl"].includes(tag.slice(0, 2).toLowerCase())) return libLocale(tag.toLowerCase().startsWith("pt") ? "pt-BR" : tag.slice(0, 2).toLowerCase());
  }
  return null;
}

/**
 * Los temas de las ofertas (offers.category, en castellano en el panel) para los filtros de la Tienda, en cada idioma
 * (it, en, es, pt, fr, de, pl, nl). Un tema nuevo sin traducción se muestra tal cual.
 */
const TOPIC_LABELS: Record<string, [string, string, string, string, string, string, string, string]> = {
  "Colorimetría": ["Colorimetria", "Hair color", "Colorimetría", "Colorimetria", "Colorimétrie", "Haarfarbe", "Koloryzacja", "Haarkleuring"],
  "Psicología": ["Psicologia", "Psychology", "Psicología", "Psicologia", "Psychologie", "Psychologie", "Psychologia", "Psychologie"],
  "Farmacología": ["Farmacologia", "Pharmacology", "Farmacología", "Farmacologia", "Pharmacologie", "Pharmakologie", "Farmakologia", "Farmacologie"],
  "Física": ["Fisica", "Physics", "Física", "Física", "Physique", "Physik", "Fizyka", "Natuurkunde"],
  "Odontología": ["Odontoiatria", "Dentistry", "Odontología", "Odontologia", "Odontologie", "Zahnmedizin", "Stomatologia", "Tandheelkunde"],
  "ECG": ["ECG", "ECG", "ECG", "ECG", "ECG", "EKG", "EKG", "ECG"],
  "Nutrición": ["Nutrizione", "Nutrition", "Nutrición", "Nutrição", "Nutrition", "Ernährung", "Żywienie", "Voeding"],
  "Uñas": ["Unghie", "Nails", "Uñas", "Unhas", "Ongles", "Nägel", "Paznokcie", "Nagels"],
  "Mecánica": ["Meccanica", "Mechanics", "Mecánica", "Mecânica", "Mécanique", "Mechanik", "Mechanika", "Mechanica"],
  "Plomería": ["Idraulica", "Plumbing", "Plomería", "Encanamento", "Plomberie", "Sanitär", "Hydraulika", "Loodgieterswerk"],
  "Electricidad": ["Elettricità", "Electrical", "Electricidad", "Eletricidade", "Électricité", "Elektrik", "Elektryka", "Elektra"],
  "Bricolaje": ["Fai da te", "DIY", "Bricolaje", "Faça você mesmo", "Bricolage", "Heimwerken", "Majsterkowanie", "Klussen"],
  "Química": ["Chimica", "Chemistry", "Química", "Química", "Chimie", "Chemie", "Chemia", "Scheikunde"],
  "Veterinaria": ["Veterinaria", "Veterinary", "Veterinaria", "Veterinária", "Vétérinaire", "Tiermedizin", "Weterynaria", "Diergeneeskunde"],
  "Climatización": ["Climatizzazione", "HVAC", "Climatización", "Climatização", "Climatisation", "Klimatechnik", "Klimatyzacja", "Klimaattechniek"],
  "Hormonas": ["Ormoni", "Hormones", "Hormonas", "Hormônios", "Hormones", "Hormone", "Hormony", "Hormonen"],
  "Crianza": ["Genitorialità", "Parenting", "Crianza", "Parentalidade", "Parentalité", "Erziehung", "Rodzicielstwo", "Opvoeding"],
  "CDL": ["CDL", "CDL", "CDL", "CDL", "CDL", "CDL", "CDL", "CDL"],
  "Barbería": ["Barbiere", "Barbering", "Barbería", "Barbearia", "Barbier", "Barbier", "Barber", "Barbier"],
  "Maquillaje": ["Trucco", "Makeup", "Maquillaje", "Maquiagem", "Maquillage", "Make-up", "Makijaż", "Make-up"],
  "Cálculos y dosis": ["Calcoli e dosaggi", "Dosage calculations", "Cálculos y dosis", "Cálculos e doses", "Calcul de doses", "Dosisberechnung", "Obliczanie dawek", "Doseringsberekeningen"],
  "Astrología": ["Astrologia", "Astrology", "Astrología", "Astrologia", "Astrologie", "Astrologie", "Astrologia", "Astrologie"],
  "Medicamentos": ["Farmaci", "Medicines", "Medicamentos", "Medicamentos", "Médicaments", "Medikamente", "Leki", "Medicijnen"],
  "Anatomía": ["Anatomia", "Anatomy", "Anatomía", "Anatomia", "Anatomie", "Anatomie", "Anatomia", "Anatomie"],
  "Radiografías": ["Radiografie", "X-rays", "Radiografías", "Radiografias", "Radiographies", "Röntgen", "Radiologia", "Röntgenfoto's"],
  "Pastelería": ["Pasticceria", "Pastry", "Pastelería", "Confeitaria", "Pâtisserie", "Konditorei", "Cukiernictwo", "Patisserie"],
  "Dermatología": ["Dermatologia", "Dermatology", "Dermatología", "Dermatologia", "Dermatologie", "Dermatologie", "Dermatologia", "Dermatologie"],
  "Emogas": ["Emogasanalisi", "Blood gases", "Gasometría", "Gasometria", "Gaz du sang", "Blutgase", "Gazometria", "Bloedgassen"],
  "Matemática niños": ["Matematica per bambini", "Kids' math", "Matemática para chicos", "Matemática infantil", "Maths pour enfants", "Mathe für Kinder", "Matematyka dla dzieci", "Rekenen voor kinderen"],
  "Pestañas": ["Ciglia", "Lashes", "Pestañas", "Cílios", "Cils", "Wimpern", "Rzęsy", "Wimpers"],
  "Traumatologia": ["Traumatologia", "Orthopedics", "Traumatología", "Traumatologia", "Traumatologie", "Traumatologie", "Traumatologia", "Traumatologie"],
  "Análisis de sangre": ["Esami del sangue", "Blood tests", "Análisis de sangre", "Exames de sangue", "Analyses de sang", "Blutwerte", "Badania krwi", "Bloedonderzoek"],
  "Pelletteria": ["Pelletteria", "Leathercraft", "Marroquinería", "Marroquinaria", "Maroquinerie", "Lederhandwerk", "Kaletnictwo", "Leerbewerking"],
  "Biología": ["Biologia", "Biology", "Biología", "Biologia", "Biologie", "Biologie", "Biologia", "Biologie"],
  "Flebotomía": ["Flebotomia", "Phlebotomy", "Flebotomía", "Flebotomia", "Phlébotomie", "Blutentnahme", "Flebotomia", "Flebotomie"],
  "Neurología": ["Neurologia", "Neurology", "Neurología", "Neurologia", "Neurologie", "Neurologie", "Neurologia", "Neurologie"],
  "Pediatría": ["Pediatria", "Pediatrics", "Pediatría", "Pediatria", "Pédiatrie", "Kinderheilkunde", "Pediatria", "Kindergeneeskunde"],
};
const TOPIC_LANGS = ["it", "en", "es", "pt", "fr", "de", "pl", "nl"];
export function topicLabel(category: string, locale: string | null | undefined): string {
  const row = TOPIC_LABELS[category.trim()];
  const i = TOPIC_LANGS.indexOf((locale ?? "").slice(0, 2));
  return row ? row[i >= 0 ? i : 1] : category.trim();
}

/** Textos del menú. */
export type NavTexts = { menu: string; topics: string; account: string; close: string; back: string };
const NAV: Record<string, NavTexts> = {
  it: { menu: "Menu", topics: "Argomenti", account: "La tua area", close: "Chiudi", back: "Indietro" },
  en: { menu: "Menu", topics: "Topics", account: "Your account", close: "Close", back: "Back" },
  es: { menu: "Menú", topics: "Temas", account: "Tu cuenta", close: "Cerrar", back: "Volver" },
  pt: { menu: "Menu", topics: "Temas", account: "Sua conta", close: "Fechar", back: "Voltar" },
  fr: { menu: "Menu", topics: "Thèmes", account: "Votre espace", close: "Fermer", back: "Retour" },
  de: { menu: "Menü", topics: "Themen", account: "Dein Bereich", close: "Schließen", back: "Zurück" },
  pl: { menu: "Menu", topics: "Tematy", account: "Twoje konto", close: "Zamknij", back: "Wróć" },
  nl: { menu: "Menu", topics: "Onderwerpen", account: "Jouw account", close: "Sluiten", back: "Terug" },
};
export const navTexts = (locale: string | null | undefined): NavTexts => NAV[(locale ?? "").slice(0, 2)] ?? NAV.en;

/**
 * Los temas agrupados en categorías para el menú (it, en, es, pt, fr, de, pl, nl). Un tema que no está en ningún
 * grupo va a «Otros».
 */
const GROUPS: [string, [string, string, string, string, string, string, string, string], string[]][] = [
  ["salud", ["Salute e medicina", "Health & medicine", "Salud y medicina", "Saúde e medicina", "Santé et médecine", "Gesundheit & Medizin", "Zdrowie i medycyna", "Gezondheid & geneeskunde"],
    ["Farmacología", "Medicamentos", "ECG", "Anatomía", "Análisis de sangre", "Emogas", "Radiografías", "Cálculos y dosis", "Dermatología", "Neurología", "Hormonas", "Traumatologia", "Pediatría", "Flebotomía", "Veterinaria"]],
  ["odonto", ["Odontoiatria", "Dentistry", "Odontología", "Odontologia", "Odontologie", "Zahnmedizin", "Stomatologia", "Tandheelkunde"], ["Odontología"]],
  ["belleza", ["Bellezza", "Beauty", "Belleza", "Beleza", "Beauté", "Beauty", "Uroda", "Schoonheid"], ["Uñas", "Pestañas", "Maquillaje", "Colorimetría", "Barbería"]],
  ["ciencias", ["Scienze", "Science", "Ciencias", "Ciências", "Sciences", "Naturwissenschaften", "Nauki ścisłe", "Wetenschap"], ["Física", "Química", "Biología", "Matemática niños"]],
  ["oficios", ["Mestieri", "Trades", "Oficios", "Profissões", "Métiers", "Handwerk", "Zawody", "Vakmanschap"],
    ["Electricidad", "Plomería", "Climatización", "Mecánica", "Bricolaje", "CDL", "Pelletteria", "Pastelería"]],
  ["familia", ["Famiglia e benessere", "Family & wellbeing", "Familia y bienestar", "Família e bem-estar", "Famille et bien-être", "Familie & Wohlbefinden", "Rodzina i samopoczucie", "Gezin & welzijn"],
    ["Crianza", "Nutrición", "Psicología", "Astrología"]],
];
const OTHER: [string, string, string, string, string, string, string, string] = ["Altro", "Other", "Otros", "Outros", "Autres", "Weitere", "Inne", "Overig"];

/** Los grupos con los temas presentes (con su cantidad de libros), en el idioma de quien mira. */
export function topicGroups(counts: Map<string, number>, locale: string | null | undefined): { key: string; label: string; topics: [string, string, number][] }[] {
  const i = Math.max(0, TOPIC_LANGS.indexOf((locale ?? "").slice(0, 2)));
  const used = new Set<string>();
  const out: { key: string; label: string; topics: [string, string, number][] }[] = [];
  const add = (key: string, label: string, cats: string[]) => {
    const topics = cats.filter((c) => counts.get(c)).map((c) => { used.add(c); return [c, topicLabel(c, locale), counts.get(c)!] as [string, string, number]; })
      .sort((a, b) => a[1].localeCompare(b[1]));
    if (topics.length) out.push({ key, label, topics });
  };
  for (const [key, labels, cats] of GROUPS) add(key, labels[i], cats);
  add("otros", OTHER[i], [...counts.keys()].filter((c) => c && !used.has(c)));
  return out;
}
