import { createHmac, randomUUID } from "crypto";
import { z } from "zod";
import { db, itemsByRole, legalOf, type Product, type Store } from "./db";
import { brandFor, withBrand } from "./brand";
import { sendMail } from "./email";
import { checkoutUrl } from "./checkout-url";
import { DEFAULT_LOCALE, LOCALES, T, money, type Locale } from "./i18n";
import { resolveSettings } from "./checkout-settings";
import { loadCheckout } from "./checkout-data";
import { quoteFrom } from "./pricing";
import { getRates } from "./fx";
import { signCartDiscount } from "./cart-discount";
import { aiConfigured, aiJson } from "./ai-reply";
import { checkLink } from "./link-check";
import { liveTrackBase, PREFETCH_UA, withTracking } from "./mail-track";
import { publicOrigin } from "./public-url";
import { queuePush } from "./push";
import { raiseAlert } from "./alerts";
import { adminEmails } from "./auth";
import { DEFAULT_TEST_EMAIL } from "./test-purchase";
import { isTestStore } from "./test-store";
import { formatUntil, recoveryTexts } from "./cart-recovery-texts";

/**
 * Carritos abandonados: a quien dejó el email en el checkout y no pagó, un
 * mail escrito por la IA (en su idioma, con la marca de ese idioma) con un
 * descuento firmado sobre lo que tenía en el carrito. Las partes que no se
 * pueden equivocar (precios, vencimiento, link, pie legal, baja) las pone la
 * plantilla, nunca la IA. Si la IA falla o escribe algo que no pasa el
 * control, sale el texto de respaldo a mano.
 *
 * Quién NO recibe: ya compró en la tienda después de abrir el carrito, es una
 * dirección de prueba o interna, rebotó antes, se dio de baja, es un robot
 * (o el revisor de Meta), el checkout tiene la recuperación apagada, es de
 * Alemania o Austria (piden consentimiento previo), o ya recibió uno de ese
 * checkout en los últimos 7 días.
 */

const H = 3600_000;
/** Alemania (UWG §7) y Austria (TKG §174) piden consentimiento previo para estos mails: sin casilla en el checkout, no se mandan. */
const NEED_CONSENT = new Set(["DE", "AT"]);
const BOT_UA = /bot\b|bot\/|crawler|spider|HeadlessChrome|facebookexternalhit|meta-externalagent|facebookcatalog|Lighthouse|Playwright|Puppeteer|python|curl|wget/i;
/** Rangos de Meta (revisión de anuncios / crawler): las personas reales entran desde su operadora, no desde acá. */
const META_IP = /^(31\.13\.|66\.220\.|69\.63\.|69\.171\.|74\.119\.|102\.132\.|129\.134\.|157\.240\.|173\.252\.|179\.60\.|185\.60\.|204\.15\.|2a03:2880:)/;

type Cart = {
  id: string; store_id: string; funnel_id: string | null; email: string | null; name: string | null; locale: string | null;
  currency: string | null; amount: number | null; bumps: string[] | null; status: string; created_at: string; updated_at: string | null;
  country: string | null; tracking: Record<string, unknown> | null; recovery_sent_at: string | null;
};
const CART_COLS = "id,store_id,funnel_id,email,name,locale,currency,amount,bumps,status,created_at,updated_at,country,tracking,recovery_sent_at";

export type RecoveryResult =
  | { sent: string; to: string; source: "ai" | "template"; subject: string; pct: number; expires_at: string }
  | { skipped: string }
  | { preview: { subject: string; html: string; source: "ai" | "template"; url: string; to: string; pct: number; expires_at: string; notes: string[] } };

const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");

async function testAddress(email: string, storeId: string) {
  const e = email.toLowerCase();
  if (/@(example\.(com|org|net)|test|invalid|localhost|tfbnw\.net)$/.test(e) || /\.(test|invalid|example)$/.test(e)) return true;
  if (/^(test|testing|prueba)[\d._+-]*@/.test(e)) return true;
  const only = process.env.MAIL_TEST_ONLY_TO?.trim().toLowerCase();
  if (only && e === only) return false; // pruebas locales: la casilla de prueba sí recibe
  if (e === DEFAULT_TEST_EMAIL || adminEmails().includes(e)) return true;
  const [{ data: st }, { data: box }, { count: tests }] = await Promise.all([
    db.from("stores").select("support_email,email_from").eq("id", storeId).maybeSingle(),
    db.from("store_mail").select("username"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("status", "test").ilike("email", likeEsc(e)),
  ]);
  const own = [st?.support_email, st?.email_from, ...(box ?? []).map((b) => b.username)].filter(Boolean).map((x) => String(x).toLowerCase());
  return own.includes(e) || !!tests;
}

/** Por qué no se le manda a este carrito (o null si se puede). `force` saltea la espera y la regla de 7 días (envío a mano). */
async function skipReason(c: Cart, opts: { force?: boolean } = {}): Promise<string | null> {
  if (!c.email || c.status !== "open") return "no está abierto o no tiene email";
  if (c.recovery_sent_at) return "ya recibió el mail de recuperación";
  if (await isTestStore(c.store_id)) return "tienda de prueba (llaves de test de Stripe)";
  const only = process.env.MAIL_TEST_ONLY_TO?.trim().toLowerCase();
  if (only && c.email.toLowerCase() !== only) return "modo prueba: solo a la casilla de prueba";
  const { data: f } = await db.from("funnels").select("settings").eq("id", c.funnel_id ?? "").maybeSingle();
  const rec = resolveSettings(f?.settings).recovery;
  if (!rec.enabled) return "recuperación apagada en este checkout";
  if (NEED_CONSENT.has((c.country ?? "").toUpperCase()) || (c.locale ?? "").startsWith("de")) return "Alemania/Austria: hace falta consentimiento previo";
  const ua = String(c.tracking?.ua ?? c.tracking?.user_agent ?? "");
  const ip = String(c.tracking?.ip ?? "");
  if ((ua && BOT_UA.test(ua)) || (ip && META_IP.test(ip))) return "robot o revisión de Meta";
  if (!opts.force) {
    const idle = c.updated_at && c.updated_at > c.created_at ? c.updated_at : c.created_at;
    if (Date.now() - +new Date(idle) < rec.delayMinutes * 60_000) return "todavía no pasó la espera";
  }
  if (await testAddress(c.email, c.store_id)) return "dirección de prueba o interna";
  const email = likeEsc(c.email);
  const [{ count: bought }, { count: bounced }, { count: unsub }, { count: recent }] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("store_id", c.store_id).ilike("email", email).eq("status", "paid").gte("created_at", c.created_at),
    db.from("email_log").select("id", { count: "exact", head: true }).eq("store_id", c.store_id).ilike("to_email", email).not("bounced_at", "is", null),
    db.from("mail_unsubscribes").select("email", { count: "exact", head: true }).eq("store_id", c.store_id).eq("email", c.email.toLowerCase()),
    db.from("checkouts").select("id", { count: "exact", head: true }).eq("funnel_id", c.funnel_id ?? "").ilike("email", email)
      .gte("recovery_sent_at", new Date(Date.now() - 7 * 24 * H).toISOString()),
  ]);
  if (bought) {
    await db.from("checkouts").update({ status: "paid" }).eq("id", c.id);
    return "ya compró";
  }
  if (bounced) return "un mail anterior rebotó";
  if (unsub) return "se dio de baja";
  if (recent && !opts.force) return "ya recibió uno de este checkout en los últimos 7 días";
  return null;
}

// ------------------------------------------------------------------ la IA

const Copy = z.object({
  subject: z.string().min(8).max(90),
  preheader: z.string().min(8).max(130),
  headline: z.string().min(4).max(80),
  intro: z.string().min(20).max(420),
  benefits: z.array(z.string().min(10).max(150)).min(2).max(3),
  cta: z.string().min(4).max(34),
  closing: z.string().min(10).max(260),
});
type CopyT = z.infer<typeof Copy>;

/** Sin descuento (el dueño lo sacó de todos los checkouts, 06/10): el mail es un recordatorio, sin %. */
const toolFor = (pct: number) => (pct ? TOOL : {
  ...TOOL,
  input_schema: {
    ...TOOL.input_schema,
    properties: {
      ...TOOL.input_schema.properties,
      subject: { type: "string", description: "≤ 70 characters. Strong and specific: the product name. There is NO discount: never mention one." },
      intro: { type: "string", description: "1–2 short warm sentences: greet by first name if given, they left the product in the cart, we kept it for them at the same price." },
      cta: { type: "string", description: "Button text, ≤ 28 characters, imperative (e.g. finish my order). No discount." },
    },
  },
});

const TOOL = {
  name: "cart_email",
  description: "The copy of one abandoned-cart email.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "≤ 70 characters. Strong and specific: the product name and the discount percentage." },
      preheader: { type: "string", description: "≤ 100 characters, complements the subject." },
      headline: { type: "string", description: "≤ 60 characters." },
      intro: { type: "string", description: "1–2 short warm sentences: greet by first name if given, they left the product in the cart, we saved it with the discount." },
      benefits: { type: "array", items: { type: "string" }, description: "2–3 concrete benefits, each ≤ 110 characters, taken ONLY from the product data." },
      cta: { type: "string", description: "Button text, ≤ 28 characters, imperative, may include the discount (e.g. −20%)." },
      closing: { type: "string", description: "One friendly sentence, no pressure (e.g. they can reply with questions)." },
    },
    required: ["subject", "preheader", "headline", "intro", "benefits", "cta", "closing"],
  },
};

const LANG: Record<Locale, string> = { it: "Italian", en: "English", es: "Spanish from Spain (tú, never voseo)", "pt-BR": "Brazilian Portuguese", fr: "French (tutoiement)", de: "German (du)" };

function system(brand: string, locale: Locale, pct: number) {
  return `You write ONE abandoned-cart email for the online store "${brand}". It sells digital study books in PDF, delivered instantly by email. Answer ONLY by calling the tool "cart_email".
Rules:
- Write everything in ${LANG[locale]}. Call the store "${brand}".
- Use ONLY facts from PRODUCT DATA (names and descriptions). Never invent features, contents, page counts, numbers, testimonials, reviews, ratings, student counts, results or guarantees.
${pct
    ? `- Do not write any number except the discount "${pct}" (prices, dates and the deadline are added by the template). No URLs, no prices, no dates.`
    : "- There is NO discount and NO deadline: never mention a discount, a percentage, an offer or an expiry. Do not write any number. No URLs, no prices, no dates."}
- No fake urgency ("last chance", "only today", "few left", "hurry"): the only deadline is the real one, added by the template. No ALL CAPS, no emojis.
- Tone: warm, clear and tempting; short sentences; one idea per line. Talk about what they get, not about us.
- benefits: concrete benefits a buyer gets, rephrased from the descriptions (what it helps them do or understand). If the bonuses are relevant, one benefit may mention them by name.`;
}

/** Números que aparecen en el texto y no están en los datos del producto (la IA no puede inventar cifras). */
function inventedNumbers(copy: CopyT, source: string, pct: number) {
  const allowed = new Set([String(pct), ...(source.match(/\d+(?:[.,]\d+)?/g) ?? [])]);
  const text = [copy.subject, copy.preheader, copy.headline, copy.intro, ...copy.benefits, copy.cta, copy.closing].join(" ");
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => !allowed.has(n));
}

async function writeCopy(input: { brand: string; locale: Locale; pct: number; first: string | null; main: Product; bumps: Product[]; bonuses: Product[]; included: Product[] }) {
  const t = recoveryTexts(input.locale).fallback;
  const r = T[input.locale] ?? T.en;
  const name = input.main.short_name || input.main.name;
  const fallback = (why: string) => ({
    source: "template" as const, why,
    // Sin descuento: los textos de recordatorio de siempre (T.rec*), en los 6 idiomas.
    copy: input.pct ? {
      subject: t.subject(name, input.pct), preheader: t.preheader(input.pct), headline: t.headline(input.pct),
      intro: t.intro(input.first, name, input.pct), benefits: [] as string[], cta: t.cta(input.pct), closing: t.closing,
    } : {
      subject: r.recSubject(name), preheader: r.recPreheader, headline: r.recHeadline,
      intro: r.recBody(name), benefits: [] as string[], cta: r.recCta, closing: r.recFoot,
    },
  });
  if (!aiConfigured()) return fallback("sin clave de IA");
  const data = {
    language: input.locale, store: input.brand, discount_percent: input.pct, first_name: input.first,
    product: { name: input.main.name, short_name: input.main.short_name, description: input.main.description },
    also_in_cart: input.bumps.map((p) => ({ name: p.name, description: p.description })),
    bonuses_included: [...input.bonuses, ...input.included].map((p) => ({ name: p.name, description: p.description })),
  };
  const source = JSON.stringify(data);
  try {
    const raw = await aiJson(system(input.brand, input.locale, input.pct), `PRODUCT DATA (JSON):\n${source}`, toolFor(input.pct), { temperature: 0.6 });
    const p = Copy.safeParse(raw);
    if (!p.success) return fallback(`la IA devolvió algo inválido (${p.error.issues[0]?.path.join(".")})`);
    const c = p.data;
    const all = [c.subject, c.preheader, c.headline, c.intro, ...c.benefits, c.cta, c.closing].join(" ");
    if (/https?:\/\/|www\./i.test(all)) return fallback("la IA escribió un link");
    const bad = inventedNumbers(c, source, input.pct);
    if (bad.length) return fallback(`la IA escribió números que no están en el producto: ${bad.join(", ")}`);
    return { source: "ai" as const, why: "", copy: c };
  } catch (e) {
    return fallback(`la IA no respondió: ${(e as Error).message.slice(0, 120)}`);
  }
}

// ------------------------------------------------------------------ el mail

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const INK = "#171717", MUTED = "#6b7280", LINE = "#e5e7eb";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderHtml(a: {
  locale: Locale; brand: string; color: string; logo: string | null; copy: CopyT; cover: string | null; productName: string;
  lines: { name: string; was: string; now: string }[]; wasTotal: string; nowTotal: string; pct: number; bonuses: string[];
  until: string; url: string; unsubUrl: string; legal: string; support: string;
}) {
  const t = recoveryTexts(a.locale);
  const btn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td align="center" bgcolor="${a.color}" style="border-radius:10px">
<a data-cta="1" href="${esc(a.url)}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${esc(a.copy.cta)}</a></td></tr></table>`;
  return `<!doctype html>
<html lang="${a.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(a.copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#f0f0f0;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(a.copy.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f0f0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 16px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1e293b">${a.logo
    ? `<img src="${esc(a.logo)}" alt="${esc(a.brand)}" height="40" style="display:block;height:40px;width:auto;max-width:220px;margin:0 auto;border-radius:6px">`
    : esc(a.brand)}</td></tr>
<tr><td bgcolor="#ffffff" style="border-radius:16px;padding:34px 32px 30px;border-top:5px solid ${a.color}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="font-family:${FONT}">
${a.pct ? `<p style="margin:0 0 14px;display:inline-block;padding:5px 12px;border-radius:999px;background:#dcfce7;color:#15803d;font-size:13px;font-weight:800">−${a.pct}%</p>` : ""}
<p style="margin:0;font-size:25px;font-weight:700;line-height:1.25;color:${INK};letter-spacing:-.02em">${esc(a.copy.headline)}</p>
<p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:${MUTED}">${esc(a.copy.intro)}</p>
</td></tr>
${a.cover ? `<tr><td align="center" style="padding:24px 0 4px"><img src="${esc(a.cover)}" width="220" alt="${esc(a.productName)}" style="display:block;width:220px;max-width:70%;height:auto;border-radius:8px;border:1px solid ${LINE}"></td></tr>` : ""}
<tr><td align="center" style="padding:12px 0 0;font-family:${FONT}"><p style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:${INK}">${esc(a.productName)}</p></td></tr>
${a.copy.benefits.length ? `<tr><td style="padding:20px 0 0;font-family:${FONT}">${a.copy.benefits.map((b) => `<p style="margin:0 0 9px;font-size:14.5px;line-height:1.5;color:${INK}"><span style="color:#16a34a;font-weight:800">✓</span>&nbsp; ${esc(b)}</p>`).join("")}</td></tr>` : ""}
${a.bonuses.length ? `<tr><td style="padding:12px 0 0;font-family:${FONT}"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${esc(t.bonusesTitle)}</p>${a.bonuses.map((b) => `<p style="margin:0 0 4px;font-size:14px;line-height:1.45;color:${INK}">🎁 ${esc(b)}</p>`).join("")}</td></tr>` : ""}
<tr><td style="padding:22px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8fafc" style="border-radius:12px;border:1px solid ${LINE}">
${a.lines.length > 1 ? a.lines.map((l) => `<tr><td style="padding:10px 16px 0;font-family:${FONT};font-size:13.5px;color:${INK}">${esc(l.name)}</td><td align="right" style="padding:10px 16px 0;font-family:${FONT};font-size:13.5px;white-space:nowrap">${a.pct ? `<s style="color:#9ca3af">${esc(l.was)}</s> ` : ""}<b style="color:${INK}">${esc(l.now)}</b></td></tr>`).join("") : ""}
${a.pct ? `<tr><td style="padding:14px 16px 4px;font-family:${FONT};font-size:13px;color:${MUTED}">${esc(t.normalPrice)}</td><td align="right" style="padding:14px 16px 4px;font-family:${FONT};font-size:15px;color:#9ca3af"><s>${esc(a.wasTotal)}</s></td></tr>` : ""}
<tr><td style="padding:${a.pct ? "0" : "14px"} 16px 14px;font-family:${FONT};font-size:14px;font-weight:700;color:${INK}">${esc(a.pct ? t.yourPrice(a.pct) : (T[a.locale] ?? T.en).ckTotal)}</td><td align="right" style="padding:${a.pct ? "0" : "14px"} 16px 14px;font-family:${FONT};font-size:22px;font-weight:800;color:${a.pct ? "#15803d" : INK}">${esc(a.nowTotal)}</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:24px 0 0">${btn}</td></tr>
${a.pct ? `<tr><td align="center" style="padding:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">${esc(t.validUntil(a.until))}</td></tr>` : ""}
<tr><td style="padding:24px 0 0;font-family:${FONT};font-size:14.5px;line-height:1.6;color:${INK}">${esc(a.copy.closing)}<p style="margin:12px 0 0;font-weight:700;color:${INK}">${esc(t.team(a.brand))}</p></td></tr>
</table></td></tr>
<tr><td align="center" style="padding:20px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9ca3af">
${esc(t.footerWhy(a.brand))}<br>${esc(a.legal)} · ${esc(a.support)}<br>
<a href="${esc(a.unsubUrl)}" target="_blank" style="color:#9ca3af;text-decoration:underline">${esc(t.unsubscribe)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ------------------------------------------------------------------ baja

const unsubSig = (storeId: string, email: string) =>
  createHmac("sha256", process.env.SECRETS_KEY ?? "").update(`unsub\n${storeId}\n${email.toLowerCase()}`).digest("base64url").slice(0, 22);
export function unsubToken(storeId: string, email: string) {
  return `${Buffer.from(`${storeId}|${email.toLowerCase()}`).toString("base64url")}.${unsubSig(storeId, email)}`;
}
export function readUnsubToken(token: string): { storeId: string; email: string } | null {
  const [b, s] = token.split(".");
  if (!b || !s) return null;
  const [storeId, email] = Buffer.from(b, "base64url").toString("utf8").split("|");
  if (!storeId || !email || unsubSig(storeId, email) !== s) return null;
  return { storeId, email };
}
export { PREFETCH_UA };

// ------------------------------------------------------------------ envío

/**
 * El mail de un carrito: lo arma (IA o respaldo), verifica el link y lo manda
 * (o, con `preview`, lo devuelve sin mandar). `force` = envío a mano desde el
 * panel/MCP: no espera los minutos de inactividad ni la regla de 7 días.
 */
export async function recoverCart(cartId: string, opts: { force?: boolean; preview?: boolean; locale?: Locale } = {}): Promise<RecoveryResult> {
  const { data } = await db.from("checkouts").select(CART_COLS).eq("id", cartId).maybeSingle();
  const c = data as Cart | null;
  if (!c) return { skipped: "no existe el carrito" };
  if (!opts.preview) {
    const why = await skipReason(c, { force: opts.force });
    if (why) {
      // Lo definitivo queda anotado para el panel; «todavía no pasó la espera» no.
      if (!/espera|modo prueba/.test(why)) await db.from("checkouts").update({ recovery_skip: why }).eq("id", c.id).is("recovery_sent_at", null);
      return { skipped: why };
    }
  }

  const [{ data: store }, { data: funnel }] = await Promise.all([
    db.from("stores").select("id,slug,name,display_name,domain,support_email,default_locale,guarantee_days,meta_pixel_id,brand,legal_name,legal_address,statement_descriptor,delivery_email").eq("id", c.store_id).single(),
    db.from("funnels").select("id,slug,settings,checkout_host,checkout_path").eq("id", c.funnel_id ?? "").single(),
  ]);
  if (!store || !funnel) return { skipped: "embudo o tienda inexistente" };
  const data2 = await loadCheckout(store.slug, funnel.slug);
  if (!data2?.main) return { skipped: "el checkout no está activo" };
  const rec = resolveSettings(funnel.settings).recovery;
  // Sin descuento (0 %) sale igual: un recordatorio al mismo precio, sin token ni vencimiento.
  const pct = rec.discountPercent || 0;
  const locale: Locale = opts.locale ?? ((LOCALES as readonly string[]).includes(c.locale ?? "") ? (c.locale as Locale) : (store.default_locale as Locale) ?? DEFAULT_LOCALE);
  const brand = brandFor(store, locale);
  const rates = await getRates();
  const currency = (c.currency ?? "USD").toUpperCase();
  const cartBumps = (c.bumps ?? []) as string[];
  const q0 = quoteFrom(data2, { currency, bumpSlugs: cartBumps, rates });
  const q1 = pct ? quoteFrom(data2, { currency, bumpSlugs: cartBumps, rates, recovery: { pct, bumpSlugs: cartBumps } }) : q0;
  if (!q0 || !q1) return { skipped: "sin precio en esa moneda" };

  const expiresAt = new Date(Date.now() + rec.validHours * H);
  const token = pct ? signCartDiscount(c.id, pct, expiresAt) : null;
  const url = `${checkoutUrl(funnel, store.slug)}?${token ? `r=${encodeURIComponent(token)}&` : ""}email=${encodeURIComponent(c.email ?? "")}&utm_source=recuperacion&utm_medium=email&utm_campaign=carrito`;
  // El botón y la baja van al dominio público del checkout. Sin uno (checkout sin checkout_host → dirección de la app), no hay mail.
  const origin = publicOrigin(url);
  if (!origin) return { skipped: "el checkout no tiene un dominio público (checkout_host)" };
  const unsubUrl = `${(await liveTrackBase(origin).catch(() => null)) ?? origin}/api/m/u/${unsubToken(store.id, c.email ?? "")}?l=${locale}`;

  const main = q1.lines[0].product;
  const bumps = q1.lines.filter((l) => l.role === "bump").map((l) => l.product);
  const bonuses = itemsByRole(data2.funnel, "bonus");
  const included = itemsByRole(data2.funnel, "included");
  const first = c.name ? c.name.trim().split(/\s+/)[0] : null;
  const written = await writeCopy({ brand, locale, pct, first, main, bumps, bonuses, included });
  const fmt = (n: number) => money(n, currency, locale);
  const until = formatUntil(expiresAt.toISOString(), locale, c.country);
  const deliveryColor = (store.delivery_email as { color?: string } | null)?.color;
  const logo = (withBrand(store, locale).brand as { logoEmail?: string } | null)?.logoEmail;
  const html = renderHtml({
    locale, brand, color: deliveryColor && /^#[0-9a-f]{6}$/i.test(deliveryColor) ? deliveryColor : "#16a34a",
    logo: typeof logo === "string" && /^https:\/\//.test(logo) ? logo : null,
    copy: written.copy, cover: main.email_image_url ?? main.image_url, productName: main.name,
    lines: q1.lines.map((l, i) => ({ name: l.product.short_name || l.product.name, was: fmt(q0.lines[i]?.amount ?? l.amount), now: fmt(l.amount) })),
    wasTotal: fmt(q0.total), nowTotal: fmt(q1.total), pct,
    bonuses: [...bonuses, ...included].map((p) => p.short_name || p.name),
    until, url, unsubUrl, legal: [legalOf(store as unknown as Store).name, legalOf(store as unknown as Store).address].filter(Boolean).join(", "),
    support: store.support_email,
  });
  const notes = written.why ? [written.why] : [];

  // El botón tiene que abrir de verdad el checkout (con el descuento) antes de mandar nada.
  const cta = await checkLink(url);
  if (!cta.ok) {
    if (!opts.preview) {
      await raiseAlert({
        kind: "broken_link", severity: "error", storeId: store.id, ref: `cart-cta:${funnel.id}`, reopen: true,
        title: `El link del mail de carrito no abre · ${funnel.slug}`, body: `${url.split("?")[0]} — ${cta.reason ?? "no abre"}`,
      });
      return { skipped: `el link del checkout no abre (${cta.reason})` };
    }
    notes.push(`el link del checkout no abre: ${cta.reason}`);
  }
  // El botón tal cual sale (con el seguimiento): https público, abre el checkout con 200 y el descuento (r=) llega entero.
  const checkoutOrigin = origin;
  const verifyFinal = async (finalHtml: string) => {
    const m = finalHtml.match(/<a data-cta="1" href="([^"]+)"/);
    if (!m) return "no encontré el botón del mail";
    const href = m[1].replace(/&amp;/g, "&");
    if (!publicOrigin(href)) return `el botón no es un link público (${href.slice(0, 60)})`;
    const chk = await checkLink(href);
    if (!chk.ok) return chk.reason ?? "no abre";
    if (chk.status !== 200) return `responde ${chk.status}`;
    const fin = new URL(chk.final ?? href);
    if (fin.origin !== checkoutOrigin) return `termina en otro dominio (${fin.origin})`;
    if (token && fin.searchParams.get("r") !== token) return "el descuento (r=) se pierde en el camino";
    // La baja también va a un dominio público (nada de localhost).
    const unsub = finalHtml.match(/href="([^"]*\/api\/m\/u\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    if (!unsub || !publicOrigin(unsub)) return "la baja no es un link público";
    return null;
  };
  if (opts.preview) {
    // La misma prueba del botón que antes de mandar: con el seguimiento puesto como saldría ahora.
    const base = await liveTrackBase(origin).catch(() => null);
    const finalBad = await verifyFinal(base ? withTracking(html, base, randomUUID()) : html);
    if (finalBad) notes.push(`el botón final no pasa: ${finalBad}`);
    return { preview: { subject: written.copy.subject, html, source: written.source, url, to: c.email ?? "", pct, expires_at: expiresAt.toISOString(), notes } };
  }

  let r;
  try {
    r = await sendMail({
      store: withBrand(store as unknown as Store, locale), to: c.email!, toName: c.name, subject: written.copy.subject, html,
      tag: "recuperacion", kind: "recovery", trackBase: url, verifyFinal,
      headers: { "List-Unsubscribe": `<${unsubUrl}>, <mailto:${store.support_email}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
  } catch (e) {
    // No salió (link que no abre o el proveedor falló): queda anotado y se ve en Carritos; «Mandar ya» lo reintenta.
    const why = `no salió: ${(e as Error).message.slice(0, 160)}`;
    await db.from("checkouts").update({ recovery_skip: why }).eq("id", c.id).is("recovery_sent_at", null);
    return { skipped: why };
  }
  if ("skipped" in r) return { skipped: "no hay proveedor de mail configurado" };
  await db.from("checkouts").update({
    recovery_sent_at: new Date().toISOString(), recovery_pct: pct, recovery_expires_at: pct ? expiresAt.toISOString() : null,
    recovery_email_log_id: r.logId ?? null, recovery_source: written.source, recovery_skip: null,
  }).eq("id", c.id);
  return { sent: r.messageId, to: c.email!, source: written.source, subject: written.copy.subject, pct, expires_at: expiresAt.toISOString() };
}

/**
 * Cron cada 10 min: los carritos con email de las últimas 48 h que todavía
 * no recibieron nada. Por persona y checkout, solo el carrito más nuevo.
 */
export async function runCartRecovery(budgetMs = 45_000) {
  const t0 = Date.now();
  const { data: rows } = await db.from("checkouts").select("id,funnel_id,email,created_at")
    .eq("status", "open").not("email", "is", null).is("recovery_sent_at", null).is("recovery_skip", null)
    .gte("created_at", new Date(Date.now() - 48 * H).toISOString())
    .order("created_at", { ascending: false }).limit(200);
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    if (Date.now() - t0 > budgetMs) break;
    const k = `${r.funnel_id}|${r.email!.toLowerCase()}`;
    if (seen.has(k)) {
      await db.from("checkouts").update({ recovery_skip: "hay un carrito más nuevo de esta persona" }).eq("id", r.id);
      out["carrito más viejo"] = (out["carrito más viejo"] ?? 0) + 1;
      continue;
    }
    seen.add(k);
    const res = await recoverCart(r.id).catch((e) => ({ skipped: `error: ${(e as Error).message.slice(0, 80)}` }));
    const key = "sent" in res ? `enviados (${res.source === "ai" ? "IA" : "respaldo"})` : "skipped" in res ? res.skipped : "vista previa";
    out[key] = (out[key] ?? 0) + 1;
  }
  return { revisados: rows?.length ?? 0, ...out };
}

/** El pago de un carrito recuperado: queda marcado y avisa «Carrito recuperado» una sola vez. */
export async function markCartRecovered(cartId: string, orderId: string) {
  const { data: won } = await db.from("checkouts").update({ recovered_order_id: orderId, status: "paid" })
    .eq("id", cartId).is("recovered_order_id", null).select("id");
  if (!won?.length) return;
  const { data: o } = await db.from("orders").select("amount_total,currency,is_test,funnels(name,offers(name))").eq("id", orderId).maybeSingle();
  // Tienda de prueba (llaves de test): no es una venta, no se avisa.
  if (!o || o.is_test) return;
  const total = money(Number(o.amount_total ?? 0), o.currency ?? "USD", "es");
  const f = o.funnels as unknown as { name: string | null; offers: { name: string | null } | null } | null;
  queuePush("sale", {
    title: `🛒 Carrito recuperado · ${total}`, body: "Pagó con el descuento del mail",
    named: { title: `🛒 Carrito recuperado · ${total}`, body: f?.offers?.name || f?.name || "Pagó con el descuento del mail" },
    url: `/admin/avisos/pedido/${orderId}`, tag: `cart:${cartId}`,
  });
}
