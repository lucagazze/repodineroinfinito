/**
 * Quién no es una persona: robots y herramientas por su user-agent, la
 * revisión de anuncios de Meta (por user-agent y por las IP de Meta), los
 * monitores de disponibilidad, las pruebas automáticas (Playwright, el smoke
 * con x-smoke) y los navegadores manejados por software (navigator.webdriver).
 * Lo usan /api/ev (site_events.is_bot) y el panel. Las mismas listas que
 * src/lib/cart-recovery.ts, más completas.
 */

/** Robots, navegadores sin pantalla, herramientas y la revisión de anuncios de Meta. */
export const BOT_UA =
  /bot\b|bot\/|crawler|spider|slurp|HeadlessChrome|headless|Lighthouse|Playwright|Puppeteer|PhantomJS|Selenium|facebookexternalhit|meta-externalagent|meta-externalfetcher|facebookcatalog|Facebot|python|curl|wget|okhttp|axios|node-fetch|undici|Go-http|Java\/|libwww|HttpClient/i;

/** Monitores de disponibilidad (el nuestro y los conocidos) y los robots de Vercel. */
export const UPTIME_UA = /CheckoutUptime|UptimeRobot|Pingdom|StatusCake|Better ?Uptime|Uptime-Kuma|Checkly|Site24x7|vercel-(screenshot|favicon|healthcheck)/i;

/** Rangos de Meta (AS32934): la revisión de anuncios entra desde acá aunque mande un user-agent de navegador. */
export const META_IP = /^(::ffff:)?(31\.13\.|66\.220\.|69\.63\.|69\.171\.|74\.119\.|102\.132\.|129\.134\.|157\.240\.|173\.252\.|179\.60\.|185\.60\.|204\.15\.)|^2a03:2880:/i;

export type BotReason = "ua" | "uptime" | "meta" | "smoke" | "webdriver";

/** El motivo por el que no es una persona, o null si lo es. */
export function botReason(i: { ua?: string | null; ip?: string | null; smoke?: boolean; webdriver?: boolean }): BotReason | null {
  const ua = i.ua ?? "";
  if (i.smoke) return "smoke";
  if (!ua.trim()) return "ua";
  if (UPTIME_UA.test(ua)) return "uptime";
  if (/facebookexternalhit|meta-external|facebookcatalog|Facebot/i.test(ua)) return "meta";
  if (BOT_UA.test(ua)) return "ua";
  if (i.ip && META_IP.test(i.ip)) return "meta";
  if (i.webdriver) return "webdriver";
  return null;
}

/** En el panel: el motivo en castellano. */
export const BOT_LABEL: Record<BotReason | "idle", string> = {
  ua: "robot",
  uptime: "monitor",
  meta: "revisión de Meta",
  smoke: "prueba automática",
  webdriver: "navegador automático",
  idle: "posible robot (sin actividad)",
};
