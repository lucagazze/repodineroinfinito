import { cache } from "react";
import { catalogFacts, fillFacts } from "./catalog-facts";
import { checkoutUrl } from "./checkout-url";
import { unstable_cache } from "next/cache";
import { db, type Product } from "./db";
import { getRates, priceFor } from "./fx";
import { CATALOG_LANGS, isCatalogLang, type CatalogLang, type LegalCtx } from "./catalog-texts";

/**
 * Catálogo público de cada tienda: el sitio que Stripe revisa para verificar
 * el negocio (quién vende, qué, a qué precio, cómo se entrega, políticas y
 * contacto). Todo sale de la base; si un dato falta, la página lo omite.
 */

export type Business = {
  tagline?: string;
  about?: string;
  audience?: string;
  phone?: string;
  reply_hours?: string | number;
  languages?: string[];
  /** false = catálogo apagado (404). Cualquier otro valor lo deja visible. */
  catalog_enabled?: boolean;
};

export type CatalogStore = {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  domain: string | null;
  catalog_domain: string | null;
  support_email: string;
  default_locale: string;
  guarantee_days: number;
  legal_name: string | null;
  legal_address: string | null;
  statement_descriptor: string | null;
  brand: Record<string, unknown> | null;
  business: Business | null;
};

export type ItemKind = "product" | "addon" | "after" | "bonus";

export type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  image: string | null;
  kind: ItemKind;
  /** Importe en la moneda base de la tienda; null = sin precio que mostrar. */
  amount: number | null;
  compareAt: number | null;
  /** Checkout donde se compra (o donde se ofrece). */
  href: string | null;
  /** Para bonus: producto principal que lo incluye. */
  includedWith: string | null;
};

export type Catalog = {
  store: CatalogStore;
  currency: string;
  items: CatalogItem[];
};

const STORE_COLS =
  "id,slug,name,display_name,logo_url,domain,catalog_domain,support_email,default_locale,guarantee_days," +
  "legal_name,legal_address,statement_descriptor,brand,business";

const KIND_ORDER: Record<ItemKind, number> = { product: 0, addon: 1, after: 2, bonus: 3 };

// ------------------------------------------------------------------ urls

/** "https://Pay.Example.com:443/x" → "pay.example.com" */
export function normHost(d: string | null | undefined): string | null {
  if (!d) return null;
  const h = d.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  return h || null;
}

/** URL pública de la app (sin barra final). Vacío = rutas relativas. */
export function appBase(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
}

/** Checkout de un embudo: en el dominio propio de la tienda si lo tiene. */
export function checkoutHref(store: { slug: string; domain?: string | null }, funnelSlug: string): string {
  const d = normHost(store.domain);
  return d ? `https://${d}/${funnelSlug}` : `${appBase()}/c/${store.slug}/${funnelSlug}`;
}

/**
 * URLs absolutas del catálogo de una tienda: el dominio de catálogo si está
 * configurado; si no, la ruta /catalogo/{slug} en el dominio de la app.
 * Para linkear las páginas legales desde el checkout, los mails, etc.
 */
export function catalogUrls(store: { slug: string; catalog_domain?: string | null }) {
  const d = normHost(store.catalog_domain);
  const root = d ? `https://${d}` : `${appBase()}/catalogo/${store.slug}`;
  return {
    home: d ? `${root}/` : root,
    terms: `${root}/terms`,
    privacy: `${root}/privacy`,
    refund: `${root}/refund-policy`,
    contact: `${root}/contact`,
  };
}

/** Tag para invalidar la caché del catálogo al guardar cambios: revalidateTag(catalogTag(slug)). */
export const catalogTag = (slug: string) => `catalog:${slug}`;

// ------------------------------------------------------------------ datos

type Row = Pick<Product, "id" | "slug" | "name" | "short_name" | "description" | "kind" | "image_url" | "email_image_url" | "sort_order" | "product_prices"> & {
  show_in_catalog: boolean | null;
};
type FunnelRow = {
  id: string;
  slug: string;
  main_product_id: string | null;
  sort_order: number;
  funnel_items: { role: string; product_id: string; sort_order: number }[];
  checkout_host: string | null;
  checkout_path: string | null;
};
type PpRow = { checkout_funnel_id: string | null; trigger_product_ids: string[] | null; pp_steps: { product_id: string; kind?: string | null }[] };

async function loadCatalog(slug: string): Promise<Catalog | null> {
  const { data: store, error } = await db
    .from("stores")
    .select(STORE_COLS)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`catalog store: ${error.message}`);
  if (!store) return null;
  const s = store as unknown as CatalogStore;
  if (s.business?.catalog_enabled === false) return null;

  const [prods, funnels, market, pp] = await Promise.all([
    db
      .from("products")
      .select(
        "id,slug,name,short_name,description,kind,image_url,email_image_url,sort_order,show_in_catalog," +
          "product_prices(currency,amount,compare_at,display_value)"
      )
      .eq("store_id", s.id)
      .eq("active", true)
      .order("sort_order"),
    db
      .from("funnels")
      .select("id,slug,main_product_id,sort_order,checkout_host,checkout_path,funnel_items(role,product_id,sort_order)")
      .eq("store_id", s.id)
      .eq("active", true)
      .order("sort_order"),
    db.from("markets").select("currency").eq("store_id", s.id).eq("is_default", true).limit(1),
    db
      .from("pp_funnels")
      .select("checkout_funnel_id,trigger_product_ids,sort_order,pp_steps(product_id,kind)")
      .eq("store_id", s.id)
      .eq("active", true)
      .order("sort_order"),
  ]);
  if (prods.error) throw new Error(`catalog products: ${prods.error.message}`);
  if (funnels.error) throw new Error(`catalog funnels: ${funnels.error.message}`);

  const currency = String(market.data?.[0]?.currency ?? "USD").trim().toUpperCase();
  const rows = (prods.data ?? []) as unknown as Row[];
  const fs = (funnels.data ?? []) as unknown as FunnelRow[];
  const pps = (pp.error ? [] : pp.data ?? []) as unknown as PpRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const has = (f: FunnelRow, pid: string, roles: string[]) =>
    f.funnel_items?.some((i) => i.product_id === pid && roles.includes(i.role));

  // Upsells de post-compra: el embudo del checkout que los dispara.
  const ppFunnelFor = (pid: string): FunnelRow | undefined => {
    for (const p of pps) {
      if (!p.pp_steps?.some((st) => st.product_id === pid)) continue;
      const f =
        fs.find((x) => x.id === p.checkout_funnel_id) ??
        fs.find((x) => x.main_product_id && (p.trigger_product_ids ?? []).includes(x.main_product_id)) ??
        fs[0];
      if (f) return f;
    }
    return undefined;
  };

  // Todo lo que se vende hoy (principal, bonus, bumps y OTOs de checkouts y post-pagos activos) va SIEMPRE, aunque
  // tenga show_in_catalog=false. Los downsells no: son el
  // mismo libro a mitad de precio, que existe solo justo después de pagar (el catálogo ya muestra el libro).
  const sold = new Set<string>([
    ...fs.map((f) => f.main_product_id).filter((x): x is string => !!x),
    ...fs.flatMap((f) => (f.funnel_items ?? []).map((i) => i.product_id)),
    ...pps.flatMap((p) => (p.pp_steps ?? []).filter((st) => st.kind !== "downsell").map((st) => st.product_id)),
  ]);
  const downsellOnly = new Set(pps.flatMap((p) => (p.pp_steps ?? []).filter((st) => st.kind === "downsell").map((st) => st.product_id)).filter((id) => !sold.has(id)));

  let rates: Record<string, number> | null = null;
  const items: CatalogItem[] = [];
  for (const p of rows) {
    if (downsellOnly.has(p.id)) continue;
    if (p.show_in_catalog === false && !sold.has(p.id)) continue;
    // Productos de prueba («PRUEBA · …»): nunca en la página que revisa Stripe.
    if (/\bprueba\b|\btest\b/i.test(`${p.name} ${p.short_name ?? ""}`)) continue;

    const main = fs.find((f) => f.main_product_id === p.id);
    const bump = main ? undefined : fs.find((f) => has(f, p.id, ["bump"]));
    const up = main || bump ? undefined : fs.find((f) => has(f, p.id, ["upsell"])) ?? ppFunnelFor(p.id);
    const bonus = main || bump || up ? undefined : fs.find((f) => has(f, p.id, ["bonus", "included"]));

    let kind: ItemKind;
    let funnel: FunnelRow | undefined;
    if (main) [kind, funnel] = ["product", main];
    else if (bump) [kind, funnel] = ["addon", bump];
    else if (up) [kind, funnel] = ["after", up];
    else if (bonus) [kind, funnel] = ["bonus", bonus];
    else if (p.kind === "bonus") continue; // bonus suelto: no se vende ni se regala en ningún lado
    else kind = p.kind === "upsell" || p.kind === "postcompra" ? "after" : "product";

    let amount: number | null = null;
    let compareAt: number | null = null;
    if (kind !== "bonus") {
      let row = p.product_prices?.find((x) => x.currency === currency) ?? null;
      if (!row && currency !== "USD") {
        rates ??= await getRates();
        row = priceFor(p as unknown as Product, currency, rates);
      }
      const a = row?.amount == null ? null : Number(row.amount);
      const c = row?.compare_at == null ? null : Number(row.compare_at);
      amount = a && a > 0 ? a : null;
      compareAt = amount && c && c > amount ? c : null;
    }

    const host = kind === "bonus" && funnel?.main_product_id ? byId.get(funnel.main_product_id) : undefined;
    items.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description ?? "",
      image: p.email_image_url || p.image_url || null,
      kind,
      amount,
      compareAt,
      // Sin precio no hay checkout que funcione: no se linkea.
      // La dirección real del checkout (la de su landing si la tiene), la misma que usan los anuncios.
      href: funnel && (kind === "bonus" || amount) ? (funnel.checkout_host && funnel.checkout_path ? checkoutUrl(funnel, s.slug) : checkoutHref(s, funnel.slug)) : null,
      includedWith: host ? host.short_name || host.name : null,
    });
  }
  items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  // El texto del negocio con los datos de hoy (idiomas, temas, públicos, países y rango de precios): ver catalog-facts.
  const b = s.business;
  if (b && /\{(languages|topics|audiences|countries|price_range)\}/.test(`${b.about ?? ""} ${b.audience ?? ""}`)) {
    const priced = items.filter((i) => i.kind !== "bonus" && i.amount).map((i) => i.amount!);
    const range = priced.length ? `${formatMoney(Math.min(...priced), currency, "en-US")} to ${formatMoney(Math.max(...priced), currency, "en-US")}` : null;
    const f = await catalogFacts(s);
    s.business = { ...b, about: fillFacts(b.about, f, range), audience: fillFacts(b.audience, f, range) };
  }

  return { store: s, currency, items };
}

/**
 * Catálogo con caché de 5 minutos entre requests (la página es dinámica por
 * ?lang, los datos no) y memoizado dentro del mismo render.
 */
export const getCatalog = cache((slug: string) =>
  unstable_cache(() => loadCatalog(slug), ["catalog-v1", slug], {
    revalidate: 300,
    tags: ["catalog", catalogTag(slug)],
  })()
);

// ------------------------------------------------------------------ idioma

const baseLang = (l: string | null | undefined) => (l ?? "").trim().toLowerCase().split(/[-_]/)[0];

/** Idiomas que ofrece el catálogo: el de la tienda, inglés y los de business.languages. */
export function catalogLangs(store: CatalogStore): { def: CatalogLang; langs: CatalogLang[] } {
  // Siempre en inglés por defecto; los idiomas en que vende la tienda, a un clic.
  const d = baseLang(store.default_locale);
  const def: CatalogLang = "en";
  const extra = (Array.isArray(store.business?.languages) ? store.business!.languages : []).map(baseLang);
  const set = new Set<string>([def, d, ...extra]);
  // El inglés primero; después el resto en orden fijo.
  return { def, langs: [def, ...CATALOG_LANGS.filter((l) => l !== def && set.has(l))] };
}

export function pickLang(store: CatalogStore, param: string | string[] | undefined) {
  const { def, langs } = catalogLangs(store);
  const want = baseLang(Array.isArray(param) ? param[0] : param);
  const lang = (langs as string[]).includes(want) ? (want as CatalogLang) : def;
  return { lang, def, langs };
}

// ------------------------------------------------------------------ negocio

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s*\.+$/, "") : "") || null;

/**
 * Razón social, dirección y descriptor: los de la tienda, o los del entorno
 * (los mismos que ya muestra el checkout). Nunca un valor inventado: si no hay
 * ninguno, la frase que lo usa se omite.
 */
export function legalInfo(s: CatalogStore) {
  return {
    name: clean(s.legal_name) ?? clean(process.env.LEGAL_NAME),
    address: clean(s.legal_address) ?? clean(process.env.LEGAL_ADDRESS),
    statement: clean(s.statement_descriptor) ?? clean(process.env.STATEMENT_NAME),
  };
}

export function brandName(s: CatalogStore) {
  return (s.display_name || "").trim() || s.name;
}

export function replyInfo(s: CatalogStore): { hours: number | null; text: string | null } {
  const raw = s.business?.reply_hours;
  if (raw == null || raw === "") return { hours: null, text: null };
  if (typeof raw === "number") return raw > 0 ? { hours: Math.round(raw), text: null } : { hours: null, text: null };
  const m = /^\s*(\d{1,3})\s*(h|hs|hrs?|hours?|ore|heures?|stunden?|horas?)?\s*$/i.exec(raw);
  if (m && Number(m[1]) > 0) return { hours: Number(m[1]), text: null };
  return { hours: null, text: clean(raw) };
}

export function phoneOf(s: CatalogStore) {
  return clean(s.business?.phone);
}

/** "+34 600 …" → "tel:+34600…" */
export function telHref(phone: string) {
  return `tel:${phone.replace(/(?!^\+)[^\d]/g, "")}`;
}

const US_RE = /(^|[\s,])(US|USA|U\.S\.A?\.?|United States( of America)?)\s*$/i;

export function legalCtx(c: Catalog): LegalCtx {
  const s = c.store;
  const legal = legalInfo(s);
  const reply = replyInfo(s);
  return {
    brand: brandName(s),
    legalName: legal.name,
    address: legal.address,
    email: s.support_email,
    phone: phoneOf(s),
    replyHours: reply.hours,
    replyText: reply.text,
    days: s.guarantee_days,
    statement: legal.statement,
    currency: c.currency,
    refundUrl: catalogUrls(s).refund,
    usLaw: !!legal.address && US_RE.test(legal.address),
  };
}

// ------------------------------------------------------------------ formato

export function formatMoney(amount: number, currency: string, intl: string) {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(intl, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

export function formatDate(iso: string, intl: string) {
  return new Intl.DateTimeFormat(intl, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`)
  );
}

/** Color de marca saneado (solo hex) y el color de texto que contrasta con él. */
export function brandColors(s: CatalogStore) {
  const raw = String((s.brand as { primary?: unknown } | null)?.primary ?? "").trim();
  const accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : "#1e293b";
  const hex = accent.length === 4 ? accent.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : accent;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return {
    accent,
    // Texto sobre el color de marca: blanco salvo que el color sea claro.
    onAccent: lum > 0.45 ? "#0f172a" : "#ffffff",
    // El color de marca como texto sobre blanco solo si llega a 4.5:1.
    accentText: lum <= 0.18 ? accent : "#0f172a",
  };
}
