import { db } from "./db";
import { isRealSale } from "./real-sale";
import { testStoreIds } from "./test-store";
import { getRates } from "./fx";
import { startOfDay } from "./admin/tz";
import { PANEL_TZ } from "./admin/range";

/**
 * Métricas del panel.
 *
 * Todo se lleva a USD con el tipo de cambio del día para poder sumar pedidos
 * en euros, reales y dólares. Es una vista de referencia: lo que liquida
 * Stripe puede diferir por la comisión de conversión.
 */

export const usdFmt = (n: number, decimals = n < 100 ? 2 : 0) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);

export const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export function periodOf(days: number) {
  const d = [7, 30, 90, 365].includes(days) ? days : 30;
  const to = new Date();
  const from = new Date(to.getTime() - d * 864e5);
  const prevFrom = new Date(from.getTime() - d * 864e5);
  return { days: d, from, to, prevFrom };
}

/** Un rango de días cerrado (AAAA-MM-DD, inclusive) en una zona horaria: el selector de fechas del panel. */
export type DayRange = { since: string; until: string; tz: string };

function periodOfRange(r: DayRange) {
  const days = Math.round((Date.parse(`${r.until}T12:00:00Z`) - Date.parse(`${r.since}T12:00:00Z`)) / 864e5) + 1;
  const next = new Date(`${r.until}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const from = startOfDay(r.since, r.tz);
  const to = startOfDay(next.toISOString().slice(0, 10), r.tz);
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  return { days, from, to, prevFrom };
}

/**
 * Trae todas las filas. Supabase corta en 1000 por consulta sin avisar: sin
 * esto, "90 días" de una tienda con 500 ventas por mes daría números
 * recortados que parecen correctos.
 */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

type OrderRow = {
  id: string; created_at: string; status: string; currency: string | null; amount_total: string | null;
  country: string | null; funnel_id: string | null; utm: Record<string, string> | null;
  stripe_payment_intent: string | null; stripe_session_id: string | null; is_test?: boolean | null;
};
type ItemRow = { order_id: string; product_id: string | null; kind: string; amount: string; currency: string | null };
type CheckoutRow = { created_at: string; status: string; email: string | null; amount: string | null; currency: string | null; funnel_id: string | null };
type EventRow = { event: string; product_id: string | null; created_at: string };

/**
 * `funnelIds`: solo esos checkouts (el panel por oferta). Sin pasarlo, toda la
 * tienda (o todas, con storeId null), como siempre.
 */
export async function storeMetrics(storeId: string | null, days: number, funnelIds?: string[], range?: DayRange) {
  // Con `range`, un período cerrado (puede terminar antes de hoy); sin él, los últimos `days` días hasta ahora.
  const P = range ? periodOfRange(range) : periodOf(days);
  const until = P.to.toISOString();
  const rates = await getRates();
  const toUsd = (amount: number, cur: string | null) => amount / (rates[(cur ?? "USD").toUpperCase()] ?? 1);
  const since = P.prevFrom.toISOString();

  // PostgREST no acepta in.() vacío: una lista vacía no tiene que traer todo.
  const only = funnelIds ? (funnelIds.length ? funnelIds : ["00000000-0000-0000-0000-000000000000"]) : null;
  // Todas las tiendas: sin las de prueba (llaves de test de Stripe), ni sus visitas ni sus OTOs.
  const test = storeId ? [] : [...(await testStoreIds())];
  const table = (name: string, cols: string, from: string, funnelCol: string | null = "funnel_id") => {
    let q = db.from(name).select(cols).gte("created_at", from).lt("created_at", until).order("created_at", { ascending: true });
    if (storeId) q = q.eq("store_id", storeId);
    else if (test.length) q = q.not("store_id", "in", `(${test.join(",")})`);
    if (only && funnelCol) q = q.in(funnelCol, only);
    return q;
  };
  const [all, ck, ev] = await Promise.all([
    fetchAll<OrderRow>((a, b) => table("orders", "id,created_at,status,currency,amount_total,country,funnel_id,utm,stripe_payment_intent,stripe_session_id,is_test", since).range(a, b)),
    fetchAll<CheckoutRow>((a, b) => table("checkouts", "created_at,status,email,amount,currency,funnel_id", since).range(a, b)),
    // Los eventos de upsell no tienen checkout: se filtran por el del pedido.
    fetchAll<EventRow>((a, b) => (only
      ? table("upsell_events", "event,product_id,created_at,orders!inner(funnel_id)", P.from.toISOString(), "orders.funnel_id")
      : table("upsell_events", "event,product_id,created_at", P.from.toISOString())).range(a, b)),
  ]);

  const ids = all.map((o) => o.id);
  const items: ItemRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    items.push(...(await fetchAll<ItemRow>((a, b) =>
      db.from("order_items").select("order_id,product_id,kind,amount,currency").in("order_id", chunk).range(a, b))));
  }
  const byOrder = new Map<string, ItemRow[]>();
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it]);

  /** Ingreso real del pedido: principal + bumps + upsells, en USD. */
  const revenueOf = (o: OrderRow) => {
    const its = byOrder.get(o.id);
    if (!its?.length) return toUsd(Number(o.amount_total ?? 0), o.currency);
    return its.reduce((a, it) => a + toUsd(Number(it.amount), it.currency ?? o.currency), 0);
  };

  const inCur = (iso: string) => new Date(iso) >= P.from && new Date(iso) < P.to;
  // Solo ventas con el pago en Stripe y monto (real-sale.ts).
  const paid = all.filter((o) => o.status === "paid" && isRealSale(o));
  const cur = paid.filter((o) => inCur(o.created_at));
  const prev = paid.filter((o) => !inCur(o.created_at));
  const sum = (rows: OrderRow[]) => rows.reduce((a, o) => a + revenueOf(o), 0);

  const ckCur = ck.filter((c) => inCur(c.created_at));
  const ckPrev = ck.filter((c) => !inCur(c.created_at));
  const abandonedCutoff = Date.now() - 30 * 60_000;
  const abandoned = ckCur.filter((c) => c.status === "open" && c.email && new Date(c.created_at).getTime() < abandonedCutoff);

  // ---- serie diaria (semanal en 12 meses) ----
  const bucketDays = P.days > 90 ? 7 : 1;
  const buckets = Math.ceil(P.days / bucketDays);
  const series = Array.from({ length: buckets }, (_, i) => {
    const start = new Date(P.from.getTime() + i * bucketDays * 864e5);
    return { start, label: start.toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: range?.tz ?? PANEL_TZ }), value: 0, prev: 0, orders: 0 };
  });
  const idx = (iso: string, base: Date) => Math.floor((new Date(iso).getTime() - base.getTime()) / (bucketDays * 864e5));
  for (const o of cur) { const i = idx(o.created_at, P.from); if (series[i]) { series[i].value += revenueOf(o); series[i].orders++; } }
  for (const o of prev) { const i = idx(o.created_at, P.prevFrom); if (series[i]) series[i].prev += revenueOf(o); }

  // ---- desgloses del período actual ----
  const add = (m: Map<string, { value: number; count: number }>, k: string, v: number) => {
    const e = m.get(k) ?? { value: 0, count: 0 }; e.value += v; e.count++; m.set(k, e);
  };
  const byProduct = new Map<string, { value: number; count: number }>();
  const byKind = { main: 0, bump: 0, upsell: 0 };
  let ordersWithBump = 0;
  let ordersWithUpsell = 0;
  for (const o of cur) {
    const its = byOrder.get(o.id) ?? [];
    if (its.some((i) => i.kind === "bump")) ordersWithBump++;
    if (its.some((i) => i.kind === "upsell")) ordersWithUpsell++;
    for (const it of its) {
      if (!it.product_id || Number(it.amount) <= 0) continue;
      const v = toUsd(Number(it.amount), it.currency ?? o.currency);
      add(byProduct, it.product_id, v);
      if (it.kind in byKind) byKind[it.kind as keyof typeof byKind] += v;
    }
  }
  const byCountry = new Map<string, { value: number; count: number }>();
  const byFunnel = new Map<string, { value: number; count: number }>();
  const bySource = new Map<string, { value: number; count: number }>();
  for (const o of cur) {
    const v = revenueOf(o);
    add(byCountry, o.country ?? "—", v);
    add(byFunnel, o.funnel_id ?? "—", v);
    add(bySource, (o.utm?.utm_source as string) || "directo / sin UTM", v);
  }
  const visitsByFunnel = new Map<string, number>();
  for (const c of ckCur) visitsByFunnel.set(c.funnel_id ?? "—", (visitsByFunnel.get(c.funnel_id ?? "—") ?? 0) + 1);

  const upsellViews = ev.filter((e) => e.event === "view").length;
  // Las compras salen de los pedidos (fuente de verdad); los eventos solo aportan las vistas,
  // que no quedan en ningún otro lado.
  const upsellAccepts = Math.max(ev.filter((e) => e.event === "accept").length, ordersWithUpsell);
  const upsellByProduct = new Map<string, { views: number; accepts: number }>();
  for (const e of ev) {
    if (!e.product_id) continue;
    const r = upsellByProduct.get(e.product_id) ?? { views: 0, accepts: 0 };
    if (e.event === "view") r.views++; if (e.event === "accept") r.accepts++;
    upsellByProduct.set(e.product_id, r);
  }

  const revenue = sum(cur), revenuePrev = sum(prev);
  const sorted = <K,>(m: Map<K, { value: number; count: number }>) =>
    [...m.entries()].sort((a, b) => b[1].value - a[1].value);

  return {
    period: P,
    revenue, revenuePrev,
    orders: cur.length, ordersPrev: prev.length,
    aov: cur.length ? revenue / cur.length : 0, aovPrev: prev.length ? revenuePrev / prev.length : 0,
    visits: ckCur.length, visitsPrev: ckPrev.length,
    // Quien pagó dejó el email aunque el checkout no lo haya registrado antes.
    leads: Math.max(ckCur.filter((c) => c.email || c.status === "paid").length, cur.length),
    conversion: ckCur.length ? cur.length / ckCur.length : 0,
    conversionPrev: ckPrev.length ? prev.length / ckPrev.length : 0,
    abandonedCount: abandoned.length,
    abandonedValue: abandoned.reduce((a, c) => a + toUsd(Number(c.amount ?? 0), c.currency), 0),
    refunds: all.filter((o) => o.status === "refunded" && isRealSale(o) && inCur(o.created_at)).length,
    byKind, ordersWithBump,
    bumpRate: cur.length ? ordersWithBump / cur.length : 0,
    ordersWithUpsell,
    upsellViews, upsellAccepts, upsellRate: upsellViews ? Math.min(1, upsellAccepts / upsellViews) : 0,
    upsellByProduct,
    series,
    topProducts: sorted(byProduct),
    countries: sorted(byCountry),
    funnels: sorted(byFunnel),
    visitsByFunnel,
    sources: sorted(bySource),
  };
}

export type Metrics = Awaited<ReturnType<typeof storeMetrics>>;
