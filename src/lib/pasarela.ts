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
 * La REGLA de enrutado -- qué países van a qué pasarela -- sigue sin
 * guardarse, y sigue siendo deliberado: `resolveSettings` solo valida
 * booleanos, numeros y cadenas, asi que una lista de reglas metida ahi se
 * descartaria en silencio. Ahora que Mercado Pago existe como modulo, lo que
 * falta para decidirlo es una tienda cobrando por el de verdad: recien
 * entonces se sabe si la regla es por pais, por moneda o por producto.
 */
export function pasarelaParaComprador(
  store: Pick<Store, "gateway"> | null | undefined,
  _pais?: string | null,
): Pasarela {
  return pasarelaDeTienda(store);
}
