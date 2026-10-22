import { randomUUID } from "crypto";
import { db, legalOf, type Product, type Store } from "./db";
import { decrypt } from "./secrets";
import { downloadHref } from "./downloads";
import { T, money, type Locale } from "./i18n";
import { liveTrackBase, publicOrigin, trackBaseForOrder, withTracking } from "./mail-track";
import { orderLink, raiseAlert, resolveAlerts } from "./alerts";
import { checkLinks, linksOf, reportLinks, type LinkCheck } from "./link-check";

/**
 * Email de entrega, por Brevo.
 *
 * Escrito para clientes de correo, no para navegadores: tablas en vez de
 * flex, estilos inline, ancho fijo de 600 y tapas en JPG (Outlook no muestra
 * WebP). Gmail ignora <style>, así que nada depende de clases.
 */

const API = "https://api.brevo.com/v3/smtp/email";
const PAY = "#005bd1";
const INK = "#171717";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

export type SendResult = { skipped: true } | { messageId: string; /** La fila de email_log del envío que salió. */ logId?: string };

type DeliveryArgs = {
  to: string;
  name: string | null;
  store: Store;
  locale: Locale;
  main: Product;
  extras: Product[];
  currency: string;
  /** «#1001» (orderRef de order-ref.ts); las pruebas, «T-81324400». */
  orderRef: string;
  /** Lo que pagó, para mostrarlo en el resumen. */
  total?: number;
  /** Con el pedido, los productos con archivo propio bajan directo por /d/{pedido}/{producto}. */
  orderId?: string;
};

/**
 * ¿El link de entrega es una carpeta de Drive?
 *
 * El consejo «guarda la carpeta en tu Drive» se mandaba con CUALQUIER
 * link. Los productos que se entregan con archivo propio (Supabase) abren
 * una descarga firmada, no una carpeta, y el comprador recibia un consejo
 * que no puede seguir. Visto el 22/10/2026 en el mail de The Valuation
 * Sheet, que es un .xlsx.
 */
const esDrive = (u: string) => /(^|\.)(drive|docs)\.google\.com/i.test(u);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cover = (p: Product) => p.email_image_url ?? p.image_url;

function button(href: string, label: string, opts: { big?: boolean; color?: string } = {}) {
  const pad = opts.big ? "16px 34px" : "9px 16px";
  const size = opts.big ? "16px" : "13px";
  // Tabla + bgcolor: Outlook ignora el padding de los <a> y el background de CSS.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 ${opts.big ? "auto" : "0"}">
<tr><td align="center" bgcolor="${opts.color ?? PAY}" style="border-radius:10px">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:${pad};font-family:${FONT};font-size:${size};font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a>
</td></tr></table>`;
}

function itemRow(p: Product, t: (typeof T)[Locale], mainFolder: string | null, color: string, orderId?: string) {
  const img = cover(p);
  const href = downloadHref(p, orderId);
  const action = href
    ? button(href, t.mailDownload, { color })
    : `<span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:5px;padding:4px 8px">${esc(mainFolder ? t.mailInside : t.ckFree)}</span>`;
  return `<tr><td style="padding:14px 0;border-top:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${img ? `<td width="64" valign="top" style="padding-right:14px"><img src="${esc(img)}" width="64" alt="" style="display:block;width:64px;height:auto;border-radius:6px;border:1px solid ${LINE}"></td>` : ""}
<td valign="top" style="font-family:${FONT}">
<p style="margin:0;font-size:14px;font-weight:600;line-height:1.35;color:${INK}">${esc(p.short_name)}</p>
<p style="margin:4px 0 10px;font-size:12.5px;line-height:1.45;color:${MUTED}">${esc(p.description)}</p>

${action}
${(p.delivery_links ?? []).filter((l) => /^https?:\/\//.test(l.url)).map((l) => `<div style="height:6px"></div>${button(l.url, l.label || t.mailDownload, { color })}`).join("")}
</td></tr></table>
</td></tr>`;
}

/**
 * Lo que la tienda personalizó en Configuración › Entrega. Cada campo vacío
 * vuelve al texto de siempre, en el idioma del comprador.
 */
type DeliveryCustom = { subject?: string; welcome?: string; closing?: string; color?: string; headerImage?: string };

function customOf(store: Store) {
  const c = (store.delivery_email ?? {}) as DeliveryCustom;
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const logo = (store.brand as { logoEmail?: unknown } | null)?.logoEmail;
  return {
    subject: txt(c.subject, 120),
    welcome: txt(c.welcome, 400),
    closing: txt(c.closing, 300),
    color: typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "",
    headerImage: typeof c.headerImage === "string" && /^https:\/\/\S+$/.test(c.headerImage.trim()) ? c.headerImage.trim() : "",
    // JPG del logo (Outlook no muestra WebP): lo genera el panel al subirlo.
    logo: typeof logo === "string" && /^https:\/\//.test(logo) ? logo : "",
  };
}

/** Texto libre con saltos de línea, escapado. {nombre} = el nombre del comprador (o nada). */
const para = (s: string, first: string | null) =>
  esc(s.replace(/ ?\{nombre\}/g, first ? ` ${first}` : "").trim()).replace(/\n/g, "<br>");

function deliveryHtml(a: DeliveryArgs) {
  const t = T[a.locale];
  const url = downloadHref(a.main, a.orderId) ?? "";
  const hero = cover(a.main);
  const legal = legalOf(a.store).name;
  const items = [a.main, ...a.extras.filter((p) => p.id !== a.main.id)];
  const c = customOf(a.store);
  const color = c.color || PAY;
  const shown = a.store.display_name || a.store.name;
  const first = a.name ? a.name.split(" ")[0] : null;

  return `<!doctype html>
<html lang="${a.locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(c.subject || t.mailSubject(shown))}</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(t.mailPreheader(a.main.short_name))}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f0f0">
<tr><td align="center" style="padding:28px 12px">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 16px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1e293b">${c.logo
  ? `<img src="${esc(c.logo)}" alt="${esc(shown)}" height="40" style="display:block;height:40px;width:auto;max-width:220px;margin:0 auto;border-radius:6px">`
  : esc(shown)}</td></tr>

${c.headerImage ? `<tr><td style="line-height:0;font-size:0"><img src="${esc(c.headerImage)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border-radius:16px 16px 0 0"></td></tr>` : ""}
<tr><td bgcolor="#ffffff" style="border-radius:${c.headerImage ? "0 0 16px 16px" : "16px"};padding:36px 32px 30px${c.color && !c.headerImage ? `;border-top:5px solid ${color}` : ""}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

<tr><td align="center" style="font-family:${FONT}">
<p style="margin:0;font-size:26px;font-weight:700;line-height:1.25;color:${INK};letter-spacing:-.02em">${esc(t.mailHeadline)}</p>
<p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:${MUTED}">${c.welcome ? para(c.welcome, first) : esc(t.mailThanks(first, shown))}</p>
</td></tr>

${hero ? `<tr><td align="center" style="padding:26px 0 6px">
<img src="${esc(hero)}" width="220" alt="${esc(a.main.short_name)}" style="display:block;width:220px;max-width:70%;height:auto;border-radius:8px;border:1px solid ${LINE}">
</td></tr>` : ""}

<tr><td align="center" style="padding:14px 0 22px;font-family:${FONT}">
<p style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:${INK}">${esc(a.main.name)}</p>
</td></tr>

${url ? `<tr><td align="center">${button(url, t.mailOpen(a.main.short_name), { big: true, color })}</td></tr>
${esDrive(url) ? `<tr><td align="center" style="padding:12px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED}">${esc(t.mailTip)}</td></tr>` : ""}` : ""}

<tr><td style="padding:30px 0 4px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${esc(t.mailYourOrder)}</td></tr>
${items.map((p) => itemRow(p, t, url || null, color, a.orderId)).join("")}

<tr><td style="padding:14px 0 0;border-top:1px solid ${LINE};font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-size:13px;color:${MUTED}">${esc(t.mailOrder)} ${esc(a.orderRef)}</td>
${a.total != null ? `<td align="right" style="font-size:13px;color:${MUTED}">${esc(t.mailPaid)} <strong style="font-size:16px;color:${INK}">${esc(money(a.total, a.currency, a.locale))}</strong></td>` : ""}
</tr></table>
</td></tr>

<tr><td style="padding:24px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f7ff" style="border-radius:12px">
<tr><td style="padding:16px 18px;font-family:${FONT}">
<p style="margin:0;font-size:14px;font-weight:700;color:#1e3a8a">&#128737; ${esc(t.mailGuaranteeTitle(a.store.guarantee_days))}</p>
<p style="margin:5px 0 0;font-size:13px;line-height:1.5;color:#334155">${esc(t.mailGuaranteeBody)}</p>
</td></tr></table>
</td></tr>
${c.closing ? `<tr><td style="padding:24px 0 0;font-family:${FONT};font-size:14.5px;line-height:1.6;color:${INK}">${para(c.closing, first)}
<p style="margin:12px 0 0;font-weight:700;color:${INK}">${esc(shown)}</p></td></tr>` : ""}

</table>
</td></tr>

<tr><td align="center" style="padding:20px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9ca3af">
${esc(t.mailSupport)}<br>${esc(legal)} · ${esc(a.store.support_email)}
</td></tr>
</table>

</td></tr></table>
</body></html>`;
}

export function renderDelivery(a: DeliveryArgs) {
  const subject = customOf(a.store).subject || T[a.locale].mailSubject(a.store.display_name || a.store.name);
  return { subject, html: deliveryHtml(a) };
}

// ---------------------------------------------------------------- envío

/** Qué proveedor manda los mails: Postmark si hay token, si no Brevo. */
export function mailProvider(): "postmark" | "brevo" | null {
  if (process.env.POSTMARK_TOKEN) return "postmark";
  if (process.env.BREVO_API_KEY) return "brevo";
  return null;
}

/** Remitente de la tienda: su dominio verificado, o el respaldo del entorno. */
export function senderOf(store: Store) {
  return {
    email: store.email_from || process.env.DELIVERY_FROM || store.support_email,
    name: store.display_name || store.name,
  };
}

type Mail = {
  store: Store;
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  tag: string;
  kind: "delivery" | "upsell" | "recovery" | "test" | "access";
  orderId?: string | null;
  /** Dominio público para el píxel y los links con seguimiento. Sin él se usa el del pedido o el de pago de la tienda. */
  trackBase?: string | null;
  /** Cabeceras extra (List-Unsubscribe de los mails comerciales). */
  headers?: Record<string, string>;
  /**
   * Control del HTML FINAL (ya con los links de seguimiento) antes de mandar:
   * devuelve el problema y el mail no sale (queda «failed» en email_log).
   */
  verifyFinal?: (html: string) => Promise<string | null>;
};

/** La casilla SMTP de la tienda, si tiene una cargada. Con los mismos datos se entra por IMAP. */
export type Smtp = { host: string; port: number; username: string; password: string };
const smtpCache = new Map<string, { at: number; smtp: Smtp | null }>();
export async function smtpFor(storeId: string): Promise<Smtp | null> {
  const hit = smtpCache.get(storeId);
  if (hit && Date.now() - hit.at < 60_000) return hit.smtp;
  const { data } = await db.from("store_mail").select("host,port,username,password_enc").eq("store_id", storeId).maybeSingle();
  const smtp = data ? { host: data.host, port: data.port, username: data.username, password: decrypt(data.password_enc) } : null;
  smtpCache.set(storeId, { at: Date.now(), smtp });
  return smtp;
}

/** Qué va a mandar los mails de esta tienda (para el panel y el diagnóstico). */
export async function mailProviderFor(storeId: string): Promise<{ primary: string | null; fallback: string | null; from: string | null }> {
  const smtp = await smtpFor(storeId);
  const api = mailProvider();
  return { primary: smtp ? "smtp" : api, fallback: smtp ? api : null, from: smtp?.username ?? null };
}

async function sendSmtp(smtp: Smtp, m: Mail): Promise<string> {
  const nodemailer = await import("nodemailer");
  const tx = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: { user: smtp.username, pass: smtp.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const name = (m.store.display_name || m.store.name).replace(/"/g, "");
  // El remitente es la casilla misma: El proveedor rechaza un From distinto de la cuenta.
  const info = await tx.sendMail({
    from: `"${name}" <${smtp.username}>`,
    to: m.toName ? `"${m.toName.replace(/"/g, "")}" <${m.to}>` : m.to,
    replyTo: m.store.support_email,
    subject: m.subject,
    html: m.html,
    headers: { "X-Entity-Ref-ID": m.orderId ?? `${m.kind}-${Date.now()}`, ...(m.headers ?? {}) },
  });
  return info.messageId ?? "sin-id";
}

async function sendApi(provider: "postmark" | "brevo", m: Mail): Promise<string> {
  const from = senderOf(m.store);
  if (provider === "postmark") {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": process.env.POSTMARK_TOKEN!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        From: `"${from.name.replace(/"/g, "")}" <${from.email}>`,
        To: m.toName ? `"${m.toName.replace(/"/g, "")}" <${m.to}>` : m.to,
        ReplyTo: m.store.support_email,
        Subject: m.subject,
        HtmlBody: m.html,
        Tag: m.tag,
        MessageStream: m.kind === "recovery" ? process.env.POSTMARK_BROADCAST_STREAM || "outbound" : "outbound",
        ...(m.headers ? { Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
        Metadata: { store: m.store.slug, ...(m.orderId ? { order: m.orderId } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`Postmark ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { MessageID?: string }).MessageID ?? "sin-id";
  }
  const res = await fetch(API, {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY!, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: from,
      replyTo: { email: m.store.support_email },
      to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }],
      subject: m.subject,
      htmlContent: m.html,
      tags: [m.tag, m.store.slug],
      ...(m.headers ? { headers: m.headers } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { messageId?: string }).messageId ?? "sin-id";
}

/**
 * Manda un mail y deja constancia en email_log, salga bien o mal.
 * Orden: la casilla SMTP de la tienda y, si falla o no hay,
 * el proveedor por API (Postmark o Brevo). Sin ninguno devuelve `skipped`:
 * quien llama decide si eso es un error (la entrega sí lo es).
 */
export async function sendMail(m: Mail): Promise<SendResult> {
  const smtp = await smtpFor(m.store.id).catch(() => null);
  const api = mailProvider();
  if (!smtp && !api) return { skipped: true };
  const tracked = TRACKED.has(m.kind);
  // Los links se revisan mientras sale el mail: si alguno no abre, el mail sale igual y queda el aviso.
  const linkCheck = tracked ? checkLinks(linksOf(m.html)).catch(() => [] as LinkCheck[]) : Promise.resolve([] as LinkCheck[]);
  // Píxel y links con seguimiento solo en un dominio propio donde /api/m ya responde; si no, sale sin seguimiento.
  const base = tracked ? await trackBase(m).then(liveTrackBase).catch(() => null) : null;
  const errors: string[] = [];
  const sent = { log: null as string | null };
  // Cada intento es una fila de email_log con su id: el píxel y los clics apuntan a esa fila.
  const attempt = async (provider: string, send: (mm: Mail) => Promise<string>) => {
    const logId = randomUUID();
    const html = base ? withTracking(m.html, base, logId) : m.html;
    const tracked = html !== m.html;
    try {
      // El link que va a tocar el comprador, tal cual sale (con el seguimiento puesto): si no abre, no se manda.
      const bad = m.verifyFinal ? await m.verifyFinal(html) : null;
      if (bad) throw new Error(`link: ${bad}`);
      const id = await send({ ...m, html });
      await logMail(m, logId, provider, "sent", id, undefined, tracked);
      sent.log = logId;
      return id;
    } catch (e) {
      errors.push(`${provider === "smtp" ? "SMTP" : provider}: ${(e as Error).message}`);
      await logMail(m, logId, provider, "failed", null, (e as Error).message, tracked);
      return null;
    }
  };
  const id = (smtp ? await attempt("smtp", (mm) => sendSmtp(smtp, mm)) : null)
    ?? (api ? await attempt(api, (mm) => sendApi(api, mm)) : null);

  const links = await linkCheck;
  if (links.length) {
    const broken = await reportLinks(links, {
      storeId: m.store.id, where: `mail ${KIND_ES[m.kind]} a ${m.to}`, link: m.orderId ? orderLink(m.orderId) : null,
    }).catch(() => [] as LinkCheck[]);
    if (broken.length && sent.log) {
      await db.from("email_log").update({ error: `link roto: ${broken.map((b) => `${b.url} (${b.reason})`).join("; ")}`.slice(0, 500) }).eq("id", sent.log);
    }
  }
  if (id) {
    await resolveAlerts("email_failed", [failRef(m)]).catch(() => {});
    return { messageId: id, ...(sent.log ? { logId: sent.log } : {}) };
  }
  const msg = errors.join(" | ").slice(0, 900);
  await raiseAlert({
    kind: "email_failed", severity: m.kind === "recovery" ? "warn" : "error", storeId: m.store.id, ref: failRef(m), reopen: true,
    link: m.orderId ? orderLink(m.orderId) : "/admin/avisos?tab=mails",
    title: `No salió el mail ${KIND_ES[m.kind]} a ${m.to}`, body: msg,
  }).catch(() => {});
  throw new Error(msg);
}

const TRACKED = new Set<Mail["kind"]>(["delivery", "upsell", "recovery"]);
const KIND_ES: Record<Mail["kind"], string> = { delivery: "de entrega", upsell: "del upsell", recovery: "de recuperación", test: "de prueba", access: "de acceso a la biblioteca" };
const failRef = (m: Mail) => `${m.kind}:${m.orderId ?? m.to.toLowerCase()}`;

async function trackBase(m: Mail): Promise<string | null> {
  if (m.trackBase !== undefined) return publicOrigin(m.trackBase);
  return (m.orderId ? await trackBaseForOrder(m.orderId) : null) ?? publicOrigin(m.store.domain);
}

async function logMail(m: Mail, logId: string, provider: string, status: "sent" | "failed", id: string | null, error?: string, tracked = false) {
  await db.from("email_log").insert({
    id: logId, store_id: m.store.id, order_id: m.orderId ?? null, kind: m.kind, to_email: m.to, subject: m.subject.slice(0, 300),
    provider, provider_id: id, status, error: error?.slice(0, 500) ?? null, tracked,
    // El cuerpo tal como se escribió (sin píxel ni links con seguimiento): «Enviados» del panel.
    body_html: m.html.slice(0, 200_000),
  }).then(({ error: e }) => e && console.error("[email_log]", e.message));
}

export async function sendDelivery(a: DeliveryArgs & { orderId?: string; kind?: "delivery" | "upsell" }): Promise<SendResult> {
  const { subject, html } = renderDelivery(a);
  return sendMail({
    store: a.store, to: a.to, toName: a.name, subject, html,
    tag: "entrega", kind: a.kind ?? "delivery", orderId: a.orderId,
  });
}

// ------------------------------------------------------------ recuperación

type RecoveryArgs = {
  to: string; name: string | null; store: Store; locale: Locale;
  product: Product; url: string; amount: number; currency: string;
};

export function renderRecovery(a: RecoveryArgs) {
  const t = T[a.locale];
  const img = cover(a.product);
  const first = a.name ? a.name.split(" ")[0] : null;
  const html = `<!doctype html>
<html lang="${a.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(t.recSubject(a.product.short_name))}</title></head>
<body style="margin:0;padding:0;background:#f0f0f0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(t.recPreheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f0f0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 16px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1e293b">${esc(a.store.name)}</td></tr>
<tr><td bgcolor="#ffffff" align="center" style="border-radius:16px;padding:36px 32px 32px;font-family:${FONT}">
<p style="margin:0;font-size:26px;font-weight:700;line-height:1.25;color:${INK}">${esc(t.recHeadline)}</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${MUTED}">${first ? esc(first) + ", " : ""}${esc(t.recBody(a.product.short_name))}</p>
${img ? `<img src="${esc(img)}" width="200" alt="${esc(a.product.short_name)}" style="display:block;width:200px;max-width:65%;height:auto;margin:24px auto 0;border-radius:8px;border:1px solid ${LINE}">` : ""}
<p style="margin:16px 0 22px;font-size:17px;font-weight:700;color:${INK}">${esc(a.product.name)}<br><span style="font-size:15px;font-weight:600;color:${PAY}">${esc(money(a.amount, a.currency, a.locale))}</span></p>
${button(a.url, t.recCta, { big: true })}
<p style="margin:22px 0 0;font-size:12.5px;line-height:1.55;color:${MUTED}">${esc(t.recFoot)}</p>
</td></tr>
<tr><td align="center" style="padding:18px 16px 0;font-family:${FONT};font-size:12px;color:#9ca3af">${esc(legalOf(a.store).name)} · ${esc(a.store.support_email)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: t.recSubject(a.product.short_name), html };
}

export async function sendRecovery(a: RecoveryArgs): Promise<SendResult> {
  const { subject, html } = renderRecovery(a);
  // El seguimiento va en el dominio del checkout al que vuelve el botón.
  return sendMail({ store: a.store, to: a.to, toName: a.name, subject, html, tag: "recuperacion", kind: "recovery", trackBase: a.url });
}
