import { cookies, headers } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "./db";
import { getRates } from "./fx";
import { offerList, scopeFor, type OfferItem } from "./admin/offers";
import { autoCampaigns } from "./admin/meta-links";
import { campaignIdsOf } from "@/components/admin/AdsBlock";
import { campaignInsights, spendByDay } from "./admin/ads";
import { PANEL_TZ } from "./admin/range";
import { addDays, dayOf, startOfDay } from "./admin/tz";

/**
 * Socios (migración 066): personas que ven SOLO los números de sus ofertas — lo cobrado en Stripe y el gasto
 * en Meta — en /socio. No es una sesión del panel: cookie aparte (cp_socio), firmada con HMAC e incluyendo el
 * email; cada página vuelve a leer al socio de la base, así apagarlo o cambiarle las ofertas rige al instante.
 */
const COOKIE = "cp_socio";
const TTL = 30 * 24 * 60 * 60 * 1000;
const secret = () => { const s = process.env.ADMIN_SECRET; if (!s) throw new Error("Falta ADMIN_SECRET"); return s; };
const mac = (v: string) => createHmac("sha256", secret()).update(`socio|${v}`).digest("hex");
const b64 = (s: string) => Buffer.from(s).toString("base64url");

export type Partner = { email: string; name: string; offer_ids: string[]; active: boolean; last_login_at: string | null; created_at: string };

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
function passwordOk(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = scryptSync(pw, salt, 64), b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isPartnerEmail(email: string) {
  const { data } = await db.from("partners").select("email").eq("email", email.trim().toLowerCase()).maybeSingle();
  return !!data;
}

/** El socio de esta sesión (activo), o null. */
export async function currentPartner(): Promise<Partner | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [e, issued, sig] = raw.split(".");
  if (!e || !issued || !sig) return null;
  const email = Buffer.from(e, "base64url").toString();
  const want = Buffer.from(mac(`${email}|${issued}`), "hex"), got = Buffer.from(sig, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const age = Date.now() - Number(issued);
  if (!(age >= 0 && age < TTL)) return null;
  const { data } = await db.from("partners").select("email,name,offer_ids,active,last_login_at,created_at").eq("email", email).maybeSingle();
  return data && data.active ? (data as Partner) : null;
}

/** Email y contraseña de socio, con el mismo límite de intentos por IP que el panel. */
export async function partnerLogin(emailRaw: string, pw: string): Promise<"ok" | "wrong" | "locked"> {
  const email = emailRaw.trim().toLowerCase();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "?";
  const { count } = await db.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("ok", false).gte("at", new Date(Date.now() - 15 * 60_000).toISOString());
  if ((count ?? 0) >= 8) return "locked";
  const { data } = await db.from("partners").select("password_hash,active").eq("email", email).maybeSingle();
  const ok = !!data?.active && passwordOk(pw, data.password_hash as string);
  await db.from("login_attempts").insert({ ip, ok });
  if (!ok) return "wrong";
  const issued = Date.now().toString();
  (await cookies()).set(COOKIE, `${b64(email)}.${issued}.${mac(`${email}|${issued}`)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL / 1000,
  });
  await db.from("partners").update({ last_login_at: new Date().toISOString() }).eq("email", email);
  return "ok";
}

export async function partnerLogout() {
  (await cookies()).delete(COOKIE);
}

/** Las ofertas de un socio (en el orden del panel). */
export async function partnerOffers(p: Pick<Partner, "offer_ids">): Promise<OfferItem[]> {
  const ids = new Set(p.offer_ids);
  return (await offerList()).filter((o) => ids.has(o.id));
}

export type PartnerDay = { date: string; gross: number; refunded: number; fees: number; net: number; spend: number; result: number; sales: number };
export type PartnerNums = {
  gross: number; refunded: number; fees: number; net: number; spend: number; result: number; sales: number; refunds: number;
  days: PartnerDay[];
  campaigns: { id: string; name: string; status: string; spend: number; purchases: number; value: number }[];
  metaAt: number | null;
};

/**
 * Los números de una oferta en el período (días de Argentina), en USD:
 *  - Cobrado / comisiones / reembolsos: los movimientos REALES de Stripe (stripe_balance_txns) de los pagos de sus
 *    pedidos — el pago del checkout y cada OTO — y sus devoluciones.
 *  - Gasto en anuncios: lo que gastaron en Meta las campañas vinculadas a sus checkouts (meta_insights_daily).
 */
export async function partnerNumbers(offer: OfferItem, since: string, until: string): Promise<PartnerNums> {
  const sc = await scopeFor(offer.key);
  const from = startOfDay(since, PANEL_TZ).toISOString();
  const to = startOfDay(addDays(until, 1), PANEL_TZ).toISOString();
  const [rates, auto] = await Promise.all([getRates(), autoCampaigns().catch(() => ({} as Record<string, string[]>))]);
  const usd = (n: unknown, cur: unknown) => (Number(n) || 0) / (rates[String(cur ?? "USD").toUpperCase()] ?? 1);

  // Los pagos de la oferta (todos sus pedidos: un reembolso de hoy puede ser de una compra vieja) y las ventas del período.
  const pis = new Set<string>();
  const salesDay: Record<string, number> = {};
  let sales = 0;
  for (let i = 0; sc.funnelIds.length; i += 1000) {
    const { data, error } = await db.from("orders").select("created_at,status,is_test,stripe_payment_intent,order_items(stripe_payment_intent)")
      .in("funnel_id", sc.funnelIds).in("status", ["paid", "refunded"]).order("created_at").range(i, i + 999);
    if (error) throw new Error(`orders: ${error.message}`);
    for (const o of data ?? []) {
      if (o.is_test) continue;
      if (o.stripe_payment_intent) pis.add(o.stripe_payment_intent as string);
      for (const it of (o.order_items ?? []) as { stripe_payment_intent: string | null }[]) if (it.stripe_payment_intent) pis.add(it.stripe_payment_intent);
      if ((o.created_at as string) >= from && (o.created_at as string) < to) {
        sales++;
        const d = dayOf(new Date(o.created_at as string), PANEL_TZ);
        salesDay[d] = (salesDay[d] ?? 0) + 1;
      }
    }
    if (!data || data.length < 1000) break;
  }

  type D = { gross: number; refunded: number; fees: number };
  const byDay: Record<string, D> = {};
  let gross = 0, refunded = 0, fees = 0, refunds = 0;
  for (let i = 0; pis.size; i += 1000) {
    const { data, error } = await db.from("stripe_balance_txns").select("reporting_category,type,amount,fee,currency,created_at,payment_intent")
      .eq("store_id", offer.store.id).gte("created_at", from).lt("created_at", to).order("created_at").range(i, i + 999);
    if (error) throw new Error(`stripe_balance_txns: ${error.message}`);
    for (const t of data ?? []) {
      if (!t.payment_intent || !pis.has(t.payment_intent as string)) continue;
      const cat = String(t.reporting_category ?? t.type);
      const d = (byDay[dayOf(new Date(t.created_at as string), PANEL_TZ)] ??= { gross: 0, refunded: 0, fees: 0 });
      if (cat === "charge") {
        const a = usd(t.amount, t.currency), f = usd(t.fee, t.currency);
        gross += a; fees += f; d.gross += a; d.fees += f;
      } else if (cat === "refund") {
        const a = -usd(t.amount, t.currency), f = usd(t.fee, t.currency);
        refunded += a; fees += f; refunds++; d.refunded += a; d.fees += f;
      }
    }
    if (!data || data.length < 1000) break;
  }

  const ads = await campaignInsights(campaignIdsOf(sc, auto), since, until);
  const spendDay = spendByDay(ads.campaigns);
  const spend = ads.campaigns.reduce((a, c) => a + c.spend, 0);
  const net = gross - fees - refunded;
  const days: PartnerDay[] = [];
  for (let d = since; d <= until && days.length < 400; d = addDays(d, 1)) {
    const b = byDay[d] ?? { gross: 0, refunded: 0, fees: 0 };
    const n = b.gross - b.fees - b.refunded, sp = spendDay.get(d) ?? 0;
    days.push({ date: d, gross: b.gross, refunded: b.refunded, fees: b.fees, net: n, spend: sp, result: n - sp, sales: salesDay[d] ?? 0 });
  }
  return {
    gross, refunded, fees, net, spend, result: net - spend, sales, refunds, days,
    campaigns: ads.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, purchases: c.purchases, value: c.value })).sort((a, b) => b.spend - a.spend),
    metaAt: ads.fetchedAt ?? null,
  };
}
