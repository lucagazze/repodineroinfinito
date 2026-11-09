// La lista de columnas con la que se lee un producto tiene que traer lo que
// hace falta para COBRAR una oferta post-compra.
//
// El defecto que guarda esta prueba: `whop_plan_id` no estaba en PRODUCT_COLS,
// asi que getProductById lo devolvia undefined y /api/upsell cortaba con
// «not_available» antes de intentar el cobro. El post-pago no cobro NUNCA desde
// que la tienda vende por la app, y no se veia: la ruta leia el campo con un
// `as unknown as {...}` que le quitaba al compilador la forma de avisar.
// Medido el 09/11/2026 contra la base: con la lista vieja, los 8 escalones de
// las dos escaleras daban «sin plan»; con la nueva, los 8 pueden cobrar.
//
// Correr:
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-product-cols.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://test.invalid";
process.env.SUPABASE_SERVICE_KEY ||= "sin-uso-en-esta-prueba";

const { PRODUCT_COLS } = await import("../src/lib/db.ts");

test("trae el plan de Whop, sin el cual no se puede cobrar un OTO", () => {
  assert.ok(PRODUCT_COLS.includes("whop_plan_id"), "falta whop_plan_id en PRODUCT_COLS");
});

test("trae lo demas que usa el cobro y la entrega", () => {
  for (const col of ["id", "slug", "kind", "delivery_url", "delivery_file", "includes", "variant_of", "product_prices"]) {
    assert.ok(PRODUCT_COLS.includes(col), `falta ${col} en PRODUCT_COLS`);
  }
});
