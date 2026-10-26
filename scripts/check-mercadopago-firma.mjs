// Prueba sin red: la verificacion de firma de los webhooks de Mercado Pago
// (src/lib/mercadopago-firma.ts). Es lo unico que separa un cobro real de
// alguien que manda un POST diciendo «pague».
//   node --experimental-strip-types scripts/check-mercadopago-firma.mjs
// Sale con codigo 1 si algun caso falla.
//
// Cada control se prueba contra un caso que DEBE pasar y uno que DEBE fallar.
// Un control que solo se prueba por el lado bueno puede estar aceptando todo.
import { createHmac } from "crypto";
import { verificarFirma, tsAMilisegundos, partirFirma, TOLERANCIA_SEGUNDOS }
  from "../src/lib/mercadopago-firma.ts";

const SECRETO = "pruebaSoloParaEsteArchivo0123456789";
const AHORA = 1_700_000_000_000;            // fijo: la prueba no puede depender del reloj
const TS_SEG = String(Math.floor(AHORA / 1000));
const TS_MS = String(AHORA);
const DATA_ID = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";   // alfanumerico EN MAYUSCULA a proposito
const REQ_ID = "d2f3a1b4-0000-4e8a-9c1d-aaaabbbbcccc";

const url = (id = DATA_ID) =>
  `https://pay.financestudylab.com/api/mercadopago/webhook/financestudylab?data.id=${id}&type=payment`;

const hmac = (manifiesto, secreto = SECRETO) =>
  createHmac("sha256", secreto).update(manifiesto).digest("hex");

const manifiesto = (id = DATA_ID, req = REQ_ID, ts = TS_SEG) =>
  `id:${id};request-id:${req};ts:${ts};`;

const h = (o) => new Headers({ "x-request-id": REQ_ID, ...o });
const firma = (v1, ts = TS_SEG) => `ts=${ts},v1=${v1}`;

const casos = [
  // --- lo que TIENE que pasar
  ["firma correcta, ts en segundos",
   url(), h({ "x-signature": firma(hmac(manifiesto())) }), true, "estandar"],

  ["firma correcta, ts en milisegundos (las dos formas viven en su doc)",
   url(), h({ "x-signature": firma(hmac(manifiesto(DATA_ID, REQ_ID, TS_MS)), TS_MS) }), true, "estandar"],

  ["data.id en minuscula: la variante de respaldo",
   url(), h({ "x-signature": firma(hmac(manifiesto(DATA_ID.toLowerCase()))) }), true, "id-minuscula"],

  ["sin x-request-id, segmento omitido",
   url(), new Headers({ "x-signature": firma(hmac(`id:${DATA_ID};ts:${TS_SEG};`)) }), true, "sin-request-id"],

  // --- lo que NO tiene que pasar
  ["sin cabecera x-signature", url(), h({}), false],

  ["firma de otro secreto",
   url(), h({ "x-signature": firma(hmac(manifiesto(), "otro-secreto")) }), false],

  ["firma valida pero data.id cambiado",
   url("ORD_OTRO"), h({ "x-signature": firma(hmac(manifiesto())) }), false],

  ["firma valida pero x-request-id cambiado",
   url(), new Headers({ "x-request-id": "otro", "x-signature": firma(hmac(manifiesto())) }), false],

  ["sin data.id en el query string",
   "https://pay.financestudylab.com/api/mercadopago/webhook/financestudylab?type=payment",
   h({ "x-signature": firma(hmac(manifiesto())) }), false],

  ["x-signature sin v1", url(), h({ "x-signature": `ts=${TS_SEG}` }), false],
  ["ts no numerico", url(), h({ "x-signature": `ts=ayer,v1=${hmac(manifiesto())}` }), false],

  // Reenvio: una firma perfectamente valida, pero vieja.
  ["reenvio fuera de la tolerancia",
   url(),
   (() => {
     const viejo = String(Math.floor(AHORA / 1000) - TOLERANCIA_SEGUNDOS - 60);
     return h({ "x-signature": firma(hmac(manifiesto(DATA_ID, REQ_ID, viejo)), viejo) });
   })(), false],

  // Un v1 basura no tiene que TIRAR: timingSafeEqual explota si los largos no
  // coinciden, asi que el largo se compara primero.
  ["v1 que no es hexadecimal", url(), h({ "x-signature": firma("no-es-hex-!!") }), false],
  ["v1 hexadecimal pero corto", url(), h({ "x-signature": firma("abcd") }), false],
  ["v1 vacio", url(), h({ "x-signature": firma("") }), false],
];

let fallos = 0;
for (const [nombre, u, headers, esperado, variante] of casos) {
  let r;
  try {
    r = verificarFirma(u, headers, SECRETO, AHORA);
  } catch (e) {
    console.log(`  TIRO   ${nombre} -> ${e.message}`);
    fallos++;
    continue;
  }
  const bien = r.ok === esperado && (!variante || r.variante === variante);
  if (!bien) fallos++;
  const detalle = r.ok ? `ok (${r.variante})` : `rechazada: ${r.motivo}`;
  console.log(`  ${bien ? "bien  " : "FALLO "} ${nombre} -> ${detalle}`);
}

// --- las dos funciones sueltas, que es donde vive el lio de segundos vs ms
const unidades = [
  ["segundos", "1704908010", 1_704_908_010_000],
  ["milisegundos", "1742505638683", 1_742_505_638_683],
  ["basura", "ayer", null],
  ["vacio", "", null],
  ["cero", "0", null],
];
for (const [nombre, entrada, esperado] of unidades) {
  const got = tsAMilisegundos(entrada);
  const bien = got === esperado;
  if (!bien) fallos++;
  console.log(`  ${bien ? "bien  " : "FALLO "} ts ${nombre}: ${entrada || "(vacio)"} -> ${got}`);
}

const p = partirFirma("ts=123,v1=abc");
if (p.ts !== "123" || p.v1 !== "abc") { fallos++; console.log("  FALLO  partirFirma basico"); }
else console.log("  bien   partirFirma basico");
// El orden no esta garantizado en ninguna parte de su documentacion.
const p2 = partirFirma("v1=abc,ts=123");
if (p2.ts !== "123" || p2.v1 !== "abc") { fallos++; console.log("  FALLO  partirFirma al reves"); }
else console.log("  bien   partirFirma al reves");

console.log(fallos === 0 ? "\nTodo bien." : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
