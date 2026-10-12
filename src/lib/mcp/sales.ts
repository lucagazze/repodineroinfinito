import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { chunks, fetchAll, localDate, r2, type StoreRow } from "./util";

/**
 * Números de ventas para el MCP. Misma base que las métricas del panel
 * (metrics.ts): ingreso del pedido = principal + bumps + upsells (order_items),
 * llevado a USD con el tipo del día. A diferencia del panel, acá los pedidos
 * reembolsados cuentan en el bruto y el reembolso se resta aparte, para que
 * bruto − reembolsos = neto cuadre con Stripe.
 */

export type OrderRow = {
  id: string; number?: number | null; store_id: string; funnel_id: string | null; created_at: string; status: string;
  currency: string | null; amount_total: string | number | null; amount_refunded: string | number | null;
  country: string | null; email: string | null; name: string | null; utm: Record<string, string> | null;
  delivered_at: string | null; delivery_error: string | null;
};
export type ItemRow = {
  order_id: string; product_id: string | null; kind: string; amount: string | number; currency: string | null;
  refunded_amount: string | number | null;
};

const ORDER_COLS = "id,number,store_id,funnel_id,created_at,status,currency,amount_total,amount_refunded,country,email,name,utm,delivered_at,delivery_error";

export async function loadOrders(storeIds: string[] | null, from: Date, to: Date) {
  const orders = await fetchAll<OrderRow>((a, b) => {
    // Nunca los pedidos de una tienda de prueba (llaves de test de Stripe, migración 038).
    let q = db.from("orders").select(ORDER_COLS).eq("is_test", false).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at");
    if (storeIds) q = q.in("store_id", storeIds);
    return q.range(a, b);
  });
  const items: ItemRow[] = [];
  for (const ids of chunks(orders.map((o) => o.id), 200)) {
    items.push(...(await fetchAll<ItemRow>((a, b) =>
      db.from("order_items").select("order_id,product_id,kind,amount,currency,refunded_amount").in("order_id", ids).range(a, b))));
  }
  const byOrder = new Map<string, ItemRow[]>();
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it]);
  return { orders, byOrder };
}

/** Cobrado: pagado o reembolsado después (el cobro existió). */
export const CHARGED = new Set(["paid", "refunded"]);

export function orderMoney(o: OrderRow, items: ItemRow[] | undefined) {
  const cur = (o.currency ?? "USD").toUpperCase();
  const gross = items?.length ? items.reduce((a, i) => a + Number(i.amount), 0) : Number(o.amount_total ?? 0);
  const refunded = Number(o.amount_refunded ?? 0) +
    (items ?? []).filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.refunded_amount ?? 0), 0);
  return { cur, gross, refunded };
}

export async function usdConverter() {
  const rates = await getRates();
  return (amount: number, cur: string | null) => amount / (rates[(cur ?? "USD").toUpperCase()] ?? 1);
}

type Agg = { orders: number; revenue_usd: number };
const bump = (m: Map<string, Agg>, k: string, v: number) => {
  const e = m.get(k) ?? { orders: 0, revenue_usd: 0 };
  e.orders++; e.revenue_usd += v; m.set(k, e);
};
const top = (m: Map<string, Agg>, n = 15) =>
  [...m.entries()].sort((a, b) => b[1].revenue_usd - a[1].revenue_usd).slice(0, n)
    .map(([key, v]) => ({ key, orders: v.orders, revenue_usd: r2(v.revenue_usd) }));

export async function salesSummary(stores: StoreRow[], range: { from: Date; to: Date; timezone: string; label: string }) {
  const storeIds = stores.map((s) => s.id);
  const storeSlug = new Map(stores.map((s) => [s.id, s.slug]));
  const multi = stores.length > 1;
  const toUsd = await usdConverter();

  const [{ orders, byOrder }, products, funnels, bumpItems, checkoutsOpened, events] = await Promise.all([
    loadOrders(storeIds, range.from, range.to),
    fetchAll<{ id: string; slug: string; short_name: string; store_id: string }>((a, b) =>
      db.from("products").select("id,slug,short_name,store_id").in("store_id", storeIds).range(a, b)),
    fetchAll<{ id: string; slug: string; name: string; store_id: string }>((a, b) =>
      db.from("funnels").select("id,slug,name,store_id").in("store_id", storeIds).range(a, b)),
    fetchAll<{ funnel_id: string; product_id: string }>((a, b) =>
      db.from("funnel_items").select("funnel_id,product_id,funnels!inner(store_id)").eq("role", "bump").in("funnels.store_id", storeIds).range(a, b)),
    fetchAll<{ funnel_id: string | null; status: string }>((a, b) =>
      db.from("checkouts").select("funnel_id,status").in("store_id", storeIds)
        .gte("created_at", range.from.toISOString()).lt("created_at", range.to.toISOString()).range(a, b)),
    fetchAll<{ event: string; product_id: string | null; order_id: string }>((a, b) =>
      db.from("upsell_events").select("event,product_id,order_id").in("store_id", storeIds)
        .gte("created_at", range.from.toISOString()).lt("created_at", range.to.toISOString()).range(a, b)),
  ]);

  const pName = new Map(products.map((p) => [p.id, multi ? `${storeSlug.get(p.store_id)}/${p.slug}` : p.slug]));
  const fName = new Map(funnels.map((f) => [f.id, multi ? `${storeSlug.get(f.store_id)}/${f.slug}` : f.slug]));
  const bumpsOf = new Map<string, Set<string>>();
  for (const b of bumpItems) bumpsOf.set(b.funnel_id, new Set([...(bumpsOf.get(b.funnel_id) ?? []), b.product_id]));

  const charged = orders.filter((o) => CHARGED.has(o.status));
  const gross: Record<string, number> = {};
  const refunds: Record<string, number> = {};
  let grossUsd = 0, refundsUsd = 0;
  const byProduct = new Map<string, { units: number; revenue_usd: number; kinds: Set<string> }>();
  const byCountry = new Map<string, Agg>(), byCheckout = new Map<string, Agg>();
  const bySource = new Map<string, Agg>(), byCampaign = new Map<string, Agg>(), byContent = new Map<string, Agg>();
  const byDay = new Map<string, Agg>();
  const byStore = new Map<string, Agg>();
  let withBump = 0, withUpsell = 0;
  const bumpStats = new Map<string, { offered: number; taken: number; revenue_usd: number }>();

  for (const o of charged) {
    const its = byOrder.get(o.id);
    const m = orderMoney(o, its);
    gross[m.cur] = (gross[m.cur] ?? 0) + m.gross;
    if (m.refunded) refunds[m.cur] = (refunds[m.cur] ?? 0) + m.refunded;
    const usd = toUsd(m.gross, m.cur);
    grossUsd += usd;
    refundsUsd += toUsd(m.refunded, m.cur);

    bump(byCountry, o.country ?? "unknown", usd);
    bump(byCheckout, fName.get(o.funnel_id ?? "") ?? "unknown", usd);
    bump(bySource, o.utm?.utm_source || "(none)", usd);
    bump(byCampaign, o.utm?.utm_campaign || "(none)", usd);
    bump(byContent, o.utm?.utm_content || "(none)", usd);
    bump(byDay, localDate(o.created_at, range.timezone), usd);
    if (multi) bump(byStore, storeSlug.get(o.store_id) ?? "?", usd);

    const kinds = new Set((its ?? []).map((i) => i.kind));
    if (kinds.has("bump")) withBump++;
    if (kinds.has("upsell")) withUpsell++;
    for (const it of its ?? []) {
      if (!it.product_id || Number(it.amount) <= 0) continue;
      const k = pName.get(it.product_id) ?? it.product_id;
      const e = byProduct.get(k) ?? { units: 0, revenue_usd: 0, kinds: new Set<string>() };
      e.units++; e.revenue_usd += toUsd(Number(it.amount), it.currency ?? m.cur); e.kinds.add(it.kind);
      byProduct.set(k, e);
    }
    // Take rate de cada bump: sobre los pedidos de checkouts que lo ofrecían.
    for (const pid of bumpsOf.get(o.funnel_id ?? "") ?? []) {
      const k = pName.get(pid) ?? pid;
      const e = bumpStats.get(k) ?? { offered: 0, taken: 0, revenue_usd: 0 };
      e.offered++;
      const hit = (its ?? []).find((i) => i.kind === "bump" && i.product_id === pid);
      if (hit) { e.taken++; e.revenue_usd += toUsd(Number(hit.amount), hit.currency ?? m.cur); }
      bumpStats.set(k, e);
    }
  }

  const upViews = events.filter((e) => e.event === "view");
  const upAccepts = events.filter((e) => e.event === "accept");
  const upByProduct = new Map<string, { views: number; accepts: number; declines: number }>();
  for (const e of events) {
    if (!e.product_id) continue;
    const k = pName.get(e.product_id) ?? e.product_id;
    const r = upByProduct.get(k) ?? { views: 0, accepts: 0, declines: 0 };
    if (e.event === "view") r.views++;
    if (e.event === "accept") r.accepts++;
    if (e.event === "decline") r.declines++;
    upByProduct.set(k, r);
  }
  const accepts = Math.max(upAccepts.length, withUpsell);
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]));
  const net = Object.fromEntries(Object.keys(gross).map((c) => [c, r2(gross[c] - (refunds[c] ?? 0))]));
  const pending = orders.filter((o) => o.status === "pending");

  return {
    range: range.label,
    from_utc: range.from.toISOString(),
    to_utc_exclusive: range.to.toISOString(),
    stores: stores.map((s) => s.slug),
    note: "Amounts in major units (e.g. 19.90). *_usd converted at today's ECB rate (approximate; Stripe payouts differ by FX fees). Order revenue = main + order bumps + 1-click upsells.",
    orders_charged: charged.length,
    orders_fully_refunded: charged.filter((o) => o.status === "refunded").length,
    orders_pending_payment: pending.length,
    gross_by_currency: round(gross),
    refunds_by_currency: round(refunds),
    net_by_currency: net,
    gross_usd: r2(grossUsd),
    refunds_usd: r2(refundsUsd),
    net_usd: r2(grossUsd - refundsUsd),
    aov_usd: charged.length ? r2(grossUsd / charged.length) : 0,
    checkouts_opened: checkoutsOpened.length,
    conversion_rate: checkoutsOpened.length ? r2(charged.length / checkoutsOpened.length) : null,
    order_bumps: {
      orders_with_bump: withBump,
      take_rate: charged.length ? r2(withBump / charged.length) : 0,
      by_bump: [...bumpStats.entries()].map(([product, v]) => ({
        product, offered_in_orders: v.offered, taken: v.taken, take_rate: v.offered ? r2(v.taken / v.offered) : 0, revenue_usd: r2(v.revenue_usd),
      })),
    },
    upsells: {
      views: upViews.length,
      accepts,
      orders_with_upsell: withUpsell,
      acceptance_rate: upViews.length ? r2(Math.min(1, accepts / upViews.length)) : null,
      by_product: [...upByProduct.entries()].map(([product, v]) => ({ product, ...v, rate: v.views ? r2(v.accepts / v.views) : null })),
    },
    top_products: [...byProduct.entries()].sort((a, b) => b[1].revenue_usd - a[1].revenue_usd).slice(0, 20)
      .map(([product, v]) => ({ product, units: v.units, revenue_usd: r2(v.revenue_usd), as: [...v.kinds] })),
    ...(multi ? { by_store: top(byStore, 50) } : {}),
    by_country: top(byCountry),
    by_checkout: top(byCheckout, 30),
    by_utm_source: top(bySource),
    by_utm_campaign: top(byCampaign, 25),
    by_utm_content: top(byContent, 25),
    by_day: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, orders: v.orders, revenue_usd: r2(v.revenue_usd) })),
  };
}
