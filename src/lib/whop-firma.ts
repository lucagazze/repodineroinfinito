import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verificacion de firma de los webhooks de Whop.
 *
 * Vive aparte de whop.ts a proposito: whop.ts importa el cliente de Supabase,
 * y validar una firma no tiene por que depender de la base. Separado, se puede
 * probar sin red ni entorno (scripts/check-whop-firma.mjs), que es justo lo que
 * hace falta para la unica pieza que separa un pago real de uno inventado.
 */

/** Desfase maximo que aceptamos en un webhook. Mas que eso es un reenvio. */
export const TOLERANCIA_SEGUNDOS = 5 * 60;

// ---------------------------------------------------------------- firma

/**
 * Verifica la firma de un webhook de Whop.
 *
 * Whop firma la cadena `{webhook-id}.{webhook-timestamp}.{cuerpo crudo}` con
 * HMAC-SHA256 y manda el resultado en `webhook-signature` como `v1,<base64>`.
 *
 * Sobre la clave hay una ambiguedad real en su documentacion: dice que se use
 * el `ws_...` tal cual, sin quitar el prefijo ni decodificar, pero el estandar
 * en el que se basan (Standard Webhooks) manda lo contrario -- quitar el
 * prefijo y decodificar base64. Como equivocarse significa o rechazar todos
 * los pagos o no enterarse de ninguno, se prueban las dos derivaciones.
 *
 * Esto no debilita nada: las dos salen del mismo secreto, y sin el secreto no
 * se puede producir ninguna de las dos.
 *
 * @param cuerpo  el cuerpo EXACTO como llego, sin parsear ni re-serializar:
 *                JSON.parse + JSON.stringify cambia bytes y rompe la firma.
 */
export function verificarFirma(
  cuerpo: string,
  headers: Headers,
  secreto: string,
  ahoraMs = Date.now()
): { ok: true; derivacion: "cruda" | "base64" } | { ok: false; motivo: string } {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const firma = headers.get("webhook-signature");
  if (!id || !ts || !firma) return { ok: false, motivo: "faltan cabeceras webhook-*" };

  const t = Number(ts);
  if (!Number.isFinite(t)) return { ok: false, motivo: "webhook-timestamp no numerico" };
  const desfase = Math.abs(ahoraMs / 1000 - t);
  if (desfase > TOLERANCIA_SEGUNDOS) {
    // Sin esto, cualquiera que haya visto un webhook valido puede reenviarlo
    // mas tarde y llevarse otra entrega del mismo pago.
    return { ok: false, motivo: `desfase de ${Math.round(desfase)}s` };
  }

  const firmado = `${id}.${ts}.${cuerpo}`;
  const claves: Array<[["cruda", "base64"][number], Buffer]> = [
    ["cruda", Buffer.from(secreto, "utf8")],
    ["base64", Buffer.from(secreto.replace(/^ws_/, ""), "base64")],
  ];

  // La cabecera puede traer varias firmas separadas por espacio (rotacion de
  // secreto): alcanza con que una coincida.
  const recibidas = firma.split(" ").map((p) => p.split(",")[1] ?? "").filter(Boolean);

  for (const [derivacion, clave] of claves) {
    const esperada = createHmac("sha256", clave).update(firmado).digest();
    for (const r of recibidas) {
      const dada = Buffer.from(r, "base64");
      if (dada.length === esperada.length && timingSafeEqual(dada, esperada)) {
        return { ok: true, derivacion };
      }
    }
  }
  return { ok: false, motivo: "ninguna firma coincide" };
}
