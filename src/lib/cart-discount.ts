import { createHmac, timingSafeEqual } from "crypto";
import { db } from "./db";

/**
 * Descuentos firmados que llegan por mail (?r=…): el checkout los muestra y
 * /api/pi los vuelve a verificar y calcula el importe. Nada del precio sale
 * del navegador. Dos clases, mismo control (HMAC con SECRETS_KEY):
 *
 *  · Carrito abandonado: `{carrito}.{pct}.{vence}.{firma}`. Vale para lo que
 *    tenía en el carrito (principal + bumps tildados); un bump que agrega
 *    después va a precio normal. Un solo uso: cuando se compra con él, el
 *    carrito queda «recuperado» y el token ya no aplica.
 *  · Campaña de email marketing: `m.{campaña}.{pct}.{vence}.{firma}`. La firma
 *    incluye el checkout: vale SOLO en el checkout al que apunta el botón del
 *    mail, solo sobre el producto principal, hasta el vencimiento y mientras la
 *    campaña exista con ese % y no se haya cortado el descuento desde el panel.
 */

function key() {
  const k = process.env.SECRETS_KEY;
  if (!k) throw new Error("Falta SECRETS_KEY");
  return k;
}
const sig = (cart: string, pct: number, exp: number) =>
  createHmac("sha256", key()).update(`cart-discount\n${cart}\n${pct}\n${exp}`).digest("base64url").slice(0, 22);
const campaignSig = (campaign: string, funnelId: string, pct: number, exp: number) =>
  createHmac("sha256", key()).update(`campaign-discount\n${campaign}\n${funnelId}\n${pct}\n${exp}`).digest("base64url").slice(0, 22);

export function signCartDiscount(cartId: string, pct: number, expiresAt: Date) {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `${cartId}.${pct}.${exp}.${sig(cartId, pct, exp)}`;
}

/** Token del descuento de una campaña para UN checkout (el del botón del mail). */
export function signCampaignDiscount(campaignId: string, funnelId: string, pct: number, expiresAt: Date) {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `m.${campaignId}.${pct}.${exp}.${campaignSig(campaignId, funnelId, pct, exp)}`;
}

export type CartDiscount =
  | {
      ok: true;
      /** El carrito del mail de recuperación (null si el descuento es de una campaña). */
      cartId: string | null;
      /** La campaña de email marketing (null si es de un carrito). */
      campaignId: string | null;
      pct: number; expiresAt: string;
      /** Bumps con el mismo descuento (los del carrito; ninguno en una campaña). */
      bumps: string[];
    }
  | { ok: false; reason: "invalid" | "expired" | "used" | "other_checkout" };

const same = (x: string, y: string) => {
  const a = Buffer.from(x), b = Buffer.from(y);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** El token, verificado contra la base: es de este checkout, no venció y no se usó (carrito) o sigue vigente (campaña). */
export async function resolveCartDiscount(token: string | null | undefined, funnelId: string): Promise<CartDiscount | null> {
  if (!token) return null;
  const t = token.trim();
  if (t.startsWith("m.")) return resolveCampaignDiscount(t, funnelId);
  const m = /^([0-9a-f-]{36})\.(\d{1,2})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(t);
  if (!m) return { ok: false, reason: "invalid" };
  const [, cartId, p, e, s] = m;
  const pct = Number(p), exp = Number(e);
  if (!same(sig(cartId, pct, exp), s) || pct < 1 || pct > 90) return { ok: false, reason: "invalid" };
  if (exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  const { data: cart } = await db.from("checkouts").select("funnel_id,bumps,recovered_order_id").eq("id", cartId).maybeSingle();
  if (!cart) return { ok: false, reason: "invalid" };
  if (cart.funnel_id !== funnelId) return { ok: false, reason: "other_checkout" };
  if (cart.recovered_order_id) return { ok: false, reason: "used" };
  return { ok: true, cartId, campaignId: null, pct, expiresAt: new Date(exp * 1000).toISOString(), bumps: (cart.bumps ?? []) as string[] };
}

async function resolveCampaignDiscount(t: string, funnelId: string): Promise<CartDiscount> {
  const m = /^m\.([0-9a-f-]{36})\.(\d{1,2})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(t);
  if (!m) return { ok: false, reason: "invalid" };
  const [, campaignId, p, e, s] = m;
  const pct = Number(p), exp = Number(e);
  // La firma lleva el checkout: en otro checkout no coincide.
  if (!same(campaignSig(campaignId, funnelId, pct, exp), s) || pct < 1 || pct > 90) return { ok: false, reason: "invalid" };
  if (exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  const { data: c } = await db.from("mkt_campaigns").select("discount_pct,discount_revoked_at").eq("id", campaignId).maybeSingle();
  if (!c || c.discount_pct !== pct) return { ok: false, reason: "invalid" };
  if (c.discount_revoked_at) return { ok: false, reason: "expired" };
  return { ok: true, cartId: null, campaignId, pct, expiresAt: new Date(exp * 1000).toISOString(), bumps: [] };
}
