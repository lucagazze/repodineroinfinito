import { acentoDe } from "../src/lib/whop-acento.ts";

/*
 * El color de marca de la tienda es un hexadecimal; el acento del formulario de
 * Whop es un nombre de su paleta. La traduccion entre los dos se prueba aca
 * porque un acento mal elegido no rompe nada: simplemente el formulario de pago
 * queda de otro color que el resto del checkout, y eso no lo avisa ningun error.
 *
 * Los colores de financestudylab.com son los de su index.html, no inventados.
 */
const CASOS = [
  // --- los de la marca, que son los que importan
  ["#15703f", "green",  "verde ejecutivo de financestudylab (--cta)"],
  ["#c9a227", "gold",   "dorado de financestudylab (--accent)"],
  ["#16233d", "indigo", "azul marino de financestudylab (--primary)"],
  ["#0b1220", "indigo", "navy oscuro del fondo"],
  ["#1c2c4d", "indigo", "azul intermedio de la landing"],
  // --- el resto de la rueda
  ["#16a34a", "green",  "verde del checkout por defecto"],
  ["#005bd1", "blue",   "azul por defecto del boton de pagar"],
  ["#dc2626", "red",    "rojo"],
  ["#f97316", "orange", "naranja"],
  ["#0891b2", "cyan",   "cian"],
  ["#7c3aed", "violet", "violeta"],
  ["#db2777", "pink",   "rosa"],
  // --- grises: sin tono que respetar
  ["#000000", "gray",   "negro"],
  ["#ffffff", "gray",   "blanco"],
  ["#6b7280", "gray",   "gris medio"],
  // --- entradas que no son colores: no pueden romper el checkout
  ["",            "blue", "cadena vacia"],
  ["verde",       "blue", "texto que no es un color"],
  ["#abc",        "blue", "hexadecimal corto (no soportado)"],
  ["  #15703F  ", "green", "con espacios y en mayusculas"],
];

let mal = 0;
for (const [hex, esperado, que] of CASOS) {
  const dio = acentoDe(hex);
  const ok = dio === esperado;
  if (!ok) mal++;
  console.log(`  ${ok ? "ok  " : "MAL "} ${JSON.stringify(hex).padEnd(12)} -> ${String(dio).padEnd(8)} ${ok ? "" : `(esperaba ${esperado}) `}${que}`);
}

// Y que SIEMPRE devuelva un nombre de la paleta: un valor fuera de la lista
// hace que Whop ignore el acento entero y el formulario quede gris.
const PALETA = new Set(["ruby","blue","red","yellow","green","gray","tomato","crimson","pink","plum","purple","violet","iris","cyan","teal","jade","grass","brown","orange","indigo","sky","mint","amber","lime","lemon","magenta","gold","bronze"]);
let fuera = 0;
for (let h = 0; h < 360; h += 3) {
  for (const l of [25, 50, 75]) {
    // HSL -> hex, barriendo toda la rueda
    const s = 0.7, L = l / 100, c = (1 - Math.abs(2 * L - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
    const [r, g, b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
    const hex = "#" + [r,g,b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
    if (!PALETA.has(acentoDe(hex))) { fuera++; console.log(`  MAL  ${hex} -> ${acentoDe(hex)} fuera de la paleta`); }
  }
}
console.log(`  ${fuera === 0 ? "ok  " : "MAL "} 360 colores de toda la rueda caen dentro de la paleta`);

console.log(`\n  ${CASOS.length + 1 - mal - (fuera ? 1 : 0)}/${CASOS.length + 1} casos`);
process.exit(mal || fuera ? 1 : 0);
