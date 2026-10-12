import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { addDays, dayOf, hourOf, startOfDay } from "./tz";
import { idsOrNone } from "./offers";

/**
 * Números del Inicio: el rango elegido en la zona de la tienda, el período
 * anterior, el total histórico y lo que pasa ahora mismo. Todo en USD al tipo del día (los
 * pedidos se cobran en EUR, USD, BRL…); es referencia, no liquidación.
 *
 * Venta = pedido pagado (los reembolsados no cuentan). El importe es el del
 * pedido (principal + bumps) más los upsells aceptados, que van en su propio
 * cobro: si no, el Inicio diría menos que Pedidos y Métricas.
 */

type Row = {
  id: string; created_at: string; currency: string | null; amount_total: string | number | null; country: string | null;
  order_items: { amount: string | number; currency: string | null }[] | null;
};

async function paidOrders(storeId: string, funnelIds?: string[]) {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("orders")
      .select("id,created_at,currency,amount_total,country,order_items(amount,currency)")
      .eq("store_id", storeId)
      .eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0)
      .eq("order_items.kind", "upsell");
    if (funnelIds) q = q.in("funnel_id", idsOrNone(funnelIds));
    const { data, error } = await q.order("created_at", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`orders: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return out;
  }
}

/**
 * El Inicio para un rango de días (el del selector de fechas). `funnelIds`:
 * solo los checkouts de una oferta o un mercado.
 */
export async function rangeDashboard(storeId: string, tz: string, since: string, until: string, funnelIds?: string[]) {
  const now = new Date();
  const today = dayOf(now, tz);
  const start = startOfDay(since, tz);
  const end = startOfDay(addDays(until, 1), tz);
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const todayStart = startOfDay(today, tz);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const halfHourAgo = new Date(now.getTime() - 30 * 60_000).toISOString();
  const only = funnelIds ? idsOrNone(funnelIds) : null;
  const ckCount = (from: string, to: string | null, open: boolean) => {
    let q = db.from("checkouts").select("id", { count: "exact", head: true }).eq("store_id", storeId).gte(open ? "updated_at" : "created_at", from);
    if (to) q = q.lt("created_at", to);
    if (open) q = q.eq("status", "open");
    if (only) q = q.in("funnel_id", only);
    return q;
  };

  const [rates, orders, ckRange, ckLive] = await Promise.all([
    getRates(),
    paidOrders(storeId, funnelIds),
    ckCount(start.toISOString(), end.toISOString(), false),
    ckCount(halfHourAgo, null, true),
  ]);
  const usd = (n: string | number | null, cur: string | null) => Number(n ?? 0) / (rates[(cur ?? "USD").toUpperCase()] ?? 1);
  const valueOf = (o: Row) =>
    usd(o.amount_total, o.currency) + (o.order_items ?? []).reduce((a, i) => a + usd(i.amount, i.currency ?? o.currency), 0);

  const single = since === until;
  let total = 0, rev = 0, n = 0, prevRev = 0, prevN = 0, lastHour = 0;
  const hours = Array<number>(24).fill(0);
  const ticks: number[] = [];
  const byDay = new Map<string, { revenue: number; orders: number }>();
  const countries = new Map<string, number>();
  for (const o of orders) {
    const at = new Date(o.created_at);
    const v = valueOf(o);
    total += v;
    if (at >= start && at < end) {
      rev += v; n++;
      if (single) {
        const h = hourOf(at, tz);
        hours[Math.min(23, Math.floor(h))]++;
        ticks.push(h);
      }
      const d = dayOf(at, tz);
      const e = byDay.get(d) ?? { revenue: 0, orders: 0 };
      e.revenue += v; e.orders++;
      byDay.set(d, e);
    } else if (at >= prevStart && at < start) { prevRev += v; prevN++; }
    if (at >= hourAgo) lastHour += v;
    if (at >= todayStart && o.country) countries.set(o.country, (countries.get(o.country) ?? 0) + 1);
  }
  const days: { day: string; revenue: number; orders: number }[] = [];
  for (let d = since; d <= until && days.length < 400; d = addDays(d, 1)) days.push({ day: d, ...(byDay.get(d) ?? { revenue: 0, orders: 0 }) });

  const checkouts = ckRange.count ?? 0;
  return {
    since, until, single, today, includesToday: until >= today,
    revenue: rev, orders: n, prevRevenue: prevRev, prevOrders: prevN,
    aov: n ? rev / n : 0,
    checkouts,
    conversion: checkouts ? Math.min(1, n / checkouts) : null,
    totalRevenue: total, firstSaleAt: orders[0]?.created_at ?? null,
    hours, ticks, days,
    nowHour: single && since === today ? hourOf(now, tz) : null,
    live: {
      inCheckout: ckLive.count ?? 0,
      lastHourRevenue: lastHour,
      countriesToday: [...countries.entries()].sort((a, b) => b[1] - a[1]),
    },
  };
}

export type RangeDashboard = Awaited<ReturnType<typeof rangeDashboard>>;

export const usd2 = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
