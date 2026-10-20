import { aNumero, montoCobrado } from "../src/lib/whop-montos.ts";

/*
 * Esta prueba existe por una venta real que se perdio.
 *
 * El 20/10/2026 un pago de 1 USD se cobro bien en Whop y NO se entrego: el
 * codigo asumia que `settlement_amount` era un numero. No lo es -- y en ese
 * pago ni siquiera venia. `total` llegaba como objeto de dinero con `amount`
 * en CADENA, se intentaba guardar el objeto entero en una columna numerica, y
 * Postgres rechazaba la fila con el dinero ya cobrado.
 *
 * El caso REAL va primero: es el cuerpo exacto que devolvio la API.
 */
const REAL = {
  id: "pay_ZNeOpbTGxPtyRj", status: "paid", currency: "usd",
  subtotal: { currency: "usd", amount: "1.00", decimals: 2, display_decimals: 2 },
  total:    { currency: "usd", amount: "1.00", decimals: 2, display_decimals: 2 },
  refunded_amount: { currency: "usd", amount: "0.00", decimals: 2, display_decimals: 2 },
  // settlement_amount NO viene
};

const CASOS = [
  [REAL, 1, "el pago real que se perdio (sin settlement_amount)"],
  [{ settlement_amount: { currency: "usd", amount: "37.00" }, total: { currency: "usd", amount: "99.00" } },
   37, "settlement_amount gana sobre total"],
  [{ total: { currency: "eur", amount: "19.99" } }, 19.99, "decimales"],
  [{ subtotal: { currency: "usd", amount: "5.00" } }, 5, "solo subtotal"],
  [{ total: 42 }, 42, "numero suelto (por si cambian el formato)"],
  [{ total: "7.50" }, 7.5, "cadena suelta"],
  [{}, 0, "sin ningun importe -> 0, nunca NaN"],
  [{ total: null, subtotal: null }, 0, "nulos -> 0"],
  [{ total: { currency: "usd", amount: "no-es-un-numero" } }, 0, "basura -> 0, nunca NaN"],
  [{ total: { currency: "jpy", amount: "1500", decimals: 0 } }, 1500, "moneda sin decimales"],
];

let mal = 0;
for (const [p, esperado, que] of CASOS) {
  const dio = montoCobrado(p);
  const ok = dio === esperado && Number.isFinite(dio);
  if (!ok) mal++;
  console.log(`  ${ok ? "ok  " : "MAL "} ${String(dio).padEnd(8)} ${ok ? "" : `(esperaba ${esperado}) `}${que}`);
}

// Nunca puede devolver NaN: un NaN en la columna de importe rompe la fila igual
// que el objeto, y con el dinero ya cobrado.
const BASURA = [undefined, null, {}, { amount: undefined }, { amount: {} }, { amount: [] }, NaN, "x"];
let nan = 0;
for (const b of BASURA) {
  const v = aNumero(b);
  if (v !== null && !Number.isFinite(v)) { nan++; console.log(`  MAL  aNumero(${JSON.stringify(b)}) = ${v}`); }
}
console.log(`  ${nan === 0 ? "ok  " : "MAL "} aNumero nunca devuelve NaN (${BASURA.length} entradas basura)`);

console.log(`\n  ${CASOS.length + 1 - mal - (nan ? 1 : 0)}/${CASOS.length + 1} casos`);
process.exit(mal || nan ? 1 : 0);
