import { db, currencyForCountry, type Product } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates, priceFor } from "@/lib/fx";
import { networkOf } from "@/lib/network";
import { checkoutUrl } from "@/lib/checkout-url";
import { resolveSettings } from "@/lib/checkout-settings";
import { simulate } from "@/lib/postpurchase";
import { testStoreIds } from "@/lib/test-store";
import { offerList, type OfferFunnel, type OfferItem } from "@/lib/admin/offers";
import { glance, type LevelRate } from "@/lib/admin/glance";
import { auditOffers, postPurchaseOf } from "@/lib/admin/offer-audit";
import type { OfferAuditRow } from "@/lib/admin/offer-audit-types";
import { previousOf, shift, todayIn, PANEL_TZ } from "@/lib/admin/range";
import { startOfDay } from "@/lib/admin/tz";
import { landingBehaviour, type LandingBehaviour } from "./landing-rec";
import { ADS_MIN, BENCH, CPA_TARGET, regionOf, regionOfFlags, type Bench } from "./benchmarks";
import type { Area, Finding, RunFacts, Severity } from "./types";

/**
 * «Mejoras», capa 1 (sin IA): calcula, por oferta y mercado, el embudo de la
 * ventana elegida (7 días por defecto, contra los 7 anteriores) y sus puntos
 * flojos, con números reales y su muestra. Todo de lectura: pedidos, eventos
 * de las páginas (sin robots ni tiendas de prueba), grabaciones, Meta, mails.
 *
 * Cada hallazgo dice contra qué referencia se compara (benchmarks.ts) y, si la
 * muestra no alcanza, sale como «pocos datos»: la IA no recomienda con eso.
 */

// ------------------------------------------------------------------ tipos

export type Window = {
  since: string; until: string; prevSince: string; prevUntil: string; days: number;
  from: Date; to: Date; pfrom: Date; pto: Date;
  /** Días que realmente pasaron en la ventana (hoy cuenta solo lo que va). */
  effDays: number;
};

type Split = { visitors: number; checkout: number; orders: number };
export type Steps = {
  landingVisits: number; landingVisitors: number; touched: number;
  timeSamples: number; medianSec: number | null; under10s: number;
  ctaVisits: number; ctaByIndex: Record<string, number>;
  checkoutVisitors: number; reachFromLanding: number; leads: number;
  /** payErrors = el pago falló (Stripe lo rechazó o el servidor no pudo crearlo) · formErrors = tocó pagar con la tarjeta incompleta. */
  payAttempts: number; payErrors: number; intentErrors: number; formErrors: number; errorCodes: Record<string, number>;
  orders: number; grossUsd: number; netUsd: number; mainUsd: number; bumpUsd: number; upsellUsd: number;
  bumpOrders: number; refunds: number; refundedUsd: number;
  bumpTaken: Record<string, number>;
  byDevice: Record<"mobile" | "desktop", Split>;
  byNetwork: Record<string, Split>;
  byCountry: Record<string, Split>;
};

export type AdNums = { spend: number; impressions: number; linkClicks: number; purchases: number; value: number; lpv: number; ic: number };

export type ProductRef = { id: string; slug: string; name: string; price: number | null; priceUsd: number | null };
export type ChainStep = ProductRef & { level: number; kind: "oto" | "downsell"; active: boolean };

export type MarketFacts = {
  offerKey: string; offerName: string; offerAlias: string; storeSlug: string; storeId: string;
  funnelId: string; slug: string; market: string; flags: string[]; currency: string; locale: string;
  landingUrl: string | null; checkoutUrl: string;
  main: ProductRef | null; bumps: ProductRef[];
  chain: { name: string | null; levels: number; otos: number; otosWithDs: number; steps: ChainStep[] } | null;
  cur: Steps; prev: Steps;
  levels: { cur: LevelRate[]; prev: LevelRate[] };
  landing: LandingBehaviour | null;
  ads: { campaignIds: string[]; region: "eu" | "us" | null; target: number | null; cur: AdNums; prev: AdNums } | null;
  delivery: { sent: number; failed: number; tracked: number; opened: number; downloaded: number; unopened24: number; old24: number };
  audit: { key: string; status: "bad" | "warn"; label: string; detail?: string }[];
};

export type CampaignFacts = {
  id: string; name: string; region: "eu" | "us" | null; target: number | null; status: string | null; budget: number | null;
  offerKey: string | null; storeSlug: string | null; funnelSlugs: string[];
  cur: AdNums; prev: AdNums;
  platforms: { platform: string; spend: number; purchases: number; impressions: number; linkClicks: number }[];
  adsNoSale: { id: string; name: string; spend: number }[];
  adsActive: number;
  bestAd: { id: string; name: string; spend: number; purchases: number; cpa: number } | null;
  /** Primer día con gasto que se ve (desde la ventana anterior): si es de hace 1–2 días, está aprendiendo. */
  firstSpend?: string | null;
};

export type StoreFacts = {
  storeId: string; slug: string; name: string;
  mailsIn: number; unanswered: number; intents: Record<string, number>;
  disputes: number;
};

export type Facts = {
  window: Window;
  markets: MarketFacts[];
  campaigns: CampaignFacts[];
  stores: StoreFacts[];
  offers: OfferItem[];
  findings: Finding[];
  notMeasurable: string[];
  errors: string[];
  landingNote: string | null;
};

// ------------------------------------------------------------------ util

const r2 = (n: number) => Math.round(n * 100) / 100;
export const usd = (n: number) => `${n < 100 ? r2(n).toFixed(2).replace(".", ",") : Math.round(n).toLocaleString("es-AR")} USD`;
export const pc = (n: number) => `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0).replace(".", ",")}%`;
const money = (n: number | null, cur: string) => (n == null ? "—" : `${n.toFixed(2).replace(".", ",")} ${cur}`);
const zeroAd = (): AdNums => ({ spend: 0, impressions: 0, linkClicks: 0, purchases: 0, value: 0, lpv: 0, ic: 0 });
const addAd = (a: AdNums, b: AdNums) => { for (const k of Object.keys(a) as (keyof AdNums)[]) a[k] += b[k]; return a; };
const split = (): Split => ({ visitors: 0, checkout: 0, orders: 0 });
const emptySteps = (): Steps => ({
  landingVisits: 0, landingVisitors: 0, touched: 0, timeSamples: 0, medianSec: null, under10s: 0,
  ctaVisits: 0, ctaByIndex: {}, checkoutVisitors: 0, reachFromLanding: 0, leads: 0,
  payAttempts: 0, payErrors: 0, intentErrors: 0, formErrors: 0, errorCodes: {},
  orders: 0, grossUsd: 0, netUsd: 0, mainUsd: 0, bumpUsd: 0, upsellUsd: 0, bumpOrders: 0, refunds: 0, refundedUsd: 0,
  bumpTaken: {}, byDevice: { mobile: split(), desktop: split() }, byNetwork: {}, byCountry: {},
});
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const deviceOfUa = (ua: string): "mobile" | "desktop" => (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini|iPad|Tablet|Silk|Kindle/i.test(ua) ? "mobile" : "desktop");
const devOf = (d: string | null | undefined): "mobile" | "desktop" => (d === "desktop" ? "desktop" : "mobile");
const NONE = "00000000-0000-0000-0000-000000000000";

/** Los últimos `days` días contando hoy (como «Últimos 7 días» del panel), contra los `days` anteriores completos. */
export function windowFor(days = 7, now = new Date()): Window {
  const until = todayIn(PANEL_TZ, now);
  const since = shift(until, -(days - 1));
  const P = previousOf({ since, until });
  const from = startOfDay(since, PANEL_TZ);
  const pfrom = startOfDay(P.since, PANEL_TZ);
  return { since, until, prevSince: P.since, prevUntil: P.until, days, from, to: now, pfrom, pto: from, effDays: Math.max(0.25, (now.getTime() - from.getTime()) / 864e5) };
}

async function pages<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, cap = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < cap; off += 1000) {
    const { data, error } = await q(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------------ datos

type Ev = { at: string; visitor_id: string | null; funnel_id: string | null; page: string; event: string; device: string | null; country: string | null; browser: string | null; ref_host: string | null; utm_source: string | null; data: Record<string, unknown> | null };
type OrderRow = {
  id: string; store_id: string; funnel_id: string | null; status: string; currency: string | null; amount_total: number | string | null; amount_refunded: number | string | null;
  created_at: string; country: string | null; tracking: { ua?: string } | null;
  order_items: { kind: string; amount: number | string; currency: string | null; refunded_amount: number | string | null; product_id: string | null }[] | null;
};

/** Todo el cálculo determinístico. `onlyOffer` = una sola oferta (tienda~oferta). */
export async function computeFacts(opts: { days?: number; now?: Date; onlyOffer?: string | null; skipAudit?: boolean } = {}): Promise<Facts> {
  const W = windowFor(opts.days ?? 7, opts.now);
  const errors: string[] = [];
  const [rates, test, allOffers] = await Promise.all([getRates(), testStoreIds(), offerList()]);
  const offers = allOffers.filter((o) => o.active && !test.has(o.store.id) && (!opts.onlyOffer || o.key === opts.onlyOffer));
  const markets = offers.flatMap((o) => o.markets.filter((f) => f.active).map((f) => ({ o, f })));
  const allFunnels = offers.flatMap((o) => o.funnels);
  const funnelIds = allFunnels.map((f) => f.id);
  const toUsd = (n: unknown, cur: string | null | undefined) => (Number(n) || 0) / (rates[(cur ?? "USD").toUpperCase()] ?? 1);

  // ---- Lecturas en paralelo
  const [frows, items, orders, events, touchedHb, emails, inbox, disputes, campRows, platRows, adRows, rec] = await Promise.all([
    db.from("funnels").select("id,store_id,settings,main_product_id").in("id", funnelIds.length ? funnelIds : [NONE]).then((r) => r.data ?? []),
    db.from("funnel_items").select("funnel_id,product_id,role").in("funnel_id", funnelIds.length ? funnelIds : [NONE]).then((r) => r.data ?? []),
    pages<OrderRow>((a, b) => db.from("orders")
      .select("id,store_id,funnel_id,status,currency,amount_total,amount_refunded,created_at,country,tracking,order_items(kind,amount,currency,refunded_amount,product_id)")
      .in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0).in("funnel_id", funnelIds.length ? funnelIds : [NONE])
      .gte("created_at", W.pfrom.toISOString()).lt("created_at", W.to.toISOString()).order("created_at").range(a, b) as unknown as PromiseLike<{ data: OrderRow[] | null; error: { message: string } | null }>)
      .catch((e) => { errors.push(`pedidos: ${(e as Error).message}`); return [] as OrderRow[]; }),
    pages<Ev>((a, b) => db.from("site_events")
      .select("at,visitor_id,funnel_id,page,event,device,country,browser,ref_host,utm_source,data")
      .in("funnel_id", funnelIds.length ? funnelIds : [NONE]).eq("is_bot", false).neq("event", "heartbeat")
      .gte("at", W.pfrom.toISOString()).lt("at", W.to.toISOString()).order("at").range(a, b) as unknown as PromiseLike<{ data: Ev[] | null; error: { message: string } | null }>)
      .catch((e) => { errors.push(`eventos: ${(e as Error).message}`); return [] as Ev[]; }),
    // Latidos con interacción (h=1): solo para saber qué cargas tocaron la pantalla.
    pages<{ funnel_id: string | null; pv: string | null }>((a, b) => db.from("site_events").select("funnel_id,pv:data->>pv")
      .in("funnel_id", funnelIds.length ? funnelIds : [NONE]).eq("is_bot", false).eq("event", "heartbeat").eq("page", "landing").eq("data->>h", "1")
      .gte("at", W.pfrom.toISOString()).lt("at", W.to.toISOString()).range(a, b) as unknown as PromiseLike<{ data: { funnel_id: string | null; pv: string | null }[] | null; error: { message: string } | null }>)
      .catch(() => [] as { funnel_id: string | null; pv: string | null }[]),
    pages<{ order_id: string | null; kind: string; status: string; tracked: boolean | null; opened_at: string | null; downloaded_at: string | null; created_at: string }>((a, b) =>
      db.from("email_log").select("order_id,kind,status,tracked,opened_at,downloaded_at,created_at").in("kind", ["delivery", "upsell"])
        .gte("created_at", W.from.toISOString()).range(a, b) as never).catch(() => []),
    pages<{ store_id: string; replied_at: string | null; date: string | null; ai_draft: { auto?: { intent?: string } } | null }>((a, b) =>
      db.from("inbox_messages").select("store_id,replied_at,date,ai_draft").eq("direction", "in").eq("automated", false).eq("is_bounce", false)
        .gte("date", W.from.toISOString()).range(a, b) as never).catch(() => []),
    db.from("alerts").select("store_id,kind").eq("kind", "stripe_dispute").gte("created_at", W.from.toISOString()).then((r) => r.data ?? []),
    pages<Record<string, unknown>>((a, b) => db.from("meta_insights_daily")
      .select("account_id,date,campaign_id,campaign_name,effective_status,daily_budget,spend,impressions,inline_link_clicks,purchases,purchase_value,initiate_checkout,landing_page_views")
      .eq("level", "campaign").gte("date", W.prevSince).lte("date", W.until).range(a, b) as never).catch((e) => { errors.push(`Meta: ${(e as Error).message}`); return []; }),
    pages<Record<string, unknown>>((a, b) => db.from("meta_platform_daily").select("account_id,campaign_id,platform,spend,impressions,link_clicks,purchases")
      .gte("date", W.since).lte("date", W.until).range(a, b) as never).catch(() => []),
    pages<Record<string, unknown>>((a, b) => db.from("meta_insights_daily").select("account_id,ad_id,ad_name,campaign_id,effective_status,spend,purchases")
      .eq("level", "ad").gte("date", W.since).lte("date", W.until).range(a, b) as never).catch(() => []),
    landingBehaviour(markets.map((m) => m.f.id), new Date(Math.max(W.from.getTime(), Date.now() - 72 * 3600_000)))
      .catch((e) => { errors.push(`grabaciones: ${(e as Error).message}`); return null; }),
  ]);
  // Diagnóstico de la oferta (offer-audit: landing, pixel, entrega, post-pago…), solo de las ofertas con
  // movimiento: pide las landings y los links de entrega, y para las que no venden acá no vale la espera.
  const spendBy = new Map<string, number>();
  for (const r of campRows) if (String(r.date) >= W.since) spendBy.set(String(r.campaign_id), (spendBy.get(String(r.campaign_id)) ?? 0) + (Number(r.spend) || 0));
  const liveOffers = offers.filter((o) => {
    const ids = new Set(o.funnels.map((f) => f.id));
    return orders.some((x) => x.funnel_id && ids.has(x.funnel_id)) || events.filter((e) => e.funnel_id && ids.has(e.funnel_id) && e.event === "view").length >= 20
      || o.funnels.some((f) => f.meta_campaign_ids.some((c) => (spendBy.get(c) ?? 0) > 0));
  });
  let auditTimer: ReturnType<typeof setTimeout> | undefined;
  const audit = opts.skipAudit ? null : await Promise.race([
    Promise.all(liveOffers.map((o) => auditOffers({ offerKey: o.key }).catch((e) => { errors.push(`diagnóstico (${o.key}): ${(e as Error).message}`); return [] as OfferAuditRow[]; }))).then((x) => x.flat()),
    new Promise<null>((r) => { auditTimer = setTimeout(() => { errors.push("diagnóstico: tardó más de 75 s, sigo sin él"); r(null); }, 75_000); }),
  ]);
  clearTimeout(auditTimer);
  const { data: syncRows } = await db.from("meta_sync").select("account_id,currency");
  const metaCur = new Map((syncRows ?? []).map((s) => [s.account_id as string, String(s.currency ?? "USD").toUpperCase()]));
  const metaUsd = (n: unknown, acct: unknown) => (Number(n) || 0) / (rates[metaCur.get(String(acct)) ?? "USD"] ?? 1);

  // ---- Productos (principal, bumps y post-pago) con precios
  const fOf = new Map(frows.map((f) => [f.id as string, f]));
  const chains = new Map<string, Awaited<ReturnType<typeof simulate>>>();
  const ppInfo = new Map<string, Awaited<ReturnType<typeof postPurchaseOf>>>();
  await Promise.all(markets.map(async ({ o, f }) => {
    const bumpIds = items.filter((i) => i.funnel_id === f.id && i.role === "bump").map((i) => i.product_id as string);
    const [c, p] = await Promise.all([
      simulate(o.store.id, f.id, [], { full: true }).catch(() => null),
      postPurchaseOf(o.store.id, f.id, bumpIds).catch(() => null),
    ]);
    if (c) chains.set(f.id, c);
    if (p) ppInfo.set(f.id, p);
  }));
  const pids = new Set<string>();
  for (const { f } of markets) {
    const fr = fOf.get(f.id);
    if (fr?.main_product_id) pids.add(fr.main_product_id as string);
    for (const i of items.filter((x) => x.funnel_id === f.id && x.role === "bump")) pids.add(i.product_id as string);
  }
  const { data: prodRows } = await db.from("products").select("id,slug,name,short_name,product_prices(currency,amount,compare_at,display_value)").in("id", pids.size ? [...pids] : [NONE]);
  const prodById = new Map(((prodRows ?? []) as unknown as Product[]).map((p) => [p.id, p]));

  // ---- Moneda de cada mercado: la fija del checkout, la del país del mercado, o la de sus pedidos.
  const curOf = new Map<string, string>();
  await Promise.all(markets.map(async ({ o, f }) => {
    const s = resolveSettings(fOf.get(f.id)?.settings);
    let c = s.currency;
    if (!c && f.flags[0]) c = (await currencyForCountry(o.store.id, f.flags[0].toUpperCase()).catch(() => null)) ?? "";
    if (!c) c = orders.find((x) => x.funnel_id === f.id)?.currency?.toUpperCase() ?? "";
    curOf.set(f.id, c || "USD");
  }));
  const ref = (p: Product | null | undefined, cur: string): ProductRef | null => {
    if (!p) return null;
    const pr = p.product_prices?.length ? priceFor(p, cur, rates) : null;
    const price = pr?.amount != null ? Number(pr.amount) : null;
    return { id: p.id, slug: p.slug, name: p.short_name || p.name, price, priceUsd: price != null ? price / (rates[cur] ?? 1) : null };
  };

  // ---- Embudo por mercado y ventana
  const stepsOf = new Map<string, { cur: Steps; prev: Steps }>();
  for (const { f } of markets) stepsOf.set(f.id, { cur: emptySteps(), prev: emptySteps() });
  const inCur = (iso: string) => iso >= W.from.toISOString();
  const touchedPv = new Set(touchedHb.map((t) => `${t.funnel_id}|${t.pv}`));

  // Por ventana y checkout: sets de personas y cargas.
  type Acc = { lv: Set<string>; lvis: Set<string>; touched: Set<string>; cta: Set<string>; ck: Set<string>; leads: Set<string>; secs: number[];
    devV: Map<string, "mobile" | "desktop">; netV: Map<string, string>; ccV: Map<string, string> };
  const acc = new Map<string, Acc>();
  const A = (fid: string, cur: boolean) => {
    const k = `${fid}|${cur ? 1 : 0}`;
    if (!acc.has(k)) acc.set(k, { lv: new Set(), lvis: new Set(), touched: new Set(), cta: new Set(), ck: new Set(), leads: new Set(), secs: [], devV: new Map(), netV: new Map(), ccV: new Map() });
    return acc.get(k)!;
  };
  for (const e of events) {
    if (!e.funnel_id || !stepsOf.has(e.funnel_id)) continue;
    const cur = inCur(e.at);
    const S = stepsOf.get(e.funnel_id)![cur ? "cur" : "prev"];
    const a = A(e.funnel_id, cur);
    const d = e.data ?? {};
    const pv = String(d.pv ?? "");
    const who = e.visitor_id ?? `pv:${pv}`;
    if (d.h) a.touched.add(pv);
    if (e.page === "landing") {
      if (e.event === "view" && pv) {
        a.lv.add(pv); a.lvis.add(who);
        if (!a.devV.has(who)) a.devV.set(who, devOf(e.device));
        if (!a.netV.has(who)) a.netV.set(who, networkOf({ browser: e.browser, refHost: e.ref_host, utmSource: e.utm_source }) ?? "Sin dato");
        if (!a.ccV.has(who) && e.country) a.ccV.set(who, e.country);
      } else if (e.event === "leave" && typeof d.s === "number") a.secs.push(d.s);
      else if (e.event === "cta_click") {
        a.cta.add(pv);
        const i = String(d.i ?? "?");
        S.ctaByIndex[i] = (S.ctaByIndex[i] ?? 0) + 1;
      }
    } else if (e.page === "checkout") {
      if (e.event === "view") {
        a.ck.add(who);
        if (!a.devV.has(who)) a.devV.set(who, devOf(e.device));
        if (!a.netV.has(who)) a.netV.set(who, networkOf({ browser: e.browser, refHost: e.ref_host, utmSource: e.utm_source }) ?? "Sin dato");
        if (!a.ccV.has(who) && e.country) a.ccV.set(who, e.country);
      } else if (e.event === "lead") a.leads.add(who);
      else if (e.event === "pay_attempt") S.payAttempts++;
      else if (e.event === "pay_error") {
        const stage = String(d.stage ?? "confirm");
        if (stage === "form") S.formErrors++;
        else { S.payErrors++; if (stage === "intent") S.intentErrors++; }
        const c = `${stage}:${String(d.decline ?? d.code ?? "otro")}`;
        S.errorCodes[c] = (S.errorCodes[c] ?? 0) + 1;
      }
    }
  }
  for (const [k, a] of acc) {
    const [fid, c] = k.split("|");
    const S = stepsOf.get(fid)![c === "1" ? "cur" : "prev"];
    S.landingVisits = a.lv.size; S.landingVisitors = a.lvis.size;
    S.touched = [...a.lv].filter((pv) => a.touched.has(pv) || touchedPv.has(`${fid}|${pv}`)).length;
    S.ctaVisits = a.cta.size; S.checkoutVisitors = a.ck.size; S.leads = a.leads.size;
    S.reachFromLanding = [...a.lvis].filter((v) => a.ck.has(v)).length;
    S.timeSamples = a.secs.length; S.medianSec = median(a.secs); S.under10s = a.secs.filter((s) => s < 10).length;
    for (const [who, dev] of a.devV) {
      if (a.lvis.has(who)) S.byDevice[dev].visitors++;
      if (a.ck.has(who)) S.byDevice[dev].checkout++;
    }
    for (const [who, net] of a.netV) {
      const x = (S.byNetwork[net] ??= split());
      if (a.lvis.has(who)) x.visitors++;
      if (a.ck.has(who)) x.checkout++;
    }
    for (const [who, cc] of a.ccV) {
      const x = (S.byCountry[cc] ??= split());
      if (a.lvis.has(who)) x.visitors++;
      if (a.ck.has(who)) x.checkout++;
    }
  }

  // Pedidos
  const orderFunnel = new Map<string, string>();
  for (const o of orders) {
    if (!o.funnel_id || !stepsOf.has(o.funnel_id)) continue;
    orderFunnel.set(o.id, o.funnel_id);
    const S = stepsOf.get(o.funnel_id)![inCur(o.created_at) ? "cur" : "prev"];
    const its = o.order_items ?? [];
    const gross = its.length ? its.reduce((a, it) => a + toUsd(it.amount, it.currency ?? o.currency), 0) : toUsd(o.amount_total, o.currency);
    const back = toUsd(o.amount_refunded, o.currency) + its.filter((i) => i.kind === "upsell").reduce((a, it) => a + toUsd(it.refunded_amount, it.currency ?? o.currency), 0);
    S.orders++; S.grossUsd += gross; S.netUsd += Math.max(0, gross - back);
    S.mainUsd += its.filter((i) => i.kind === "main").reduce((a, it) => a + toUsd(it.amount, it.currency ?? o.currency), 0);
    S.bumpUsd += its.filter((i) => i.kind === "bump").reduce((a, it) => a + toUsd(it.amount, it.currency ?? o.currency), 0);
    S.upsellUsd += its.filter((i) => i.kind === "upsell").reduce((a, it) => a + toUsd(it.amount, it.currency ?? o.currency), 0);
    if (back > 0) { S.refunds++; S.refundedUsd += back; }
    const bumps = its.filter((i) => i.kind === "bump" && i.product_id);
    if (bumps.length) S.bumpOrders++;
    for (const b of bumps) S.bumpTaken[b.product_id!] = (S.bumpTaken[b.product_id!] ?? 0) + 1;
    const dev = deviceOfUa(o.tracking?.ua ?? "");
    S.byDevice[dev].orders++;
    const net = networkOf({ ua: o.tracking?.ua }) ?? "Sin dato";
    (S.byNetwork[net] ??= split()).orders++;
    if (o.country) (S.byCountry[o.country.toUpperCase()] ??= split()).orders++;
  }

  // OTO por nivel (lo de Inicio: glance), solo donde hubo pedidos.
  const levelsOf = new Map<string, { cur: LevelRate[]; prev: LevelRate[] }>();
  await Promise.all(markets.map(async ({ o, f }) => {
    const st = stepsOf.get(f.id)!;
    const [c, p] = await Promise.all([
      st.cur.orders ? glance({ storeIds: [o.store.id], funnelIds: [f.id], since: W.since, until: W.until }).then((g) => g.levels).catch(() => []) : Promise.resolve([]),
      st.prev.orders ? glance({ storeIds: [o.store.id], funnelIds: [f.id], since: W.prevSince, until: W.prevUntil }).then((g) => g.levels).catch(() => []) : Promise.resolve([]),
    ]);
    levelsOf.set(f.id, { cur: c, prev: p });
  }));

  // Entregas (mails) de los pedidos de la ventana.
  const delOf = new Map<string, MarketFacts["delivery"]>();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  for (const m of emails) {
    const fid = m.order_id ? orderFunnel.get(m.order_id) : undefined;
    if (!fid) continue;
    const d = delOf.get(fid) ?? { sent: 0, failed: 0, tracked: 0, opened: 0, downloaded: 0, unopened24: 0, old24: 0 };
    if (m.status === "failed") d.failed++;
    else if (m.status === "sent") {
      d.sent++;
      if (m.tracked) {
        d.tracked++;
        if (m.opened_at) d.opened++;
        if (m.downloaded_at) d.downloaded++;
        if (m.created_at < dayAgo) { d.old24++; if (!m.opened_at) d.unopened24++; }
      }
    }
    delOf.set(fid, d);
  }

  // ---- Meta: por campaña (actual y anterior), por red y por anuncio.
  const funnelOfCampaign = new Map<string, { o: OfferItem; f: OfferFunnel }[]>();
  for (const o of offers) for (const f of o.funnels) for (const c of f.meta_campaign_ids) {
    (funnelOfCampaign.get(c) ?? (funnelOfCampaign.set(c, []), funnelOfCampaign.get(c)!)).push({ o, f });
  }
  const camp = new Map<string, CampaignFacts>();
  const lastDate = new Map<string, string>();
  const firstSpend = new Map<string, string>();
  for (const r of campRows) {
    const id = String(r.campaign_id);
    const name = String(r.campaign_name ?? id);
    let c = camp.get(id);
    if (!c) {
      const linked = funnelOfCampaign.get(id) ?? [];
      const region = linked.length ? regionOfFlags(linked[0].f.flags) ?? regionOf(name) : regionOf(name);
      c = { id, name, region, target: region ? CPA_TARGET[region] : null, status: null, budget: null, offerKey: linked[0]?.o.key ?? null, storeSlug: linked[0]?.o.store.slug ?? null,
        funnelSlugs: linked.map((l) => l.f.slug), cur: zeroAd(), prev: zeroAd(), platforms: [], adsNoSale: [], adsActive: 0, bestAd: null };
      camp.set(id, c);
    }
    const d = String(r.date);
    if ((Number(r.spend) || 0) > 0 && d < (firstSpend.get(id) ?? "9999")) firstSpend.set(id, d);
    if (d >= (lastDate.get(id) ?? "")) { lastDate.set(id, d); c.status = (r.effective_status as string) ?? c.status; c.budget = r.daily_budget != null ? metaUsd(r.daily_budget, r.account_id) : c.budget; c.name = name; }
    const n: AdNums = {
      spend: metaUsd(r.spend, r.account_id), impressions: Number(r.impressions) || 0, linkClicks: Number(r.inline_link_clicks) || 0,
      purchases: Number(r.purchases) || 0, value: metaUsd(r.purchase_value, r.account_id), lpv: Number(r.landing_page_views) || 0, ic: Number(r.initiate_checkout) || 0,
    };
    addAd(d >= W.since ? c.cur : c.prev, n);
  }
  for (const r of platRows) {
    const c = camp.get(String(r.campaign_id));
    if (!c) continue;
    const p = String(r.platform);
    let x = c.platforms.find((y) => y.platform === p);
    if (!x) { x = { platform: p, spend: 0, purchases: 0, impressions: 0, linkClicks: 0 }; c.platforms.push(x); }
    x.spend += metaUsd(r.spend, r.account_id); x.purchases += Number(r.purchases) || 0; x.impressions += Number(r.impressions) || 0; x.linkClicks += Number(r.link_clicks) || 0;
  }
  const ads = new Map<string, { id: string; name: string; campaign: string; spend: number; purchases: number; active: boolean }>();
  for (const r of adRows) {
    const id = String(r.ad_id);
    const a = ads.get(id) ?? { id, name: String(r.ad_name ?? id), campaign: String(r.campaign_id), spend: 0, purchases: 0, active: false };
    a.spend += metaUsd(r.spend, r.account_id); a.purchases += Number(r.purchases) || 0;
    if (r.effective_status === "ACTIVE") a.active = true;
    ads.set(id, a);
  }
  for (const a of ads.values()) {
    const c = camp.get(a.campaign);
    if (!c) continue;
    if (a.active) c.adsActive++;
    const floor = (c.target ?? CPA_TARGET.eu) * ADS_MIN.adNoSale;
    if (a.active && a.purchases === 0 && a.spend >= floor) c.adsNoSale.push({ id: a.id, name: a.name, spend: a.spend });
    if (a.purchases >= 3) {
      const cpa = a.spend / a.purchases;
      if (!c.bestAd || cpa < c.bestAd.cpa) c.bestAd = { id: a.id, name: a.name, spend: a.spend, purchases: a.purchases, cpa };
    }
  }
  for (const c of camp.values()) { c.adsNoSale.sort((a, b) => b.spend - a.spend); c.platforms.sort((a, b) => b.spend - a.spend); }
  for (const c of camp.values()) c.firstSpend = firstSpend.get(c.id) ?? null;
  const campaigns = [...camp.values()].filter((c) => c.cur.spend > 0 || c.prev.spend > 0).sort((a, b) => b.cur.spend - a.cur.spend);

  // ---- Tiendas: mails de compradores y contracargos
  const stores = new Map<string, StoreFacts>();
  for (const o of offers) if (!stores.has(o.store.id)) stores.set(o.store.id, { storeId: o.store.id, slug: o.store.slug, name: o.store.display_name || o.store.name, mailsIn: 0, unanswered: 0, intents: {}, disputes: 0 });
  for (const m of inbox) {
    const s = stores.get(m.store_id);
    if (!s) continue;
    s.mailsIn++;
    if (!m.replied_at && m.date && m.date < dayAgo) s.unanswered++;
    const it = m.ai_draft?.auto?.intent;
    if (it) s.intents[it] = (s.intents[it] ?? 0) + 1;
  }
  for (const d of disputes) { const s = stores.get(d.store_id as string); if (s) s.disputes++; }

  // ---- Armado por mercado
  const auditByKey = new Map(((audit ?? []) as OfferAuditRow[]).map((r) => [r.key, r]));
  const mk: MarketFacts[] = markets.map(({ o, f }) => {
    const fr = fOf.get(f.id);
    const cur = curOf.get(f.id) ?? "USD";
    const s = resolveSettings(fr?.settings);
    const ch = chains.get(f.id);
    const pp = ppInfo.get(f.id);
    const st = stepsOf.get(f.id)!;
    const linked = f.meta_campaign_ids.filter((id) => camp.has(id));
    const region = regionOfFlags(f.flags);
    const adsCur = linked.reduce((a, id) => addAd(a, camp.get(id)!.cur), zeroAd());
    const adsPrev = linked.reduce((a, id) => addAd(a, camp.get(id)!.prev), zeroAd());
    const ar = auditByKey.get(f.key);
    return {
      offerKey: o.key, offerName: o.name, offerAlias: o.alias, storeSlug: o.store.slug, storeId: o.store.id,
      funnelId: f.id, slug: f.slug, market: f.market_label || f.name, flags: f.flags, currency: cur, locale: s.locale || "",
      landingUrl: f.landing_url, checkoutUrl: checkoutUrl(f, o.store.slug),
      main: ref(prodById.get(fr?.main_product_id as string), cur),
      bumps: items.filter((i) => i.funnel_id === f.id && i.role === "bump").map((i) => ref(prodById.get(i.product_id as string), cur)).filter((x): x is ProductRef => !!x),
      chain: ch && pp ? {
        name: ch.name, levels: pp.levels, otos: pp.otos, otosWithDs: pp.otosWithDs,
        steps: ch.steps.map((p, i) => ({ ...(ref(p, cur) as ProductRef), level: ch.meta[i]?.level ?? 1, kind: ch.meta[i]?.kind ?? "oto", active: ch.meta[i]?.active ?? true })),
      } : null,
      cur: st.cur, prev: st.prev,
      levels: levelsOf.get(f.id) ?? { cur: [], prev: [] },
      landing: rec?.byFunnel.get(f.id) ?? null,
      ads: linked.length ? { campaignIds: linked, region, target: region ? CPA_TARGET[region] : null, cur: adsCur, prev: adsPrev } : null,
      delivery: delOf.get(f.id) ?? { sent: 0, failed: 0, tracked: 0, opened: 0, downloaded: 0, unopened24: 0, old24: 0 },
      audit: ar ? Object.entries(ar.cells).filter(([k, c]) => (c.status === "bad" || c.status === "warn") && k !== "recording").map(([k, c]) => ({ key: k, status: c.status as "bad" | "warn", label: c.label, detail: c.detail })) : [],
    };
  });

  const notMeasurable = [
    "Qué sección exacta de la landing lee o salta cada visita: las grabaciones tapan el texto, solo se sabe a qué altura (en % de la página) se fue.",
    "El alto real de cada landing: rrweb no lo guarda; se estima con lo más hondo que llegó alguien en ese dispositivo.",
    "Comportamiento en la landing de más de 3 días atrás: las grabaciones se borran a las 72 h (los eventos de visita, botón y tiempo sí quedan).",
    "Visitas que se van en el primer segundo: no llegan a grabarse (sí cuentan en «se fue sin tocar la pantalla»).",
    "Ventas de las ofertas que todavía cobran en la plataforma anterior: Panel no las ve; para esas campañas solo están las compras que informa Meta.",
    "Frecuencia y alcance de los anuncios: el sync de Meta no los trae.",
    "Si la visita tocó la pantalla: la señal «h» de los eventos casi no llega (en Uñas USA, 28 de 30 clics al botón llegaron sin ella), así que no se usa. Para el rebote se usa el tiempo hasta irse.",
  ];
  const landingNote = rec ? `${rec.chunks} pedazos de grabación leídos${rec.truncated ? " (tope alcanzado: muestra parcial)" : ""}` : null;

  const facts: Facts = { window: W, markets: mk, campaigns, stores: [...stores.values()], offers, findings: [], notMeasurable, errors, landingNote };
  facts.findings = findingsOf(facts);
  return facts;
}

// ------------------------------------------------------------------ hallazgos

const sevLow = (rate: number, b: Bench): Severity => (rate < b.bad ? "alta" : "media");
const sevHigh = (rate: number, b: Bench): Severity => (rate > b.bad ? "alta" : "media");
const bText = (b: Bench, invert = false) => `${invert ? "hasta " : ""}${pc(invert ? b.high : b.low)}${invert ? "" : `–${pc(b.high)}`}: ${b.why}`;
const few = (n: number, min: number) => `pocos datos (${n} de ${min} necesarios)`;

export function findingsOf(F: Facts): Finding[] {
  const out: Finding[] = [];
  const wk = (x: number) => (x * 7) / F.window.effDays;
  const add = (f: Omit<Finding, "enough" | "impactUsdWeek"> & { enough?: boolean; impactUsdWeek?: number | null }) =>
    out.push({ enough: true, ...f, impactUsdWeek: f.impactUsdWeek != null && f.impactUsdWeek > 0 ? Math.round(f.impactUsdWeek) : null });

  // Tasa contra referencia, con «pocos datos» si no alcanza la muestra.
  const rate = (o: {
    id: string; area: Area; m: MarketFacts | null; offerKey: string | null; storeSlug: string | null; funnelSlug?: string | null; title: string;
    num: number; den: number; b: Bench; label: string; higherIsBad?: boolean; impact?: (rate: number) => number | null; impactHow?: string; detail?: string;
  }) => {
    if (!o.den) return;
    const r = o.num / o.den;
    const metric = `${o.label}: ${pc(r)} (${o.num} de ${o.den})`;
    const goal = o.higherIsBad ? `bajar a ${pc(o.b.high)} o menos` : `llegar a ${pc(o.b.low)} o más`;
    const base = { id: o.id, area: o.area, offerKey: o.offerKey, storeSlug: o.storeSlug, funnelSlug: o.funnelSlug ?? null, metric, benchmark: bText(o.b, o.higherIsBad), sample: o.den, goal: `${o.label}: ${goal}` };
    const weak = o.higherIsBad ? r > o.b.flag : r < o.b.flag;
    if (o.den < o.b.min) {
      if (!weak) return;
      add({ ...base, severity: "info", enough: false, title: `${o.title}: ${few(o.den, o.b.min)}`, detail: o.detail ?? metric });
      return;
    }
    if (!weak) return;
    add({
      ...base, severity: o.higherIsBad ? sevHigh(r, o.b) : sevLow(r, o.b), title: o.title,
      impactUsdWeek: o.impact ? o.impact(r) : null, impactHow: o.impactHow ?? null, detail: o.detail ?? metric,
    });
  };

  for (const m of F.markets) {
    const C = m.cur, P = m.prev;
    const ok = m.offerKey, ss = m.storeSlug, fs = m.slug;
    const where = `${m.offerName} (${m.market})`;
    const aov = C.orders ? C.grossUsd / C.orders : P.orders ? P.grossUsd / P.orders : m.main?.priceUsd ?? null;
    const ckConv = C.checkoutVisitors ? C.orders / C.checkoutVisitors : null;

    // Landing → checkout
    if (C.landingVisitors) {
      rate({
        id: `landing.ck.${m.funnelId}`, area: "landing", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Pocos pasan de la landing al checkout · ${where}`,
        num: C.reachFromLanding, den: C.landingVisitors, b: BENCH.landingToCheckout, label: "Abren el checkout",
        impact: (r) => (aov ? wk((BENCH.landingToCheckout.low - r) * C.landingVisitors * Math.max(ckConv ?? 0, BENCH.checkoutConv.low) * aov) : null),
        impactHow: "personas que faltan para llegar al 15 % × conversión del checkout (la real o 25 %) × ticket",
        detail: `${C.landingVisitors} personas en la landing, ${C.reachFromLanding} abrieron el checkout. Tocaron el botón ${C.ctaVisits} de ${C.landingVisits} cargas.${C.medianSec != null ? ` Tiempo mediano en la página: ${Math.round(C.medianSec)} s (${C.timeSamples} salidas medidas).` : ""}`,
      });
      rate({
        id: `landing.quickexit.${m.funnelId}`, area: "landing", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Muchos se van antes de 10 segundos · ${where}`,
        num: C.under10s, den: C.timeSamples, b: BENCH.quickExit, label: "Se fueron antes de 10 s", higherIsBad: true,
        detail: `${C.under10s} de ${C.timeSamples} salidas medidas fueron antes de 10 s (mediana ${C.medianSec != null ? Math.round(C.medianSec) : "—"} s): lo primero que ven (titular, imagen, velocidad de carga) no los retiene.`,
      });
      // Celular contra computadora (solo con muestra en los dos).
      const mob = C.byDevice.mobile, desk = C.byDevice.desktop;
      if (mob.visitors >= 100 && desk.visitors >= 30) {
        const rm = mob.checkout / mob.visitors, rd = desk.checkout / desk.visitors;
        if (rd > 0 && rm < rd * 0.5) add({
          id: `landing.mobile.${m.funnelId}`, area: "landing", severity: "media", offerKey: ok, storeSlug: ss, funnelSlug: fs,
          title: `En el celular avanzan la mitad que en la computadora · ${where}`, metric: `Celular ${pc(rm)} (${mob.checkout} de ${mob.visitors}) · computadora ${pc(rd)} (${desk.checkout} de ${desk.visitors})`,
          benchmark: "parecidos entre dispositivos; si el celular queda muy abajo, algo de la versión móvil frena", sample: mob.visitors, detail: "Personas que abren el checkout sobre las que vieron la landing, por dispositivo.",
        });
      }
    }
    // Grabaciones
    if (m.landing) {
      const L = m.landing;
      for (const [dev, D] of [["celular", L.mobile], ["computadora", L.desktop]] as const) {
        if (!D) continue;
        rate({
          id: `landing.noscroll.${dev}.${m.funnelId}`, area: "landing", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `No bajan de la primera pantalla (${dev}) · ${where}`,
          num: Math.round(D.noScroll * D.n), den: D.n, b: BENCH.noScroll, label: `No bajaron (${dev})`, higherIsBad: true,
          detail: `Grabaciones de los últimos 3 días: ${D.n} visitas en ${dev}. Página de ~${D.screens} pantallas. Llegan al 50 %: ${pc(D.reached.p50)}; al 90 %: ${pc(D.reached.p90)}.`,
        });
        if (D.topExit && D.topExit.share >= 0.25 && D.n >= 50) add({
          id: `landing.exit.${dev}.${m.funnelId}`, area: "landing", severity: "baja", offerKey: ok, storeSlug: ss, funnelSlug: fs,
          title: `Muchos se van en el ${D.topExit.decile * 10}–${D.topExit.decile * 10 + 10} % de la página (${dev}) · ${where}`,
          metric: `${pc(D.topExit.share)} de los que se van pasada la primera pantalla, se van en ese tramo`, benchmark: "las salidas se reparten a lo largo de la página; un tramo con 25 % o más marca una sección que corta la lectura",
          sample: D.n, detail: `Profundidad estimada sobre ~${D.screens} pantallas (${D.n} grabaciones en ${dev}, sin contar a los que tocaron el botón).`,
        });
      }
      if (L.imgClickShare >= 0.15 && L.sessions >= 50) add({
        id: `landing.imgclick.${m.funnelId}`, area: "landing", severity: "baja", offerKey: ok, storeSlug: ss, funnelSlug: fs,
        title: `Tocan las imágenes para verlas más grandes · ${where}`, metric: `${pc(L.imgClickShare)} de ${L.sessions} visitas grabadas tocaron una imagen que no hace nada`,
        benchmark: "menos de 10 %: cuando muchos tocan una imagen, quieren verla de cerca (páginas del libro, ejemplos)", sample: L.sessions,
        detail: "Clics o toques sobre imágenes que no son link ni botón, en las grabaciones de los últimos 3 días.",
      });
    }

    // Checkout
    rate({
      id: `checkout.conv.${m.funnelId}`, area: "checkout", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `El checkout convierte poco · ${where}`,
      num: Math.min(C.orders, C.checkoutVisitors), den: C.checkoutVisitors, b: BENCH.checkoutConv, label: "Pagaron",
      impact: (r) => (aov ? wk((BENCH.checkoutConv.low - r) * C.checkoutVisitors * aov) : null),
      impactHow: "pedidos que faltan para llegar al 25 % × ticket promedio",
      detail: `${C.checkoutVisitors} personas abrieron el checkout, ${C.leads} escribieron su mail, ${C.orders} pagaron. Intentos de pago: ${C.payAttempts} (${C.formErrors} con la tarjeta incompleta, ${C.payErrors} rechazados o con error).`,
    });
    if (C.intentErrors >= 2) add({
      id: `checkout.intent.${m.funnelId}`, area: "checkout", severity: "alta", offerKey: ok, storeSlug: ss, funnelSlug: fs,
      title: `El servidor no pudo crear el pago · ${where}`, metric: `${C.intentErrors} intentos sin poder crear el pago`, benchmark: "0: es un error de la app, no del comprador", sample: C.payAttempts,
      goal: "0 errores al crear el pago", detail: `Errores: ${Object.entries(C.errorCodes).filter(([k]) => k.startsWith("intent:")).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    });
    if (C.payAttempts - C.formErrors > 0) rate({
      id: `checkout.errors.${m.funnelId}`, area: "checkout", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Muchos pagos fallan · ${where}`,
      num: C.payErrors, den: Math.max(C.payErrors, C.payAttempts - C.formErrors), b: BENCH.payErrors, label: "Pagos rechazados o con error", higherIsBad: true,
      detail: `Sin contar ${C.formErrors} intentos con la tarjeta incompleta (validación del formulario). Errores: ${Object.entries(C.errorCodes).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}.`,
    });
    // Bumps
    if (C.orders) {
      const bumpPrice = m.bumps.reduce((a, b) => Math.max(a, b.priceUsd ?? 0), 0);
      rate({
        id: `checkout.bump.${m.funnelId}`, area: "checkout", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Pocos suman el bump · ${where}`,
        num: C.bumpOrders, den: C.orders, b: BENCH.bump, label: "Sumaron un bump",
        impact: (r) => (bumpPrice ? wk((BENCH.bump.low - r) * C.orders * bumpPrice) : null), impactHow: "pedidos que faltan para el 20 % × precio del bump",
        detail: m.bumps.length ? m.bumps.map((b) => `${b.slug} (${money(b.price, m.currency)}): ${C.bumpTaken[b.id] ?? 0} de ${C.orders}`).join(" · ") : "El checkout no tiene bump.",
      });
    }

    // Post-pago por nivel
    const lv = m.levels.cur;
    for (const l of lv) {
      const b = l.kind === "downsell" ? BENCH.downsell : l.level === 1 ? BENCH.oto1 : l.level === 2 ? BENCH.oto2 : BENCH.oto3;
      const step = m.chain?.steps.find((s) => s.kind === l.kind && s.level === l.level);
      const name = l.kind === "downsell" ? `Downsell ${l.level}` : `OTO ${l.level}`;
      rate({
        id: `postpago.${l.kind}${l.level}.${m.funnelId}`, area: "postpago", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `${name} acepta poco · ${where}`,
        num: l.accepted, den: l.shown, b, label: name,
        impact: (r) => (step?.priceUsd ? wk((b.low - r) * l.shown * step.priceUsd) : null), impactHow: `aceptaciones que faltan para el ${pc(b.low)} × precio del ${name}`,
        detail: `${name}${step ? ` = ${step.slug} (${money(step.price, m.currency)})` : ""}: lo vieron ${l.shown}, lo tomaron ${l.accepted}.`,
      });
    }
    // Ticket con bump + post-pago sobre el principal
    if (C.orders && C.mainUsd) {
      const lift = C.grossUsd / C.mainUsd - 1;
      const mainAvg = C.mainUsd / C.orders;
      if (C.orders < BENCH.aovLift.min) { if (lift < BENCH.aovLift.flag) add({ id: `postpago.aov.${m.funnelId}`, area: "postpago", severity: "info", enough: false, offerKey: ok, storeSlug: ss, funnelSlug: fs,
        title: `Ticket promedio: ${few(C.orders, BENCH.aovLift.min)}`, metric: `Ticket ${usd(C.grossUsd / C.orders)} sobre ${usd(mainAvg)} del principal (+${pc(Math.max(0, lift))})`, benchmark: bText(BENCH.aovLift), sample: C.orders,
        detail: `Bumps ${usd(C.bumpUsd)} · post-pago ${usd(C.upsellUsd)} en ${C.orders} pedidos.` }); }
      else if (lift < BENCH.aovLift.flag) add({
        id: `postpago.aov.${m.funnelId}`, area: "postpago", severity: lift < BENCH.aovLift.bad ? "alta" : "media", offerKey: ok, storeSlug: ss, funnelSlug: fs,
        title: `Bump y post-pago suman poco al ticket · ${where}`, metric: `Ticket ${usd(C.grossUsd / C.orders)} sobre ${usd(mainAvg)} del principal (+${pc(Math.max(0, lift))})`,
        benchmark: bText(BENCH.aovLift), sample: C.orders, impactUsdWeek: wk((BENCH.aovLift.low - lift) * mainAvg * C.orders), impactHow: "lo que falta para +30 % × precio del principal × pedidos",
        detail: `Bumps ${usd(C.bumpUsd)} · post-pago ${usd(C.upsellUsd)} en ${C.orders} pedidos.`,
      });
    }

    // Post-venta
    if (C.orders) rate({
      id: `postventa.refunds.${m.funnelId}`, area: "postventa", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Muchos reembolsos · ${where}`,
      num: C.refunds, den: C.orders, b: BENCH.refunds, label: "Reembolsados", higherIsBad: true,
      impact: () => wk(C.refundedUsd), impactHow: "lo devuelto en la ventana, llevado a una semana", detail: `${C.refunds} pedidos con reembolso, ${usd(C.refundedUsd)} devueltos.`,
    });
    if (m.delivery.failed) add({
      id: `postventa.delivery_failed.${m.funnelId}`, area: "postventa", severity: "alta", offerKey: ok, storeSlug: ss, funnelSlug: fs,
      title: `Mails de entrega que no salieron · ${where}`, metric: `${m.delivery.failed} entregas fallidas (de ${m.delivery.sent + m.delivery.failed})`,
      benchmark: "0: cada entrega fallida es un comprador sin su producto (y un posible reembolso o contracargo)", sample: m.delivery.sent + m.delivery.failed,
      detail: "Ver Avisos › Mails enviados (filtro «Fallaron»).",
    });
    if (m.delivery.old24) rate({
      id: `postventa.unopened.${m.funnelId}`, area: "postventa", m, offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `Entregas sin abrir a las 24 h · ${where}`,
      num: m.delivery.unopened24, den: m.delivery.old24, b: BENCH.deliveryUnopened, label: "Sin abrir a las 24 h", higherIsBad: true,
      detail: `${m.delivery.opened} abiertos y ${m.delivery.downloaded} descargas de ${m.delivery.tracked} mails con seguimiento.`,
    });

    // Diagnóstico de la oferta (offer-audit): lo que está mal armado.
    const AUD: Record<string, { area: Area; title: string }> = {
      landing: { area: "landing", title: "Landing" }, checkout: { area: "checkout", title: "Checkout" }, pixel: { area: "tracking", title: "Pixel" },
      events: { area: "tracking", title: "Eventos de Meta" }, bumps: { area: "checkout", title: "Bumps" }, post: { area: "postpago", title: "Post-pago" },
      downsells: { area: "postpago", title: "Downsells" }, delivery: { area: "postventa", title: "Entrega" }, webhook: { area: "postventa", title: "Webhook de Stripe" },
      recovery: { area: "checkout", title: "Recuperación de carritos" },
    };
    const live = C.orders + P.orders > 0 || C.landingVisitors + C.checkoutVisitors >= 20;
    for (const a of m.audit) {
      const meta = AUD[a.key];
      if (!meta) continue;
      const noPost = a.key === "post" && a.status === "bad";
      const ppImpact = noPost && C.orders && m.main?.priceUsd ? wk(C.orders * BENCH.oto1.low * m.main.priceUsd) : null;
      add({
        id: `audit.${a.key}.${m.funnelId}`, area: meta.area,
        // Una oferta que no vende ni recibe visitas en la app (todavía cobra en la plataforma anterior): lo mal armado es de baja prioridad.
        severity: !live ? "baja" : a.status === "bad" ? "alta" : a.key === "bumps" || a.key === "downsells" || a.key === "post" || a.key === "pixel" || a.key === "landing" ? "media" : "baja",
        offerKey: ok, storeSlug: ss, funnelSlug: fs, title: `${meta.title}: ${a.label} · ${where}`, metric: a.label,
        benchmark: a.key === "post" ? "3 niveles de OTO, cada uno con su downsell" : a.key === "bumps" ? "2 bumps o más" : null,
        sample: 0, impactUsdWeek: ppImpact, impactHow: ppImpact ? "pedidos × 15 % (el piso de un OTO 1) × precio del principal, como precio de referencia del OTO" : null,
        detail: a.detail ?? a.label,
      });
    }

    // Anuncios de este mercado: Meta ve menos (o más) compras que las reales.
    if (m.ads && C.orders >= 10) {
      const r = m.ads.cur.purchases / C.orders;
      if (r < 0.7 || r > 1.3) add({
        id: `tracking.meta_vs_real.${m.funnelId}`, area: "tracking", severity: r < 0.5 || r > 1.6 ? "alta" : "media", offerKey: ok, storeSlug: ss, funnelSlug: fs,
        title: r < 1 ? `Meta ve menos compras que las reales · ${where}` : `Meta cuenta más compras que las reales · ${where}`,
        metric: `Meta ${Math.round(m.ads.cur.purchases)} compras · Panel ${C.orders} pedidos`, benchmark: "70–130 %: Meta optimiza con las compras que ve; si ve pocas, aprende peor",
        sample: C.orders, detail: `Campañas: ${m.ads.campaignIds.join(", ")}.`,
      });
    }
    if (m.ads && m.landingUrl && !C.landingVisits && m.ads.cur.lpv >= 50) add({
      // Sin pedidos en la app: lo más probable es que la oferta todavía cobre en la plataforma anterior (eso lo decide el dueño).
      id: `tracking.landing_untracked.${m.funnelId}`, area: "tracking", severity: C.orders + P.orders ? "media" : "baja", offerKey: ok, storeSlug: ss, funnelSlug: fs,
      title: `La landing no registra visitas en la app · ${where}`, metric: `Meta: ${Math.round(m.ads.cur.lpv)} visitas a la landing · Panel: 0`,
      benchmark: "las visitas de la app deberían acercarse a las de Meta (la landing tiene que cargar /t.js)", sample: Math.round(m.ads.cur.lpv),
      detail: `${m.landingUrl}: sin el script de la app no se miden visitas, tiempo ni recorrido.${C.orders + P.orders ? "" : " Sin pedidos en la app: si la oferta todavía cobra en la plataforma anterior, es esperable; pasarla o no a la app lo decide el dueño."}`,
    });
  }

  // ---- Anuncios (toda la cuenta, una fila por campaña)
  for (const c of F.campaigns) {
    const C = c.cur, P = c.prev;
    if (!C.spend) continue;
    const t = c.target;
    const where = `«${c.name}»`;
    const base = { offerKey: c.offerKey, storeSlug: c.storeSlug, campaignId: c.id, funnelSlug: c.funnelSlugs[0] ?? null };
    const cpa = C.purchases ? C.spend / C.purchases : null;
    const tText = t ? `objetivo ${t} USD (${c.region === "us" ? "EE. UU." : "Europa"})` : null;
    const real = F.markets.filter((m) => m.ads?.campaignIds.includes(c.id));
    const realOrders = real.reduce((a, m) => a + m.cur.orders, 0);
    const realText = real.length ? ` Pedidos reales en la app: ${realOrders}${realOrders ? ` (CPA real ${usd(C.spend / realOrders)})` : ""}.` : "";
    const ageDays = c.firstSpend ? Math.round((Date.parse(`${F.window.until}T12:00:00Z`) - Date.parse(`${c.firstSpend}T12:00:00Z`)) / 864e5) + 1 : 99;
    if (t && ageDays <= 2) {
      add({ ...base, id: `ads.cpa.${c.id}`, area: "ads", severity: "info", enough: false, title: `CPA de ${where}: pocos datos (arrancó hace ${ageDays} ${ageDays === 1 ? "día" : "días"}, está aprendiendo)`,
        metric: `CPA ${cpa != null ? usd(cpa) : "—"} (${Math.round(C.purchases)} compras, ${usd(C.spend)})`, benchmark: tText, sample: Math.round(C.purchases),
        detail: `Una campaña nueva necesita unos días (y compras) para salir de aprendizaje: todavía no se juzga.${realText}` });
    } else if (t) {
      if (C.spend < t * ADS_MIN.spendForCpa) {
        add({ ...base, id: `ads.cpa.${c.id}`, area: "ads", severity: "info", enough: false, title: `CPA de ${where}: ${few(Math.round(C.spend), t * ADS_MIN.spendForCpa)} USD de gasto`,
          metric: `CPA ${cpa != null ? usd(cpa) : "—"} (${Math.round(C.purchases)} compras, ${usd(C.spend)})`, benchmark: tText, sample: Math.round(C.purchases), detail: "Con menos de 3 CPA de gasto el número todavía se mueve mucho." });
      } else if (!C.purchases) {
        add({ ...base, id: `ads.cpa.${c.id}`, area: "ads", severity: "alta", title: `Gasto sin compras · ${where}`, goal: `compras a ${t} USD o menos, o pausarla`, metric: `${usd(C.spend)} gastados, 0 compras`, benchmark: tText,
          sample: 0, impactUsdWeek: wk(C.spend), impactHow: "todo el gasto de la ventana, llevado a una semana", detail: `Estado: ${c.status ?? "—"}.${realText}` });
      } else if (cpa! > t * 1.15) {
        add({ ...base, id: `ads.cpa.${c.id}`, area: "ads", severity: cpa! > t * 1.5 && C.purchases >= 5 ? "alta" : "media", title: `CPA por encima del objetivo · ${where}`, goal: `CPA de ${t} USD o menos`,
          metric: `CPA ${usd(cpa!)} (${Math.round(C.purchases)} compras, ${usd(C.spend)})`, benchmark: tText, sample: Math.round(C.purchases),
          impactUsdWeek: wk(C.spend - C.purchases * t), impactHow: "gasto − compras × CPA objetivo, llevado a una semana",
          detail: `Antes: ${P.purchases ? `CPA ${usd(P.spend / P.purchases)} (${Math.round(P.purchases)} compras)` : "sin compras"}.${realText} ${c.bestAd ? `Mejor anuncio: «${c.bestAd.name}» a ${usd(c.bestAd.cpa)} (${c.bestAd.purchases} compras).` : ""}`.trim() });
      } else if (cpa! <= t * 0.7 && C.purchases >= 10) {
        add({ ...base, id: `ads.scale.${c.id}`, area: "ads", severity: "baja", good: true, title: `Para escalar: CPA muy por debajo del objetivo · ${where}`,
          metric: `CPA ${usd(cpa!)} (${Math.round(C.purchases)} compras, ${usd(C.spend)})`, benchmark: tText, sample: Math.round(C.purchases),
          detail: `Presupuesto diario: ${c.budget != null ? usd(c.budget) : "—"}.${c.bestAd ? ` Mejor anuncio: «${c.bestAd.name}» a ${usd(c.bestAd.cpa)}.` : ""}` });
      }
    }
    // CPA que empeora contra la semana anterior
    if (C.purchases >= ADS_MIN.purchasesForTrend && P.purchases >= ADS_MIN.purchasesForTrend) {
      const pc0 = P.spend / P.purchases;
      if (cpa! > pc0 * 1.3) add({ ...base, id: `ads.cpatrend.${c.id}`, area: "ads", severity: "media", title: `El CPA subió contra la semana anterior · ${where}`, goal: `volver a un CPA cerca de ${usd(pc0)}${t ? ` (objetivo ${t} USD)` : ""}`,
        metric: `CPA ${usd(cpa!)} ahora · ${usd(pc0)} antes`, benchmark: "estable (±30 %) de una semana a otra", sample: Math.round(C.purchases),
        impactUsdWeek: wk((cpa! - pc0) * C.purchases), impactHow: "(CPA de ahora − CPA de antes) × compras", detail: `CPM ${usd(C.impressions ? (C.spend / C.impressions) * 1000 : 0)} ahora · ${usd(P.impressions ? (P.spend / P.impressions) * 1000 : 0)} antes.` });
    }
    // CTR de enlace
    if (C.impressions) {
      const ctr = C.linkClicks / C.impressions;
      if (C.impressions >= BENCH.ctr.min && ctr < BENCH.ctr.flag) add({ ...base, id: `ads.ctr.${c.id}`, area: "ads", severity: ctr < BENCH.ctr.bad ? "alta" : "media",
        title: `Los anuncios casi no generan clics · ${where}`, metric: `CTR de enlace ${pc(ctr)} (${C.linkClicks.toLocaleString("es-AR")} clics en ${C.impressions.toLocaleString("es-AR")} impresiones)`,
        benchmark: bText(BENCH.ctr), sample: C.impressions, detail: "El gancho (primeros segundos / imagen) no frena el scroll." });
    }
    // CPM
    if (C.impressions >= ADS_MIN.impressionsForCpm && P.impressions >= ADS_MIN.impressionsForCpm) {
      const cpm = (C.spend / C.impressions) * 1000, pcpm = (P.spend / P.impressions) * 1000;
      if (cpm > pcpm * 1.3) add({ ...base, id: `ads.cpm.${c.id}`, area: "ads", severity: "baja", title: `El CPM subió · ${where}`, metric: `CPM ${usd(cpm)} ahora · ${usd(pcpm)} antes`,
        benchmark: "estable (±30 %): si sube, el público se satura o la competencia aprieta", sample: C.impressions, detail: "Creativos nuevos o públicos más amplios suelen bajarlo." });
    }
    // Clics que no llegan a cargar la landing
    if (C.linkClicks >= BENCH.lpvRate.min && C.lpv > 0) {
      const lr = C.lpv / C.linkClicks;
      if (lr < BENCH.lpvRate.flag) add({ ...base, id: `ads.lpv.${c.id}`, area: "landing", severity: lr < BENCH.lpvRate.bad ? "alta" : "media",
        title: `Muchos clics no llegan a ver la landing · ${where}`, metric: `${pc(lr)} de los clics cargan la landing (${Math.round(C.lpv)} de ${C.linkClicks})`,
        benchmark: bText(BENCH.lpvRate), sample: C.linkClicks, impactUsdWeek: wk(C.spend * Math.max(0, (BENCH.lpvRate.low * C.linkClicks - C.lpv) / C.linkClicks)),
        impactHow: "gasto × proporción de clics que se pierden por debajo del 70 %", detail: "La página tarda en cargar en el navegador de Instagram/Facebook, o redirige." });
    }
    // Redes: Instagram contra Facebook
    const ig = c.platforms.find((p) => p.platform === "instagram"), fb = c.platforms.find((p) => p.platform === "facebook");
    if (ig && fb && ig.purchases >= 5 && fb.purchases >= 5) {
      const ci = ig.spend / ig.purchases, cf = fb.spend / fb.purchases;
      const [worse, better, wn, bn] = ci > cf ? [ci, cf, "Instagram", "Facebook"] : [cf, ci, "Facebook", "Instagram"];
      const wp = ci > cf ? ig : fb;
      if (worse > better * 1.4) add({ ...base, id: `ads.network.${c.id}`, area: "ads", severity: "media", title: `${wn} sale mucho más caro que ${bn} · ${where}`,
        metric: `CPA ${wn} ${usd(worse)} (${Math.round(wp.purchases)} compras) · ${bn} ${usd(better)}`, benchmark: "parecidos (±40 %) entre redes", sample: Math.round(ig.purchases + fb.purchases),
        impactUsdWeek: wk((worse - better) * wp.purchases), impactHow: "(CPA de la red cara − CPA de la otra) × compras de la red cara",
        detail: c.platforms.map((p) => `${p.platform}: ${usd(p.spend)}, ${Math.round(p.purchases)} compras`).join(" · ") });
    }
    for (const p of c.platforms) {
      if (p.platform === "instagram" || p.platform === "facebook") continue;
      const floor = (t ?? CPA_TARGET.eu) * 2;
      if (p.spend >= floor && p.purchases === 0) add({ ...base, id: `ads.placement.${p.platform}.${c.id}`, area: "ads", severity: "media",
        title: `Gasto sin compras en ${p.platform} · ${where}`, metric: `${usd(p.spend)} en ${p.platform}, 0 compras`, benchmark: "cada red con gasto tiene que traer compras; si no, se excluye la ubicación",
        sample: 0, impactUsdWeek: wk(p.spend), impactHow: "lo gastado en esa red, llevado a una semana", detail: "Meta reparte solo en ubicaciones Advantage+; se puede excluir." });
    }
    // Anuncios activos que gastan sin vender
    if (c.adsNoSale.length) {
      const s = c.adsNoSale.reduce((a, x) => a + x.spend, 0);
      add({ ...base, id: `ads.nosale.${c.id}`, area: "ads", severity: s >= (t ?? CPA_TARGET.eu) * 4 ? "media" : "baja",
        title: `${c.adsNoSale.length === 1 ? "Un anuncio activo gasta" : `${c.adsNoSale.length} anuncios activos gastan`} sin vender · ${where}`,
        metric: `${usd(s)} sin compras (${c.adsNoSale.slice(0, 3).map((a) => `«${a.name}» ${usd(a.spend)}`).join(", ")})`,
        benchmark: `cada anuncio activo con más de ${ADS_MIN.adNoSale} CPA objetivo de gasto debería tener al menos una compra`, sample: c.adsActive,
        impactUsdWeek: wk(s), impactHow: "lo que gastaron esos anuncios, llevado a una semana", detail: `${c.adsActive} anuncios activos en la campaña.` });
    }
  }

  // ---- Tiendas: mails de compradores y contracargos
  for (const s of F.stores) {
    const access = (s.intents.delivery_problem ?? 0) + (s.intents.access_issue ?? 0);
    if (access >= 5) add({ id: `postventa.mails_access.${s.storeId}`, area: "postventa", severity: access >= 15 ? "alta" : "media", offerKey: null, storeSlug: s.slug,
      title: `Compradores que escriben porque no reciben o no pueden abrir · ${s.name}`, metric: `${access} mails (entrega o acceso) de ${s.mailsIn} recibidos`,
      benchmark: "pocos: si el mail de entrega y el link andan, casi nadie escribe por esto", sample: s.mailsIn, detail: `Clasificados por la IA del buzón: ${Object.entries(s.intents).map(([k, v]) => `${k} ${v}`).join(", ")}.` });
    if ((s.intents.refund_request ?? 0) >= 5) add({ id: `postventa.mails_refund.${s.storeId}`, area: "postventa", severity: "media", offerKey: null, storeSlug: s.slug,
      title: `Pedidos de reembolso por mail · ${s.name}`, metric: `${s.intents.refund_request} mails pidiendo reembolso`, benchmark: "pocos: cada pedido de reembolso suele venir de una expectativa que no se cumplió", sample: s.mailsIn,
      detail: "Mirá los motivos en Mails: si se repiten (no sabía que era PDF, idioma…), se corrige en la landing o el checkout." });
    if (s.unanswered >= 5) add({ id: `postventa.unanswered.${s.storeId}`, area: "postventa", severity: s.unanswered >= 30 ? "alta" : "media", offerKey: null, storeSlug: s.slug,
      title: `Mails de compradores sin responder hace más de 24 h · ${s.name}`, metric: `${s.unanswered} sin responder de ${s.mailsIn}`, benchmark: "0: un comprador sin respuesta es el que termina en contracargo", sample: s.mailsIn,
      detail: "Mails › sin responder." });
    if (s.disputes) add({ id: `postventa.disputes.${s.storeId}`, area: "postventa", severity: "alta", offerKey: null, storeSlug: s.slug, title: `Contracargos · ${s.name}`,
      metric: `${s.disputes} en la ventana`, benchmark: "menos de 0,5 % de los pedidos; Stripe frena la cuenta cerca del 1 %", sample: s.disputes, detail: "Avisos › Contracargo." });
  }

  const sevRank = { alta: 0, media: 1, baja: 2, info: 3 } as const;
  return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (b.impactUsdWeek ?? 0) - (a.impactUsdWeek ?? 0));
}

/** Lo que va a coach_runs.facts: los hallazgos y qué se analizó (sin los datos crudos). */
export function runFacts(F: Facts, analyzed: Map<string, string | null>): RunFacts {
  return {
    window: { since: F.window.since, until: F.window.until, prevSince: F.window.prevSince, prevUntil: F.window.prevUntil, days: F.window.days },
    findings: F.findings,
    notMeasurable: F.notMeasurable,
    offers: F.offers.map((o) => ({ key: o.key, name: o.name, alias: o.alias, storeSlug: o.store.slug, active: o.active, analyzed: analyzed.has(o.key) && analyzed.get(o.key) === null, why: analyzed.get(o.key) ?? undefined })),
    errors: F.errors,
  };
}
