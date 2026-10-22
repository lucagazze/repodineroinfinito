import { Inter } from "next/font/google";
import type { CSSProperties } from "react";
import { T, type Locale } from "@/lib/i18n";
import { offerUi } from "@/lib/postcompra-page";
import { PreviewPill } from "../oferta/[step]/PreviewPill";
import { StoreLogo } from "./StoreLogo";
import { DownloadTracker } from "./DownloadTracker";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

/**
 * La página de gracias / descargas, con el mismo lenguaje visual que las OTO:
 * columna blanca centrada, barra azul con la tienda, píldora verde de pago
 * confirmado, una tarjeta por producto con su botón de descarga.
 * La usan /gracias (pedido real) y la simulación del panel.
 */

export type TyItem = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  kind: string;
  links: { label: string; url: string }[];
};

type Texts = {
  eyebrow: (n: string) => string;
  lead: string;
  leadSent: string;
  yourPurchase: string;
  added: string;
  bonus: string;
  included: string;
  opensDrive: string;
  opensTab: string;
  pdf: string;
  help: string;
};

const TX: Record<Locale, Texts> = {
  en: {
    eyebrow: (n) => `✓ Payment confirmed · order ${n}`,
    lead: "Your order is ready. Download it below.",
    leadSent: "Your order is ready. Download it below — we also emailed the links to",
    yourPurchase: "Your purchase", added: "Added to your order", bonus: "Bonus", included: "Included",
    opensDrive: "Opens in Google Drive", opensTab: "Opens in a new tab", pdf: "Downloads the PDF",
    help: "Need a hand? Write to",
  },
  it: {
    eyebrow: (n) => `✓ Pagamento confermato · ordine ${n}`,
    lead: "Il tuo ordine è pronto. Scaricalo qui sotto.",
    leadSent: "Il tuo ordine è pronto. Scaricalo qui sotto: ti abbiamo mandato i link anche a",
    yourPurchase: "Il tuo acquisto", added: "Aggiunto al tuo ordine", bonus: "Bonus", included: "Incluso",
    opensDrive: "Si apre in Google Drive", opensTab: "Si apre in una nuova scheda", pdf: "Scarica il PDF",
    help: "Serve aiuto? Scrivi a",
  },
  es: {
    eyebrow: (n) => `✓ Pago confirmado · pedido ${n}`,
    lead: "Tu pedido está listo. Descargalo acá abajo.",
    leadSent: "Tu pedido está listo. Descargalo acá abajo: también te mandamos los links a",
    yourPurchase: "Tu compra", added: "Sumado a tu pedido", bonus: "Bonus", included: "Incluido",
    opensDrive: "Se abre en Google Drive", opensTab: "Se abre en una pestaña nueva", pdf: "Descarga el PDF",
    help: "¿Necesitás ayuda? Escribí a",
  },
  "pt-BR": {
    eyebrow: (n) => `✓ Pagamento confirmado · pedido ${n}`,
    lead: "Seu pedido está pronto. Baixe aqui embaixo.",
    leadSent: "Seu pedido está pronto. Baixe aqui embaixo: também enviamos os links para",
    yourPurchase: "Sua compra", added: "Adicionado ao seu pedido", bonus: "Bônus", included: "Incluído",
    opensDrive: "Abre no Google Drive", opensTab: "Abre em uma nova aba", pdf: "Baixa o PDF",
    help: "Precisa de ajuda? Escreva para",
  },
  fr: {
    eyebrow: (n) => `✓ Paiement confirmé · commande ${n}`,
    lead: "Ta commande est prête. Télécharge-la ci-dessous.",
    leadSent: "Ta commande est prête. Télécharge-la ci-dessous : nous t’avons aussi envoyé les liens à",
    yourPurchase: "Ton achat", added: "Ajouté à ta commande", bonus: "Bonus", included: "Inclus",
    opensDrive: "S’ouvre dans Google Drive", opensTab: "S’ouvre dans un nouvel onglet", pdf: "Télécharge le PDF",
    help: "Besoin d’aide ? Écris à",
  },
  de: {
    eyebrow: (n) => `✓ Zahlung bestätigt · Bestellung ${n}`,
    lead: "Deine Bestellung ist fertig. Lade sie unten herunter.",
    leadSent: "Deine Bestellung ist fertig. Lade sie unten herunter – die Links haben wir dir auch geschickt an",
    yourPurchase: "Dein Kauf", added: "Zu deiner Bestellung hinzugefügt", bonus: "Bonus", included: "Inklusive",
    opensDrive: "Öffnet sich in Google Drive", opensTab: "Öffnet sich in einem neuen Tab", pdf: "Lädt das PDF herunter",
    help: "Brauchst du Hilfe? Schreib an",
  },
};

const TY_CSS = `
body{background:#f4f7fd}
.ty{--primary:#2645a0;--primary-dark:#1c3479;--primary-light:#eff4fd;--bg-light:#f4f7fd;
 --text:#101828;--text-light:#667085;--border:#e1e8f4;--success:#10b981;--guarantee-bg:#f0fdf4;
 --shadow:0 4px 20px rgba(16,24,40,.08);
 font-family:var(--ty-font),Inter,system-ui,-apple-system,sans-serif;color:var(--text);background:var(--bg-light);
 line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:clip;min-height:100vh}
.ty *{box-sizing:border-box}
.ty .pg{width:100%;max-width:540px;min-height:100vh;margin:0 auto;background:#fff;display:flex;flex-direction:column}
.ty .banda{padding:11px 12px;background:linear-gradient(90deg,#1c3479,#2645a0 55%,#1c3479);color:#fff;
 text-align:center;font-size:12px;font-weight:800;letter-spacing:.1em;line-height:1.8;text-transform:uppercase}
.ty .brand{padding:20px 18px 0;text-align:center}
.ty .brand img{display:inline-block;max-height:36px;max-width:200px;width:auto;height:auto}
.ty .top{padding:22px 18px 4px;text-align:center}
.ty .eyebrow{display:inline-block;font-size:12.5px;font-weight:700;line-height:1.7;text-transform:uppercase;
 letter-spacing:.1em;color:var(--success);background:var(--guarantee-bg);padding:6px 16px;border-radius:99px}
.ty h1{margin:16px 0 8px;font-size:clamp(28px,7vw,34px);font-weight:800;line-height:1.15;letter-spacing:-.02em;text-wrap:balance;overflow-wrap:anywhere}
.ty .lead{margin:0;font-size:15px;color:var(--text-light);overflow-wrap:anywhere;white-space:pre-line}
.ty .lead strong{color:var(--text);font-weight:600}
.ty .items{display:grid;gap:12px;padding:22px 14px 0}
.ty .item{padding:16px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:var(--shadow)}
.ty .row{display:flex;gap:14px;align-items:center;min-width:0}
.ty .row img{flex:none;width:56px;height:auto;border-radius:6px;box-shadow:0 3px 10px rgba(16,24,40,.16)}
.ty .row div{min-width:0}
.ty .tag{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--success)}
.ty .name{margin-top:1px;font-size:16px;font-weight:800;line-height:1.3;overflow-wrap:anywhere}
.ty .btn{display:block;width:100%;margin-top:14px;padding:15px 16px;border-radius:11px;background:var(--primary);
 color:#fff;font-size:15px;font-weight:800;line-height:1.35;text-align:center;text-decoration:none;
 box-shadow:0 6px 18px rgba(38,69,160,.26);transition:background .15s;overflow-wrap:anywhere}
.ty .btn:hover{background:var(--primary-dark)}
.ty .btn.alt{margin-top:8px;background:#fff;color:var(--primary-dark);border:1.5px solid #d4dbe7;box-shadow:none;font-weight:700}
.ty .btn.alt:hover{background:var(--bg-light)}
.ty .hint{margin:7px 0 0;text-align:center;font-size:12px;color:var(--text-light)}
.ty .incl{margin:12px 14px 0;padding:14px 16px;border-radius:14px;background:var(--bg-light);font-size:14px}
.ty .incl b{display:block;margin-bottom:4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text-light)}
.ty .incl div{display:flex;gap:10px}
.ty .incl i{font-style:normal;color:var(--success);font-weight:800}
.ty .sum{margin:12px 14px 0;padding:14px 16px;border:1px solid var(--border);border-radius:14px;font-size:14.5px}
.ty .sum b{display:block;margin-bottom:6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text-light)}
.ty .sum div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.ty .sum div span:last-child{white-space:nowrap}
.ty .sum .tot{margin-top:6px;padding-top:8px;border-top:1px solid var(--border);font-weight:800}
/* «Y ahora qué». Mismo ancho y mismo radio que el resto de la página: es una
   sección más de la entrega, no un anuncio pegado al final. Se separa del
   bloque de descargas con un filete, no con un color: lo que vende tiene que
   verse claramente después de lo que ya se pagó. */
.ty .next{margin:22px 14px 0;padding-top:18px;border-top:1px solid var(--border);display:grid;gap:12px}
.ty .nx{padding:16px 18px;border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:var(--shadow)}
.ty .nk{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text-light)}
.ty .nx h2{margin:6px 0 0;font-size:16.5px;line-height:1.3;font-weight:700;color:var(--text)}
.ty .nx p{margin:8px 0 0;font-size:14px;line-height:1.55;color:var(--text-light);white-space:pre-line}
.ty .nx ul{margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.5;color:var(--text-light)}
.ty .nx li{margin:3px 0}
.ty .nl{display:inline-block;margin-top:12px;font-size:14px;font-weight:600;color:var(--primary-dark);text-decoration:none}
.ty .nl:hover{text-decoration:underline}
.ty .nn{margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-light)}
.ty .spam{margin:14px 14px 0;padding:13px 16px;border-radius:12px;background:var(--primary-light);color:var(--primary-dark);font-size:13.5px;text-align:center}
.ty .foot{padding:24px 18px 32px;text-align:center;font-size:13px;color:var(--text-light)}
.ty .foot a{color:var(--primary);font-weight:700;overflow-wrap:anywhere}
.ty .foot .g{display:inline-block;margin-top:8px;padding:5px 14px;border-radius:99px;background:var(--guarantee-bg);color:#067647;font-weight:700;font-size:12px}
`;

export function ThankYouView(p: {
  locale: Locale;
  storeName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  orderNumber: string;
  title: string;
  /** Mensaje propio de la tienda ({email} → el email en negrita). Vacío = el texto de siempre. */
  message: string | null;
  email: string | null;
  items: TyItem[];
  included: string[];
  summary: { title: string; rows: { name: string; amount: string }[]; totalLabel: string; total: string } | null;
  showSpam: boolean;
  /** «Y ahora qué»: lo que sigue después de la descarga. Vacío = no se dibuja nada. */
  next?: { kicker?: string; title: string; body?: string; bullets?: string[];
           note?: string; link?: { label: string; url: string } }[];
  guaranteeDays: number;
  preview?: { detail?: string };
  /** Pedido real: los clics en «Descargar» se registran (site_events). */
  orderId?: string;
  /** Compra de prueba del panel: una franja lo aclara. */
  test?: boolean;
}) {
  const tx = TX[p.locale] ?? TX.en;
  const t = T[p.locale] ?? T.en;
  const tagOf = (k: string) => (k === "main" ? tx.yourPurchase : k === "bump" || k === "upsell" ? tx.added : k === "bonus" ? tx.bonus : tx.included);
  const hintOf = (u: string) =>
    /drive\.google\.com|docs\.google\.com/i.test(u) ? tx.opensDrive : /\/d\/[^/]+\/[^/]+$/.test(u) || /\.pdf(\?|$)/i.test(u) ? tx.pdf : tx.opensTab;

  return (
    <div className={`ty ${inter.className}`} style={{ "--ty-font": inter.style.fontFamily } as CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: TY_CSS }} />
      {p.preview && <PreviewPill label={offerUi(p.locale).pill} detail={p.preview.detail} />}
      {p.test && <PreviewPill label="Compra de prueba" detail="no se cobró nada" />}
      <main className="pg">
        <div className="banda">{p.storeName}</div>
        {p.logoUrl && <StoreLogo src={p.logoUrl} alt={p.storeName} />}

        <section className="top">
          <div className="eyebrow">{tx.eyebrow(p.orderNumber)}</div>
          <h1>{p.title}</h1>
          {p.message ? (
            <p className="lead">
              {p.message.split("{email}").map((part, i, all) => (
                <span key={i}>{part}{i < all.length - 1 && <strong>{p.email ?? ""}</strong>}</span>
              ))}
            </p>
          ) : (
            <p className="lead">
              {p.email ? <>{tx.leadSent} <strong>{p.email}</strong>.</> : tx.lead}
            </p>
          )}
        </section>

        {p.items.length > 0 && (
          <section className="items">
            {p.items.map((it) => (
              <div className="item" key={it.id}>
                <div className="row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.image && <img src={it.image} alt="" loading="lazy" />}
                  <div>
                    <div className="tag">{tagOf(it.kind)}</div>
                    <div className="name">{it.name}</div>
                  </div>
                </div>
                {it.links.map((l, i) => (
                  <a key={l.url + i} className={i === 0 ? "btn" : "btn alt"} href={l.url} target="_blank" rel="noopener noreferrer" data-dl={it.slug}>
                    {i === 0 ? `↓ ${t.download}` : l.label}
                  </a>
                ))}
                {it.links[0] && <p className="hint">{hintOf(it.links[0].url)}</p>}
              </div>
            ))}
          </section>
        )}

        {p.included.length > 0 && (
          <section className="incl">
            <b>{t.included.replace(/\s*:\s*$/, "")}</b>
            {p.included.map((n) => <div key={n}><i>✓</i><span>{n}</span></div>)}
          </section>
        )}

        {p.summary && p.summary.rows.length > 0 && (
          <section className="sum">
            <b>{p.summary.title}</b>
            {p.summary.rows.map((r, i) => <div key={i}><span>{r.name}</span><span>{r.amount}</span></div>)}
            <div className="tot"><span>{p.summary.totalLabel}</span><span>{p.summary.total}</span></div>
          </section>
        )}

        {/* Lo que sigue. Va DESPUES de las descargas a proposito: el comprador
            vino a buscar sus archivos, y una pagina que le pone otra cosa
            delante del boton que vino a apretar se lee como un embudo, no como
            una entrega. Una vez que tiene lo suyo, esto es bienvenido. */}
        {(p.next ?? []).length > 0 && (
          <section className="next">
            {(p.next ?? []).map((b, i) => (
              <article className="nx" key={i}>
                {b.kicker && <div className="nk">{b.kicker}</div>}
                <h2>{b.title}</h2>
                {b.body && <p>{b.body}</p>}
                {b.bullets && b.bullets.length > 0 && (
                  <ul>{b.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>
                )}
                {b.link && (
                  <a className="nl" href={b.link.url} target="_blank" rel="noopener noreferrer">
                    {b.link.label} →
                  </a>
                )}
                {b.note && <p className="nn">{b.note}</p>}
              </article>
            ))}
          </section>
        )}

        {p.showSpam && <p className="spam">{t.emailHelp}</p>}

        <footer className="foot">
          {p.supportEmail && <>{tx.help} <a href={`mailto:${p.supportEmail}`}>{p.supportEmail}</a></>}
          {p.guaranteeDays > 0 && <><br /><span className="g">{t.guarantee(p.guaranteeDays)}</span></>}
        </footer>
      </main>
      {p.orderId && !p.preview && <DownloadTracker order={p.orderId} />}
    </div>
  );
}
