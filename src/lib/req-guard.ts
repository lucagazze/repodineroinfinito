import type { NextRequest } from "next/server";

/**
 * Lo que comparten los endpoints públicos que reciben datos del navegador
 * (/api/rec): origen permitido, IP, robots y límite por IP en memoria.
 */

const hostOf = (u: string | null | undefined) => {
  if (!u) return "";
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).host.toLowerCase(); } catch { return ""; }
};

/** Mismo origen (landings y checkouts los sirve esta app, o un sitio que la tiene detrás) o un host propio. */
export function originOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const o = hostOf(origin);
  if (!o) return false;
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host"), process.env.NEXT_PUBLIC_SITE_URL, process.env.PUBLIC_BASE_URL, process.env.PANEL_HOST]
    .map(hostOf).filter(Boolean);
  if (own.includes(o)) return true;
  const bare = o.replace(/:\d+$/, "");
  return bare === "localhost" || bare === "127.0.0.1" || bare.endsWith(".vercel.app");
}

export const clientIp = (req: NextRequest) =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "?";

/** Robots, navegadores sin pantalla y herramientas: no se graban. */
export const BOT_UA = /bot\b|bot\/|crawler|spider|HeadlessChrome|headless|Lighthouse|Playwright|Puppeteer|PhantomJS|facebookexternalhit|python|curl|wget|okhttp|axios|node-fetch|Go-http/i;
export const isBot = (req: NextRequest) => {
  const ua = req.headers.get("user-agent") ?? "";
  return !ua || BOT_UA.test(ua);
};

/** Balde de fichas por clave: `cap` de golpe y una ficha cada `refillMs`. */
export function bucket(cap: number, refillMs: number) {
  const m = new Map<string, { t: number; at: number }>();
  return (key: string) => {
    const now = Date.now();
    const b = m.get(key) ?? { t: cap, at: now };
    b.t = Math.min(cap, b.t + (now - b.at) / refillMs);
    b.at = now;
    if (b.t < 1) return false;
    b.t -= 1;
    m.set(key, b);
    if (m.size > 20_000) for (const [k, v] of m) if (now - v.at > 120_000) m.delete(k);
    return true;
  };
}
