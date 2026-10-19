// Prueba sin red: la verificacion de firma de los webhooks de Whop
// (src/lib/whop.ts). Es lo unico que separa un pago real de alguien que manda
// un POST diciendo "pague, dame los PDF".
//   node --experimental-strip-types scripts/check-whop-firma.mjs
// Sale con codigo 1 si algun caso falla.
import { createHmac } from "crypto";
import { verificarFirma, TOLERANCIA_SEGUNDOS } from "../src/lib/whop-firma.ts";

const SECRETO = "ws_pruebaSoloParaEsteArchivo0123456789";
const AHORA = 1_700_000_000_000;                 // fijo: la prueba no puede depender del reloj
const TS = String(Math.floor(AHORA / 1000));
const ID = "msg_2abcDEF";
const CUERPO = '{"action":"payment.succeeded","data":{"id":"pay_123","status":"paid"}}';

const firmar = (clave, id = ID, ts = TS, cuerpo = CUERPO) =>
  "v1," + createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`).digest("base64");

const cruda = Buffer.from(SECRETO, "utf8");
const base64 = Buffer.from(SECRETO.replace(/^ws_/, ""), "base64");

const h = (o) => new Headers({ "webhook-id": ID, "webhook-timestamp": TS, ...o });

const casos = [
  ["firma correcta, clave cruda", h({ "webhook-signature": firmar(cruda) }), CUERPO, true],
  ["firma correcta, clave base64", h({ "webhook-signature": firmar(base64) }), CUERPO, true],
  // En el formato real cada firma lleva su propio prefijo "v1," y van
  // separadas por espacio: asi conviven la clave vieja y la nueva mientras se
  // rota el secreto.
  ["varias firmas, una valida (rotacion de secreto)",
   h({ "webhook-signature": `v1,${"A".repeat(43)}= ${firmar(cruda)}` }), CUERPO, true],

  ["sin cabecera de firma", h({}), CUERPO, false],
  ["firma de otro secreto",
   h({ "webhook-signature": firmar(Buffer.from("ws_otro", "utf8")) }), CUERPO, false],
  ["firma valida pero cuerpo cambiado",
   h({ "webhook-signature": firmar(cruda) }), CUERPO.replace("pay_123", "pay_999"), false],
  ["firma valida pero otro webhook-id",
   new Headers({ "webhook-id": "msg_otro", "webhook-timestamp": TS,
                 "webhook-signature": firmar(cruda) }), CUERPO, false],
  ["timestamp no numerico",
   new Headers({ "webhook-id": ID, "webhook-timestamp": "ayer",
                 "webhook-signature": firmar(cruda) }), CUERPO, false],
  ["firma vacia", h({ "webhook-signature": "v1," }), CUERPO, false],
];

// Reenvio: firma impecable, pero vieja. Tiene que rechazarse igual.
{
  const tsViejo = String(Math.floor(AHORA / 1000) - TOLERANCIA_SEGUNDOS - 1);
  casos.push(["reenvio fuera de la ventana de 5 min",
    new Headers({ "webhook-id": ID, "webhook-timestamp": tsViejo,
                  "webhook-signature": firmar(cruda, ID, tsViejo) }), CUERPO, false]);
  const tsBorde = String(Math.floor(AHORA / 1000) - TOLERANCIA_SEGUNDOS + 5);
  casos.push(["justo dentro de la ventana",
    new Headers({ "webhook-id": ID, "webhook-timestamp": tsBorde,
                  "webhook-signature": firmar(cruda, ID, tsBorde) }), CUERPO, true]);
}

let fallos = 0;
for (const [nombre, headers, cuerpo, esperado] of casos) {
  const r = verificarFirma(cuerpo, headers, SECRETO, AHORA);
  const ok = r.ok === esperado;
  if (!ok) fallos++;
  const detalle = r.ok ? `acepta (clave ${r.derivacion})` : `rechaza: ${r.motivo}`;
  console.log(`  ${ok ? "ok  " : "FALLA"} ${nombre.padEnd(48)} ${detalle}`);
}

console.log(`\n  ${casos.length - fallos}/${casos.length} casos`);
process.exit(fallos ? 1 : 0);
