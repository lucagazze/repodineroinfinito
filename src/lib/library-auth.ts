import { createHmac, timingSafeEqual } from "crypto";

/**
 * Acceso a «Mi biblioteca» sin contraseña: el comprador pone su mail y recibe un link firmado (HMAC con
 * SECRETS_KEY). El link vale 2 días y deja una cookie de 90 días en el dominio de la tienda.
 * `admin` = lo abrió el dueño desde el panel: ve exactamente lo mismo, pero sin poder comprar.
 *
 * Token: `{tienda}.{email en base64url}.{vence}.{a|c|q}.{firma}`. q = entró escribiendo su mail, sin verificarlo: ve y baja lo suyo, pero nunca se le cobra con la tarjeta guardada.
 */
export const LIB_COOKIE = "bib";
export const LINK_TTL_S = 2 * 24 * 3600;
export const COOKIE_TTL_S = 90 * 24 * 3600;

export type LibAuth = { storeId: string; email: string; admin: boolean; exp: number; /** Entró por el link del mail (o es el administrador). */ verified: boolean };

function key() {
  const k = process.env.SECRETS_KEY;
  if (!k) throw new Error("Falta SECRETS_KEY");
  return k;
}
const sig = (store: string, email: string, exp: number, who: string) =>
  createHmac("sha256", key()).update(`biblioteca\n${store}\n${email}\n${exp}\n${who}`).digest("base64url").slice(0, 27);

export function signLibrary(storeId: string, email: string, ttlSeconds: number, admin = false, quick = false) {
  const e = email.trim().toLowerCase();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const who = admin ? "a" : quick ? "q" : "c";
  return `${storeId}.${Buffer.from(e).toString("base64url")}.${exp}.${who}.${sig(storeId, e, exp, who)}`;
}

export function readLibrary(token: string | null | undefined, storeId?: string): LibAuth | null {
  if (!token) return null;
  const [store, em, expS, who, s] = token.split(".");
  if (!store || !em || !expS || !who || !s) return null;
  if (storeId && store !== storeId) return null;
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  let email: string;
  try { email = Buffer.from(em, "base64url").toString("utf8"); } catch { return null; }
  const want = Buffer.from(sig(store, email, exp, who)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { storeId: store, email, admin: who === "a", exp, verified: who !== "q" };
}
