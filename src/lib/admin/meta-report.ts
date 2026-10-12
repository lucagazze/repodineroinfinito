import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { addDays, dayOf, startOfDay } from "./tz";

/**
 * El reporte de Meta Ads del inicio: las cuentas publicitarias de las tiendas
 * (stores.meta_ad_account_id), el gasto por día de cada una y lo que
 * cobramos nosotros en las mismas tiendas. Las campañas, conjuntos y anuncios
 * con sus métricas por ventana salen de meta-perf.ts. Solo lectura.
 *
 * Meta corta los días en la zona horaria de la cuenta publicitaria (no se
 * puede pedir otra); el panel cuenta los nuestros en hora de Londres.
 */

/** Las cuentas publicitarias de las tiendas, sin repetir, con las tiendas que usan cada una. */
export async function adAccounts() {
  const { data } = await db.from("stores").select("id,meta_ad_account_id").not("meta_ad_account_id", "is", null);
  const m = new Map<string, string[]>();
  for (const s of data ?? []) {
    const act = `act_${String(s.meta_ad_account_id).replace(/^act_/, "")}`;
    m.set(act, [...(m.get(act) ?? []), s.id]);
  }
  return [...m].map(([id, storeIds]) => ({ id, storeIds }));
}

/**
 * Lo que cobraron NUESTROS pedidos de esas tiendas (principal + bumps + OTOs,
 * menos reembolsos) por día del panel, en USD, con la comisión de Stripe
 * estimada (2,9 % + US$ 0,30 por cobro) y la cantidad de pedidos.
 */
export async function ourRevenueByDay(storeIds: string[], tz: string, since: string, until: string, funnelIds?: string[]) {
  const rates = await getRates();
  const from = startOfDay(since, tz).toISOString();
  const to = startOfDay(addDays(until, 1), tz).toISOString();
  const byDay = new Map<string, number>();
  let orders = 0, fees = 0, refunded = 0;
  if (!storeIds.length) return { byDay, orders, revenue: 0, fees, refunded };
  for (let i = 0; ; i += 1000) {
    let q = db.from("orders")
      .select("created_at,currency,amount_total,amount_refunded,order_items(kind,amount,currency,refunded_amount)")
      .in("store_id", storeIds).in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0)
      .gte("created_at", from).lt("created_at", to).range(i, i + 999);
    if (funnelIds) q = q.in("funnel_id", funnelIds.length ? funnelIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q;
    if (error) throw new Error(`orders: ${error.message}`);
    for (const o of data ?? []) {
      const usd = (n: unknown, c?: string | null) => Number(n ?? 0) / (rates[(c ?? o.currency ?? "USD").toUpperCase()] ?? 1);
      const items = (o.order_items ?? []) as { kind: string; amount: number; currency: string | null; refunded_amount: number | null }[];
      const ups = items.filter((it) => it.kind === "upsell");
      const gross = items.length ? items.reduce((a, it) => a + usd(it.amount, it.currency), 0) : usd(o.amount_total);
      const back = usd(o.amount_refunded) + ups.reduce((a, it) => a + usd(it.refunded_amount, it.currency), 0);
      const fee = (n: number) => (n > 0 ? n * 0.029 + 0.3 : 0);
      fees += fee(usd(o.amount_total)) + ups.reduce((a, it) => a + fee(usd(it.amount, it.currency)), 0);
      refunded += back;
      const d = dayOf(new Date(o.created_at), tz);
      byDay.set(d, (byDay.get(d) ?? 0) + Math.max(0, gross - back));
      orders++;
    }
    if ((data ?? []).length < 1000) break;
  }
  return { byDay, orders, revenue: [...byDay.values()].reduce((a, b) => a + b, 0), fees, refunded };
}
