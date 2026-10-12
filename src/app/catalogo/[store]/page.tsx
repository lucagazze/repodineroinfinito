import type { Metadata } from "next";
import { pageCtx, type PageCtx, type PageProps } from "@/app/catalogo/_ui/ctx";
import { Shell, Icon, PaymentMarks } from "@/app/catalogo/_ui/shell";
import { formatMoney, telHref, type CatalogItem } from "@/lib/catalog";

// ?lang hace la página dinámica; los datos vienen con caché de 5 min (getCatalog).
export const dynamic = "force-dynamic";

const paragraphs = (s?: string) =>
  (s ?? "")
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Primeras oraciones que entran en ~160 caracteres, para la meta description. */
function summary(s: string, max = 160) {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const dot = cut.lastIndexOf(". ");
  return dot > 60 ? cut.slice(0, dot + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const c = await pageCtx(props, "");
  const b = c.store.business ?? {};
  const tagline = b.tagline?.trim();
  return c.meta(
    tagline ? `${c.brand} — ${tagline}` : `${c.brand} — ${c.t.ui.productsTitle}`,
    b.about?.trim() ? summary(b.about) : c.t.ui.metaHome(c.brand)
  );
}

function ProductCard({ c, it }: { c: PageCtx; it: CatalogItem }) {
  const { t, currency } = c;
  const money = (n: number) => formatMoney(n, currency, t.intl);
  return (
    <article className="cat-card" data-kind={it.kind}>
      <div className="cat-media">
        {it.image ? (
          <img src={it.image} alt={it.name} loading="lazy" decoding="async" width={600} height={800} />
        ) : (
          <div className="cat-ph" aria-hidden="true">{it.name.trim().charAt(0)}</div>
        )}
      </div>
      <div className="cat-body">
        <span className="cat-label">{t.ui.labels[it.kind]}</span>
        <h3 className="cat-name">{it.name}</h3>
        {it.description.trim() && <p className="cat-desc">{it.description}</p>}
        <div className="cat-buy">
          {it.kind === "bonus"
            ? it.includedWith && <p className="cat-incl">{t.ui.includedWith(it.includedWith)}</p>
            : it.amount != null && (
                <>
                  <p className="cat-price">
                    <strong>{money(it.amount)}</strong>
                    {it.compareAt != null && <s>{money(it.compareAt)}</s>}
                  </p>
                  <p className="cat-once">{t.ui.oneTime}</p>
                </>
              )}
          {it.href &&
            (it.kind === "product" ? (
              <a className="cat-btn" href={it.href}>
                {t.ui.buyNow}
              </a>
            ) : (
              <a className="cat-link" href={it.href}>
                {t.ui.viewAtCheckout}
              </a>
            ))}
        </div>
      </div>
    </article>
  );
}

export default async function CatalogHome(props: PageProps) {
  const c = await pageCtx(props, "");
  const { t, store, brand, legal, phone, reply, items, currency } = c;
  const b = store.business ?? {};
  const tagline = b.tagline?.trim();
  const about = paragraphs(b.about);
  const audience = b.audience?.trim();
  const days = store.guarantee_days;
  const cards = t.ui.cards;
  const mail = `mailto:${store.support_email}`;

  return (
    <Shell c={c}>
      <section className="cat-hero">
        <div className="cat-wrap cat-herogrid">
          <div>
            {tagline && <p className="cat-eyebrow">{brand}</p>}
            <h1 className="cat-h1">{tagline || brand}</h1>
            <div className="cat-about">
              {about.length ? (
                about.map((p, i) => <p key={i}>{p}</p>)
              ) : (
                <p className="cat-leadp">{t.ui.heroFallback(days)}</p>
              )}
            </div>
            {audience && (
              <p className="cat-who">
                <strong>{t.ui.whoFor}</strong> {audience}
              </p>
            )}
            {legal.name && (
              <p className="cat-op">
                {t.ui.operatedBy} <strong>{legal.name}</strong>
                {legal.address ? ` · ${legal.address}` : ""}
              </p>
            )}
            <a className="cat-cta" href="#products">
              {t.ui.productsCta}
            </a>
          </div>
          <ul className="cat-facts">
            <li>
              <Icon name="download" />
              <span>{t.ui.facts.delivery}</span>
            </li>
            <li>
              <Icon name="refund" />
              <span>{t.ui.facts.refund(days)}</span>
            </li>
            <li>
              <Icon name="lock" />
              <span>{t.ui.facts.stripe}</span>
            </li>
            <li>
              <Icon name="mail" />
              <span>
                {t.ui.facts.support} <a href={mail}>{store.support_email}</a>
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="cat-sec" id="products" aria-labelledby="products-h">
        <div className="cat-wrap">
          <h2 className="cat-h2" id="products-h">
            {t.ui.productsTitle}
          </h2>
          <p className="cat-sub">{t.ui.productsIntro}</p>
          <p className="cat-note">
            <Icon name="info" size={16} />
            <span>{t.ui.currencyNote}</span>
          </p>
          {items.length ? (
            <div className="cat-grid">
              {items.map((it) => (
                <ProductCard key={it.id} c={c} it={it} />
              ))}
            </div>
          ) : (
            <p className="cat-empty">{t.ui.empty}</p>
          )}
        </div>
      </section>

      <section className="cat-sec">
        <div className="cat-wrap cat-two">
          <div className="cat-panel" id="delivery">
            <h2 className="cat-h2">{t.ui.deliveryTitle}</h2>
            <ul className="cat-list">
              <li>
                <Icon name="mail" />
                <span>{t.ui.deliveryEmail}</span>
              </li>
              <li>
                <Icon name="download" />
                <span>{t.ui.deliveryDigital}</span>
              </li>
            </ul>
            <p className="cat-small">
              <a className="cat-link" href={`${c.link("/refund-policy")}#delivery`}>
                {cards.delivery.link}
              </a>
            </p>
          </div>
          <div className="cat-panel" id="support">
            <h2 className="cat-h2">{t.ui.supportTitle}</h2>
            <p className="cat-sub" style={{ margin: 0 }}>
              {t.ui.supportIntro}
            </p>
            <dl className="cat-dl">
              <div>
                <dt>{t.ui.email}</dt>
                <dd>
                  <a href={mail}>{store.support_email}</a>
                </dd>
              </div>
              {phone && (
                <div>
                  <dt>{t.ui.phone}</dt>
                  <dd>
                    <a href={telHref(phone)}>{phone}</a>
                  </dd>
                </div>
              )}
              {legal.address && (
                <div>
                  <dt>{t.ui.address}</dt>
                  <dd>{legal.address}</dd>
                </div>
              )}
            </dl>
            {(reply.hours || reply.text) && (
              <p className="cat-reply">
                <Icon name="clock" size={16} />
                {reply.hours ? t.ui.reply(reply.hours) : t.ui.replyText(reply.text!)}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="cat-sec" aria-labelledby="policies-h">
        <div className="cat-wrap">
          <h2 className="cat-h2" id="policies-h">
            {t.ui.policiesTitle}
          </h2>
          <p className="cat-sub">{t.ui.policiesIntro}</p>
          <div className="cat-pol">
            <a className="cat-polcard" href={c.link("/refund-policy")}>
              <h3>{cards.refund.title}</h3>
              <p>{cards.refund.body(days)}</p>
              <span>{cards.refund.link}</span>
            </a>
            <a className="cat-polcard" href={`${c.link("/refund-policy")}#delivery`}>
              <h3>{cards.delivery.title}</h3>
              <p>{cards.delivery.body}</p>
              <span>{cards.delivery.link}</span>
            </a>
            <a className="cat-polcard" href={c.link("/terms")}>
              <h3>{cards.terms.title}</h3>
              <p>{cards.terms.body}</p>
              <span>{cards.terms.link}</span>
            </a>
            <a className="cat-polcard" href={c.link("/privacy")}>
              <h3>{cards.privacy.title}</h3>
              <p>{cards.privacy.body}</p>
              <span>{cards.privacy.link}</span>
            </a>
          </div>
        </div>
      </section>

      <section className="cat-sec">
        <div className="cat-wrap cat-two cat-two-top">
          <div className="cat-panel">
            <h2 className="cat-h2">{t.ui.secureTitle}</h2>
            <ul className="cat-list">
              <li>
                <Icon name="lock" />
                <span>{t.ui.secureHttps}</span>
              </li>
              <li>
                <Icon name="check" />
                <span>{t.ui.secureStripe}</span>
              </li>
              <li>
                <Icon name="check" />
                <span>{t.ui.secureCurrency(currency)}</span>
              </li>
            </ul>
          </div>
          <div className="cat-panel">
            <h2 className="cat-h2">{t.ui.weAccept}</h2>
            <PaymentMarks />
            {legal.statement && (
              <p className="cat-stmt">
                {t.ui.statement} <span className="cat-tag">{legal.statement}</span>
              </p>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}
