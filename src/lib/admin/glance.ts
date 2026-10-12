import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { PANEL_TZ } from "./range";
import { addDays, dayOf, startOfDay } from "./tz";
import { fetchAll } from "@/lib/fetch-all";

/**
 * Los números que se miran de un vistazo, de las compras reales (pagadas o
 * reembolsadas; nunca las de prueba) de un período: ventas, facturado neto
 * (principal + bumps + OTOs, en USD, menos reembolsos), ticket promedio,
 * reembolsos, comisiones de Stripe estimadas y cuántos tomaron el bump y
 * cada OTO (1, 2, 3) o su downsell. Por tienda y por checkout también.
 */

export type LevelRate = { level: number; kind: "oto" | "downsell"; shown: number; accepted: number };
export type Glance = {
  /** gross: lo cobrado (principal + bumps + OTOs) antes de reembolsos; revenue: lo mismo, menos lo devuelto. */
  orders: number; gross: number; revenue: number; fees: number; refunds: number; refunded: number; bumpOrders: number;
  levels: LevelRate[];
  byStore: Record<string, { orders: number; revenue: number; bumpOrders: number; refunds: number }>;
  byFunnel: Record<string, { orders: number; revenue: number }>;
  /** Comisión estimada (USD) de cada cobro: el PaymentIntent del pedido y el de cada OTO cobrado aparte. */
  feeByPi: Record<string, number>;
  /** El día (de Argentina, el del panel) de cada uno de esos cobros: el del pedido. */
  dayByPi: Record<string, string>;
  /** Por día del pedido: cobrado, pedidos, devuelto y la comisión estimada de los cobros sin PaymentIntent. */
  byDay: Record<string, { gross: number; orders: number; refunded: number; feesNoPi: number }>;
};

type Item = { kind: string; amount: number | string; currency: string | null; refunded_amount: number | string | null; product_id: string | null; stripe_payment_intent?: string | null };
type O = { id: string; created_at: string; store_id: string; funnel_id: string | null; pp_funnel_id: string | null; status: string; currency: string | null;
  amount_total: number | string | null; amount_refunded: number | string | null; stripe_payment_intent?: string | null; order_items: Item[] | null };

export async function glance({ storeIds, funnelIds, since, until }: { storeIds?: string[] | null; funnelIds?: string[] | null; since: string; until: string }): Promise<Glance> {
  const rates = await getRates();
  const from = startOfDay(since, PANEL_TZ).toISOString();
  const to = startOfDay(addDays(until, 1), PANEL_TZ).toISOString();
  const rows: O[] = [];
  for (let i = 0; ; i += 1000) {
    let q = db.from("orders")
      .select("id,created_at,store_id,funnel_id,pp_funnel_id,status,currency,amount_total,amount_refunded,stripe_payment_intent,order_items(kind,amount,currency,refunded_amount,product_id,stripe_payment_intent)")
      .in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0).gte("created_at", from).lt("created_at", to).range(i, i + 999);
    if (storeIds) q = q.in("store_id", storeIds.length ? storeIds : ["00000000-0000-0000-0000-000000000000"]);
    if (funnelIds) q = q.in("funnel_id", funnelIds.length ? funnelIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q;
    if (error) throw new Error(`orders: ${error.message}`);
    rows.push(...((data ?? []) as unknown as O[]));
    if ((data ?? []).length < 1000) break;
  }

  const g: Glance = { orders: 0, gross: 0, revenue: 0, fees: 0, refunds: 0, refunded: 0, bumpOrders: 0, levels: [], byStore: {}, byFunnel: {}, feeByPi: {}, dayByPi: {}, byDay: {} };
  const fee = (n: number) => (n > 0 ? n * 0.029 + 0.3 : 0);
  for (const o of rows) {
    const usd = (n: unknown, c?: string | null) => Number(n ?? 0) / (rates[(c ?? o.currency ?? "USD").toUpperCase()] ?? 1);
    const items = o.order_items ?? [];
    const ups = items.filter((it) => it.kind === "upsell");
    const gross = items.length ? items.reduce((a, it) => a + usd(it.amount, it.currency), 0) : usd(o.amount_total);
    const back = usd(o.amount_refunded) + ups.reduce((a, it) => a + usd(it.refunded_amount, it.currency), 0);
    const net = Math.max(0, gross - back);
    const bump = items.some((it) => it.kind === "bump");
    g.orders++; g.gross += gross; g.revenue += net; g.refunded += back; if (back > 0) g.refunds++;
    g.fees += fee(usd(o.amount_total)) + ups.reduce((a, it) => a + fee(usd(it.amount, it.currency)), 0);
    const day = dayOf(new Date(o.created_at), PANEL_TZ);
    const dd = (g.byDay[day] ??= { gross: 0, orders: 0, refunded: 0, feesNoPi: 0 });
    dd.gross += gross; dd.orders++; dd.refunded += back;
    if (o.stripe_payment_intent) { g.feeByPi[o.stripe_payment_intent] = fee(usd(o.amount_total)); g.dayByPi[o.stripe_payment_intent] = day; }
    else dd.feesNoPi += fee(usd(o.amount_total));
    for (const it of ups) {
      if (it.stripe_payment_intent) { g.feeByPi[it.stripe_payment_intent] = fee(usd(it.amount, it.currency)); g.dayByPi[it.stripe_payment_intent] = day; }
      else dd.feesNoPi += fee(usd(it.amount, it.currency));
    }
    if (bump) g.bumpOrders++;
    const s = (g.byStore[o.store_id] ??= { orders: 0, revenue: 0, bumpOrders: 0, refunds: 0 });
    s.orders++; s.revenue += net; if (bump) s.bumpOrders++; if (back > 0) s.refunds++;
    const f = (g.byFunnel[o.funnel_id ?? ""] ??= { orders: 0, revenue: 0 });
    f.orders++; f.revenue += net;
  }

  // Post-pago: a cuántos se les mostró cada nivel y cuántos aceptaron (upsell_events + pp_steps).
  const ids = rows.map((o) => o.id);
  const ppIds = [...new Set(rows.map((o) => o.pp_funnel_id).filter((x): x is string => !!x))];
  if (ids.length && ppIds.length) {
    const evs: { order_id: string; product_id: string | null; pp_funnel_id: string | null; event: string }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("upsell_events").select("order_id,product_id,pp_funnel_id,event").in("order_id", ids.slice(i, i + 200));
      evs.push(...(data ?? []));
    }
    const st = await fetchAll<{ id: string; pp_funnel_id: string; product_id: string; sort_order: number; kind: string | null; downsell_of: string | null; level: number | null }>((a, b) =>
      db.from("pp_steps").select("id,pp_funnel_id,product_id,sort_order,kind,downsell_of,level").in("pp_funnel_id", ppIds).order("id").range(a, b));
    const step = new Map<string, { kind: "oto" | "downsell"; level: number }>();
    for (const pp of ppIds) {
      const mine = ((st ?? []) as { id: string; pp_funnel_id: string; product_id: string; sort_order: number; kind: string | null; downsell_of: string | null; level: number | null }[])
        .filter((r) => r.pp_funnel_id === pp).sort((a, b) => a.sort_order - b.sort_order);
      const otos = mine.filter((r) => (r.kind ?? "oto") === "oto");
      const lvl = new Map(otos.map((r, i) => [r.id, r.level ?? i + 1]));
      for (const r of mine) {
        const ds = r.kind === "downsell";
        step.set(`${pp}|${r.product_id}`, { kind: ds ? "downsell" : "oto", level: ds ? r.level ?? lvl.get(r.downsell_of ?? "") ?? 1 : lvl.get(r.id) ?? 1 });
      }
    }
    const ppOf = new Map(rows.map((o) => [o.id, o.pp_funnel_id]));
    const shown = new Map<string, Set<string>>(), took = new Map<string, Set<string>>();
    const put = (m: Map<string, Set<string>>, k: string, order: string) => m.set(k, (m.get(k) ?? new Set()).add(order));
    for (const e of evs) {
      const s = step.get(`${e.pp_funnel_id ?? ppOf.get(e.order_id)}|${e.product_id}`);
      if (!s) continue;
      const k = `${s.kind}|${s.level}`;
      if (e.event === "view") put(shown, k, e.order_id);
      if (e.event === "accept") { put(took, k, e.order_id); put(shown, k, e.order_id); }
    }
    // Lo aceptado también sale del pedido (los eventos pueden faltar).
    for (const o of rows) for (const it of (o.order_items ?? []).filter((x) => x.kind === "upsell")) {
      const s = step.get(`${o.pp_funnel_id}|${it.product_id}`);
      if (!s) continue;
      const k = `${s.kind}|${s.level}`;
      put(took, k, o.id); put(shown, k, o.id);
    }
    g.levels = [...shown.keys()].map((k) => {
      const [kind, level] = k.split("|");
      return { kind: kind as "oto" | "downsell", level: Number(level), shown: shown.get(k)!.size, accepted: took.get(k)?.size ?? 0 };
    }).sort((a, b) => a.level - b.level || (a.kind === "oto" ? -1 : 1));
  }
  return g;
}
