import { db } from "./db";
import type { ExtItem, ExtOrder } from "./legacy-lookup";

/**
 * Compras de una tienda de Shopify (opcional: si la marca vendía o vende también en Shopify), para que la IA de los
 * mails encuentre lo que compró alguien ahí y le pase sus links. Shopify entrega con otra app; acá cada producto se
 * reconoce por su nombre contra los libros de la app:
 *  - exacto (un solo libro con ese nombre, una vez limpio de «Kit Completo», «(Italian edition)», etc.): links;
 *    si es un kit, también los bonus que trae su checkout en la app;
 *  - dudoso (el nombre contiene o está contenido en el de un libro): links marcados «check_link» — la IA los
 *    propone pero no se manda sola;
 *  - nada: sin link (lo ve el dueño).
 * Credenciales: SHOPIFY_SHOP (xxx.myshopify.com), SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET (app de Dev Dashboard,
 * client credentials). SHOPIFY_LOOKUP_STORES: slugs de las tiendas de la app cuyo catálogo se usa para reconocer los
 * libros, separados por coma; la primera gana cuando el mismo libro está en varias. Sin eso no se consulta Shopify.
 */

/** Las tiendas de la app que se buscan en Shopify (SHOPIFY_LOOKUP_STORES). */
export const shopifyLookupStores = (): string[] => (process.env.SHOPIFY_LOOKUP_STORES ?? "").split(",").map((x) => x.trim()).filter(Boolean);

let cached: { token: string; until: number } | null = null;

async function token(): Promise<string | null> {
  const shop = process.env.SHOPIFY_SHOP?.trim(), id = process.env.SHOPIFY_CLIENT_ID?.trim(), secret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!shop || !id || !secret) return null;
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(6000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) return null;
  cached = { token: j.access_token, until: Date.now() + 20 * 3600_000 };
  return j.access_token;
}

type ShopOrder = {
  name: string; createdAt: string; email: string | null; displayFinancialStatus: string | null; customer?: { displayName?: string | null } | null;
  /** Encontrada por el nombre o por un mail casi igual, no por el suyo. */
  byName?: boolean;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: { title: string; quantity: number }[] };
};

const tokens = (x: string | null | undefined) => (x ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter((w) => w.length >= 3);

async function search(shop: string, t: string, q: string): Promise<ShopOrder[]> {
  const r = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "X-Shopify-Access-Token": t, "content-type": "application/json" },
    body: JSON.stringify({
      query: "query($q: String!) { orders(first: 15, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt email displayFinancialStatus customer { displayName } totalPriceSet { shopMoney { amount currencyCode } } lineItems(first: 25) { nodes { title quantity } } } } }",
      variables: { q },
    }),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { orders?: { nodes?: ShopOrder[] } } };
  return j.data?.orders?.nodes ?? [];
}

/**
 * Sus compras por su mail. Si no hay ninguna, por el comienzo del mail
 * (mismo usuario, otro dominio mal escrito) o por su nombre completo: esas quedan marcadas para que las revise el dueño.
 */
async function ordersOf(emails: string[], name?: string | null): Promise<ShopOrder[]> {
  const t = await token();
  const shop = process.env.SHOPIFY_SHOP?.trim();
  if (!t || !shop || !emails.length) return [];
  try {
    const want = new Set(emails.map((e) => e.toLowerCase()));
    const exact = (await search(shop, t, emails.slice(0, 6).map((e) => `email:${JSON.stringify(e)}`).join(" OR "))).filter((o) => want.has((o.email ?? "").toLowerCase()));
    if (exact.length) return exact;
    const locals = [...new Set(emails.map((e) => e.toLowerCase().split("@")[0]).filter((l) => /^[a-z0-9._+-]{5,}$/.test(l)))].slice(0, 3);
    const who = new Set(tokens(name));
    const q = [...locals.map((l) => `email:${l}*`), ...(who.size >= 2 ? [JSON.stringify([...who].join(" "))] : [])].join(" OR ");
    if (!q) return [];
    const sameLocal = (e: string | null) => locals.includes((e ?? "").toLowerCase().split("@")[0]);
    const sameName = (n: string | null | undefined) => { const w = tokens(n); return who.size >= 2 && w.length >= 2 && w.filter((x) => who.has(x)).length >= 2; };
    const near = (await search(shop, t, q)).filter((o) => sameLocal(o.email) || sameName(o.customer?.displayName));
    return near.length <= 3 ? near.map((o) => ({ ...o, byName: true })) : [];
  } catch {
    return [];
  }
}

const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const FILLER = /\b(complete kit|kit completo|kit complet|kit completa|komplettes set|italian edition|edizione italiana|prezzo speciale carrello|special cart price|illustrated handbook)\b/g;
/** Palabras que están en muchos títulos y no dicen qué libro es. */
const GENERIC = new Set(["illustrated", "illustrata", "illustrate", "illustrati", "illustrato", "illustree", "illustrees", "illustriert", "visual", "complete", "completo", "completa", "complet",
  "complets", "handbook", "edition", "edizione", "italian", "english", "french", "francais", "special", "speciale", "prezzo", "carrello", "collection", "collezione", "reading", "leggere"]);
const SMALL = new Set(["and", "e", "ed", "et", "und", "y", "the", "il", "lo", "la", "le", "gli", "i"]);
/** El nombre «puro» de un libro: sin «Kit», sin subtítulo, sin «Complete Kit», sin conectores. */
const core = (x: string | null | undefined, cutSubtitle: boolean) => {
  let s = x ?? "";
  if (cutSubtitle) s = s.split(/ [—–-] | · /)[0];
  return norm(s).replace(FILLER, " ").replace(/^kit /, "").split(" ").filter((w) => w && !SMALL.has(w)).join(" ");
};
const http = (u: string | null | undefined): u is string => !!u && /^https?:\/\//.test(u);

type P = { id: string; name: string; short_name: string | null; delivery_url: string | null; delivery_links: { url: string }[] | null; variant_of: string | null; store_id: string };

export async function shopifyOrders(emails: string[], name?: string | null): Promise<ExtOrder[]> {
  const raw = await ordersOf(emails, name);
  if (!raw.length) return [];
  const slugs = shopifyLookupStores();
  if (!slugs.length) return [];
  const { data: stores } = await db.from("stores").select("id,slug").in("slug", slugs);
  // Con el mismo libro en varias tiendas, va el de la primera de SHOPIFY_LOOKUP_STORES.
  const home = (stores ?? []).find((s) => s.slug === slugs[0])?.id as string | undefined;
  const { data: prods } = await db.from("products").select("id,name,short_name,delivery_url,delivery_links,variant_of,store_id").in("store_id", (stores ?? []).map((s) => s.id as string));
  const all = ((prods ?? []) as P[]).filter((p) => !/\bprueba\b|\btest\b/i.test(p.name));
  const byId = new Map(all.map((p) => [p.id, p]));
  const own = (p: P | undefined) => (p ? [p.delivery_url, ...(p.delivery_links ?? []).map((l) => l.url)].filter(http) : []);
  const linksOf = (p: P) => { const l = own(p); return l.length ? l : own(byId.get(p.variant_of ?? "")); };
  // Cada libro una vez (las variantes de precio cuentan como su base), con su nombre puro.
  const books = all.filter((p) => !p.variant_of && linksOf(p).length).map((p) => ({ p, keys: new Set([core(p.name, true), core(p.short_name, true), core(p.name, false)].filter(Boolean)), kit: /^kit\b/i.test(p.name) }));

  const words = (x: string) => new Set(norm(x).split(" ").filter((w) => w && !SMALL.has(w)));
  const match = (title: string): { p: P; how: "exact" | "probable" } | null => {
    const k = core(title, true);
    if (!k) return null;
    const isKit = /\bkit\b/i.test(title);
    // Entre varios candidatos, el que comparte más palabras con el título y tiene un largo parecido (si hay uno solo así).
    const tw = words(title), kn = k.split(" ").length;
    const best = (list: typeof books) => {
      const scored = list.map((b) => ({ b, s: [...words(b.p.name)].filter((w) => tw.has(w)).length * 10 - Math.abs(core(b.p.name, true).split(" ").length - kn) })).sort((x, y) => y.s - x.s);
      return scored.length && (scored.length === 1 || scored[0].s > scored[1].s) ? scored[0].b : null;
    };
    let hits = books.filter((b) => b.keys.has(k));
    if (hits.length > 1) hits = hits.filter((b) => b.kit === isKit).length ? hits.filter((b) => b.kit === isKit) : hits;
    // El mismo libro (mismo nombre) en varias tiendas: el de la primera.
    if (hits.length > 1 && new Set(hits.map((b) => norm(b.p.name))).size === 1) hits = hits.filter((b) => b.p.store_id === home).slice(0, 1).length ? hits.filter((b) => b.p.store_id === home).slice(0, 1) : hits.slice(0, 1);
    if (hits.length === 1) return { p: hits[0].p, how: "exact" };
    const near = hits.length > 1 ? hits : books.filter((b) => [...b.keys].some((x) => x.length > 5 && k.length > 5 && (x.includes(k) || k.includes(x))));
    // Último intento: una palabra propia del título (p. ej. el tema del libro), no las de siempre.
    const own = [...tw].filter((w) => w.length >= 6 && !GENERIC.has(w));
    const pick = best(near.length ? near : books.filter((b) => own.some((w) => words(b.p.name).has(w))));
    return pick ? { p: pick.p, how: "probable" } : null;
  };

  // Lo que trae cada kit en la app: los bonus e incluidos de su checkout (un mercado activo).
  const bonusOf = async (productId: string) => {
    const { data: f } = await db.from("funnels").select("id,slug").eq("main_product_id", productId).eq("active", true).not("slug", "like", "%-solo").limit(1);
    if (!f?.length) return [] as P[];
    const { data: its } = await db.from("funnel_items").select("product_id,role").eq("funnel_id", f[0].id).in("role", ["bonus", "included"]);
    return (its ?? []).map((i) => byId.get(i.product_id as string)).filter((p): p is P => !!p);
  };

  const now = Date.now();
  return Promise.all(raw.map(async (o) => {
    const status = /^(PAID|PARTIALLY_REFUNDED)$/.test(o.displayFinancialStatus ?? "") ? "paid" as const : "not_paid" as const;
    const items: ExtItem[] = [];
    for (const li of o.lineItems.nodes) {
      const hit = status === "paid" ? match(li.title) : null;
      if (!hit) { items.push({ product: li.title, kind: "", links: [], status: "no_link", productId: null }); continue; }
      items.push({ product: li.title, kind: "", links: linksOf(hit.p), status: hit.how === "exact" ? "available" : "check_link", productId: hit.p.id });
      if (/\bkit\b/i.test(li.title)) {
        for (const b of await bonusOf(hit.p.id)) {
          const l = linksOf(b);
          if (l.length && !items.some((x) => x.productId === b.id)) items.push({ product: b.short_name || b.name, kind: "bonus", links: l, status: hit.how === "exact" ? "available" : "check_link", productId: b.id });
        }
      }
    }
    return {
      ref: o.name.replace(/^#/, ""), order_id: `shopify:${o.name}`, parent_ref: null, email: o.email ?? "",
      purchased_on: o.createdAt.slice(0, 10), days_since_purchase: Math.floor((now - Date.parse(o.createdAt)) / 864e5),
      status, raw_status: o.displayFinancialStatus ?? "", is_post_purchase: false,
      total_paid: Number(o.totalPriceSet.shopMoney.amount), currency: o.totalPriceSet.shopMoney.currencyCode, items,
      found_by: o.byName ? "name" as const : "email" as const,
    };
  }));
}
