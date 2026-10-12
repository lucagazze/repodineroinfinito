"use client";

import { useEffect } from "react";
import { startPresence, type Page } from "@/lib/track-client";

/**
 * Presencia en una página pública para el panel «En vivo» y site_events:
 * view al entrar, heartbeat cada 20 s y leave al irse. No dibuja nada.
 *   <Track page="oferta" store="mitienda" funnel="my-offer-kit" order={order.id} />
 * Con solo `order` alcanza: el servidor saca la tienda y el checkout del pedido.
 * `off` en las vistas previas y simulaciones del panel. Los eventos sueltos
 * (oto_accept, oto_decline, download) van con track() de @/lib/track-client.
 */
export function Track({ page, store, funnel, order, off }: {
  page: Page; store?: string | null; funnel?: string | null; order?: string | null; off?: boolean;
}) {
  useEffect(() => {
    if (off) return;
    return startPresence(page, { store, funnel, order });
  }, [page, store, funnel, order, off]);
  return null;
}

export default Track;
