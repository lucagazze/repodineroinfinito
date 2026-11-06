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

// --------------------------------------------- la referencia de la pasarela

/** Prefijo con que se guarda un pago de Whop. Espejo de `PREFIJO` en whop-events.ts. */
export const WHOP_PREFIX = "whop:";
/** Prefijo de una compra de prueba del panel. Espejo de `TEST_PREFIX` en test-purchase.ts. */
export const TEST_REF_PREFIX = "test_";

/** Un pago de Whop, por descarte: no es nuestro ni de Stripe. */
const esWhopRef = (ref: string) =>
  !ref.startsWith("pi_") && !ref.startsWith("cs_") && !ref.startsWith(TEST_REF_PREFIX);

/**
 * La columna y el valor con que se busca en `orders` una referencia que vuelve
 * por la URL.
 *
 * EXISTE PORQUE ESTA CUENTA SE HIZO DOS VECES Y LA SEGUNDA ESTABA MAL. Un pago
 * de Whop se guarda con el prefijo `whop:` adelante, pero por la URL viaja SIN
 * el prefijo. La busqueda de `order-lookup` se lo agregaba; `/api/upsell`
 * tenia su propia version de dos lineas que no, asi que buscaba `pay_xxx`
 * donde estaba guardado `whop:pay_xxx` y contestaba 403 «Pedido no valido».
 *
 * Medido el 6/11/2026: la pagina de la oferta abria bien --la arma la busqueda
 * buena-- y el cobro fallaba SIEMPRE. Los dos unicos compradores que dijeron
 * que si en toda la vida de la tienda se comieron ese 403, y el post-pago
 * figuraba como «nadie compra» cuando en realidad nadie PODIA.
 *
 * Vive aca, en el modulo sin dependencias, para que se pueda probar sola.
 */
export function orderRefColumn(ref: string) {
  const col = ref.startsWith("cs_") || ref.startsWith(TEST_REF_PREFIX)
    ? ("stripe_session_id" as const)
    : ("stripe_payment_intent" as const);
  return { col, value: esWhopRef(ref) ? WHOP_PREFIX + ref : ref };
}
