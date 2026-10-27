// Prueba sin red: a que pasarela va cada comprador segun su pais.
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/check-pasarela-pais.mjs
// Sale con 1 si algun caso falla.
//
// Esto decide POR DONDE se cobra, y equivocarse manda a alguien a una
// pasarela que no puede cobrarle -- o que no le paga a Bruno. Cada caso
// incluye su contrario: que AR vaya a Mercado Pago no dice nada si ES tambien
// termina ahi.
import { pasarelaParaComprador } from "../src/lib/pasarela.ts";
const tienda = { gateway: "whop", gateway_by_country: { AR: "mercadopago" } };
const casos = [
  ["AR",  tienda, "mercadopago", "argentino -> Mercado Pago"],
  ["ar",  tienda, "mercadopago", "en minuscula igual"],
  [" AR ",tienda, "mercadopago", "con espacios igual"],
  ["ES",  tienda, "whop",        "España -> la de la tienda"],
  ["GB",  tienda, "whop",        "Reino Unido -> la de la tienda"],
  [null,  tienda, "whop",        "sin pais -> la de la tienda"],
  ["AR",  { gateway: "whop", gateway_by_country: { AR: "inventada" } }, "whop",
          "regla con una pasarela que no existe: NO rompe, cae en la tienda"],
  ["AR",  { gateway: "whop" }, "whop", "tienda sin reglas"],
  ["AR",  null, "stripe", "sin tienda -> stripe"],
];
let mal = 0;
for (const [pais, st, esperado, nombre] of casos) {
  const got = pasarelaParaComprador(st, pais);
  const ok = got === esperado;
  if (!ok) mal++;
  console.log(`  ${ok ? "bien  " : "FALLO "} ${nombre.padEnd(52)} -> ${got}`);
}
console.log(mal ? `\n  ${mal} fallo(s).` : "\n  Todo bien.");
process.exit(mal ? 1 : 0);
