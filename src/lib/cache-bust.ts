import { revalidateTag } from "next/cache";
import { db } from "./db";
import { checkoutTag } from "./checkout-data";
import { catalogTag } from "./catalog";
import { STORES_TAG, storeTag, pixelsTag } from "./admin/store";
import { OFFERS_TAG } from "./admin/offers";

/**
 * Después de un cambio hecho por el MCP o un script: que el checkout, el
 * catálogo y el panel muestren lo nuevo ya, sin esperar a que venza la caché.
 * Son pocas tiendas: se invalida todo, es más simple que adivinar qué tocó.
 */
export async function invalidateEverything() {
  revalidateTag(checkoutTag());
  revalidateTag(STORES_TAG);
  revalidateTag(OFFERS_TAG);
  const { data } = await db.from("stores").select("id,slug");
  for (const s of data ?? []) {
    revalidateTag(storeTag(s.slug));
    revalidateTag(pixelsTag(s.id));
    revalidateTag(catalogTag(s.slug));
    revalidateTag(checkoutTag(s.slug));
  }
}
