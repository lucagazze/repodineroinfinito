// Como se busca en `orders` la referencia que vuelve por la URL.
//
// Esta prueba existe por un defecto que estuvo vivo dos semanas sin que nada
// lo delatara: la pagina de la oferta post-compra abria bien, y el cobro
// contestaba 403 «Pedido no valido» SIEMPRE. La causa era que habia dos
// versiones de esta resolucion y una no le ponia el prefijo `whop:`.
//
// Los valores de abajo son los REALES: el `session_id` que viaja por la URL y
// el `stripe_session_id` tal como esta guardado en la base.
//
//   npm run test:order-ref
import test from "node:test";
import assert from "node:assert/strict";
import { orderRefColumn } from "../src/lib/order-ref.ts";

test("Whop: por la URL viaja sin prefijo y en la base esta con prefijo", () => {
  // pedido 2f00b7a8 (GBP 50,35) y ae61de35 (USD 17,99): los dos que fallaron
  for (const id of ["pay_i6GzB9Engsg9Fp", "pay_zkMi9A0XQcFAIC"]) {
    const { value } = orderRefColumn(id);
    assert.equal(value, `whop:${id}`, "sin el prefijo la busqueda no encuentra nada y da 403");
  }
});

test("Stripe y las compras de prueba no llevan prefijo", () => {
  assert.deepEqual(orderRefColumn("pi_3QabcDEF"), { col: "stripe_payment_intent", value: "pi_3QabcDEF" });
  assert.deepEqual(orderRefColumn("cs_test_a1b2"), { col: "stripe_session_id", value: "cs_test_a1b2" });
  assert.deepEqual(orderRefColumn("test_DPFUxKJMpPvU"), { col: "stripe_session_id", value: "test_DPFUxKJMpPvU" });
});

test("un id de Whop se busca en una columna que lo tiene", () => {
  // Con Whop las dos columnas guardan el mismo valor; lo que no puede pasar es
  // que se busque el valor SIN prefijo, en la columna que sea.
  const { col, value } = orderRefColumn("pay_ZNeOpbTGxPtyRj");
  assert.ok(col === "stripe_payment_intent" || col === "stripe_session_id");
  assert.ok(value.startsWith("whop:"));
});
