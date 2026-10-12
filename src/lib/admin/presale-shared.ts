/** Tipos y textos de Preventas que usan el servidor y el navegador (sin base de datos). */

/** «entregado»: listo y avisado a todos (o listo sin nadie esperando): ya no es tarea, se ve aparte. */
export type PresaleState = "sin_ventas" | "a_tiempo" | "vence_pronto" | "atrasado" | "listo_sin_avisar" | "entregado";

/** Un PDF verificado en la carpeta: un PDF de verdad y con peso de libro (no el aviso). */
export type ReadyFile = { id: string; title: string; bytes: number | null };

export type PresaleRow = {
  id: string; slug: string; name: string; image: string | null;
  storeId: string; storeName: string;
  days: number;
  since: string | null; readyAt: string | null;
  deliveryUrl: string | null;
  /** Los productos que son este libro: él, sus variantes y los packs que lo incluyen. */
  productIds: string[];
  /** Pedidos pagados que lo llevan. */
  orders: string[];
  /** De esos, a cuántos todavía no se les avisó que está (solo cuenta una vez listo). */
  pendingNotice: number;
  firstSale: string | null;
  due: string | null;
  hoursLeft: number | null;
  state: PresaleState;
  /** Los PDF que se verificaron al darlo por terminado (nombre, id de Drive y peso). */
  readyFiles: ReadyFile[];
  /** El aviso de preventa que sigue en la carpeta junto al libro terminado: hay que borrarlo antes de avisar. */
  leftoverNotices: { id: string; title: string }[];
  /** Lo prometido: cuántas páginas y el índice planificado (para quien lo escriba). */
  plannedPages: number | null;
  plannedOutline: string | null;
  /** Cuándo se mandó el último aviso «ya está» a los compradores. */
  noticedAt: string | null;
  /** En qué ofertas se vende (y cómo: bump, bonus, OTO), para saber de dónde es cada libro. */
  offers: { name: string; role: string }[];
};

/** «vence en 2 d 5 h», «vence en 3 h», «atrasado 1 d». */
export function dueText(r: Pick<PresaleRow, "hoursLeft" | "state">) {
  if (r.hoursLeft == null) return "sin ventas todavía";
  const h = Math.abs(r.hoursLeft);
  const t = h >= 24 ? `${Math.floor(h / 24)} d${Math.round(h % 24) ? ` ${Math.round(h % 24)} h` : ""}` : `${Math.max(1, Math.round(h))} h`;
  return r.hoursLeft <= 0 ? `atrasado ${t}` : `vence en ${t}`;
}
