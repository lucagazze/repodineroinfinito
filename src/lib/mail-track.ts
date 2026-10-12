import { createHmac, timingSafeEqual } from "crypto";
import { db } from "./db";
import { publicOrigin } from "./public-url";

/**
 * Seguimiento de los mails que salen (entrega, upsell, recuperación): un
 * píxel de 1×1 al final y cada link pasado por /api/m/c/{mail}, que anota el
 * clic y redirige. Va en el dominio público de la oferta (pay.*, nails.*),
 * nunca en el de vercel.app: un link a otro dominio en un mail de entrega
 * parece phishing y lo castigan los filtros.
 */

/** Origen público https para el seguimiento, o null (localhost, IP, red privada, vercel.app o inválido). */
export { publicOrigin };

/** Dónde vive el checkout del pedido (funnels.checkout_host) o, si no, el dominio de pago de la tienda. */
export async function trackBaseForOrder(orderId: string): Promise<string | null> {
  const { data } = await db.from("orders").select("funnels(checkout_host),stores(domain)").eq("id", orderId).maybeSingle();
  const f = data?.funnels as unknown as { checkout_host: string | null } | null;
  const s = data?.stores as unknown as { domain: string | null } | null;
  return publicOrigin(f?.checkout_host) ?? publicOrigin(s?.domain);
}

/**
 * El dominio para el seguimiento, solo si /api/m ya responde ahí. Un mail con
 * links a una ruta que todavía no está publicada en ese dominio (build local,
 * deploy viejo) le daría un 404 al comprador: en ese caso sale sin
 * seguimiento. MAIL_TRACK_BASE fuerza otro dominio, solo si es público (nunca localhost).
 */
const live = new Map<string, { at: number; ok: boolean }>();
export async function liveTrackBase(candidate: string | null): Promise<string | null> {
  // MAIL_TRACK_BASE solo puede elegir otro dominio PÚBLICO: nunca localhost (los links de un mail real quedarían muertos).
  const base = publicOrigin(process.env.MAIL_TRACK_BASE) ?? publicOrigin(candidate);
  if (!base) return null;
  const hit = live.get(base);
  if (hit && Date.now() - hit.at < (hit.ok ? 10 * 60_000 : 60_000)) return hit.ok ? base : null;
  const ok = await fetch(`${base}/api/m/ping`, { cache: "no-store", signal: AbortSignal.timeout(3000) })
    .then(async (r) => r.ok && ((await r.json().catch(() => null)) as { ok?: string } | null)?.ok === "mail-track")
    .catch(() => false);
  live.set(base, { at: Date.now(), ok });
  return ok ? base : null;
}

function key() {
  const k = process.env.SECRETS_KEY;
  if (!k) throw new Error("Falta SECRETS_KEY");
  return k;
}

/** Firma del link: sin ella /api/m/c sería un redirector abierto. */
export function clickSig(logId: string, url: string) {
  return createHmac("sha256", key()).update(`mail-click\n${logId}\n${url}`).digest("base64url").slice(0, 22);
}

export function validClickSig(logId: string, url: string, sig: string) {
  const a = Buffer.from(clickSig(logId, url));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const clickUrl = (base: string, logId: string, url: string) =>
  `${base}/api/m/c/${logId}?u=${encodeURIComponent(url)}&s=${clickSig(logId, url)}`;

export const pixelUrl = (base: string, logId: string) => `${base}/api/m/o/${logId}.gif`;

/** ¿Es un link de descarga? Drive, Dropbox, /d/{pedido}/{producto}, Storage o un PDF. */
export const isDownloadUrl = (u: string) =>
  /(drive|docs)\.google\.com|dropbox\.com|\/d\/[0-9a-f-]{36}\/|\/storage\/v1\/object\/|\.pdf(\?|#|$)/i.test(u);

/**
 * Escáneres y vistas previas que piden el píxel sin que nadie haya abierto
 * el mail. Ojo: GoogleImageProxy y YahooMailProxy SÍ son aperturas reales.
 */
export const PREFETCH_UA =
  /(bot\b|bot\/|crawler|spider|preview|scanner|headless|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|barracuda|mimecast|proofpoint|safelinks|symantec|forcepoint|trendmicro|sophos|fortinet|zscaler)/i;

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * El mismo HTML con los links envueltos y el píxel antes de </body>. Solo se
 * tocan los href http(s) de los <a>: el mail se ve idéntico.
 */
export function withTracking(html: string, rawBase: string, logId: string) {
  // Segunda barrera: con un dominio que no es público, el mail sale tal cual (sin seguimiento), nunca con links muertos.
  const base = publicOrigin(rawBase);
  if (!base) return html;
  const out = html.replace(/(<a\b[^>]*?\bhref=")([^"]+)(")/gi, (all, pre: string, href: string, post: string) => {
    const url = unesc(href).trim();
    if (!/^https?:\/\//i.test(url) || url.startsWith(`${base}/api/m/`)) return all;
    return pre + esc(clickUrl(base, logId, url)) + post;
  });
  const pixel = `<img src="${esc(pixelUrl(base, logId))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0;overflow:hidden">`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
}

/** IP del que pidió (primera de x-forwarded-for). */
export const reqIp = (h: Headers) => (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
