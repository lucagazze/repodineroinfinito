/**
 * El impuesto que la pasarela suma DESPUES del total que muestra el checkout.
 *
 * EL PROBLEMA QUE ESTO ARREGLA (medido el 6/11/2026). La app no sabe nada de
 * impuestos: manda `totalCents` a Whop y Whop le suma el IVA segun el pais.
 * En el Reino Unido eso son 20 puntos que el comprador no veia por ningun
 * lado -- el checkout decia «Pay £13.99» y la tarjeta terminaba cobrando
 * £16,79. Comprobado contra los dos unicos pedidos reales en libras, al
 * centavo:
 *
 *     13,99 × 1,20                      = 16,79   y se cobro 16,79
 *     (13,99 + 5,99 + 11,99 + 9,99) × 1,20 = 50,35   y se cobro 50,35
 *
 * Con 105 checkouts abiertos y 11 pagados (10,5 %), una sorpresa del 20 % en
 * el ultimo paso es la explicacion mas limpia. Ademas, en el Reino Unido el
 * precio que se le muestra a un consumidor tiene que llevar el IVA incluido.
 *
 * ESTO NO CAMBIA LO QUE SE COBRA NI LO QUE ENTRA. El importe que viaja a la
 * pasarela sigue siendo el de siempre (sin impuesto); lo unico que cambia es
 * que el numero en pantalla ya es el final. El IVA nunca fue de Bruno: lo
 * recauda la pasarela y lo gira al fisco.
 *
 * POR QUE LA TABLA ES CORTA, Y POR QUE CONVIENE QUE LO SIGA SIENDO. Solo
 * figura el pais donde el recargo esta VERIFICADO contra pedidos reales.
 * Estados Unidos y Australia estan medidos en cero: muestran 17,99 y A$25,90
 * y cobran exactamente eso. De la Union Europea no hay un solo pedido, asi
 * que poner una tasa de memoria seria volver a crear el mismo defecto --
 * un numero en pantalla que no coincide con el cobro-- nada mas que al reves.
 * Un pais entra aca cuando hay un cobro real que lo confirme.
 */

/** Tasa verificada contra cobros reales. Pais en ISO-3166 alfa-2. */
const TASAS: Record<string, number> = {
  GB: 0.2, // IVA britanico. Confirmado 6/11/2026 contra dos pedidos.
};

/** La tasa que la pasarela va a sumar, o 0 si no suma nada. */
export const vatRate = (country: string | null | undefined): number =>
  (country ? TASAS[country.toUpperCase()] : 0) ?? 0;

/** El impuesto sobre un importe, redondeado a centavos. */
export const vatOn = (amount: number, country: string | null | undefined): number =>
  Math.round(amount * vatRate(country) * 100) / 100;

/** El importe tal como lo va a ver la tarjeta. */
export const withVat = (amount: number, country: string | null | undefined): number =>
  Math.round((amount + vatOn(amount, country)) * 100) / 100;
