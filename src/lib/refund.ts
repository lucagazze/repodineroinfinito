import { db } from "./db";
import { dashboardUrl, stripeForStore } from "./stripe";
import { fromMinor, toMinor } from "./fx";
import { orderRef } from "./order-ref";

/**
 * Reembolso de un pedido desde el panel (decisión del dueño en el buzón). Misma
 * lógica que refund_order del MCP: sin monto, todo el pago principal y cada
 * upsell; con monto, parcial del pago principal.
 *
 * Algunas cuentas piden aprobar en el dashboard de Stripe los
 * reembolsos hechos por API: el reembolso queda «pending»/«requires_action»
 * y se avisa con el link para aprobarlo.
 */

export type RefundOutcome = {
  order: string; currency: string; requested: number;
  refunds: { payment: string; refund_id: string; status: string; amount: number }[];
  skipped: string[]; failed: string[];
  /** Algún reembolso quedó esperando aprobación en el dashboard de Stripe. */
  needs_approval: boolean;
  dashboard: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que queda por devolver: pago principal + upsells (moneda del pedido). */
export async function refundableOf(orderId: string) {
  const [{ data: o }, { data: ups }] = await Promise.all([
    db.from("orders").select("currency,amount_total,amount_refunded,status").eq("id", orderId).maybeSingle(),
    db.from("order_items").select("amount,refunded_amount,stripe_payment_intent").eq("order_id", orderId).eq("kind", "upsell"),
  ]);
  if (!o) return null;
  const main = r2(Number(o.amount_total ?? 0) - Number(o.amount_refunded ?? 0));
  const upsells = r2((ups ?? []).reduce((a, u) => a + Math.max(Number(u.amount ?? 0) - Number(u.refunded_amount ?? 0), 0), 0));
  return { currency: (o.currency ?? "USD").toUpperCase(), main, upsells, total: r2(main + upsells), status: o.status as string };
}

export async function refundOrder(orderId: string, opts: { amount?: number; source: string }): Promise<RefundOutcome> {
  const { data: o } = await db.from("orders").select("id,number,store_id,status,currency,amount_total,amount_refunded,stripe_payment_intent").eq("id", orderId).maybeSingle();
  if (!o) throw new Error("No existe el pedido.");
  if (o.status !== "paid") throw new Error(`El pedido está «${o.status}»: no hay nada para reembolsar.`);
  const cur = (o.currency ?? "USD").toUpperCase();
  const left = r2(Number(o.amount_total ?? 0) - Number(o.amount_refunded ?? 0));
  if (opts.amount !== undefined && opts.amount > left) throw new Error(`Quedan ${left} ${cur} por devolver del pago principal.`);
  const { data: ups } = await db.from("order_items").select("stripe_payment_intent").eq("order_id", orderId).eq("kind", "upsell");
  const conn = await stripeForStore(o.store_id);

  const jobs: { pi: string; minor?: number; what: string }[] = [];
  if (o.stripe_payment_intent) jobs.push({ pi: o.stripe_payment_intent, minor: opts.amount !== undefined ? toMinor(opts.amount, cur) : undefined, what: "principal" });
  if (opts.amount === undefined) {
    for (const u of ups ?? []) if (u.stripe_payment_intent && u.stripe_payment_intent !== o.stripe_payment_intent) jobs.push({ pi: u.stripe_payment_intent, what: "upsell" });
  }
  if (!jobs.length) throw new Error("El pedido no tiene pagos de Stripe.");

  const out: RefundOutcome = { order: orderRef(o), currency: cur, requested: opts.amount ?? left, refunds: [], skipped: [], failed: [], needs_approval: false, dashboard: [] };
  const done = toMinor(Number(o.amount_refunded ?? 0), cur);
  for (const j of jobs) {
    try {
      const r = await conn.stripe.refunds.create(
        { payment_intent: j.pi, ...(j.minor ? { amount: j.minor } : {}), reason: "requested_by_customer", metadata: { source: opts.source, order: orderId } },
        { idempotencyKey: `panel-refund-${j.pi}-${j.minor ?? "full"}-${done}` }
      );
      out.refunds.push({ payment: j.what, refund_id: r.id, status: r.status ?? "unknown", amount: fromMinor(r.amount, r.currency) });
      if (r.status !== "succeeded") { out.needs_approval = true; out.dashboard.push(dashboardUrl(conn, j.pi)); }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "charge_already_refunded") out.skipped.push(`${j.what}: ya estaba reembolsado`);
      else {
        out.failed.push(`${j.what}: ${err.message}`);
        out.dashboard.push(dashboardUrl(conn, j.pi));
      }
    }
  }
  return out;
}
