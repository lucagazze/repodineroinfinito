import { createHmac } from "crypto";

/**
 * Brevo para el email marketing. Va aparte de los mails de la tienda: nunca
 * por la casilla SMTP del proveedor ni por sendMail (entregas): remitente de un
 * subdominio propio autenticado en Brevo (news.tumarca.com), tag
 * «mkt» y el id del envío en X-Mailin-custom (vuelve en los webhooks).
 */

const API = "https://api.brevo.com/v3";
const key = () => {
  const k = process.env.BREVO_API_KEY?.trim();
  if (!k) throw new Error("Falta BREVO_API_KEY");
  return k;
};
const headers = () => ({ "api-key": key(), accept: "application/json", "content-type": "application/json" });

export const brevoConfigured = () => !!process.env.BREVO_API_KEY?.trim();

export type BrevoAccount = { plan: string; credits: number | null; creditsType: string | null; email: string | null; error?: string };
export async function brevoAccount(): Promise<BrevoAccount> {
  try {
    const r = await fetch(`${API}/account`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { plan: "?", credits: null, creditsType: null, email: null, error: `Brevo ${r.status}` };
    const j = (await r.json()) as { email?: string; plan?: { type?: string; credits?: number; creditsType?: string }[] };
    const p = j.plan?.[0];
    return { plan: p?.type ?? "?", credits: p?.credits ?? null, creditsType: p?.creditsType ?? null, email: j.email ?? null };
  } catch (e) {
    return { plan: "?", credits: null, creditsType: null, email: null, error: (e as Error).message };
  }
}

/**
 * ¿Brevo va a mandar de verdad? Sin créditos la API igual responde 201 con un
 * messageId y el mail no sale (lo anota una vez por día como «insufficient
 * credits»): por eso se mira la cuenta antes de mandar. Si Brevo no responde,
 * no se frena (null).
 */
let credCache: { at: number; why: string | null } | null = null;
export async function noCreditsReason(): Promise<string | null> {
  if (credCache && Date.now() - credCache.at < 60_000) return credCache.why;
  const a = await brevoAccount();
  const why = a.error ? null : a.credits === 0 ? `Brevo no tiene créditos (plan ${a.plan}): la API acepta el mail pero no lo manda` : null;
  credCache = { at: Date.now(), why };
  return why;
}

export type BrevoDomain = { name: string; authenticated: boolean; verified: boolean };
let domCache: { at: number; list: BrevoDomain[] } | null = null;
export async function brevoDomains(fresh = false): Promise<BrevoDomain[]> {
  if (!fresh && domCache && Date.now() - domCache.at < 5 * 60_000) return domCache.list;
  const r = await fetch(`${API}/senders/domains`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Brevo ${r.status} al leer los dominios`);
  const j = (await r.json()) as { domains?: { domain_name: string; authenticated: boolean; verified: boolean }[] };
  const list = (j.domains ?? []).map((d) => ({ name: d.domain_name.toLowerCase(), authenticated: !!d.authenticated, verified: !!d.verified }));
  domCache = { at: Date.now(), list };
  return list;
}

/** Pide a Brevo que verifique el DNS del dominio (después de cargar los registros). */
export async function brevoAuthenticate(domain: string) {
  const r = await fetch(`${API}/senders/domains/${encodeURIComponent(domain)}/authenticate`, { method: "PUT", headers: headers(), signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { message?: string };
  domCache = null;
  return { ok: r.ok, message: j.message ?? (r.ok ? "ok" : `Brevo ${r.status}`) };
}

/** ¿El remitente es de un dominio (o subdominio exacto) autenticado en Brevo? */
export async function senderReady(from: string): Promise<string | null> {
  const dom = from.split("@")[1]?.toLowerCase();
  if (!dom) return "el remitente no es un email";
  const list = await brevoDomains().catch(() => null);
  if (!list) return "no pude leer los dominios de Brevo";
  const d = list.find((x) => x.name === dom);
  if (!d) return `${dom} no está cargado en Brevo`;
  if (!d.authenticated) return `${dom} todavía no está autenticado en Brevo (DNS)`;
  return null;
}

export class BrevoError extends Error {
  constructor(message: string, readonly status: number, readonly noCredits: boolean) { super(message); }
}

export async function brevoSend(m: {
  from: { email: string; name: string }; replyTo: string; to: string; toName?: string | null;
  subject: string; html: string; headers: Record<string, string>; tags: string[];
}): Promise<string> {
  const r = await fetch(`${API}/smtp/email`, {
    method: "POST", headers: headers(), signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      sender: m.from, replyTo: { email: m.replyTo },
      to: [{ email: m.to, ...(m.toName ? { name: m.toName.slice(0, 70) } : {}) }],
      subject: m.subject, htmlContent: m.html, headers: m.headers, tags: m.tags,
    }),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 300);
    throw new BrevoError(`Brevo ${r.status}: ${text}`, r.status, r.status === 402 || /credit/i.test(text));
  }
  return ((await r.json()) as { messageId?: string }).messageId ?? "sin-id";
}

// ------------------------------------------------------------------ webhooks

/** Secreto de los webhooks (derivado de SECRETS_KEY: no hace falta otra variable). */
export const webhookSecret = () =>
  createHmac("sha256", process.env.SECRETS_KEY ?? "").update("brevo-mkt-webhook").digest("base64url").slice(0, 32);

const EVENTS = ["delivered", "hardBounce", "softBounce", "blocked", "spam", "invalid", "unsubscribed"];

/** Crea (o deja como está) el webhook transaccional de Brevo hacia /api/mkt/brevo. */
export async function ensureWebhook(baseUrl: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/mkt/brevo?k=${webhookSecret()}`;
  const list = await fetch(`${API}/webhooks?type=transactional`, { headers: headers(), cache: "no-store" });
  const j = (await list.json().catch(() => ({}))) as { webhooks?: { id: number; url: string }[] };
  const mine = (j.webhooks ?? []).find((w) => w.url.split("?")[0] === url.split("?")[0]);
  if (mine) {
    const r = await fetch(`${API}/webhooks/${mine.id}`, { method: "PUT", headers: headers(), body: JSON.stringify({ url, events: EVENTS }) });
    return { ok: r.ok, id: mine.id, created: false, message: r.ok ? "actualizado" : `Brevo ${r.status}` };
  }
  const r = await fetch(`${API}/webhooks`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ url, description: "Panel · email marketing (rebotes, quejas, bajas)", events: EVENTS, type: "transactional" }),
  });
  const out = (await r.json().catch(() => ({}))) as { id?: number; message?: string };
  return { ok: r.ok, id: out.id ?? null, created: r.ok, message: r.ok ? "creado" : out.message ?? `Brevo ${r.status}` };
}

export async function webhookStatus(baseUrl: string) {
  const r = await fetch(`${API}/webhooks?type=transactional`, { headers: headers(), cache: "no-store" }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { webhooks?: { id: number; url: string }[] };
  return (j.webhooks ?? []).some((w) => w.url.startsWith(`${baseUrl.replace(/\/$/, "")}/api/mkt/brevo`));
}
