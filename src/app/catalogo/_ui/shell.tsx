import type { CSSProperties, ReactNode } from "react";
import { CATALOG_CSS } from "./catalog.css";
import type { PageCtx, PagePath } from "./ctx";
import { legalSections, labelSep, LAST_UPDATED, type DocId } from "@/lib/catalog-texts";
import { formatDate, telHref } from "@/lib/catalog";

// ------------------------------------------------------------------ íconos

const PATHS = {
  check: "M20 6 9 17l-5-5",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  refund: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ------------------------------------------------------------- auto-links

const LINK_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?»)"”]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

/** Texto plano con emails y URLs clickeables. */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(LINK_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} className="cat-auto" href={p.includes("@") && !p.startsWith("http") ? `mailto:${p}` : p}>
            {p}
          </a>
        ) : (
          p
        )
      )}
    </>
  );
}

// ------------------------------------------------------------ medios de pago

export function PaymentMarks() {
  const box = { width: 60, height: 38, viewBox: "0 0 60 38", role: "img" } as const;
  return (
    <div className="cat-pay">
      <svg {...box} aria-label="Visa">
        <rect x=".5" y=".5" width="59" height="37" rx="6" fill="#fff" stroke="#e2e8f0" />
        <text x="30" y="24.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="15"
          fontWeight="900" fontStyle="italic" fill="#1a1f71" letterSpacing=".5">VISA</text>
      </svg>
      <svg {...box} aria-label="Mastercard">
        <rect x=".5" y=".5" width="59" height="37" rx="6" fill="#fff" stroke="#e2e8f0" />
        <circle cx="24.5" cy="19" r="10" fill="#eb001b" />
        <circle cx="35.5" cy="19" r="10" fill="#f79e1b" />
        <path d="M30 10.6a10 10 0 0 1 0 16.8 10 10 0 0 1 0-16.8z" fill="#ff5f00" />
      </svg>
      <svg {...box} aria-label="American Express">
        <rect width="60" height="38" rx="6" fill="#1f72cd" />
        <text x="30" y="23.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="12"
          fontWeight="800" fill="#fff" letterSpacing=".5">AMEX</text>
      </svg>
      <svg {...box} aria-label="Apple Pay">
        <rect width="60" height="38" rx="6" fill="#000" />
        <text x="30" y="23" textAnchor="middle" fontFamily="-apple-system, 'Segoe UI', Arial, sans-serif" fontSize="9.5"
          fontWeight="600" fill="#fff">Apple Pay</text>
      </svg>
      <svg {...box} aria-label="Google Pay">
        <rect x=".5" y=".5" width="59" height="37" rx="6" fill="#fff" stroke="#e2e8f0" />
        <text x="30" y="23" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fontWeight="600"
          fill="#3c4043"><tspan fill="#4285f4">G</tspan>oogle Pay</text>
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ shell

export function Shell({ c, children }: { c: PageCtx; children: ReactNode }) {
  const { t, store, brand, legal, phone, colors } = c;
  const vars = {
    "--accent": colors.accent,
    "--on-accent": colors.onAccent,
    "--accent-text": colors.accentText,
  } as CSSProperties;

  const nav: [PagePath, string][] = [
    ["", t.ui.nav.home],
    ["/terms", t.ui.nav.terms],
    ["/privacy", t.ui.nav.privacy],
    ["/refund-policy", t.ui.nav.refund],
    ["/contact", t.ui.nav.contact],
  ];
  const owner = legal.name ?? brand;
  const showBrandToo = !!legal.name && legal.name.toLowerCase() !== brand.toLowerCase();

  return (
    <div className="cat" lang={c.lang} style={vars}>
      <style dangerouslySetInnerHTML={{ __html: CATALOG_CSS }} />

      <header className="cat-top">
        <div className="cat-wrap cat-topin">
          <a className="cat-brand" href={c.link("")}>
            {store.logo_url ? (
              <img className="cat-logo" src={store.logo_url} alt={brand} height={34} />
            ) : (
              <>
                <span className="cat-mono" aria-hidden="true">{brand.trim().charAt(0)}</span>
                <span>{brand}</span>
              </>
            )}
          </a>
          {c.langs.length > 1 && (
            <nav className="cat-lang" aria-label={t.ui.language}>
              {c.langs.map((l) => (
                <a key={l} href={c.link(c.path, l)} hrefLang={l} lang={l} aria-current={l === c.lang ? "true" : undefined}
                  title={l.toUpperCase()}>
                  {l.toUpperCase()}
                </a>
              ))}
            </nav>
          )}
          <nav className="cat-nav" aria-label={brand}>
            {nav.map(([p, label]) => (
              <a key={p || "home"} href={c.link(p)} aria-current={p === c.path ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="cat-foot">
        <div className="cat-wrap cat-footgrid">
          <div>
            <p>
              <strong>{owner}</strong>
              {showBrandToo ? ` · ${brand}` : ""}
            </p>
            {legal.address && <p>{legal.address}</p>}
            <p>
              {t.ui.email}
              {labelSep(c.lang)}
              <a href={`mailto:${store.support_email}`}>{store.support_email}</a>
              {phone && (
                <>
                  {" · "}
                  {t.ui.phone}
                  {labelSep(c.lang)}
                  <a href={telHref(phone)}>{phone}</a>
                </>
              )}
            </p>
          </div>
          <nav className="cat-footlinks" aria-label={t.ui.policiesTitle}>
            <a href={c.link("/terms")}>{t.ui.docs.terms}</a>
            <a href={c.link("/privacy")}>{t.ui.docs.privacy}</a>
            <a href={c.link("/refund-policy")}>{t.ui.docs.refund}</a>
            <a href={c.link("/contact")}>{t.ui.nav.contact}</a>
          </nav>
        </div>
        <div className="cat-wrap">
          <p className="cat-copy">{t.ui.rights(new Date().getFullYear(), owner)}</p>
        </div>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------ doc legal

export function LegalDoc({ c, doc, intro }: { c: PageCtx; doc: DocId; intro?: string }) {
  const sections = legalSections(c.lang, doc, c.legalCtx);
  const title = c.t.ui.docs[doc];
  return (
    <article className="cat-wrap cat-doc">
      <h1>{title}</h1>
      {intro && <p className="cat-doclead">{intro}</p>}
      <p className="cat-updated">
        {c.t.ui.lastUpdated} <time dateTime={LAST_UPDATED}>{formatDate(LAST_UPDATED, c.t.intl)}</time>
      </p>
      <nav className="cat-toc" aria-label={c.t.ui.contents}>
        <p>{c.t.ui.contents}</p>
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                {s.n}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="cat-legal">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`h-${s.id}`}>
            <h2 id={`h-${s.id}`}>
              {s.n}. {s.title}
            </h2>
            {s.paras.map((p, i) => (
              <p key={i}>
                <Linkify text={p} />
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
