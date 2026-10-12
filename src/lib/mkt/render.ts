import { legalOf, type Product } from "../db";
import { brandFor, withBrand } from "../brand";
import { loadCheckoutFresh, type CheckoutData } from "../checkout-data";
import { quoteFrom, currencyFrom } from "../pricing";
import { resolveSettings } from "../checkout-settings";
import { getRates } from "../fx";
import { money, type Locale } from "../i18n";
import { ownsProduct } from "../postpurchase";
import { signCampaignDiscount } from "../cart-discount";
import { unsubToken } from "../cart-recovery";
import { formatUntil } from "../cart-recovery-texts";
import { mktTexts, COUNTRY_OF } from "./texts";
import { isPublicUrl } from "../public-url";
import type { Block, Version } from "./types";
import type { CatalogItem, StoreRow } from "./catalog";

/**
 * El HTML de un mail de campaña para UNA persona: su idioma, su marca (la
 * de su idioma), el precio en la moneda de su mercado (con el descuento
 * de la campaña si hay), solo productos que todavía no tiene, y el pie fijo
 * (razón social, dirección, baja en un clic). Escrito para clientes de correo:
 * tablas, estilos inline, ancho 600, tapas en JPG.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const INK = "#171717", MUTED = "#6b7280", LINE = "#e5e7eb";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Memoria de un envío (o de un lote): checkouts y tipos de cambio se cargan una vez. */
export type RenderCtx = {
  rates?: Record<string, number>;
  checkouts: Map<string, Promise<CheckoutData | null>>;
  catalog: CatalogItem[];
};
export const newCtx = (catalog: CatalogItem[]): RenderCtx => ({ checkouts: new Map(), catalog });

async function checkoutOf(ctx: RenderCtx, store: StoreRow, item: CatalogItem) {
  let p = ctx.checkouts.get(item.funnelId);
  if (!p) {
    p = loadCheckoutFresh(store.slug, item.funnelSlug).catch(() => null);
    ctx.checkouts.set(item.funnelId, p);
  }
  return p;
}

export type Recipient = { email: string; name: string | null; country: string | null; products: string[] };

export type RenderArgs = {
  campaignId: string;
  discount: { pct: number; expiresAt: Date } | null;
  version: Version;
  locale: Locale;
  store: StoreRow;
  to: Recipient;
  /** El envío (mkt_sends.id): va en la baja. Null en la vista previa. */
  sendId: string | null;
  /** Dominio público donde viven /api/m/n (baja). Null = vista previa sin link de baja real. */
  base: string | null;
  test?: boolean;
  ctx: RenderCtx;
};

export type Rendered = {
  subject: string; preheader: string; html: string;
  /** Los botones de producto (para verificar que abren el checkout con el descuento). */
  productLinks: { funnelId: string; url: string; token: string | null }[];
  unsubUrl: string | null;
  /** Por qué no se le manda (ya tiene todo lo que ofrece). */
  skip: string | null;
  notes: string[];
};

const firstName = (n: string | null) => (n ? n.trim().split(/\s+/)[0] || null : null);

/** Texto del editor: párrafos con línea en blanco, **negrita**, {nombre}. */
function rich(s: string, first: string | null) {
  const named = s.replace(/ ?\{nombre\}/g, first ? ` ${first}` : "").replace(/\{nombre\}/g, first ?? "");
  return named.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15.5px;line-height:1.6;color:${INK}">${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`).join("");
}

function button(href: string, label: string, color: string, attr = "") {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td align="center" bgcolor="${color}" style="border-radius:10px">
<a ${attr} href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;
}

function withParams(url: string, params: Record<string, string | null>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export async function renderCampaign(a: RenderArgs): Promise<Rendered> {
  const t = mktTexts(a.locale);
  const brand = brandFor(a.store, a.locale);
  const branded = withBrand(a.store, a.locale);
  const logoRaw = (branded.brand as { logoEmail?: unknown } | null)?.logoEmail;
  const logo = typeof logoRaw === "string" && /^https:\/\//.test(logoRaw) ? logoRaw : null;
  const dc = (a.store.delivery_email as { color?: string } | null)?.color;
  const pay = (a.store.brand as { payButton?: string } | null)?.payButton;
  const color = [dc, pay].find((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) ?? "#111827";
  const first = firstName(a.to.name);
  const owned = new Set(a.to.products);
  const rates = a.ctx.rates ?? (a.ctx.rates = await getRates());
  const notes: string[] = [];
  const productLinks: Rendered["productLinks"] = [];
  const shown = new Set<string>();
  const country = (a.to.country || COUNTRY_OF[a.locale]).toUpperCase();
  const until = a.discount ? formatUntil(a.discount.expiresAt.toISOString(), a.locale, country) : "";
  let wanted = 0, drawn = 0;

  const card = async (item: CatalogItem, cta: string | undefined, blurb: string | undefined): Promise<string | null> => {
    const data = await checkoutOf(a.ctx, a.store, item);
    if (!data?.main) { notes.push(`el checkout «${item.funnelSlug}» no está activo: no se muestra`); return null; }
    const main = data.main as Product;
    if (ownsProduct(owned, main)) return null;
    const set = resolveSettings(data.funnel.settings);
    const cur = set.currency || currencyFrom(data.markets, country, rates);
    const disc = a.discount && a.discount.pct > 0 ? { pct: a.discount.pct, bumpSlugs: [] as string[] } : null;
    const q = quoteFrom(data, { currency: cur, bumpSlugs: [], rates, recovery: disc });
    if (!q) { notes.push(`«${item.shortName}» no tiene precio en ${cur}: no se muestra`); return null; }
    const line = q.lines[0];
    const token = a.discount ? signCampaignDiscount(a.campaignId, data.funnel.id, a.discount.pct, a.discount.expiresAt) : null;
    // El link público del checkout (checkout_host + checkout_path, o /c/tienda/embudo), como en el catálogo.
    const href = withParams(item.url, {
      r: token, utm_source: "email", utm_medium: "email", utm_campaign: a.campaignId, utm_content: a.locale,
    });
    productLinks.push({ funnelId: item.funnelId, url: href, token });
    shown.add(item.funnelId);
    const img = main.email_image_url ?? main.image_url;
    const was = line.compareAt && line.compareAt > line.amount ? money(line.compareAt, cur, a.locale) : null;
    return `<tr><td style="padding:10px 0 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:14px">
<tr><td align="center" style="padding:22px 20px 20px;font-family:${FONT}">
${img ? `<img src="${esc(img)}" width="200" alt="${esc(main.short_name || main.name)}" style="display:block;width:200px;max-width:70%;height:auto;margin:0 auto 14px;border-radius:8px;border:1px solid ${LINE}">` : ""}
<p style="margin:0;font-size:17px;font-weight:700;line-height:1.3;color:${INK}">${esc(main.name)}</p>
${blurb ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:${MUTED}">${esc(blurb)}</p>` : ""}
<p style="margin:12px 0 0;font-size:20px;font-weight:800;color:${a.discount ? "#15803d" : INK}">${was ? `<s style="font-size:15px;font-weight:600;color:#9ca3af">${esc(was)}</s>&nbsp; ` : ""}${esc(money(line.amount, cur, a.locale))}</p>
${a.discount ? `<p style="margin:6px 0 0"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:12.5px;font-weight:800">${esc(t.off(a.discount.pct))}</span></p>` : ""}
<div style="height:16px;line-height:16px">&nbsp;</div>
${button(href, cta || t.cta, color, `data-p="${esc(item.funnelId)}"`)}
${a.discount ? `<p style="margin:10px 0 0;font-size:12.5px;line-height:1.5;color:${MUTED}">${esc(t.validUntil(until))}</p>` : ""}
</td></tr></table></td></tr>`;
  };
  const parts: string[] = [];
  for (const b of a.version.blocks as Block[]) {
    if (b.type === "heading") {
      if (b.text.trim()) parts.push(`<tr><td style="padding:4px 0 12px;font-family:${FONT}"><p style="margin:0;font-size:24px;font-weight:700;line-height:1.25;color:${INK};letter-spacing:-.02em">${esc(b.text.replace(/ ?\{nombre\}/g, first ? ` ${first}` : ""))}</p></td></tr>`);
    } else if (b.type === "text") {
      const h = rich(b.text, first);
      if (h) parts.push(`<tr><td style="padding:0 0 4px">${h}</td></tr>`);
    } else if (b.type === "product") {
      wanted++;
      const item = a.ctx.catalog.find((c) => c.funnelId === b.funnel);
      if (!item) { notes.push("un bloque de producto apunta a un checkout que ya no existe"); continue; }
      const h = await card(item, b.cta, b.blurb);
      if (h) { parts.push(h); drawn++; }
    } else if (b.type === "recommend") {
      wanted++;
      const cats = new Set((b.categories ?? []).filter(Boolean));
      const picks = a.ctx.catalog.filter((c) => c.active && !c.solo && c.locale === a.locale && !shown.has(c.funnelId) && (!cats.size || (c.category && cats.has(c.category))));
      const cards: string[] = [];
      for (const it of picks) {
        if (cards.length >= b.count) break;
        const h = await card(it, b.cta, undefined);
        if (h) cards.push(h);
      }
      if (cards.length) {
        parts.push(`<tr><td style="padding:8px 0 4px;font-family:${FONT}"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${esc(b.title || t.forYou)}</p></td></tr>`, ...cards);
        drawn++;
      }
    } else if (b.type === "image") {
      if (!isPublicUrl(b.src)) { notes.push("una imagen no tiene un link https público: no se muestra"); continue; }
      const img = `<img src="${esc(b.src)}" width="536" alt="${esc(b.alt ?? "")}" style="display:block;width:100%;max-width:536px;height:auto;border-radius:10px">`;
      parts.push(`<tr><td style="padding:6px 0 18px">${b.href && isPublicUrl(b.href) ? `<a href="${esc(b.href)}" target="_blank">${img}</a>` : img}</td></tr>`);
    } else if (b.type === "button") {
      if (!b.label.trim() || !isPublicUrl(b.href)) { notes.push("un botón no tiene texto o link https público: no se muestra"); continue; }
      parts.push(`<tr><td align="center" style="padding:8px 0 22px">${button(withParams(b.href, isOurs(b.href, a.store) ? { utm_source: "email", utm_medium: "email", utm_campaign: a.campaignId } : {}), b.label, color)}</td></tr>`);
    }
  }
  const skip = wanted > 0 && drawn === 0 ? "ya tiene todo lo que ofrece la campaña" : null;

  const legal = legalOf(a.store);
  const unsubUrl = a.base
    ? `${a.base}/api/m/n/${unsubToken(a.store.id, a.to.email)}?l=${encodeURIComponent(a.locale)}${a.sendId ? `&s=${a.sendId}` : ""}${a.test ? "&t=1" : ""}`
    : null;
  const subject = a.version.subject.replace(/ ?\{nombre\}/g, first ? ` ${first}` : "").trim();
  const pre = (a.version.preheader ?? "").replace(/ ?\{nombre\}/g, first ? ` ${first}` : "").trim();

  const html = `<!doctype html>
<html lang="${a.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f0f0f0;-webkit-text-size-adjust:100%">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(pre)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f0f0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 16px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1e293b">${logo
    ? `<img src="${esc(logo)}" alt="${esc(brand)}" height="40" style="display:block;height:40px;width:auto;max-width:220px;margin:0 auto;border-radius:6px">`
    : esc(brand)}</td></tr>
<tr><td bgcolor="#ffffff" style="border-radius:16px;padding:32px 32px 18px;border-top:5px solid ${color}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${parts.join("\n")}
</table></td></tr>
<tr><td align="center" style="padding:20px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9ca3af">
${esc(t.why(brand))}<br>${esc([legal.name, legal.address].filter(Boolean).join(", "))} · ${esc(a.store.support_email)}<br>
${unsubUrl ? `<a href="${esc(unsubUrl)}" data-unsub="1" target="_blank" style="color:#9ca3af;text-decoration:underline">${esc(t.unsubscribe)}</a>` : `<span style="text-decoration:underline">${esc(t.unsubscribe)}</span>`}
</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, preheader: pre, html, productLinks, unsubUrl, skip, notes };
}

/** ¿El link es de un dominio de la tienda? (solo a esos se les suman los utm). */
function isOurs(href: string, store: StoreRow) {
  try {
    const h = new URL(href).hostname.replace(/^www\./, "");
    const root = (d: string | null | undefined) => (d ?? "").replace(/^https?:\/\//, "").split("/")[0].split(".").slice(-2).join(".");
    const mine = [root(store.domain), root(store.support_email.split("@")[1])].filter(Boolean);
    return mine.some((m) => h === m || h.endsWith(`.${m}`));
  } catch {
    return false;
  }
}
