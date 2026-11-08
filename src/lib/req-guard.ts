import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bareHost, hostOf, originAllowed } from "@/lib/req-guard-shared";

/**
 * Lo que comparten los endpoints públicos que reciben datos del navegador
 * (/api/ev, /api/rec): origen permitido, IP, robots y límite por IP en memoria.
 */

export { hostOf };

// ------------------------------------------------ landings de otro dominio

/**
 * Las landings que pueden mandar eventos son las declaradas en los checkouts
 * (funnels.landing_url), o sea las mismas que el panel muestra como landing de
 * la oferta: se dan de alta y de baja con el checkout, sin variable de entorno
 * que haya que acordarse de tocar al abrir una tienda. Se consulta sólo cuando
 * el origen no es propio, así el checkout (que es casi todo el tráfico) no paga
 * la consulta, y se recuerda 5 minutos.
 */
const TTL = 5 * 60_000;
let landings: { at: number; hosts: Set<string> } | null = null;
let loading: Promise<Set<string>> | null = null;

async function landingHosts(): Promise<Set<string>> {
  if (landings && Date.now() - landings.at < TTL) return landings.hosts;
  loading ??= (async () => {
    const { data } = await db.from("funnels").select("landing_url").not("landing_url", "is", null);
    const hosts = new Set((data ?? []).map((f) => bareHost(hostOf(f.landing_url as string | null))).filter(Boolean));
    // Si la base falla se sigue con la lista anterior (o vacía) y se reintenta en 30 s.
    landings = data ? { at: Date.now(), hosts } : { at: Date.now() - TTL + 30_000, hosts: landings?.hosts ?? hosts };
    return landings.hosts;
  })().finally(() => { loading = null; });
  return loading;
}

/** Mismo origen (landings y checkouts los sirve esta app), un host propio, o una landing declarada. */
export async function originOk(req: NextRequest): Promise<boolean> {
  const origin = req.headers.get("origin");
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host"), process.env.NEXT_PUBLIC_SITE_URL, process.env.PUBLIC_BASE_URL, process.env.PANEL_HOST]
    .map(hostOf).filter(Boolean);
  const ctx = { own, crossSite: req.headers.get("sec-fetch-site") === "cross-site", landings: new Set<string>() };
  if (originAllowed(origin, ctx)) return true;
  if (!origin) return false;
  return originAllowed(origin, { ...ctx, landings: await landingHosts() });
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
