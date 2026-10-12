import { db } from "./db";

export type UpsellEvent = "view" | "accept" | "decline" | "fail";

/**
 * Anota qué pasó con una oferta post-compra. Uno por pedido, producto y tipo:
 * recargar la pantalla no infla las vistas.
 */
export async function logUpsellEvent(e: {
  storeId: string; orderId: string; ppFunnelId: string | null; productId: string; event: UpsellEvent;
}) {
  await db.from("upsell_events").upsert(
    { store_id: e.storeId, order_id: e.orderId, pp_funnel_id: e.ppFunnelId, product_id: e.productId, event: e.event },
    { onConflict: "order_id,product_id,event", ignoreDuplicates: true }
  );
}
