import { withBrand } from "@/lib/brand";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  getCatalog,
  pickLang,
  catalogUrls,
  legalCtx,
  legalInfo,
  brandName,
  brandColors,
  phoneOf,
  replyInfo,
} from "@/lib/catalog";
import { catalogTexts, type CatalogLang } from "@/lib/catalog-texts";

export type PagePath = "" | "/terms" | "/privacy" | "/refund-policy" | "/contact";

export type PageProps = {
  params: Promise<{ store: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Todo lo que una página del catálogo necesita: datos, idioma, textos y
 * links. En un dominio propio (el middleware manda x-catalog-root: 1) los
 * links van a /terms; en el dominio de la app, a /catalogo/{slug}/terms.
 */
export async function pageCtx(props: PageProps, path: PagePath) {
  const { store: slug } = await props.params;
  const sp = await props.searchParams;
  const raw = await getCatalog(slug);
  if (!raw) notFound();

  const { lang, def, langs } = pickLang(raw.store, sp.lang);
  // Con el nombre de la marca en ese idioma (p. ej. otra marca en francés).
  const cat = { ...raw, store: withBrand(raw.store, lang) };
  const store = cat.store;
  const t = catalogTexts(lang);
  const onRoot = (await headers()).get("x-catalog-root") === "1";
  const base = onRoot ? "" : `/catalogo/${store.slug}`;
  const q = (l: CatalogLang) => (l === def ? "" : `?lang=${l}`);
  const link = (p: PagePath, l: CatalogLang = lang) => `${base}${p}`.replace(/^$/, "/") + q(l);

  const abs = catalogUrls(store);
  const absOf: Record<PagePath, string> = {
    "": abs.home,
    "/terms": abs.terms,
    "/privacy": abs.privacy,
    "/refund-policy": abs.refund,
    "/contact": abs.contact,
  };

  const brand = brandName(store);
  const legal = legalInfo(store);

  /** Metadata con canonical y hreflang (solo si hay URL absoluta). */
  const meta = (title: string, description: string): Metadata => {
    const url = absOf[path];
    const absolute = /^https?:\/\//.test(url);
    return {
      title,
      description,
      robots: { index: true, follow: true },
      alternates: absolute
        ? {
            canonical: `${url}${q(lang)}`,
            languages: Object.fromEntries([
              ...langs.map((l) => [l, `${url}${q(l)}`]),
              ["x-default", url],
            ]),
          }
        : undefined,
      openGraph: { title, description, type: "website", siteName: brand, locale: t.intl.replace("-", "_") },
    };
  };

  return {
    cat,
    store,
    items: cat.items,
    currency: cat.currency,
    lang,
    def,
    langs,
    t,
    path,
    link,
    brand,
    legal,
    phone: phoneOf(store),
    reply: replyInfo(store),
    colors: brandColors(store),
    legalCtx: legalCtx(cat),
    meta,
  };
}

export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;
