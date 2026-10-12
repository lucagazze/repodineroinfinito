import { createHmac, timingSafeEqual } from "crypto";
import { publicOrigin } from "../public-url";

/**
 * Seguimiento de los mails de campaña: píxel /api/m/v/{envío}.gif y cada
 * link por /api/m/k/{envío} (firmado: sin firma no es un redirector abierto).
 * Mismo esquema que mail-track.ts, sobre mkt_sends. La baja (/api/m/n/…) no
 * se envuelve.
 */

function key() {
  const k = process.env.SECRETS_KEY;
  if (!k) throw new Error("Falta SECRETS_KEY");
  return k;
}
export const mktClickSig = (sendId: string, url: string) =>
  createHmac("sha256", key()).update(`mkt-click\n${sendId}\n${url}`).digest("base64url").slice(0, 22);
export function validMktClickSig(sendId: string, url: string, sig: string) {
  const a = Buffer.from(mktClickSig(sendId, url)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function withMktTracking(html: string, rawBase: string, sendId: string) {
  const base = publicOrigin(rawBase);
  if (!base) return html;
  const out = html.replace(/(<a\b[^>]*?\bhref=")([^"]+)(")/gi, (all, pre: string, href: string, post: string) => {
    const url = unesc(href).trim();
    if (!/^https?:\/\//i.test(url) || url.startsWith(`${base}/api/m/`)) return all;
    return pre + esc(`${base}/api/m/k/${sendId}?u=${encodeURIComponent(url)}&s=${mktClickSig(sendId, url)}`) + post;
  });
  const pixel = `<img src="${esc(`${base}/api/m/v/${sendId}.gif`)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0;overflow:hidden">`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
}

/**
 * El dominio público de la tienda donde ya están publicadas las rutas de
 * campaña (/api/m/n/ping responde «mkt»). Sin eso, un mail real no sale: la
 * baja tiene que andar sí o sí.
 */
const live = new Map<string, { at: number; ok: boolean }>();
export async function liveMktBase(candidates: (string | null | undefined)[]): Promise<string | null> {
  for (const c of candidates) {
    const base = publicOrigin(c);
    if (!base) continue;
    const hit = live.get(base);
    if (hit && Date.now() - hit.at < (hit.ok ? 10 * 60_000 : 60_000)) { if (hit.ok) return base; continue; }
    const ok = await fetch(`${base}/api/m/n/ping`, { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then(async (r) => r.ok && ((await r.json().catch(() => null)) as { ok?: string } | null)?.ok === "mkt")
      .catch(() => false);
    live.set(base, { at: Date.now(), ok });
    if (ok) return base;
  }
  return null;
}
