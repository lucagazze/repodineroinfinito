import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verificacion de firma de los webhooks de Mercado Pago.
 *
 * Vive aparte de mercadopago.ts por la misma razon que whop-firma.ts: validar
 * una firma no tiene por que depender de la base, y separado se puede probar
 * sin red ni entorno (scripts/check-mercadopago-firma.mjs). Es la unica pieza
 * que separa un cobro real de alguien mandando un POST que dice «pague».
 *
 * COMO FIRMA MERCADO PAGO, Y QUE ESTA MEDIDO DE ESO
 *   Manda dos cabeceras:
 *     x-signature:  ts=1704908010,v1=618c85...
 *     x-request-id: un identificador de la entrega
 *   y el id del recurso NO va en el cuerpo sino en el QUERY STRING de la URL,
 *   como `?data.id=...&type=...`. Eso esta confirmado en su documentacion.
 *
 *   Lo que su documentacion NO escribe es la plantilla que se firma. Dice que
 *   se usa «HMAC-based Webhook Signature Verification» y muestra una funcion
 *   que recibe (xSignature, xRequestId, dataId, secret), pero nunca pone la
 *   cadena. La plantilla de abajo sale de sus SDK y de varias
 *   implementaciones que coinciden entre si:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 *   HMAC-SHA256, comparado en hexadecimal.
 *
 *   Como no esta en la fuente oficial, no se apuesta a una sola forma: se
 *   prueban las variantes plausibles y se DEVUELVE cual coincidio, para que el
 *   primer webhook real diga la verdad y despues se pueda dejar solo esa. Es
 *   el mismo criterio con el que whop-firma.ts resuelve la ambiguedad de su
 *   clave, y el mismo con el que `membresiaDe` prueba formas y guarda el crudo.
 *
 *   Esto no debilita nada: todas las variantes salen del MISMO secreto, y sin
 *   el secreto no se puede producir ninguna.
 */

/** Desfase maximo que aceptamos en un webhook. Mas que eso es un reenvio. */
export const TOLERANCIA_SEGUNDOS = 5 * 60;

export type Variante = "estandar" | "id-minuscula" | "sin-request-id";

/**
 * El `ts` de Mercado Pago viene en segundos O en milisegundos.
 *
 * NO es una suposicion defensiva: sus dos paginas de documentacion muestran
 * ejemplos distintos — `ts=1704908010` (10 digitos, segundos) y
 * `ts=1742505638683` (13 digitos, milisegundos). Tomar una de las dos y
 * comparar contra el reloj rechazaria TODOS los webhooks de la otra forma por
 * un desfase de decadas.
 *
 * Importante: esto normaliza solo la comprobacion de FRESCURA. La firma se
 * calcula siempre con el `ts` tal como llego, byte por byte, porque es lo que
 * Mercado Pago firmo.
 */
export function tsAMilisegundos(ts: string): number | null {
  if (!/^\d{1,}$/.test(ts)) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 1e12 ms = 2001; 1e12 s = año 33658. El corte distingue sin ambiguedad
  // cualquier fecha que un webhook pueda traer.
  return n < 1e12 ? n * 1000 : n;
}

/** Saca `ts` y `v1` de la cabecera `x-signature`. */
export function partirFirma(cabecera: string): { ts?: string; v1?: string } {
  const out: { ts?: string; v1?: string } = {};
  for (const trozo of cabecera.split(",")) {
    const i = trozo.indexOf("=");
    if (i <= 0) continue;
    const k = trozo.slice(0, i).trim();
    const v = trozo.slice(i + 1).trim();
    if (k === "ts") out.ts = v;
    else if (k === "v1") out.v1 = v;
  }
  return out;
}

/**
 * Verifica la firma de un webhook de Mercado Pago.
 *
 * @param url      la URL COMPLETA de la peticion. De aca sale `data.id`, que
 *                 Mercado Pago pone en el query string y no en el cuerpo.
 * @param headers  las cabeceras tal como llegaron.
 * @param secreto  el secreto de ESTA tienda. Un cobro de una cuenta nunca se
 *                 valida con la llave de otra.
 */
export function verificarFirma(
  url: string,
  headers: Headers,
  secreto: string,
  ahoraMs = Date.now(),
): { ok: true; variante: Variante } | { ok: false; motivo: string } {
  const cabecera = headers.get("x-signature");
  if (!cabecera) return { ok: false, motivo: "falta la cabecera x-signature" };

  const { ts, v1 } = partirFirma(cabecera);
  if (!ts || !v1) return { ok: false, motivo: "x-signature sin ts o sin v1" };

  const tsMs = tsAMilisegundos(ts);
  if (tsMs === null) return { ok: false, motivo: "ts no numerico" };

  const desfase = Math.abs(ahoraMs - tsMs) / 1000;
  if (desfase > TOLERANCIA_SEGUNDOS) {
    // Sin esto, cualquiera que haya visto un webhook valido puede reenviarlo
    // mas tarde y llevarse otro cobro contado del mismo pago.
    return { ok: false, motivo: `desfase de ${Math.round(desfase)}s` };
  }

  let dataId: string | null = null;
  try {
    dataId = new URL(url).searchParams.get("data.id");
  } catch {
    return { ok: false, motivo: "URL ilegible" };
  }
  if (!dataId) return { ok: false, motivo: "falta data.id en el query string" };

  const requestId = headers.get("x-request-id") ?? "";

  // Las variantes, en orden de probabilidad. Todas con el MISMO secreto.
  const manifiestos: Array<[Variante, string]> = [
    ["estandar", `id:${dataId};request-id:${requestId};ts:${ts};`],
    // Su documentacion menciona en otras partes pasar los ids alfanumericos a
    // minuscula; no dice si aplica aca.
    ["id-minuscula", `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`],
    // «Los segmentos ausentes se omiten»: si no vino x-request-id, el segmento
    // entero no va, en vez de ir vacio.
    ...(requestId ? [] : [["sin-request-id", `id:${dataId};ts:${ts};`] as [Variante, string]]),
  ];

  const dada = Buffer.from(v1, "hex");
  // Un v1 que no sea hexadecimal valido produce un Buffer corto o vacio, y
  // timingSafeEqual tira si los largos no coinciden. Se compara el largo
  // primero, siempre.
  for (const [variante, manifiesto] of manifiestos) {
    const esperada = createHmac("sha256", secreto).update(manifiesto).digest();
    if (dada.length === esperada.length && timingSafeEqual(dada, esperada)) {
      return { ok: true, variante };
    }
  }
  return { ok: false, motivo: "ninguna firma coincide" };
}
