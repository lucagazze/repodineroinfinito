import { createHash } from "crypto";

/**
 * La clave de idempotencia de un cobro con Whop.
 *
 * Para que sirva tiene que cumplir las DOS cosas a la vez:
 *   - el MISMO pedido repetido no cobra dos veces (doble clic, reintento de
 *     red, el navegador que manda el POST otra vez);
 *   - un pedido NUEVO sí se cobra.
 *
 * EL ERROR QUE ESTO ARREGLA: la clave era `co_<checkout>` pelada, o sea la
 * misma para toda la vida de la fila del checkout. El `confirmation_token`, en
 * cambio, es DE UN SOLO USO y el formulario mina uno nuevo en cada intento.
 * Entonces el segundo intento llegaba con la misma clave y un cuerpo distinto,
 * y Whop contesta `400 This Idempotency-Key was already used with a different
 * request`. Dicho de otro modo: **el primer intento fallido mataba el
 * checkout**, y el texto que se le muestra al comprador cuando el banco pide
 * verificar es justamente «tocá Pagar de nuevo». Medido el 4/11/2026 en
 * maths-illustrated (GB): verificación del banco sin completar -> «Pagar» otra
 * vez -> 400 -> se fue sin comprar.
 *
 * Atando la clave al token, la identidad de la clave es la del pedido: mismo
 * token y mismo importe = mismo cobro; token nuevo = cobro nuevo.
 */
export function claveIdem(args: {
  checkoutId: string | null;
  confirmationToken: string;
  amountCents: number;
  currency: string;
}): string {
  const huella = createHash("sha256")
    .update([args.confirmationToken, args.amountCents, args.currency.toLowerCase()].join("|"))
    .digest("hex")
    .slice(0, 24);
  // El prefijo del checkout no hace falta para la idempotencia: está para que
  // la clave se pueda rastrear hasta su fila cuando Whop la devuelve en un error.
  return args.checkoutId ? `co_${args.checkoutId}:${huella}` : `ct_${huella}`;
}
