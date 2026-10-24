import { db } from "@/lib/db";
import { metaKpis } from "./meta-kpis";
import { PANEL_TZ } from "./range";
import { addDays, dayOf, startOfDay } from "./tz";
import { getRates } from "@/lib/fx";

/**
 * La plata de un período
 *  - Facturado, comisiones, reembolsos y neto: los movimientos REALES de las cuentas de Stripe de
 *    las tiendas (stripe_balance_txns, sincronizados cada 15 min). Incluye lo que todavía cobra
 *    la plataforma anterior con esas mismas cuentas. Sin las tiendas de EXCLUDED_STORES ni las
 *    tiendas de prueba.
 *  - Gasto en anuncios: todo lo que gastó la cuenta de Meta en esas fechas.
 * Las fechas son días de Argentina (las de Meta también: la cuenta está en hora de Argentina).
 */
export type Money = {
  since: string; until: string;
  /** Compras: los cobros de una misma persona en la misma tienda con menos de 1 h entre uno y otro (principal + bumps + OTOs) cuentan como UNA. */
  orders: number;
  /** Cobros sueltos en Stripe (cada OTO es uno aparte). */
  charges: number;
  gross: number;
  fees: number;
  /** Siempre «real» (sale de Stripe); queda el campo por compatibilidad con la fila de plata. */
  feesSource: "real" | "mixed" | "estimated";
  refunded: number; refunds: number;
  net: number;
  /** null: Meta todavía no tiene datos guardados. */
  spend: number | null;
  campaigns: number;
  idleSpend: number;
  unlinkedSpend: number;
  unlinkedCampaigns: number;
  profit: number;
};

/** Un día del período: lo mismo que Money, día por día (para los gráficos de Métricas). */
export type MoneyDay = { date: string; gross: number; orders: number; fees: number; refunded: number; net: number; spend: number; profit: number };

/** Tiendas que no suman: las de EXCLUDED_STORES y las de prueba (Stripe en modo test). */
const EXCLUDED = new Set((process.env.EXCLUDED_STORES ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export async function moneyFor(since: string, until: string): Promise<Money> {
  return (await moneyDetail(since, until)).money;
}

/** La plata del período y, día por día, lo mismo (los días sin nada, en cero). */
export async function moneyDetail(since: string, until: string): Promise<{ money: Money; days: MoneyDay[] }> {
  const from = startOfDay(since, PANEL_TZ).toISOString();
  const to = startOfDay(addDays(until, 1), PANEL_TZ).toISOString();
  const [{ data: stores }, rates, meta] = await Promise.all([
    db.from("stores").select("id,slug"),
    getRates(),
    metaKpis(since, until),
  ]);
  const storeIds = (stores ?? []).filter((s) => !EXCLUDED.has(s.slug as string)).map((s) => s.id as string);
  const usd = (n: unknown, cur: unknown) => (Number(n) || 0) / (rates[String(cur ?? "USD").toUpperCase()] ?? 1);

  type D = { gross: number; orders: number; fees: number; refunded: number };
  // Para contar compras: el último cobro de cada persona (tienda + email); si el nuevo llega dentro de 1 h, es la misma compra.
  const lastOf = new Map<string, number>();
  let charges = 0;
  const byDay: Record<string, D> = {};
  let gross = 0, fees = 0, refunded = 0, orders = 0, refunds = 0;
  for (let i = 0; storeIds.length; i += 1000) {
    const { data, error } = await db.from("stripe_balance_txns")
      .select("store_id,reporting_category,type,amount,fee,currency,created_at,buyer")
      .in("store_id", storeIds).gte("created_at", from).lt("created_at", to)
      .order("created_at").range(i, i + 999);
    if (error) throw new Error(`stripe_balance_txns: ${error.message}`);
    for (const t of data ?? []) {
      const cat = String(t.reporting_category ?? t.type);
      const d = (byDay[dayOf(new Date(t.created_at as string), PANEL_TZ)] ??= { gross: 0, orders: 0, fees: 0, refunded: 0 });
      if (cat === "charge") {
        const a = usd(t.amount, t.currency), f = usd(t.fee, t.currency);
        gross += a; fees += f; charges++;
        d.gross += a; d.fees += f;
        const who = t.buyer ? `${t.store_id}:${t.buyer}` : null;
        const at = Date.parse(t.created_at as string);
        const prev = who ? lastOf.get(who) : undefined;
        if (prev == null || at - prev > 3600_000) { orders++; d.orders++; }
        if (who) lastOf.set(who, at);
      } else if (cat === "refund" || cat === "dispute" || cat === "partial_capture_reversal") {
        // Devoluciones y contracargos: restan (el monto viene negativo); su comisión también se paga.
        const a = -usd(t.amount, t.currency), f = usd(t.fee, t.currency);
        refunded += a; fees += f; if (cat === "refund") refunds++;
        d.refunded += a; d.fees += f;
      } else if (cat === "fee") {
        // Cobros sueltos de Stripe que no van atados a una venta (Radar, facturación, etc.): también son comisión.
        const f = -usd(t.amount, t.currency);
        fees += f; d.fees += f;
      }
    }
    if (!data || data.length < 1000) break;
  }

  // ----------------------------------------------------------------- Whop
  //
  // Hasta aca todo salio de stripe_balance_txns. Las tiendas que cobran con
  // Whop no aparecen ahi, asi que el panel mostraba US$ 0 con ventas reales
  // entrando: el dueño veia «Sin cobros» y un beneficio negativo que era solo
  // el gasto de Meta. Physics y Finance pasaron a Whop y toda su plata era
  // invisible.
  //
  // Whop no da un libro mayor como el balance de Stripe, asi que la fuente es
  // la tabla de pedidos, que es la que la app llena cuando el webhook entrega:
  //   amount_total  lo cobrado, en la moneda del comprador
  //   net_amount    lo que queda despues de la comision, cuando Whop lo informa
  //   amount_refunded / refunded_at  las devoluciones
  // La comision se DERIVA (cobrado - neto) en vez de estimarse con un
  // porcentaje: un numero inventado en una fila de «Comisiones» es peor que
  // ninguno. Si Whop no mando el neto, esa venta suma al bruto y no a la
  // comision, y feesSource baja a "mixed" para que el panel lo diga.
  let whopVentas = 0, sinNeto = 0;
  for (let i = 0; storeIds.length; i += 1000) {
    const { data, error } = await db.from("orders")
      .select("store_id,currency,amount_total,net_amount,amount_refunded,refunded_at,created_at,status,is_test")
      .in("store_id", storeIds).eq("provider", "whop").eq("status", "paid").eq("is_test", false)
      .gte("created_at", from).lt("created_at", to)
      .order("created_at").range(i, i + 999);
    if (error) throw new Error(`orders (whop): ${error.message}`);
    for (const o of data ?? []) {
      const dia = dayOf(new Date(o.created_at as string), PANEL_TZ);
      const d = (byDay[dia] ??= { gross: 0, orders: 0, fees: 0, refunded: 0 });
      const a = usd(o.amount_total, o.currency);
      gross += a; orders++; charges++; whopVentas++;
      d.gross += a; d.orders++;
      const neto = o.net_amount == null ? null : usd(o.net_amount, o.currency);
      if (neto == null) sinNeto++;
      else { const f = Math.max(0, a - neto); fees += f; d.fees += f; }
      const dev = usd(o.amount_refunded, o.currency);
      if (dev > 0) { refunded += dev; d.refunded += dev; if (o.refunded_at) refunds++; }
    }
    if (!data || data.length < 1000) break;
  }

  const spend = meta.fetchedAt != null || meta.cur.spend > 0 ? meta.cur.spend : null;
  const campaigns = Object.values(meta.byCampaign).filter((n) => n.spend > 0).length;
  const net = gross - fees - refunded;
  const money: Money = {
    // "mixed" cuando alguna venta de Whop llego sin su neto: ahi la comision
    // de esa venta no se puede derivar y el total queda corto. El panel lo
    // dice en vez de presentar un numero incompleto como si fuera exacto.
    since, until, orders, charges, gross, fees,
    feesSource: sinNeto > 0 ? "mixed" : "real", refunded, refunds, net,
    spend, campaigns, idleSpend: 0, unlinkedSpend: 0, unlinkedCampaigns: 0, profit: net - (spend ?? 0),
  };

  const spendDay = new Map(meta.days.map((d) => [d.date, d.spend]));
  const days: MoneyDay[] = [];
  for (let d = since; d <= until && days.length < 400; d = addDays(d, 1)) {
    const b = byDay[d] ?? { gross: 0, orders: 0, fees: 0, refunded: 0 };
    const n = b.gross - b.fees - b.refunded;
    const sp = spendDay.get(d) ?? 0;
    days.push({ date: d, gross: b.gross, orders: b.orders, fees: b.fees, refunded: b.refunded, net: n, spend: sp, profit: n - sp });
  }
  return { money, days };
}
