import type { Metadata } from "next";
import { pageCtx, type PageProps } from "@/app/catalogo/_ui/ctx";
import { Shell, Icon } from "@/app/catalogo/_ui/shell";
import { telHref } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const c = await pageCtx(props, "/contact");
  return c.meta(`${c.t.ui.docs.contact} · ${c.brand}`, c.t.ui.contactIntro);
}

export default async function ContactPage(props: PageProps) {
  const c = await pageCtx(props, "/contact");
  const { t, store, legal, phone, reply } = c;
  const mail = `mailto:${store.support_email}`;

  return (
    <Shell c={c}>
      <article className="cat-wrap cat-doc">
        <h1>{t.ui.docs.contact}</h1>
        <p className="cat-doclead">{t.ui.contactIntro}</p>

        <div className="cat-cgrid">
          <div className="cat-ccard">
            <Icon name="mail" size={20} />
            <div>
              <h2>{t.ui.email}</h2>
              <p>
                <a href={mail}>{store.support_email}</a>
              </p>
            </div>
          </div>
          {phone && (
            <div className="cat-ccard">
              <Icon name="phone" size={20} />
              <div>
                <h2>{t.ui.phone}</h2>
                <p>
                  <a href={telHref(phone)}>{phone}</a>
                </p>
              </div>
            </div>
          )}
          {legal.address && (
            <div className="cat-ccard">
              <Icon name="pin" size={20} />
              <div>
                <h2>{t.ui.address}</h2>
                {legal.name && <p>{legal.name}</p>}
                <p>{legal.address}</p>
              </div>
            </div>
          )}
          {(reply.hours || reply.text) && (
            <div className="cat-ccard">
              <Icon name="clock" size={20} />
              <div>
                <p>{reply.hours ? t.ui.reply(reply.hours) : t.ui.replyText(reply.text!)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="cat-prose">
          <p>{t.ui.supportIntro}</p>
          <p>{t.ui.contactTip}</p>
          {legal.statement && (
            <p>
              {t.ui.statement} <span className="cat-tag">{legal.statement}</span>
            </p>
          )}
        </div>
        <a className="cat-btn" href={mail}>
          {t.ui.writeEmail}
        </a>
      </article>
    </Shell>
  );
}
