import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { brandFor } from "@/lib/brand";
import { money, type Locale } from "@/lib/i18n";
import { LIB_COOKIE, readLibrary } from "@/lib/library-auth";
import { ALL_CONTENT, libraryAll, libraryBase, libraryData, publicCatalog, type LibBook, type LibMore, type LibOrder, type LibUnlock } from "@/lib/library";
import { deviceLocale, LANG_COOKIE, LIB_LANGS, libLocale, libTexts, navTexts, topicGroups, topicLabel, uiLocale, type LibTexts } from "@/lib/library-texts";
import { BIB_CSS } from "./bib.css";
import { bibFonts } from "./fonts";
import { coverImg, thumb } from "./thumb";
import { AdminGrant, BuyerSearch, Card, CardProvider, LoginForm, LoginToggle, Pages, PayReturn, ShopBrowser, Tabs, TopBar, When, type CardCtx, type CardData, type TopGroup } from "./BibClient";

export const dynamic = "force-dynamic";

/**
 * Pestana del navegador. Estaba fija en «Biblioteca», en espanol, para TODAS
 * las tiendas: un comprador de Finance Study Lab (producto en ingles, mails en
 * ingles) veia una pestana en espanol. Ahora sale del mismo idioma que el resto
 * de la pagina, con el nombre de la tienda, que es lo que ayuda a encontrar la
 * pestana entre veinte.
 */
export async function generateMetadata({ params }: { params: Promise<{ store: string }> }): Promise<Metadata> {
  const iconos = {
    icon: [{ url: "/brand/favicon-32x32.png?v=3", sizes: "32x32" }],
    apple: [{ url: "/brand/apple-touch-icon.png?v=3", sizes: "180x180" }],
  };
  const base: Metadata = { robots: { index: false, follow: false }, icons: iconos };
  try {
    const { store } = await params;
    const [{ data: s }, h, c] = await Promise.all([
      db.from("stores").select("name,display_name,default_locale").eq("slug", store).maybeSingle(),
      headers(), cookies(),
    ]);
    if (!s) return { ...base, title: "Library" };
    const locale = uiLocale(c.get(LANG_COOKIE)?.value, h.get("accept-language"), s.default_locale as string);
    const marca = (s.display_name as string | null) || (s.name as string);
    return { ...base, title: [libTexts(locale).title, marca].filter(Boolean).join(" · ") };
  } catch {
    // El titulo no puede tirar la pagina: los errores de metadata no los ataja error.tsx.
    return { ...base, title: "Library" };
  }
}

/**
 * Mi biblioteca.
 * Sin sesión: el catálogo público de la tienda (todos los libros en el idioma del dispositivo, con buscador, temas y
 * vista previa; cada uno a su landing) y, secundario, «¿Ya compraste? Entrá con tu email».
 * Con sesión (cookie) o con el token de administrador del panel (?t=): su perfil con tres pestañas — Mis libros
 * (descarga directa, lo que le falta de sus colecciones y «Más libros para vos»), Tienda (todos los libros de la
 * tienda en su idioma que no tiene, con buscador, temas y vista previa; en 1 clic o a su checkout) y Mis pedidos.
 * Idioma de los textos: el que elige arriba (cookie bib_lang); si no, el de su dispositivo (Accept-Language); si no,
 * el de la tienda. Los precios, en la moneda de su compra.
 */
export default async function Biblioteca({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store: slug } = await params;
  const sp = await searchParams;
  const h = await headers();
  const jar = await cookies();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const { data: store } = await db.from("stores").select("id,slug,name,display_name,brand,logo_url,default_locale,support_email").eq("slug", slug).maybeSingle();
  if (!store) notFound();

  const base = await libraryBase(host, store as { id: string; slug: string });
  const param = typeof sp.t === "string" ? sp.t : null;
  const auth = readLibrary(param, store.id) ?? readLibrary(jar.get(LIB_COOKIE)?.value, store.id);
  const chosen = jar.get(LANG_COOKIE)?.value ?? null;
  const accept = h.get("accept-language");
  const support = store.support_email as string;

  // ---------------- Sin sesión: el catálogo público (nada del comprador ni del administrador).
  if (!auth) {
    const ui = uiLocale(chosen, accept, store.default_locale as string);
    const t = libTexts(ui);
    const brand = brandFor(store, ui);
    // El país del navegador (es-AR, en-GB…) para la moneda; el idioma, el del dispositivo.
    const region = (accept ?? "").split(",")[0].split(";")[0].trim().split("-")[1] ?? null;
    const cat = await publicCatalog(store.id as string, ui, region);
    const books = cat?.books ?? [];
    const loginT = { emailPh: t.emailPh, send: t.send, sending: t.sending, sent: t.sent("{email}"), badEmail: t.badEmail, tooMany: t.tooMany, checkMail: t.checkMail, otherEmail: t.otherEmail, notFound: `${t.empty}. ${t.emptySub}` };
    const expired = sp.e === "expired";
    const items = shuffled(books.map((m) => ({
      id: m.id, q: `${m.name} ${m.description} ${m.topic ? topicLabel(m.topic, ui) : ""}`, topic: m.topic, first: false,
      card: { ...cardOf(m, "pub"), badge: m.presale ? t.presale : null },
    })));
    const ctx = cardCtx(t, store.id as string, books, null);
    return (
      <div className={`bib bib-pub ${bibFonts}`} lang={ui}>
        <style dangerouslySetInnerHTML={{ __html: BIB_CSS }} />
        <TopBar brand={brand} lang={ui} langs={LIB_LANGS} t={navT(t, ui)} groups={groupsOf(books, ui)}
          cta={{ label: t.signIn, href: "#entrar" }} items={[{ label: t.shopAll, href: "#catalogo", count: books.length }, { label: t.signIn, href: "#entrar" }]} />
        <section className="bib-hero">
          <div className="bib-wrap">
            <div className="bib-hero-txt">
              <span className="bib-pill">📚 {t.catalogKicker}{books.length ? ` · ${t.includes(books.length)}` : ""}</span>
              <h1 className="bib-h1">{t.catalogTitle}</h1>
              <p className="bib-sub">{t.catalogSub}</p>
              {expired && <p className="bib-msg bib-warn" style={{ marginTop: 16, display: "inline-block" }}>{t.expired}</p>}
              <LoginToggle label={t.alreadyBought} title={t.loginTitle} sub={t.loginSub} open={expired}>
                <LoginForm store={slug} locale={ui} t={loginT} autoFocus={false} />
                <p className="bib-trouble">{t.trouble} <a href={`mailto:${support}`}>{support}</a></p>
              </LoginToggle>
            </div>
            <Fan covers={books.map((b) => b.cover)} />
          </div>
        </section>
        <main className="bib-wrap" id="catalogo" style={{ paddingBottom: 8 }}>
          {items.length
            ? <CardProvider value={ctx}><ShopBrowser items={items} topics={topicsOf(books, ui)} counts={counts(t, items.length)} t={shopT(t)} /></CardProvider>
            : <div className="bib-empty"><p className="bib-sub" style={{ margin: 0 }}>{t.shopEmpty}</p></div>}
        </main>
        <Help t={t} support={support} />
        <Foot brand={brand} support={support} />
      </div>
    );
  }

  // ---------------- Con sesión.
  // Vista de administrador «con todo»: todo el contenido de la tienda, por oferta.
  const everything = auth.admin && auth.email === ALL_CONTENT;
  // El idioma de su dispositivo (o el que eligió arriba); si no es uno de los nuestros, el de sus compras.
  const device = everything ? uiLocale(chosen, "es", "es") : deviceLocale(chosen, accept);
  const data = everything ? await libraryAll(store.id) : await libraryData(store.id, auth.email, { admin: auth.admin, ui: device });
  const ui: Locale = device ?? libLocale(data?.locale ?? (store.default_locale as string));
  // ?as=buyer: el administrador ve exactamente lo que ve el comprador (cuenta demo), sin herramientas de admin.
  const asBuyer = auth.admin && sp.as === "buyer";
  const buyerAdmin = auth.admin && !everything && !asBuyer;
  if (!data) notFound();
  const t = libTexts(ui);
  const brand = brandFor(store, data.locale);
  const kits = data.groups.filter((g) => g.kit);
  const loose = data.groups.find((g) => !g.kit);
  const canBuy = !!data.chargeOrderId;
  const tok = param ? `&t=${encodeURIComponent(param)}` : "";
  const dl = (b: LibBook) => `/api/biblioteca/descargar?p=${b.id}${tok}`;
  // Las tarjetas de lo que puede comprar se arman en el navegador: textos y forma de pago una sola vez (CardCtx). Sin un
  // pedido de la app no se le cobra con un clic: el botón lleva al checkout de ese libro suelto (se crea solo).
  const ctx = cardCtx(t, store.id as string, [...data.more, ...data.collections.flatMap((c) => c.unlock)], {
    canBuy, buyerAdmin, admin: auth.admin, publishableKey: data.publishableKey, locale: ui, email: auth.email, tok,
  });

  // Un libro suyo: descarga directa (o «Disponible en 2 días» si está en preventa) y sus páginas.
  const Book = ({ b }: { b: LibBook }) => (
    <article className="bib-book">
      <div className="bib-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {b.cover ? <img {...coverImg(b.cover)} alt={b.name} loading="lazy" decoding="async" /> : <div className="bib-ph"><span>{b.name}</span></div>}
        {b.granted && buyerAdmin && <span className="bib-badge" style={{ color: "#15803D" }}>🎁 Desbloqueado</span>}
      </div>
      <h3 className="bib-t">{b.name}</h3>
      <p className="bib-d">{b.description}</p>
      <div className="bib-acts">
        {/* Preventa: su descripción de siempre y, solo en el botón, «Disponible en 2 días». */}
        {b.presale
          ? <span className="bib-btn bib-soon">⏳ {t.presaleBtn}</span>
          : b.links[0] && <a className="bib-btn" href={dl(b)}><DlIcon /> {t.download}</a>}
        <Pages pages={b.pages} title={b.name} label={t.pages(b.pages.length)} closeLabel={t.close} />
        {buyerAdmin && b.granted && <AdminGrant store={store.id} email={auth.email} productId={b.id} remove />}
      </div>
    </article>
  );

  const books = data.bookCount === 0 ? (
    <div className="bib-empty">
      <h2 className="bib-h2">{t.empty}</h2>
      <p className="bib-sub">{t.emptySub}</p>
    </div>
  ) : (
    <>
      {kits.map((g) => (
        <div key={g.id} className="bib-block">
          <div className="bib-kit-h">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {g.cover && <img src={thumb(g.cover, 120)} alt="" loading="lazy" />}
            <div style={{ minWidth: 0 }}>
              <small>{t.inKit} · {t.includes(g.books.length)}</small>
              <h2 className="bib-h2">{g.name}</h2>
            </div>
          </div>
          <div className="bib-grid">{g.books.map((b) => <Book key={b.id} b={b} />)}</div>
        </div>
      ))}
      {loose && loose.books.length > 0 && (
        <div className="bib-block">
          {kits.length > 0 && <div className="bib-block-h"><h2 className="bib-h2">{t.yours} <span className="bib-count">{loose.books.length}</span></h2></div>}
          <div className="bib-grid">{loose.books.map((b) => <Book key={b.id} b={b} />)}</div>
        </div>
      )}
    </>
  );

  // Pedidos: el comprador ve los pagados y reembolsados; el administrador, todo.
  const orders: LibOrder[] = (data.orders ?? []).filter((o) => buyerAdmin || o.status === "paid" || o.status === "refunded");
  const kindTag = (k: string) => (k === "bump" ? t.kindExtra : k === "upsell" ? t.kindAdded : k === "bonus" || k === "included" ? t.kindGift : null);
  const ordersNode = (
    <section className="bib-sec">
      <div className="bib-block">
        <div className="bib-block-h">
          <h2 className="bib-h2">{t.tabOrders} <span className="bib-count">{orders.length}</span></h2>
          <p className="bib-lede">{t.ordersSub}</p>
        </div>
        {orders.length ? (
          <div className="bib-orders">
            {orders.map((o) => (
              <article key={o.ref + o.date} className="bib-order">
                <header>
                  <div style={{ minWidth: 0 }}>
                    <b className="bib-order-ref">{o.ref}{buyerAdmin && o.source === "legacy" ? " · plataforma anterior" : ""}</b>
                    <span className="bib-order-date"><When iso={o.date} locale={ui} /></span>
                  </div>
                  <div className="bib-order-tot">
                    <b>{money(o.total, o.currency || data.currency, ui)}</b>
                    <span className={`bib-status ${o.status === "paid" ? "ok" : "bad"}`}>{o.status === "paid" ? t.paid : o.status === "refunded" ? t.refunded : o.status}</span>
                  </div>
                </header>
                <ul>
                  {o.items.map((it, i) => (
                    <li key={i}><span>{it.name}</span>{kindTag(it.kind) && <em>{kindTag(it.kind)}</em>}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : <div className="bib-empty"><p className="bib-sub" style={{ margin: 0 }}>{t.noOrders}</p></div>}
      </div>
    </section>
  );

  // Lo que le falta de sus colecciones (1 clic con su tarjeta, o el checkout de ese libro).
  const unlockable = data.collections.filter((c) => c.unlock.length);
  const lockCard = (u: LibUnlock) => <Card key={u.id} c={{ ...cardOf(u, "lock"), badge: null }} />;
  const collectionsNode = unlockable.length > 0 && (
    <div className="bib-block">
      <div className="bib-block-h"><h2 className="bib-h2">{t.collectionsTitle}</h2></div>
      {unlockable.map((c) => (
        <div key={c.id} className="bib-coll">
          <div className="bib-block-h" style={{ marginBottom: 0 }}>
            <h3 className="bib-h2" style={{ fontSize: "clamp(18px,2vw,22px)" }}>{t.collection(c.name)}</h3>
            <span className="bib-coll-n">{t.progress(c.have, c.total)}</span>
          </div>
          <div className="bib-prog" aria-hidden><i style={{ width: `${Math.round((c.have / Math.max(1, c.total)) * 100)}%` }} /></div>
          {canBuy && auth.verified && <p className="bib-note">{t.oneClick}</p>}
          <div className="bib-grid">{c.unlock.map(lockCard)}</div>
        </div>
      ))}
    </div>
  );

  // La Tienda: todos los libros de la tienda en su idioma que no tiene. Con precio, en 1 clic (la misma compra de
  // siempre: /api/biblioteca/comprar); sin precio o sin pedido de la app para sumarlo, a su checkout.
  const shopData = (m: LibMore): CardData => ({ ...cardOf(m, "shop"), badge: m.reason ? (m.reason === "same" ? t.sameTopic : t.forYou) : m.presale ? t.presale : null });
  const shopCard = (m: LibMore) => <Card key={m.id} c={shopData(m)} />;
  // Las colecciones van una sola vez, en «I miei libri» (antes también arriba de la Tienda: el doble de tarjetas).
  const shopCount = data.more.length;
  const shopNode = (
    <section className="bib-sec">
      {data.more.length
        ? <ShopBrowser topics={topicsOf(data.more, ui)} counts={counts(t, data.more.length)} t={shopT(t)}
            items={shuffled(data.more.map((m) => ({ id: m.id, q: `${m.name} ${m.description} ${m.topic ? topicLabel(m.topic, ui) : ""}`, topic: m.topic, first: m.reason === "same", card: shopData(m) })))} />
        : <div className="bib-empty"><p className="bib-sub" style={{ margin: 0 }}>{t.shopEmpty}</p></div>}
    </section>
  );
  // Debajo de sus libros: lo que le falta de sus colecciones y las 6 recomendaciones de siempre.
  const teaser = data.more.length > 0 && (
    <div className="bib-block">
      <div className="bib-block-h">
        <h2 className="bib-h2">{t.more}</h2>
        <a className="bib-more-link" href="#tienda">{t.seeShop} →</a>
      </div>
      <div className="bib-grid bib-grid-6">{data.more.slice(0, 6).map(shopCard)}</div>
    </div>
  );

  const first = orders.length ? orders[orders.length - 1].date : null;
  const hello = t.hello(data.name ?? "");
  const name = data.name && hello.endsWith(data.name) ? data.name : null;
  return (
    <div className={`bib ${bibFonts}`} lang={ui}>
      <style dangerouslySetInnerHTML={{ __html: BIB_CSS }} />
      <PayReturn />
      {auth.admin && <div className="bib-admin">{everything ? `Vista administrador · todo el contenido de ${brand} (${data.bookCount} libros)` : asBuyer ? `Así lo ve el comprador · ${auth.email} (la compra no cobra en esta vista)` : t.adminBar(auth.email)}</div>}
      <TopBar brand={brand} lang={ui} langs={LIB_LANGS} t={navT(t, ui)} groups={everything ? [] : groupsOf(data.more, ui)}
        cta={everything ? null : { label: t.tabShop, href: "#tienda" }}
        items={everything ? [] : [
          { label: t.tabBooks, href: "#libros", count: data.bookCount }, { label: t.tabShop, href: "#tienda", count: data.more.length },
          { label: t.tabOrders, href: "#pedidos", count: orders.length }, ...(!auth.admin ? [{ label: t.logout, post: `${base}/salir` }] : []),
        ]} />

      {everything ? (
        <main className="bib-wrap" style={{ paddingTop: 28 }}>
          <section className="bib-coll">
            <h2 className="bib-h2">Ver el portal de un comprador</h2>
            <p className="bib-note" style={{ margin: "6px 0 0" }}>Ves lo que compró, sus pedidos y le podés desbloquear libros.</p>
            <BuyerSearch store={store.slug as string} />
          </section>
          {books}
        </main>
      ) : (
        <>
          <section className="bib-hero">
            <div className="bib-wrap">
              <div className="bib-hero-txt">
                <span className="bib-pill">📚 {t.title}</span>
                <h1 className="bib-h1">{name ? <>{hello.slice(0, hello.length - name.length)}<span className="bib-hl">{name}</span></> : hello}</h1>
                <p className="bib-mail">{auth.email}</p>
                <ul className="bib-stats">
                  <li>{t.count(data.bookCount)}</li>
                  <li>{t.ordersCount(orders.length)}</li>
                  {first && <li>{t.memberSince("")}<When iso={first} locale={ui} time={false} /></li>}
                </ul>
              </div>
              <Fan covers={[...data.groups.flatMap((g) => g.books.map((b) => b.cover)), ...data.more.map((m) => m.cover)]} />
            </div>
          </section>
          <CardProvider value={ctx}>
            <Tabs tabs={[
              { id: "libros", label: t.tabBooks, count: data.bookCount, node: <section className="bib-sec">{books}{collectionsNode}{teaser}</section> },
              { id: "tienda", label: t.tabShop, count: shopCount, node: shopNode, lazy: true },
              { id: "pedidos", label: t.tabOrders, count: orders.length, node: ordersNode },
            ]} />
          </CardProvider>
        </>
      )}
      <Help t={t} support={support} />
      <Foot brand={brand} support={support} />
    </div>
  );
}

/** Los temas del menú, agrupados por categoría, con los libros que hay en cada uno. */
function groupsOf(books: LibMore[], ui: string): TopGroup[] {
  const n = new Map<string, number>();
  for (const b of books) if (b.topic) n.set(b.topic, (n.get(b.topic) ?? 0) + 1);
  return topicGroups(n, ui);
}
const navT = (t: LibTexts, ui: string) => ({ ...navTexts(ui), language: t.language, all: t.shopAll });
const previewT = (t: LibTexts) => ({ preview: t.preview, samplePages: t.samplePages, close: t.close, loading: t.loading });

/** Los datos de una tarjeta (Tienda, colección o catálogo público); el botón lo arma el navegador con CardCtx. */
function cardOf(m: LibMore | LibUnlock, kind: CardData["kind"]): Omit<CardData, "badge"> {
  return {
    id: m.id, name: m.name, description: m.description, cover: m.cover, label: m.label, compare: m.compare, kind,
    books: m.books, gifts: "bonus" in m ? m.bonus.length : 0, pages: m.pages, url: "url" in m ? m.url : null,
  };
}
/** Lo que comparten todas las tarjetas, una sola vez: textos, plurales ya escritos y cómo compra quien mira. */
function cardCtx(t: LibTexts, store: string, items: (LibMore | LibUnlock)[], buyer: CardCtx["buyer"]): CardCtx {
  const maxBooks = Math.max(1, ...items.map((m) => m.books));
  const maxGifts = Math.max(0, ...items.map((m) => ("bonus" in m ? m.bonus.length : 0)));
  return {
    store, pt: previewT(t), buyer,
    includes: Array.from({ length: maxBooks + 1 }, (_, i) => t.includes(i)),
    gifts: Array.from({ length: maxGifts + 1 }, (_, i) => t.gifts(i)),
    t: {
      unlock: t.unlock, unlocking: t.unlocking, unlocked: t.unlocked, payError: t.payError, adminNoBuy: t.adminNoBuy,
      buyTitle: t.buyTitle, payNow: "", payNowTpl: t.payNow("{label}"), buyNote: t.buyNote, cancel: t.cancel, secure: t.secure,
      includes: "", gifts: "", buy: t.buy, seeOffer: t.seeOffer, seeBook: t.seeBook,
    },
  };
}
/** El orden de la grilla, mezclado en el servidor (los del mismo tema primero): en el navegador nada se reacomoda al cargar. */
function shuffled<T extends { first: boolean }>(xs: T[]): T[] {
  const mix = (a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return [...mix(xs.filter((x) => x.first)), ...mix(xs.filter((x) => !x.first))];
}
const shopT = (t: LibTexts) => ({ search: t.shopSearch, all: t.allTopics, title: t.shopAll, shuffle: t.shuffle, shuffleLabel: t.shuffleLabel, noMatch: t.noMatch("{q}") });
/** «n libros» ya escrito para cada cantidad posible (los plurales no se arman en el cliente). */
const counts = (t: LibTexts, n: number) => Array.from({ length: n + 1 }, (_, i) => t.includes(i));
/** Los temas presentes, con su nombre en el idioma de quien mira; los más grandes primero. */
function topicsOf(books: LibMore[], ui: string): [string, string][] {
  const n = new Map<string, number>();
  for (const b of books) if (b.topic) n.set(b.topic, (n.get(b.topic) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || topicLabel(a[0], ui).localeCompare(topicLabel(b[0], ui))).map(([k]) => [k, topicLabel(k, ui)]);
}

function Fan({ covers }: { covers: (string | null)[] }) {
  const fan = covers.filter((c): c is string => !!c).slice(0, 3);
  if (!fan.length) return null;
  return (
    <div className={`bib-fan bib-fan-${fan.length}`} aria-hidden>
      {/* Solo en pantallas anchas (oculto en el celular: lazy no la descarga ahí). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {fan.map((c, i) => <img key={i} src={thumb(c, 400)} alt="" loading="lazy" decoding="async" />)}
    </div>
  );
}

function Help({ t, support }: { t: LibTexts; support: string }) {
  return (
    <section className="bib-help">
      <div className="bib-wrap">
        <div>
          <h2 className="bib-h2">{t.help}</h2>
          <p className="bib-sub">{t.helpSub}</p>
        </div>
        <a className="bib-btn bib-cta" href={`mailto:${support}`}>✉ {t.write}</a>
      </div>
    </section>
  );
}

function Foot({ brand, support }: { brand: string; support: string }) {
  return (
    <footer className="bib-foot">
      <div className="bib-wrap">
        <span className="bib-wm">{brand}</span>
        <span>© {new Date().getFullYear()} · <a href={`mailto:${support}`}>{support}</a></span>
      </div>
    </footer>
  );
}

const DlIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
