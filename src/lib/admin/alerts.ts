import { db } from "@/lib/db";
import { isRealSale } from "@/lib/real-sale";
import { queuePush } from "@/lib/push";

/**
 * Avisos (tabla alerts, migración 023) que nacen del panel. Uno por
 * (kind, ref_id): si el problema vuelve se reabre el mismo; si se arregla se
 * cierra solo. Sin la tabla, no hace nada.
 */

/**
 * Productos activos que se venden o se entregan sin link de entrega
 * («missing_link»): avisa los que faltan y cierra los que ya lo tienen.
 */
export async function syncMissingLinks(storeId: string, missing: { id: string; name: string; link: string; body?: string }[], fine: string[]) {
  try {
    const now = new Date().toISOString();
    if (missing.length) {
      await db.from("alerts").upsert(missing.map((p) => ({
        store_id: storeId, kind: "missing_link", severity: "warn", ref_id: p.id, resolved_at: null,
        title: `Falta el link de entrega: ${p.name}`,
        body: p.body ?? "Se vende (o va dentro de una compra) y no tiene delivery_url, delivery_links ni archivo propio: el mail de entrega sale sin botón de descarga. Cargarlo con upsert_product.",
        link: p.link,
      })), { onConflict: "kind,ref_id" });
    }
    if (fine.length) {
      await db.from("alerts").update({ resolved_at: now }).eq("kind", "missing_link").in("ref_id", fine).is("resolved_at", null);
    }
  } catch (e) {
    console.error("[alerts] missing_link:", (e as Error).message);
  }
}

/**
 * Pedidos «pagados» o «reembolsados» sin el pago en Stripe (sin
 * payment_intent ni sesión) o con monto 0/vacío: no son ventas y no se
 * muestran como tales (real-sale.ts). Cada uno queda en Avisos como «Pedido
 * sin pago en Stripe» hasta que se corrija o se borre. Lo corre el cron de
 * Meta (cada 15 min).
 */
export async function syncUnpaidOrders() {
  try {
    const { data, error } = await db.from("orders")
      .select("id,store_id,status,email,amount_total,currency,stripe_payment_intent,stripe_session_id,created_at")
      .in("status", ["paid", "refunded"])
      .or("and(stripe_payment_intent.is.null,stripe_session_id.is.null),amount_total.is.null,amount_total.lte.0")
      .limit(200);
    if (error) throw new Error(error.message);
    const bad = (data ?? []).filter((o) => !isRealSale(o));
    if (bad.length) {
      const { data: fresh } = await db.from("alerts").upsert(bad.map((o) => ({
        store_id: o.store_id, kind: "order_unpaid", severity: "error", ref_id: o.id, resolved_at: null,
        title: `Pedido sin pago en Stripe${o.email ? `: ${o.email}` : ""}`,
        body: `Figura como ${o.status === "paid" ? "pagado" : "reembolsado"} pero ${!o.stripe_payment_intent && !o.stripe_session_id ? "no tiene pago en Stripe" : "el monto es 0 o está vacío"}. No se cuenta como venta en ningún lado. Si es una prueba o un error, borralo o pasalo a status test.`,
        link: `/admin/avisos/pedido/${o.id}`,
      })), { onConflict: "kind,ref_id", ignoreDuplicates: true }).select("ref_id");
      // Push «unpaid» solo de los nuevos (el upsert ignora los que ya estaban).
      for (const n of fresh ?? []) {
        const o = bad.find((x) => x.id === n.ref_id);
        queuePush("unpaid", {
          title: "⚠️ Pedido sin pago en Stripe", body: o?.email ? "Figura pagado sin cobro" : "Panel",
          named: { title: "⚠️ Pedido sin pago en Stripe", body: o?.email ?? "Figura pagado sin cobro" },
          url: `/admin/avisos/pedido/${n.ref_id}`, tag: `unpaid:${n.ref_id}`,
        });
      }
    }
    // Los que ya no están así (se corrigieron o se borraron) se cierran solos.
    const { data: open } = await db.from("alerts").select("ref_id").eq("kind", "order_unpaid").is("resolved_at", null).limit(500);
    const still = new Set(bad.map((o) => o.id));
    const fixed = (open ?? []).map((a) => a.ref_id as string).filter((id) => id && !still.has(id));
    if (fixed.length) await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("kind", "order_unpaid").in("ref_id", fixed);
    return { open: bad.length, closed: fixed.length };
  } catch (e) {
    console.error("[alerts] order_unpaid:", (e as Error).message);
    return { open: 0, closed: 0 };
  }
}
