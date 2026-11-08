import { claveIdem } from "../src/lib/whop-idem.ts";

/*
 * La clave de idempotencia del cobro con Whop tiene que hacer DOS cosas que se
 * contradicen si se elige mal:
 *   - el mismo pedido repetido no se cobra dos veces;
 *   - un intento nuevo sí se cobra.
 *
 * Se prueba acá porque los dos modos de fallo son invisibles: con la clave
 * demasiado fija, el comprador que reintenta se come un `400 This
 * Idempotency-Key was already used with a different request` (pasó el
 * 4/11/2026 en maths-illustrated y costó la venta); con la clave demasiado
 * suelta, el doble clic cobra dos veces y eso se descubre por un reclamo.
 */
const CO = "49040ebf-24b9-4e41-b23e-481f3dbde5b5";
const base = { checkoutId: CO, confirmationToken: "ctok_uno", amountCents: 1399, currency: "GBP" };

const casos = [
  ["el mismo pedido dos veces da la MISMA clave (doble clic no cobra dos veces)",
    () => claveIdem(base) === claveIdem({ ...base })],
  ["un token nuevo da una clave DISTINTA (el reintento llega a Whop)",
    () => claveIdem(base) !== claveIdem({ ...base, confirmationToken: "ctok_dos" })],
  ["cambiar los bumps (otro importe) da una clave DISTINTA",
    () => claveIdem(base) !== claveIdem({ ...base, amountCents: 1998 })],
  ["cambiar la moneda da una clave DISTINTA",
    () => claveIdem(base) !== claveIdem({ ...base, currency: "USD" })],
  ["la moneda no distingue por mayúsculas",
    () => claveIdem({ ...base, currency: "gbp" }) === claveIdem({ ...base, currency: "GBP" })],
  ["sin fila de checkout sigue habiendo clave",
    () => /^ct_[0-9a-f]{24}$/.test(claveIdem({ ...base, checkoutId: null }))],
  ["la clave lleva el id del checkout, para rastrearla desde un error de Whop",
    () => claveIdem(base).startsWith(`co_${CO}:`)],
  ["dos checkouts distintos con el mismo token no comparten clave",
    () => claveIdem(base) !== claveIdem({ ...base, checkoutId: "f111477b-3c9b-4ac6-8fbd-b1700a8176d3" })],
  ["entra en el largo que acepta una cabecera (<= 255)",
    () => claveIdem(base).length <= 255],
  ["no filtra el token: no aparece en la clave",
    () => !claveIdem(base).includes("ctok_uno")],
];

let mal = 0;
for (const [que, f] of casos) {
  const ok = f();
  if (!ok) mal++;
  console.log(`  ${ok ? "ok  " : "MAL "} ${que}`);
}
console.log(`\n  ${casos.length - mal}/${casos.length} casos`);
process.exit(mal ? 1 : 0);
