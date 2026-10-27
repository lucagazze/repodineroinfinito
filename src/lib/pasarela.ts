import type { Store } from "./db";

/**
 * Con qué pasarela se cobra.
 *
 * POR QUE EXISTE UNA FUNCION PARA UNA LINEA
 *   La regla estaba repetida en quince sitios como `s.gateway === "whop"`, y
 *   una regla repetida es una regla que diverge. Ya diverjo una vez: el cobro
 *   de un clic del post-pago no leia `stores.gateway` sino que adivinaba por
 *   que conexion tenia la tienda, y con una tercera pasarela habria cobrado a
 *   la tarjeta equivocada. Se arreglo el 26/10/2026 leyendo `orders.provider`.
 *
 *   Aqui la regla queda en UN sitio. Hoy devuelve exactamente lo mismo que
 *   antes; el dia que haya una tercera pasarela, cambia este archivo y no
 *   quince.
 *
 * LAS DOS PREGUNTAS SON DISTINTAS, Y CONFUNDIRLAS FUE EL FALLO
 *   - `pasarelaDeTienda`: con que cobra esta tienda. Es configuracion.
 *   - `pasarelaDePedido`: con que se cobro ESTE pedido. Es historia, y es lo
 *     unico valido para volver a cobrarle a alguien que ya pago.
 *
 *   Nunca se usa la primera donde corresponde la segunda.
 */
export type Pasarela = "stripe" | "whop" | "mercadopago";

export const PASARELAS: readonly Pasarela[] = ["stripe", "whop", "mercadopago"] as const;

function esPasarela(v: unknown): v is Pasarela {
  return typeof v === "string" && (PASARELAS as readonly string[]).includes(v);
}

/**
 * Con qué cobra una tienda. Es un dato de la tienda y NO se deduce de qué
 * conexión existe: durante una migración las dos conviven, y adivinar por
 * presencia haría cobrar a la que se conectó último.
 */
export function pasarelaDeTienda(store: Pick<Store, "gateway"> | null | undefined): Pasarela {
  // Se valida contra la lista en vez de comparar con una: mientras hubo dos
  // pasarelas, `gateway === "whop" ? "whop" : "stripe"` daba lo mismo, pero con
  // una tercera mandaba a Stripe cualquier tienda que no fuera Whop -- o sea,
  // una tienda de Mercado Pago habria intentado cobrar por Stripe.
  return esPasarela(store?.gateway) ? store!.gateway as Pasarela : "stripe";
}

/**
 * Con qué se cobró un pedido. Para cualquier cobro posterior sobre una tarjeta
 * ya guardada -- el post-pago de un clic, una renovación, un reembolso -- esta
 * es la única respuesta correcta, aunque la tienda haya cambiado de pasarela
 * desde entonces.
 */
export function pasarelaDePedido(order: { provider?: string | null } | null | undefined): Pasarela {
  return esPasarela(order?.provider) ? order.provider : "stripe";
}

/**
 * Con qué va a cobrar ESTE comprador, antes de que exista un pedido.
 *
 * Hoy la respuesta es siempre la de la tienda, y el país no se usa. El
 * parámetro está en la firma a propósito: es el único dato que haría falta
 * para enrutar por país, y tenerlo ya en los sitios que llaman significa que
 * el día que se agregue Mercado Pago no hay que ir a buscarlo a quince
 * lugares.
 *
 * LA REGLA VIVE EN `stores.gateway_by_country`, y no en los settings del
 * embudo: `resolveSettings` solo valida booleanos, numeros y cadenas, asi que
 * una lista de reglas metida ahi se descartaria EN SILENCIO -- el enrutado no
 * funcionaria y no habria ni un error que lo delatara. Por eso se espero a
 * tener una segunda pasarela viva antes de elegir donde guardarla.
 *
 * PARA QUE SIRVE DE VERDAD
 *   No es una preferencia estetica: es que a Bruno no todas las pasarelas le
 *   pagan. A un comprador argentino hay que cobrarle por Mercado Pago, que
 *   deposita en una cuenta argentina; al resto, por la que cobre en dolares.
 *   Sin esto hay que elegir una sola y perder el otro mercado.
 */
export function pasarelaParaComprador(
  store: Pick<Store, "gateway" | "gateway_by_country"> | null | undefined,
  pais?: string | null,
): Pasarela {
  const cc = pais?.trim().toUpperCase();
  const regla = cc ? store?.gateway_by_country?.[cc] : null;
  // Una regla que nombra una pasarela que no existe se ignora, no rompe: el
  // comprador cae en la de la tienda y la venta sigue viva.
  if (esPasarela(regla)) return regla;
  return pasarelaDeTienda(store);
}
