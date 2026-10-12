/**
 * El número de pedido que ve todo el mundo (panel, mails, gracias, push): «#1001».
 * Lo pone la base al crear el pedido (migración 036, correlativo desde 1001).
 * Las compras de prueba del panel no llevan número: «T-81324400».
 * La referencia vieja (los primeros 8 del id) sigue sirviendo para buscar:
 * hay mails y links ya enviados con ella.
 *
 * Sin base de datos: lo usan también componentes del navegador.
 */
export type Numbered = { id: string; number?: number | string | null; status?: string | null };

/** La referencia vieja: «81324400». */
export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Sin «#»: «1001». Prueba: «T-81324400». Sin número todavía: la referencia vieja. */
export function orderNo(o: Numbered): string {
  if (o.number != null && String(o.number) !== "") return String(o.number);
  return o.status === "test" ? `T-${shortId(o.id)}` : shortId(o.id);
}

/** Para mostrar: «#1001». Prueba: «T-81324400». */
export function orderRef(o: Numbered): string {
  const n = orderNo(o);
  return n.startsWith("T-") ? n : `#${n}`;
}

/** Lo mismo para una fila con el pedido embebido (`orders(number,status)` de PostgREST). */
export function embeddedRef(id: string, emb: unknown): string {
  const o = (Array.isArray(emb) ? emb[0] : emb) as { number?: number | null; status?: string | null } | null | undefined;
  return orderRef({ id, number: o?.number, status: o?.status });
}

/** «#1001», «1001»: el número que escribió alguien en un buscador o en un mail. null si no es uno. */
export function parseOrderNumber(q: string): number | null {
  const m = /^#?\s*(\d{1,12})$/.exec(q.trim());
  return m ? Number(m[1]) : null;
}
