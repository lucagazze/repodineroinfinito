import { db, type Product, type Store, STORE_COLS } from "./db";
import { downloadHref } from "./downloads";
import { getRates, priceFor } from "./fx";
import { money, type Locale } from "./i18n";
import { baseOf, contentOf, ownsProduct, overlapsOwned } from "./postpurchase";
import { legacyOrders } from "./legacy-lookup";
import { resolveSettings } from "./checkout-settings";
import { checkoutUrl } from "./checkout-url";
import { libLocale } from "./library-texts";
import { topicsMap } from "./catalog-facts";
import { fetchAll, storeProducts } from "./fetch-all";

/**
 * «Mi biblioteca».
 *
 * Lo que tiene: todos los pedidos pagados de ese email en la tienda (principal, bumps, OTOs; los packs abiertos
 * en sus libros) y lo que compró en el checkout anterior (plataforma anterior, ver legacy-lookup.ts) cuando el libro se reconoce sin dudas.
 * Lo que puede desbloquear: el resto de la colección de las ofertas que compró (principal, bumps y OTOs de esos
 * checkouts), al precio de la tienda en su moneda, en 1 clic con la tarjeta que ya usó. Y la Tienda: los principales
 * de las otras ofertas activas en su idioma (en 1 clic o a su checkout). Las descargas son los links de siempre.
 *
 * Velocidad: el catálogo de la tienda (productos,
 * checkouts, ofertas, bumps, post-pagos, temas, tipos de cambio) se lee una vez cada 2 minutos por instancia y se
 * comparte; lo del comprador (pedidos, regalos del admin) se lee siempre, en paralelo; el checkout anterior se
 * guarda 5 minutos por email. Las páginas de muestra de la Tienda no viajan con la página: se piden al abrir la
 * vista previa (/api/biblioteca/paginas).
 *
 * Idioma: cada producto tiene el idioma de los checkouts donde
 * se vende (su principal, bumps, upsells, bonus y pasos del post-pago; los libros de un pack y las variantes heredan el
 * del pack o del libro base). Un producto sin idioma, o con más de uno, no se ofrece a nadie. La Tienda, «Altri libri
 * per te», las colecciones y el catálogo público muestran solo libros del idioma de quien mira (el de su dispositivo;
 * si en ese idioma no hay libros, el de sus compras). Lo que ya compró se ve siempre, en el idioma que sea.
 */

type P = Product & { active: boolean | null; pc_gallery?: unknown };
export type LibLink = { label: string | null; url: string };
export type LibBook = { id: string; name: string; description: string; cover: string | null; links: LibLink[]; presale: boolean; pages: string[]; /** Desbloqueado gratis por el administrador (se puede quitar). */ granted?: boolean };
/** Para la vista de administrador: cada compra de la persona (de la app y del checkout anterior). */
export type LibOrder = { ref: string; date: string; total: number; currency: string; status: string; items: { name: string; kind: string }[]; source: "app" | "legacy" };
export type LibGroup = { id: string; name: string; description: string; cover: string | null; kit: boolean; links: LibLink[]; books: LibBook[] };
/** pages: cuántas páginas de muestra tiene (0 = ninguna; null = se sabe al abrir la vista previa). */
export type LibUnlock = { id: string; name: string; description: string; cover: string | null; price: number; currency: string; label: string; compare: string | null; books: number; pages: number | null };
export type LibCollection = { id: string; name: string; have: number; total: number; unlock: LibUnlock[] };
/** reason: same = del mismo tema que lo que compró; related = para el mismo público (p. ej. enfermería → farmacología). */
export type LibMore = {
  id: string; name: string; description: string; cover: string | null; url: string | null; reason?: "same" | "related";
  /** Para comprarlo desde la biblioteca: su precio y los regalos de su checkout. */
  price: number | null; currency: string; label: string | null; compare: string | null; books: number; bonus: string[];
  /** El tema de su oferta (offers.category), para los filtros de la Tienda. */
  topic: string;
  /** Páginas de muestra (0 = ninguna; null = se sabe al abrir la vista previa). */
  pages: number | null;
  /** Su oferta; main: es el principal de un checkout (los demás son libros de bumps o del post-pago). */
  offer: string; main: boolean; presale: boolean;
};
export type LibraryData = {
  store: Store; email: string; name: string | null; locale: string; currency: string;
  /** El idioma de los libros que se le ofrecen (Tienda, colecciones, «Altri libri per te»). */
  view: string;
  groups: LibGroup[]; bookCount: number; collections: LibCollection[];
  /** La Tienda: todos los principales de las otras ofertas activas en su idioma que no tiene (el mismo tema primero). */
  more: LibMore[];
  /** El pedido al que se suman las compras de la biblioteca (el último pagado con cliente de Stripe). */
  chargeOrderId: string | null; publishableKey: string | null;
  /** Sus compras (perfil «Mis pedidos»), de la app y del checkout anterior. */
  orders?: LibOrder[];
};

// Sin postcompra_page entero (pesado): solo sus páginas de muestra.
const PCOLS =
  "id,slug,name,short_name,description,kind,delivery_url,delivery_file,delivery_file_name,delivery_links,includes,variant_of,book_count,is_library,presale,presale_days,image_url,sort_order,active," +
  "pc_gallery:postcompra_page->gallery->images,product_prices(currency,amount,compare_at,display_value,stripe_price_id)";
const http = (u: string | null | undefined): u is string => !!u && /^https?:\/\//.test(u);
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/**
 * Productos y checkouts de prueba («PRUEBA 1 USD — …», prueba-1-usd): nunca a la vista del comprador. Solo cuando el
 * nombre EMPIEZA así: «Practice Test of X» es un libro de verdad.
 */
const isTest = (...names: (string | null | undefined)[]) => names.some((n) => /^\s*(prueba|test)\b/i.test(n ?? ""));
/**
 * La biblioteca completa no se ofrece en el portal: ni en la
 * Tienda, ni en «Más libros para vos», ni en las colecciones, ni en el catálogo público. is_library, o «library/
 * biblioteca/bibliothèque/Bibliothek/biblioteka/bibliotheek» en el nombre o el slug.
 */
const isWholeLibrary = (p: { is_library?: boolean | null; slug?: string | null; name?: string | null; short_name?: string | null }) =>
  !!p.is_library || [p.slug, p.name, p.short_name].some((n) => /librar|bibliot[eh]|biblioth[eè]que/i.test(n ?? ""));
const galleryOf = (p: P | undefined): string[] => {
  const g = p?.pc_gallery;
  return Array.isArray(g) ? g.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 12) : [];
};

/** Memoria por instancia con vencimiento (la promesa se comparte: dos visitas a la vez hacen una sola lectura). */
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => memo.delete(key));
  if (memo.size > 500) for (const [k, v] of memo) if (Date.now() - v.at > ttlMs) memo.delete(k);
  return p;
}
const CATALOG_TTL = 2 * 60_000;
const timing = process.env.BIB_TIMING === "1";
const mark = (label: string, t0: number) => { if (timing) console.log(`[biblioteca] ${label} ${Date.now() - t0}ms`); };

type Funnel = {
  id: string; slug: string; offer_id: string | null; main_product_id: string; active: boolean | null; settings: unknown;
  checkout_host: string | null; checkout_path: string | null; sort_order: number | null; landing_url: string | null;
};
type Catalog = {
  store: Store; products: P[]; byId: Map<string, P>; funnels: Funnel[];
  offers: { id: string; category: string | null; active: boolean | null; name: string | null }[];
  items: { funnel_id: string; product_id: string; role: string }[];
  ppf: { id: string; checkout_funnel_id: string; active: boolean | null }[];
  steps: { pp_funnel_id: string; product_id: string; kind: string | null }[];
  topics: Record<string, { topic: string; who: string }>; rates: Awaited<ReturnType<typeof getRates>>; publishableKey: string | null;
  markets: { currency: string; countries: string[] | null; is_default: boolean | null }[];
  /** El idioma de cada producto (null: ninguno o más de uno, no se ofrece). */
  lang: Map<string, string | null>;
  /** Los idiomas con al menos un libro a la venta en la tienda. */
  langs: Set<string>;
  /** La landing de cada principal (y sus variantes): de ahí salen sus páginas de muestra si no tiene galería propia. */
  landingOf: Map<string, string>;
  /** Productos con galería propia, por idioma y nombre (otra copia del mismo libro). */
  galleryByName: Map<string, string>;
};

/** El catálogo de una tienda, compartido por todas las vistas (2 min). */
function storeCatalog(storeId: string): Promise<Catalog | null> {
  return cached(`cat:${storeId}`, CATALOG_TTL, async () => {
    const t0 = Date.now();
    const [{ data: store }, products, funnels, offers, topics, rates, { data: conn }, { data: markets }] = await Promise.all([
      db.from("stores").select(STORE_COLS).eq("id", storeId).maybeSingle(),
      storeProducts<P>(storeId, PCOLS),
      fetchAll<Funnel>((a, b) => db.from("funnels").select("id,slug,offer_id,main_product_id,active,settings,checkout_host,checkout_path,sort_order,landing_url")
        .eq("store_id", storeId).order("sort_order").order("id").range(a, b)),
      fetchAll<Catalog["offers"][number]>((a, b) => db.from("offers").select("id,category,active,name").eq("store_id", storeId).order("id").range(a, b)),
      topicsMap(),
      getRates(),
      db.from("store_stripe").select("publishable_key").eq("store_id", storeId).maybeSingle(),
      db.from("markets").select("currency,countries,is_default").eq("store_id", storeId),
    ]);
    if (!store) return null;
    const fids = funnels.map((f) => f.id);
    const chunks = Array.from({ length: Math.ceil(fids.length / 150) }, (_, k) => fids.slice(k * 150, k * 150 + 150));
    const [items, ppf] = await Promise.all([
      Promise.all(chunks.map((c) => fetchAll<Catalog["items"][number]>((a, b) => db.from("funnel_items").select("funnel_id,product_id,role").in("funnel_id", c).order("id").range(a, b)))).then((x) => x.flat()),
      Promise.all(chunks.map((c) => fetchAll<Catalog["ppf"][number]>((a, b) => db.from("pp_funnels").select("id,checkout_funnel_id,active").in("checkout_funnel_id", c).order("id").range(a, b)))).then((x) => x.flat()),
    ]);
    const ppIds = ppf.filter((x) => x.active !== false).map((x) => x.id);
    const steps = (await Promise.all(Array.from({ length: Math.ceil(ppIds.length / 150) }, (_, k) => ppIds.slice(k * 150, k * 150 + 150)).map((c) =>
      fetchAll<Catalog["steps"][number]>((a, b) => db.from("pp_steps").select("pp_funnel_id,product_id,kind").in("pp_funnel_id", c).order("id").range(a, b))))).flat();
    mark(`catálogo ${products.length} productos, ${funnels.length} checkouts`, t0);
    const byId = new Map(products.map((p) => [p.id, p]));
    const st = store as unknown as Store;
    const lang = productLangs(st, byId, funnels, items, ppf, steps);
    const live = new Set(offers.filter((x) => x.active !== false).map((x) => x.id));
    const langs = new Set<string>();
    for (const f of funnels) {
      const p = byId.get(f.main_product_id);
      if (f.active === false || !f.offer_id || !live.has(f.offer_id) || !p || p.active === false || isTest(p.name, p.short_name, f.slug) || isWholeLibrary(p)) continue;
      const l = lang.get(p.id);
      if (l) langs.add(l);
    }
    const landingOf = new Map<string, string>();
    for (const f of [...funnels].sort((a, b) => Number(b.active !== false) - Number(a.active !== false))) {
      if (!http(f.landing_url) || landingOf.has(f.main_product_id)) continue;
      landingOf.set(f.main_product_id, f.landing_url);
    }
    for (const p of products) if (p.variant_of && landingOf.has(p.variant_of) && !landingOf.has(p.id)) landingOf.set(p.id, landingOf.get(p.variant_of)!);
    const galleryByName = new Map<string, string>();
    for (const p of products) {
      const l = lang.get(p.id);
      if (l && galleryOf(p).length && !galleryByName.has(`${l}|${nameKey(p)}`)) galleryByName.set(`${l}|${nameKey(p)}`, p.id);
    }
    const cat: Catalog = {
      store: st, products, byId, funnels, offers, items, ppf, steps, topics, rates,
      publishableKey: (conn?.publishable_key as string | undefined) ?? null, markets: (markets ?? []) as Catalog["markets"],
      lang, langs, landingOf, galleryByName,
    };
    // Las páginas de las landings se leen en segundo plano (así las tarjetas saben de antemano cuántas tiene cada libro).
    void warmLandings([...new Set(landingOf.values())]);
    return cat;
  });
}

/**
 * El idioma de cada producto: el de los checkouts donde aparece (principal, ítems, pasos del post-pago); los libros de
 * un pack y las variantes heredan el del pack o el del libro base. Si queda en más de un idioma, null.
 */
function productLangs(store: Store, byId: Map<string, P>, funnels: Funnel[], items: Catalog["items"], ppf: Catalog["ppf"], steps: Catalog["steps"]) {
  const tags = new Map<string, Set<string>>();
  const tag = (id: string, l: string) => { let s = tags.get(id); if (!s) tags.set(id, (s = new Set())); s.add(l); };
  const fl = new Map(funnels.map((f) => [f.id, libLocale(resolveSettings(f.settings).locale || store.default_locale) as string]));
  for (const f of funnels) tag(f.main_product_id, fl.get(f.id)!);
  for (const i of items) { const l = fl.get(i.funnel_id); if (l) tag(i.product_id, l); }
  const ppOf = new Map(ppf.map((x) => [x.id, x.checkout_funnel_id]));
  for (const s of steps) { const l = fl.get(ppOf.get(s.pp_funnel_id) ?? ""); if (l) tag(s.product_id, l); }
  // Pack → sus libros; variante ↔ libro base (tres vueltas alcanzan para packs de variantes).
  for (let k = 0; k < 3; k++) {
    for (const [id, set] of [...tags]) {
      const p = byId.get(id);
      for (const x of p?.includes ?? []) for (const l of set) tag(x, l);
      if (p?.variant_of) for (const l of set) tag(p.variant_of, l);
    }
    for (const p of byId.values()) if (p.variant_of && tags.has(p.variant_of)) for (const l of [...tags.get(p.variant_of)!]) tag(p.id, l);
  }
  const out = new Map<string, string | null>();
  for (const [id, set] of tags) out.set(id, set.size === 1 ? [...set][0] : null);
  return out;
}

/** El nombre de un libro sin el subtítulo («Il Cibo e l'Umore — Perché…» → «il cibo e l'umore»). */
function nameKey(p: P) { return (p.short_name || p.name || "").split(/\s[—–-]\s/)[0].trim().toLowerCase(); }

/**
 * Las páginas de muestra de una landing: las imágenes de su sección
 * «anteprime», en orden. Las rutas relativas se prueban contra la página y contra la raíz del sitio (las landings se
 * sirven con rewrites). Se guardan 6 h por instancia; si la landing no responde, no se guarda nada.
 */
const landingCount = new Map<string, number>();
function landingPages(url: string): Promise<string[]> {
  return cached(`land:${url}`, 6 * 3600_000, async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (checkout biblioteca)" } });
    if (!r.ok) throw new Error(`landing ${r.status}`);
    const html = await r.text();
    const srcs = [...new Set([...html.matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, "&"))
      .filter((s) => /\/anteprime\//.test(s) && /\.(webp|jpe?g|png|avif)(\?|$)/i.test(s)))].slice(0, 12);
    let base: string | null = null;
    const rel = srcs.find((s) => !/^https?:\/\//i.test(s));
    if (rel) {
      for (const b of [r.url, new URL("/", r.url).href]) {
        const h = await fetch(new URL(rel, b).href, { method: "HEAD", signal: AbortSignal.timeout(3000) }).catch(() => null);
        if (h?.ok) { base = b; break; }
      }
    }
    const out = srcs.map((s) => (/^https:\/\//i.test(s) ? s : base ? new URL(s, base).href : null)).filter((u): u is string => !!u && u.startsWith("https://"));
    landingCount.set(url, out.length);
    return out;
  });
}
let warming = false;
async function warmLandings(urls: string[]) {
  if (warming) return;
  warming = true;
  try {
    for (let k = 0; k < urls.length; k += 6) await Promise.all(urls.slice(k, k + 6).filter((u) => !landingCount.has(u)).map((u) => landingPages(u).catch(() => [])));
  } finally { warming = false; }
}

/** De dónde salen las páginas de un libro: su galería, la del libro base, las de los libros del pack, la de otra copia del mismo libro o su landing. */
function pageSource(cat: Catalog, p: P): { pages: string[] } | { landing: string } | null {
  const own = galleryOf(p);
  if (own.length) return { pages: own };
  const base = galleryOf(p.variant_of ? cat.byId.get(p.variant_of) : undefined);
  if (base.length) return { pages: base };
  const inc = [...new Set((p.includes ?? []).flatMap((x) => galleryOf(cat.byId.get(x)).slice(0, 4)))].slice(0, 16);
  if (inc.length) return { pages: inc };
  const l = cat.lang.get(p.id);
  const twin = l ? cat.galleryByName.get(`${l}|${nameKey(p)}`) : undefined;
  if (twin) return { pages: galleryOf(cat.byId.get(twin)) };
  const landing = cat.landingOf.get(p.id);
  return landing ? { landing } : null;
}
/** Cuántas páginas tiene (null: están en su landing y todavía no se leyó). */
function pageCount(cat: Catalog, p: P): number | null {
  const s = pageSource(cat, p);
  if (!s) return 0;
  return "pages" in s ? s.pages.length : landingCount.get(s.landing) ?? null;
}

/** Las páginas de muestra de un libro de la tienda (vista previa). */
export async function bookPages(storeId: string, productId: string): Promise<string[] | null> {
  const cat = await storeCatalog(storeId);
  const p = cat?.byId.get(productId);
  if (!cat || !p) return null;
  const s = pageSource(cat, p);
  if (!s) return [];
  return "pages" in s ? s.pages : landingPages(s.landing).catch(() => []);
}

/**
 * Todos los libros a la venta de la tienda en un idioma (la Tienda del comprador y el catálogo público): de cada checkout activo de una oferta
 * activa, el principal y los libros de sus bumps, upsells y pasos del post-pago (también los de preventa). Afuera:
 * la biblioteca completa, las variantes a mitad de precio o downsell (variant_of; el libro ya está con su precio
 * normal), los packs de bump/post-pago (los que traen más de un libro: sus libros van uno por uno), los regalos (solo
 * vienen con su principal), las pruebas, lo que no tiene precio (salvo un principal, que va a su checkout) y lo que ya
 * tiene. Una vez por libro (el mismo libro en dos ofertas: el principal antes que un bump y, si no, el más barato);
 * el mismo tema primero y, dentro, los principales.
 */
function offerCards(cat: Catalog, o: {
  /** null: todos los idiomas (solo para validar una compra, nunca para mostrar). */
  locale: string | null; currency: string | null; fmt: Locale; owned: Set<string>; skipOffers: Set<string>; myCats: Set<string>;
  /** Libros que ya se le ofrecen en otro lado (lo que le falta de sus colecciones), por idioma y nombre. */
  skipNames?: Set<string>;
  /** El link de un principal (su landing o su checkout); el de los demás libros lo arma `other`. */
  link: (f: Funnel) => string;
  other: (f: Funnel, p: P) => string | null;
}): LibMore[] {
  const catOf = new Map(cat.offers.map((x) => [x.id, (x.category ?? "").trim()]));
  const live = new Set(cat.offers.filter((x) => x.active !== false).map((x) => x.id));
  const myWho = new Set([...o.myCats].map((c) => cat.topics[c]?.who).filter(Boolean));
  const ppByFunnel = new Map<string, string[]>();
  for (const x of cat.ppf) if (x.active !== false) ppByFunnel.set(x.checkout_funnel_id, [...(ppByFunnel.get(x.checkout_funnel_id) ?? []), x.id]);
  const stepsOf = new Map<string, Catalog["steps"]>();
  for (const st of cat.steps) stepsOf.set(st.pp_funnel_id, [...(stepsOf.get(st.pp_funnel_id) ?? []), st]);
  const nameOf = (p: P) => `${cat.lang.get(p.id) ?? ""}|${nameKey(p)}`;
  // Lo que ya tiene, también por nombre (el mismo libro puede ser otro producto en otra oferta).
  const ownedNames = new Set([...o.owned].map((id) => cat.byId.get(id)).filter((p): p is P => !!p).map(nameOf));
  type Cand = LibMore & { score: number; i: number; rank: number };
  const best = new Map<string, Cand>();
  let i = 0;
  for (const f of cat.funnels) {
    if (f.active === false || !f.offer_id || !live.has(f.offer_id) || o.skipOffers.has(f.offer_id) || isWholeLibrary({ slug: f.slug })) continue;
    const s = resolveSettings(f.settings);
    if (o.locale != null && libLocale(s.locale || cat.store.default_locale) !== o.locale) continue;
    const mainP = cat.byId.get(f.main_product_id);
    if (!mainP || isTest(mainP.name, mainP.short_name, f.slug)) continue;
    const topic = catOf.get(f.offer_id) ?? "";
    const reason = topic && o.myCats.has(topic) ? "same" as const : topic && cat.topics[topic] && myWho.has(cat.topics[topic].who) ? "related" as const : undefined;
    const currency = o.currency ?? (s.currency || "EUR");
    const cands: { p: P | undefined; rank: number }[] = [
      { p: mainP, rank: 0 },
      ...cat.items.filter((x) => x.funnel_id === f.id && (x.role === "bump" || x.role === "upsell")).map((x) => ({ p: cat.byId.get(x.product_id), rank: 1 })),
      ...(ppByFunnel.get(f.id) ?? []).flatMap((pp) => stepsOf.get(pp) ?? []).filter((x) => x.kind !== "downsell").map((x) => ({ p: cat.byId.get(x.product_id), rank: 2 })),
    ];
    for (const { p, rank } of cands) {
      i++;
      if (!p || p.active === false || isTest(p.name, p.short_name) || isWholeLibrary(p)) continue;
      if (o.locale != null && cat.lang.get(p.id) !== o.locale) continue;
      if (rank > 0 && (p.variant_of || (p.includes ?? []).filter((x) => cat.byId.has(x)).length > 1)) continue;
      if (overlapsOwned(o.owned, p) || ownedNames.has(nameOf(p)) || o.skipNames?.has(nameOf(p))) continue;
      const pr = priceFor(p, currency, cat.rates);
      const amount = pr?.amount && Number(pr.amount) > 0 ? Number(pr.amount) : null;
      if (amount == null && rank > 0) continue;
      const key = o.locale == null ? p.id : nameOf(p);
      const prev = best.get(key);
      if (prev && (prev.rank < rank || (prev.rank === rank && (prev.price ?? Infinity) <= (amount ?? Infinity)))) continue;
      best.set(key, {
        id: p.id, name: p.short_name || p.name, description: p.description ?? "", cover: p.image_url,
        url: rank === 0 ? o.link(f) : o.other(f, p), ...(reason ? { reason } : {}),
        price: amount, currency: pr?.currency ?? currency, label: amount != null ? money(amount, pr!.currency, o.fmt) : null,
        compare: amount != null && pr?.compare_at && Number(pr.compare_at) > amount ? money(Number(pr.compare_at), pr.currency, o.fmt) : null,
        books: Math.max(1, contentOf(p).length), bonus: rank === 0 ? [f.id] : [], topic, pages: pageCount(cat, p), offer: f.offer_id,
        main: rank === 0, presale: !!p.presale,
        score: reason === "same" ? 3 : reason === "related" ? 2 : 1, i, rank,
      });
    }
  }
  // Los regalos (bonus) del checkout de un principal van con la compra, igual que si comprara ahí.
  return [...best.values()].sort((a, b) => b.score - a.score || Number(b.main) - Number(a.main) || a.i - b.i).map(({ score: _s, i: _i, rank: _r, ...m }) => ({
    ...m, bonus: m.bonus.length ? cat.items.filter((b) => b.funnel_id === m.bonus[0] && b.role === "bonus" && cat.byId.get(b.product_id)?.active !== false && !o.owned.has(b.product_id)).map((b) => b.product_id) : [],
  }));
}

/** La oferta de un libro del catálogo público (para comprarlo en el portal cuando no tiene landing). */
export async function publicBookOffer(storeId: string, productId: string): Promise<string | null> {
  const cat = await storeCatalog(storeId);
  if (!cat) return null;
  const m = offerCards(cat, {
    locale: null, currency: null, fmt: "en" as Locale, owned: new Set(), skipOffers: new Set(), myCats: new Set(), link: () => "", other: () => null,
  }).find((x) => x.id === productId);
  return m?.offer ?? null;
}

/**
 * El catálogo público: todos los libros de la
 * tienda en el idioma de su dispositivo (si no hay ninguno, en el de la tienda; si tampoco, en el primero que tenga),
 * cada uno a su landing (o a su checkout). Nada del comprador ni del administrador.
 */
export async function publicCatalog(storeId: string, ui: string, region?: string | null): Promise<{ store: Store; books: LibMore[]; locale: string } | null> {
  const cat = await storeCatalog(storeId);
  if (!cat) return null;
  const fmt = libLocale(ui);
  // La moneda de quien mira: la del mercado de su país (por el navegador: es-AR, en-GB…); si no, la de su idioma.
  const reg = (region ?? "").toUpperCase();
  const byLang: Record<string, string> = { it: "EUR", fr: "EUR", de: "EUR", es: "EUR", nl: "EUR", pl: "PLN", "pt-BR": "BRL", en: "USD" };
  const want = (reg && cat.markets.find((m) => (m.countries ?? []).includes(reg))?.currency) || byLang[fmt] || cat.markets.find((m) => m.is_default)?.currency || "EUR";
  const currency = cat.markets.some((m) => m.currency === want) ? want : (cat.markets.find((m) => m.is_default)?.currency ?? want);
  const build = (locale: string) => offerCards(cat, {
    locale, currency, fmt, owned: new Set(), skipOffers: new Set(), myCats: new Set(),
    link: (f) => f.landing_url && http(f.landing_url) ? f.landing_url : `${checkoutUrl(f, cat.store.slug)}?utm_source=biblioteca&utm_medium=catalogo`,
    // Un libro de bump o del post-pago: la landing de su oferta; si no tiene, se compra en el portal (su checkout suelto).
    other: (f, p) => f.landing_url && http(f.landing_url) ? f.landing_url : `/api/biblioteca/checkout?s=${storeId}&p=${p.id}`,
  });
  const order = [fmt, libLocale(cat.store.default_locale), ...cat.funnels.map((f) => libLocale(resolveSettings(f.settings).locale || cat.store.default_locale))];
  for (const locale of [...new Set(order)]) {
    const books = build(locale);
    if (books.length) return { store: cat.store, books, locale };
  }
  return { store: cat.store, books: [], locale: fmt };
}

/**
 * opts.ui: el idioma del dispositivo de quien mira (null si no se sabe): los libros que se le ofrecen son de ese idioma
 * (si en ese idioma no hay libros, del de sus compras) y los precios se escriben así; la moneda es la de su compra.
 * Sin opts.ui (las rutas que validan una compra o una descarga): lo que se le puede vender, en cualquier idioma.
 */
export async function libraryData(storeId: string, email: string, opts: { admin?: boolean; ui?: string | null } = {}): Promise<LibraryData | null> {
  const t0 = Date.now();
  const mail = email.trim().toLowerCase();
  // Todo lo independiente a la vez: el catálogo (compartido), sus pedidos con sus ítems, el checkout anterior y los regalos del admin.
  const [cat, { data: orderRows }, ext, { data: grantRows }] = await Promise.all([
    storeCatalog(storeId),
    db.from("orders").select("id,number,name,locale,currency,created_at,funnel_id,stripe_customer,status,is_test,amount_total,order_items(order_id,product_id,kind,amount,refunded_amount,created_at)")
      .eq("store_id", storeId).ilike("email", like(email)).in("status", ["paid", "refunded"]).order("created_at", { ascending: false }).limit(80),
    cached(`ext:${storeId}:${mail}`, 5 * 60_000, async () => {
      const { data: s } = await db.from("stores").select("id,slug,name,display_name").eq("id", storeId).maybeSingle();
      return s ? legacyOrders([email], { id: s.id as string, slug: s.slug as string, name: s.name as string, display_name: s.display_name as string | null }).catch(() => []) : [];
    }),
    db.from("library_grants").select("product_id").eq("store_id", storeId).eq("email", mail),
  ]);
  mark("lecturas en paralelo", t0);
  if (!cat) return null;
  const st = cat.store;
  const byId = cat.byId;

  type Row = { id: string; number: number | null; name: string | null; locale: string | null; currency: string | null; created_at: string; funnel_id: string | null; stripe_customer: string | null; status: string; is_test: boolean | null; amount_total: number | null;
    order_items: { order_id: string; product_id: string | null; kind: string; amount: number | null; refunded_amount: number | null; created_at: string }[] | null };
  const rows = ((orderRows ?? []) as unknown as Row[]).filter((o) => !o.is_test);
  const orders = rows.filter((o) => o.status === "paid");
  // Lo devuelto entero ya no es suyo.
  const items = orders.flatMap((o) => o.order_items ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((i) => i.product_id && !(Number(i.amount ?? 0) > 0 && Number(i.refunded_amount ?? 0) >= Number(i.amount)));

  // Checkout anterior: lo que se reconoce por nombre, sin dudas.
  const extIds = ext.filter((e) => e.status === "paid").flatMap((e) => e.items.map((i) => i.productId).filter((x): x is string => !!x));

  const locale = libLocale(orders[0]?.locale ?? st.default_locale);
  const currency = String(orders[0]?.currency ?? (st.default_locale === "it" ? "EUR" : "USD")).toUpperCase();
  // Los precios se escriben en el idioma de quien mira (19,90 € / €19.90), en la moneda de su compra.
  const device = opts.ui ? libLocale(opts.ui) : null;
  const fmt = device ?? locale;
  // Los libros que se le ofrecen: los del idioma de su dispositivo; si en ese idioma no hay libros, los de sus compras.
  const view = device && cat.langs.has(device) ? device : locale;
  const offerLang = "ui" in opts ? view : null;

  // Lo que tiene (con las bases de las variantes y lo que traen los packs).
  const owned = new Set<string>();
  const add = (id: string) => {
    const p = byId.get(id);
    owned.add(id);
    if (p?.variant_of) owned.add(p.variant_of);
    for (const x of p?.includes ?? []) owned.add(x);
  };
  for (const i of items) add(i.product_id as string);
  for (const id of extIds) add(id);
  // Lo que le desbloqueó el administrador sin cobrar (library_grants).
  const granted = new Set((grantRows ?? []).map((g) => g.product_id as string).filter((id) => byId.has(id)));
  for (const id of granted) add(id);

  // El pedido de cada producto: para el link /d/ de los que tienen archivo propio.
  const orderOf = new Map<string, string>();
  for (const i of items) if (!orderOf.has(i.product_id as string)) orderOf.set(i.product_id as string, i.order_id);
  const linksOf = (p: P | undefined, orderId?: string | null): LibLink[] => {
    if (!p) return [];
    const main = downloadHref(p, orderId ?? orderOf.get(p.id) ?? null);
    const out: LibLink[] = [...(http(main) ? [{ label: null, url: main }] : []), ...(p.delivery_links ?? []).filter((l) => http(l.url)).map((l) => ({ label: l.label || null, url: l.url }))];
    if (!out.length && p.variant_of) return linksOf(byId.get(p.variant_of), orderId);
    return out;
  };
  const book = (p: P, orderId?: string | null): LibBook => ({
    id: p.id, name: p.short_name || p.name, description: p.description ?? "", cover: p.image_url,
    links: linksOf(p, orderId), presale: !!p.presale, pages: galleryOf(p), ...(granted.has(p.id) ? { granted: true } : {}),
  });

  // Lo comprado, en orden de compra: los packs como grupo con sus libros; los sueltos juntos al final.
  const bought: string[] = [];
  for (const i of [...items].reverse()) if (!bought.includes(i.product_id as string)) bought.push(i.product_id as string);
  for (const id of extIds) if (!bought.includes(id)) bought.push(id);
  for (const id of granted) if (!bought.includes(id)) bought.push(id);
  const groups: LibGroup[] = [];
  const shown = new Set<string>();
  const loose: LibBook[] = [];
  for (const id of bought) {
    const p = byId.get(id);
    if (!p) continue;
    const base = byId.get(baseOf(p)) ?? p;
    const inc = (base.includes?.length ? base.includes : p.includes ?? []).filter((x) => byId.has(x));
    if (inc.length) {
      if (shown.has(base.id)) continue;
      shown.add(base.id);
      const kitLinks = linksOf(p);
      const books = inc.filter((x) => !shown.has(x)).map((x) => { shown.add(x); const b = book(byId.get(x)!); return b.links.length ? b : { ...b, links: kitLinks }; });
      groups.push({ id: base.id, name: base.short_name || base.name, description: base.description ?? "", cover: base.image_url, kit: true, links: kitLinks, books });
    } else {
      const key = baseOf(p);
      if (shown.has(key)) continue;
      shown.add(key);
      loose.push(book(p));
    }
  }
  // Un libro suelto que después vino dentro de un pack se ve una sola vez (en el pack).
  const looseLeft = loose.filter((b) => !groups.some((g) => g.books.some((x) => x.id === b.id)));
  if (looseLeft.length) groups.push({ id: "sueltos", name: "", description: "", cover: null, kit: false, links: [], books: looseLeft });
  const bookCount = groups.reduce((a, g) => a + g.books.length, 0);

  // Colecciones: las ofertas de lo que compró (todo en memoria, del catálogo).
  const funnelById = new Map(cat.funnels.map((f) => [f.id, f]));
  const myFunnelIds = new Set([...orders.map((o) => o.funnel_id).filter((x): x is string => !!x), ...cat.funnels.filter((f) => owned.has(f.main_product_id)).map((f) => f.id)]);
  const myFunnels = [...myFunnelIds].map((id) => funnelById.get(id)).filter((f): f is Funnel => !!f);
  const offerIds = [...new Set(myFunnels.map((f) => f.offer_id).filter((x): x is string => !!x))];
  const ppFunnelOf = new Map(cat.ppf.filter((x) => x.active !== false).map((x) => [x.id, x.checkout_funnel_id]));

  const collections: LibCollection[] = [];
  for (const offerId of offerIds) {
    const fs = cat.funnels.filter((f) => f.offer_id === offerId && f.active !== false);
    const fset = new Set(fs.map((f) => f.id));
    const pids = new Set<string>([
      ...fs.map((f) => f.main_product_id),
      ...cat.items.filter((i) => fset.has(i.funnel_id) && (i.role === "bump" || i.role === "upsell")).map((i) => i.product_id),
      ...cat.steps.filter((s) => fset.has(ppFunnelOf.get(s.pp_funnel_id) ?? "")).map((s) => s.product_id),
    ]);
    const prods = [...pids].map((id) => byId.get(id)).filter((p): p is P => !!p);
    // El nombre que vio el comprador: el principal que compró de esta oferta.
    const mine = myFunnels.find((f) => f.offer_id === offerId);
    const main = byId.get(mine?.main_product_id ?? "");
    const content = new Set(prods.filter((p) => !isWholeLibrary(p)).flatMap((p) => contentOf(p)));
    const have = [...content].filter((id) => owned.has(id)).length;
    // Lo que le falta, una sola vez por libro/pack (el precio más bajo de sus variantes).
    const best = new Map<string, LibUnlock>();
    // Solo libros sueltos: un kit o pack de la misma colección no se
    // ofrece acá; sus libros sí, uno por uno (los kits de otras ofertas van en la Tienda).
    const singles = prods.flatMap((p) => {
      const inc = (p.includes ?? []).filter((x) => byId.has(x));
      return inc.length > 1 ? inc.map((x) => byId.get(x)!) : [p];
    });
    for (const p of singles) {
      if (p.active === false || isTest(p.name, p.short_name) || isWholeLibrary(p)) continue;
      if (offerLang != null && cat.lang.get(p.id) !== offerLang) continue;
      if (p.is_library ? ownsProduct(owned, p) : overlapsOwned(owned, p)) continue;
      const pr = priceFor(p, currency, cat.rates);
      if (!pr?.amount || Number(pr.amount) <= 0) continue;
      const key = baseOf(p);
      const amount = Number(pr.amount);
      if (best.has(key) && best.get(key)!.price <= amount) continue;
      const base = byId.get(key) ?? p;
      best.set(key, {
        id: p.id, name: base.short_name || base.name, description: base.description ?? "", cover: base.image_url ?? p.image_url,
        price: amount, currency: pr.currency, label: money(amount, pr.currency, fmt),
        compare: pr.compare_at && Number(pr.compare_at) > amount ? money(Number(pr.compare_at), pr.currency, fmt) : null,
        books: contentOf(p).length, pages: pageCount(cat, p),
      });
    }
    if (!content.size) continue;
    collections.push({
      id: offerId, name: main?.short_name || main?.name || "", have: Math.min(have, content.size), total: content.size,
      unlock: [...best.values()].sort((a, b) => a.price - b.price),
    });
  }

  // La Tienda: todas las otras ofertas activas en su idioma.
  const catOf = new Map(cat.offers.map((x) => [x.id, (x.category ?? "").trim()]));
  const more = offerCards(cat, {
    locale: offerLang, currency, fmt, owned, skipOffers: new Set(offerIds),
    myCats: new Set(offerIds.map((id) => catOf.get(id)).filter((c): c is string => !!c)),
    skipNames: new Set(collections.flatMap((c) => c.unlock).map((u) => cat.byId.get(u.id)).filter((p): p is P => !!p).map((p) => `${cat.lang.get(p.id) ?? ""}|${nameKey(p)}`)),
    link: (f) => `${checkoutUrl(f, st.slug)}?email=${encodeURIComponent(email)}&utm_source=biblioteca&utm_medium=web`,
    // Los demás libros, sin un clic posible: su checkout suelto (lo arma /api/biblioteca/checkout).
    other: () => null,
  });

  // Sus pedidos (perfil «Mis pedidos»): de la app (pagados y reembolsados) y del checkout anterior.
  const app: LibOrder[] = rows.slice(0, 50).map((o) => {
    const its = o.order_items ?? [];
    return {
      ref: `#${o.number ?? String(o.id).slice(0, 8)}`, date: String(o.created_at), currency: String(o.currency ?? "").toUpperCase(), status: String(o.status),
      total: Number(o.amount_total ?? 0) + its.filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.amount ?? 0), 0),
      items: its.map((i) => { const p = byId.get(i.product_id ?? ""); return { name: p?.short_name || p?.name || "—", kind: i.kind }; }),
      source: "app" as const,
    };
  });
  const old: LibOrder[] = ext.map((e) => ({
    ref: `#${e.ref}`, date: e.purchased_on, currency: e.currency, status: e.status === "paid" ? "paid" : e.raw_status,
    total: e.total_paid, items: e.items.map((i) => ({ name: i.product, kind: "main" })), source: "legacy" as const,
  }));

  const charge = orders.find((o) => o.stripe_customer);
  mark("libraryData total", t0);
  return {
    store: st, email, name: (orders[0]?.name ?? "").trim().split(/\s+/)[0] || null, locale, currency, view,
    groups, bookCount, collections: collections.filter((c) => c.total > 1 || c.unlock.length), more,
    chargeOrderId: charge?.id ?? null, publishableKey: cat.publishableKey,
    orders: [...app, ...old].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/**
 * La tienda de un dominio público (pay.*, el de una oferta, el del catálogo o el de la biblioteca). `library`: es el
 * subdominio propio de la biblioteca (biblioteca.tumarca.com), donde la raíz es la biblioteca.
 */
export async function storeForHost(host: string | null | undefined): Promise<{ id: string; slug: string; library?: boolean } | null> {
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!h) return null;
  return cached(`host:${h}`, 5 * 60_000, async () => {
    const { data: s } = await db.from("stores").select("id,slug,library_domain").or(`domain.eq.${h},catalog_domain.eq.${h},library_domain.eq.${h}`).limit(1).maybeSingle();
    if (s) return { id: s.id as string, slug: s.slug as string, library: (s.library_domain as string | null) === h };
    const { data: f } = await db.from("funnels").select("store_id,stores(slug)").eq("checkout_host", h).limit(1).maybeSingle();
    const slug = (f?.stores as { slug?: string } | null)?.slug;
    return f && slug ? { id: f.store_id as string, slug } : null;
  });
}

/** Marca del token de administrador para «el portal con todo». */
export const ALL_CONTENT = "*todo*";

/**
 * «El portal con todo»: la vista de administrador de la biblioteca con TODO el contenido de la
 * tienda, ordenado por oferta (principal, bonus, bumps y OTOs de sus checkouts y post-pagos activos), cada libro
 * con su portada, descripción y links de descarga. Los packs se abren en sus libros; sin downsells ni pruebas.
 */
export async function libraryAll(storeId: string): Promise<LibraryData | null> {
  const cat = await storeCatalog(storeId);
  if (!cat) return null;
  const st = cat.store;
  const byId = cat.byId;
  const fs = cat.funnels.filter((f) => f.active !== false && !isTest(f.slug, byId.get(f.main_product_id)?.name));
  const ppOf = new Map(cat.ppf.filter((x) => x.active !== false).map((x) => [x.id, x.checkout_funnel_id]));
  const offerName = new Map(cat.offers.map((o) => [o.id, o.name ?? ""]));

  const links = (p: P | undefined): LibLink[] => {
    if (!p) return [];
    const out: LibLink[] = [
      ...(http(p.delivery_url) ? [{ label: null, url: p.delivery_url }] : []),
      ...(p.delivery_links ?? []).filter((l) => http(l.url)).map((l) => ({ label: l.label || null, url: l.url })),
    ];
    return out.length || !p.variant_of ? out : links(byId.get(p.variant_of));
  };
  // Un grupo por oferta (o por checkout suelto sin oferta).
  const keyOf = (f: Funnel) => f.offer_id ?? `f:${f.id}`;
  const groups: LibGroup[] = [];
  for (const key of [...new Set(fs.map(keyOf))]) {
    const mine = fs.filter((f) => keyOf(f) === key);
    const set = new Set(mine.map((f) => f.id));
    const ids = [
      ...mine.map((f) => f.main_product_id),
      ...cat.items.filter((i) => set.has(i.funnel_id)).map((i) => i.product_id),
      ...cat.steps.filter((s) => s.kind !== "downsell" && set.has(ppOf.get(s.pp_funnel_id) ?? "")).map((s) => s.product_id),
    ];
    const seen = new Set<string>();
    const books: LibBook[] = [];
    const push = (id: string, depth = 0) => {
      const p = byId.get(id);
      if (!p || depth > 3 || isTest(p.name, p.short_name)) return;
      const inc = (p.includes ?? []).filter((x) => byId.has(x));
      if (inc.length) { for (const x of inc) push(x, depth + 1); return; }
      const base = byId.get(p.variant_of ?? "") ?? p;
      if (seen.has(base.id)) return;
      seen.add(base.id);
      books.push({ id: base.id, name: base.short_name || base.name, description: base.description ?? "", cover: base.image_url ?? p.image_url, links: links(base), presale: !!base.presale, pages: galleryOf(base) });
    };
    for (const id of ids) push(id);
    if (!books.length) continue;
    const main = byId.get(mine[0].main_product_id);
    const internal = offerName.get(key);
    groups.push({ id: key, name: `${main?.short_name || main?.name || "Oferta"}${internal ? ` · ${internal}` : ""}`, description: main?.description ?? "", cover: main?.image_url ?? null, kit: true, links: links(main), books });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return {
    store: st, email: ALL_CONTENT, name: null, locale: "es", currency: "USD", view: "es",
    groups, bookCount: groups.reduce((n, g) => n + g.books.length, 0), collections: [], more: [], chargeOrderId: null, publishableKey: null,
  };
}

/** Dónde vive la biblioteca de esa tienda en este dominio: «» en su subdominio propio, /biblioteca en pay.*, si no /biblioteca/<tienda>. */
export async function libraryBase(host: string | null | undefined, store: { id: string; slug: string }): Promise<string> {
  const h = await storeForHost(host);
  return h?.id !== store.id ? `/biblioteca/${store.slug}` : h.library ? "" : "/biblioteca";
}
