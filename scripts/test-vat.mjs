// Las tasas de src/lib/vat.ts, contra los cobros REALES de la pasarela.
//
// Esta prueba existe porque el defecto que arregla no se ve en pantalla: el
// checkout mostraba un numero y la tarjeta cobraba otro un 20 % mas alto, y
// asi estuvo dos semanas. Los dos casos britanicos de abajo son los dos unicos
// pedidos reales en libras que hubo, copiados de `orders.amount_total`.
//
//   npm run test:vat
import test from "node:test";
import assert from "node:assert/strict";
import { vatRate, vatOn, withVat } from "../src/lib/vat.ts";

test("Reino Unido: coincide con lo que la pasarela cobro de verdad", () => {
  assert.equal(withVat(13.99, "GB"), 16.79);                   // pedido de 1 articulo
  assert.equal(withVat(13.99 + 5.99 + 11.99 + 9.99, "GB"), 50.35); // pedido de 4
  assert.equal(vatOn(13.99, "GB"), 2.8);
  assert.equal(vatRate("GB"), 0.2);
  assert.equal(withVat(13.99, "gb"), 16.79, "el codigo de pais no distingue mayusculas");
});

test("donde la pasarela no suma nada, el numero no se toca", () => {
  assert.equal(withVat(17.99, "US"), 17.99);  // medido
  assert.equal(withVat(25.9, "AU"), 25.9);    // medido
  assert.equal(withVat(299.99, "ZA"), 299.99, "sin un cobro real que lo confirme, no se inventa");
  assert.equal(withVat(50, null), 50);
  assert.equal(withVat(50, "XX"), 50);
});
