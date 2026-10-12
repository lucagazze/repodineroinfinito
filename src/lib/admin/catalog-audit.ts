import { db } from "@/lib/db";
import { getCatalog, phoneOf, type CatalogItem } from "@/lib/catalog";
import { catalogFacts, type CatalogFacts } from "@/lib/catalog-facts";

/**
 * Revisión del catálogo de una tienda (el sitio que mira Stripe), para «Catálogos» del panel. El catálogo de la app se arma solo desde la base (5 min de caché); esto verifica lo
 * publicado de verdad en el dominio público.
 */
export type Check = { ok: boolean; label: string; detail?: string };
export type CatalogAudit = {
  slug: string; name: string; url: string | null; domain: string | null; currency: string;
  servedBy: "app" | "otro" | "caído";
  items: CatalogItem[]; counts: Record<string, number>;
  /** Productos de la base que no aparecen en la página publicada (solo si no la sirve la app). */
  missingLive: string[];
  noLink: CatalogItem[]; noPrice: CatalogItem[];
  brokenLinks: { name: string; href: string; status: number | string }[];
  legal: Check[]; pages: Check[]; facts: CatalogFacts; problems: number;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function get(url: string, timeout = 15_000): Promise<{ status: number | string; text: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(timeout), headers: { "user-agent": "Mozilla/5.0 (catalog-audit)" } });
    return { status: r.status, text: r.ok ? await r.text() : "" };
  } catch (e) {
    return { status: (e as Error).name === "TimeoutError" ? "tarda" : "error", text: "" };
  }
}
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
  return out;
}

export async function auditCatalog(slug: string): Promise<CatalogAudit | null> {
  const cat = await getCatalog(slug);
  if (!cat) return null;
  const s = cat.store;
  const { data: row } = await db.from("stores").select("catalog_url").eq("slug", slug).maybeSingle();
  const url = (row?.catalog_url as string | null) ?? (s.catalog_domain ? `https://${s.catalog_domain}/` : null);
  const items = cat.items;
  const counts = items.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {});

  // Lo publicado.
  const live = url ? await get(url) : { status: "sin url", text: "" };
  const servedBy: CatalogAudit["servedBy"] = !live.text ? "caído" : live.text.includes("cat-hero") ? "app" : "otro";
  const liveText = norm(live.text.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " "));
  const missingLive = servedBy === "app" ? [] : items.filter((i) => !liveText.includes(norm(i.name).slice(0, 40))).map((i) => i.name);

  // Políticas (en el dominio público).
  const base = url ? url.replace(/\/+$/, "") : null;
  const pageList = ["terms", "privacy", "refund-policy", "contact"];
  const pages: Check[] = base
    ? await Promise.all(pageList.map(async (p) => { const r = await get(`${base}/${p}`); return { ok: r.status === 200, label: `/${p}`, detail: String(r.status) }; }))
    : [{ ok: false, label: "Sin dirección pública del catálogo" }];

  // Links de compra: cada checkout distinto, una vez.
  const hrefs = [...new Map(items.filter((i) => i.href).map((i) => [i.href!, i.name])).entries()];
  const res = await pool(hrefs, 6, async ([href, name]) => ({ name, href, status: (await get(href, 12_000)).status }));
  const brokenLinks = res.filter((r) => r.status !== 200);

  const b = s.business ?? {};
  const legal: Check[] = [
    { ok: !!s.legal_name, label: "Razón social", detail: s.legal_name ?? "falta" },
    { ok: !!s.legal_address, label: "Dirección legal", detail: s.legal_address ?? "falta" },
    { ok: !!s.support_email, label: "Email de soporte", detail: s.support_email },
    { ok: !!phoneOf(s), label: "Teléfono", detail: phoneOf(s) ?? "falta" },
    { ok: !!s.statement_descriptor, label: "Descriptor de la tarjeta", detail: s.statement_descriptor ?? "falta" },
    { ok: (s.guarantee_days ?? 0) > 0, label: "Política de reembolso", detail: `${s.guarantee_days ?? 0} días` },
    { ok: !!b.about?.trim(), label: "Descripción del negocio", detail: b.about ? "con datos en vivo" : "falta" },
    { ok: !!b.audience?.trim(), label: "A quién se vende", detail: b.audience ? "con datos en vivo" : "falta" },
  ];
  const facts = await catalogFacts(s);
  const noLink = items.filter((i) => i.kind !== "bonus" && !i.href);
  const noPrice = items.filter((i) => i.kind !== "bonus" && !i.amount);
  const problems = (servedBy === "app" ? 0 : 1) + missingLive.length + brokenLinks.length + legal.filter((c) => !c.ok).length + pages.filter((c) => !c.ok).length + facts.unknown.length;
  return { slug, name: s.display_name || s.name, url, domain: s.catalog_domain, currency: cat.currency, servedBy, items, counts, missingLive, noLink, noPrice, brokenLinks, legal, pages, facts, problems };
}
