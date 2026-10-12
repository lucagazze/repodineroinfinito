import { db } from "./db";
import { pixelsFor } from "./meta";

/**
 * Pixels y evento Purchase para la primera pantalla después de pagar (oferta o
 * gracias). Mismo eventID que la API de Conversiones: Meta cuenta una compra.
 */
export async function purchasePixel(order: { id: string; store_id: string; funnel_id: string | null }) {
  const { data: o } = await db
    .from("orders")
    .select("stripe_payment_intent,amount_total,currency,status,funnels(pixel_ids),order_items(kind,products(slug))")
    .eq("id", order.id)
    .single();
  if (!o || o.status !== "paid" || !o.stripe_payment_intent) return { pixels: [] as string[], events: [] };
  const pixels = (await pixelsFor(order.store_id, (o.funnels as unknown as { pixel_ids?: string[] } | null)?.pixel_ids)).map((p) => p.pixel_id);
  const items = (o.order_items ?? []) as unknown as { kind: string; products: { slug: string } | null }[];
  return {
    pixels,
    events: [{
      name: "Purchase",
      eventID: o.stripe_payment_intent,
      params: {
        value: Number(o.amount_total ?? 0),
        currency: (o.currency ?? "USD").toUpperCase(),
        content_type: "product",
        content_ids: items.filter((x) => x.kind === "main" || x.kind === "bump").map((x) => x.products?.slug).filter(Boolean),
      },
    }],
  };
}
