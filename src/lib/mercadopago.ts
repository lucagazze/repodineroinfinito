/**
 * Cliente de Mercado Pago: suscripciones por `preapproval`.
 *
 * QUE HACE ESTE ARCHIVO Y QUE NO
 *   Solo habla con la API de Mercado Pago. No toca la base, no decide a quien
 *   darle acceso y no manda mails. Lo que entra a la base pasa por
 *   `sub_cobro` / `sub_fallo`, igual que con Whop.
 *
 * POR QUE `preapproval` Y NO «pagos automaticos»
 *   Mercado Pago tiene dos productos distintos:
 *     · Suscripciones (`/preapproval`): cobra solo, en su ciclo, sin que el
 *       comprador intervenga. NO pide permiso especial. Es esto.
 *     · Pagos automaticos (MIT, `CREDENTIAL_ON_FILE` + `unscheduled`): cobra un
 *       monto cualquiera en cualquier momento sobre una tarjeta guardada, y
 *       PIDE autorizacion del equipo comercial. Eso es lo que haria falta para
 *       el salto de 27 -> 29, y esta bloqueado hasta que la den.
 *   El camino obvio -- Checkout API con tarjetas guardadas -- no sirve para
 *   nada automatico: «debes capturar nuevamente el codigo de seguridad (CVV)
 *   de la tarjeta, ya que Mercado Pago no almacena este dato». Es el diseno del
 *   producto, no un detalle de implementacion.
 *
 * SIN PLAN ASOCIADO, A PROPOSITO
 *   Se crea el preapproval con el monto y la frecuencia ADENTRO, en vez de dar
 *   de alta un plan primero. Asi no hay un id de plan que mantener sincronizado
 *   con el precio de la base -- que es exactamente el problema que ya existe
 *   con `whop_plan_id`, donde el precio del plan y el de la base tienen que
 *   coincidir a mano o el cobro falla.
 */

const API = "https://api.mercadopago.com";

// ------------------------------------------------------------------ llamadas

type Metodo = "GET" | "POST" | "PUT";

async function llamar<T>(
  token: string, metodo: Metodo, ruta: string,
  cuerpo?: unknown, idempotencia?: string,
): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      // Mercado Pago acepta esta cabecera para que un reintento de red no cree
      // dos suscripciones. Sin ella, un timeout del lado nuestro sobre una
      // peticion que SI llego deja al comprador con dos cobros mensuales.
      ...(idempotencia ? { "x-idempotency-key": idempotencia } : {}),
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const texto = await r.text();
  if (!r.ok) {
    // El cuerpo del error entra en el mensaje a proposito: Mercado Pago explica
    // el motivo ahi (`message`, `cause`), y sin eso diagnosticar un cobro que
    // no salio es a ciegas.
    throw new Error(`Mercado Pago ${metodo} ${ruta} -> HTTP ${r.status}: ${texto.slice(0, 400)}`);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

// ------------------------------------------------------------- la frecuencia

export type Frecuencia = { frequency: number; frequency_type: "days" | "months" };

/**
 * De «cada N dias» a lo que entiende Mercado Pago.
 *
 * TIRA en vez de aproximar. Mercado Pago solo expresa `days` y `months`, y
 * aproximar en silencio significa cobrarle al suscriptor en fechas que no son
 * las que dice la pagina. 30 dias se mandan como UN MES y no como 30 dias a
 * proposito: doce ciclos de 30 dias son 360, asi que con `days` se cobraria
 * 12,17 veces al año y la fecha de renovacion caminaria hacia atras por el
 * calendario. Lo que promete el producto es «mensual».
 */
export function frecuenciaDe(dias: number): Frecuencia {
  switch (dias) {
    case 7: return { frequency: 7, frequency_type: "days" };
    case 14: return { frequency: 14, frequency_type: "days" };
    case 30:
    case 31: return { frequency: 1, frequency_type: "months" };
    case 90: return { frequency: 3, frequency_type: "months" };
    case 365:
    case 366: return { frequency: 12, frequency_type: "months" };
    default:
      throw new Error(
        `no se sabe expresar un ciclo de ${dias} dias en Mercado Pago. ` +
        `Acepta days y months; agregalo a frecuenciaDe() con la equivalencia pensada, ` +
        `no lo aproximes.`,
      );
  }
}

// ----------------------------------------------------------- el preapproval

/** Lo que devuelve Mercado Pago al crear o leer una suscripcion. */
export type Preapproval = {
  id: string;
  status: string;
  init_point?: string | null;
  external_reference?: string | null;
  payer_email?: string | null;
  payer_id?: number | null;
  reason?: string | null;
  next_payment_date?: string | null;
  date_created?: string | null;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
  } | null;
};

/**
 * Crear la suscripcion.
 *
 * `status: "pending"` y sin tarjeta: Mercado Pago devuelve un `init_point` y el
 * comprador va alla a poner la tarjeta. Es el camino sin PCI -- no pasamos
 * nunca por un numero de tarjeta, igual que con Whop.
 *
 * `external_reference` es lo que despues permite saber de QUE producto es este
 * preapproval, y es obligatorio en las suscripciones sin plan. Va el id del
 * producto: la renovacion llega un mes despues, cuando no hay ninguna sesion
 * ni metadata nuestra que leer, y el unico dato estable es este.
 */
export async function crearPreapproval(token: string, p: {
  productId: string;
  razon: string;
  email: string;
  monto: number;
  moneda: string;
  dias: number;
  volverA: string;
  /** Clave de idempotencia. Si dos clics crean dos peticiones, una sola suscripcion. */
  idempotencia?: string;
}): Promise<Preapproval> {
  const f = frecuenciaDe(p.dias);
  return llamar<Preapproval>(token, "POST", "/preapproval", {
    reason: p.razon,
    external_reference: p.productId,
    payer_email: p.email,
    back_url: p.volverA,
    status: "pending",
    auto_recurring: {
      frequency: f.frequency,
      frequency_type: f.frequency_type,
      transaction_amount: p.monto,
      currency_id: p.moneda.toUpperCase(),
    },
  }, p.idempotencia);
}

export const leerPreapproval = (token: string, id: string) =>
  llamar<Preapproval>(token, "GET", `/preapproval/${encodeURIComponent(id)}`);

/**
 * Cancelar la suscripcion del lado de Mercado Pago.
 *
 * SIN ESTO LA BAJA NO DETIENE EL COBRO. Mismo razonamiento que
 * `cancelarEnWhop`: la baja de nuestra base es una anotacion, no una orden.
 *
 * ATENCION, LO UNICO QUE QUEDA SIN VERIFICAR DE ESTE ARCHIVO:
 *   su documentacion dice que `status: "cancelled"` cancela, pero NO dice si
 *   corta en el acto o al terminar el periodo pagado. `sub_baja` esta escrito
 *   suponiendo que el suscriptor conserva el acceso hasta
 *   `current_period_end`, que es lo que promete la pagina de baja. Si Mercado
 *   Pago corta en el acto, lo nuestro sigue siendo correcto -- le damos acceso
 *   que ya pago -- pero hay que medirlo en el sandbox antes de vender esto.
 */
export const cancelarPreapproval = (token: string, id: string) =>
  llamar<Preapproval>(token, "PUT", `/preapproval/${encodeURIComponent(id)}`,
    { status: "cancelled" });

export const pausarPreapproval = (token: string, id: string) =>
  llamar<Preapproval>(token, "PUT", `/preapproval/${encodeURIComponent(id)}`,
    { status: "paused" });

// ------------------------------------------------------- el pago recurrente

/**
 * Una factura del motor de recurrencia: el cobro del mes.
 *
 * Campos confirmados en su referencia: id, type, status, date_created,
 * last_modified, preapproval_id, transaction_amount, retry_attempt, debit_date.
 * `payment` anidado aparece en implementaciones pero no lo pude confirmar en su
 * documentacion, asi que se lee de forma opcional.
 */
export type PagoAutorizado = {
  id: number | string;
  preapproval_id?: string | null;
  type?: string | null;
  status?: string | null;
  date_created?: string | null;
  debit_date?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  retry_attempt?: number | null;
  next_retry_date?: string | null;
  payment?: { id?: number | string; status?: string | null; status_detail?: string | null } | null;
};

export const leerPagoAutorizado = (token: string, id: string) =>
  llamar<PagoAutorizado>(token, "GET", `/authorized_payments/${encodeURIComponent(id)}`);

export type Clasificacion = "cobrado" | "rechazado" | "desconocido";

/**
 * ¿Este pago recurrente entro o se rechazo?
 *
 * LO QUE NO ESTA VERIFICADO, Y POR QUE NO SE ADIVINA
 *   No pude encontrar en la documentacion accesible de Mercado Pago la lista
 *   cerrada de valores de `status` de un pago autorizado. Los de abajo salen de
 *   su nomenclatura general de pagos y de implementaciones de terceros.
 *
 *   Adivinar aca cuesta plata en los DOS sentidos: tomar un rechazo por un
 *   cobro regala acceso, y tomar un cobro por un rechazo deja a alguien que
 *   pago sin lo que compro -- que termina en reembolso y queja.
 *
 *   Por eso lo que no se reconoce NO se interpreta: devuelve «desconocido», y
 *   quien llama lo deja crudo en la bitacora para mirarlo. Con cero
 *   suscriptores, el primer webhook del sandbox dice la verdad gratis. Ese es
 *   el momento de cerrar esta lista y borrar este comentario.
 *
 * Se mira primero el `payment.status` anidado cuando viene: es el estado del
 * COBRO. El `status` de arriba es el de la factura, que puede decir
 * «processed» de una factura cuyo pago se rechazo.
 */
export function clasificarPago(p: PagoAutorizado): Clasificacion {
  const interno = (p.payment?.status ?? "").toLowerCase();
  if (interno) {
    if (interno === "approved") return "cobrado";
    if (["rejected", "cancelled", "refunded", "charged_back"].includes(interno)) return "rechazado";
    return "desconocido";
  }
  const estado = (p.status ?? "").toLowerCase();
  if (["approved", "processed"].includes(estado)) return "cobrado";
  if (["rejected", "cancelled", "recycling"].includes(estado)) return "rechazado";
  return "desconocido";
}

/** El importe del cobro, o null si no vino legible. */
export function montoDe(p: PagoAutorizado): number | null {
  const n = Number(p.transaction_amount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** De quien es esta llave, para comprobarla antes de guardarla. */
export const verCuenta = (token: string) =>
  llamar<{ id?: number; nickname?: string; email?: string; site_id?: string }>(
    token, "GET", "/users/me");
