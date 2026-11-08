// Quién puede escribir en site_events: el origen de los eventos del navegador.
//
// Esta prueba existe porque el guardia era «mismo origen o un host de la app», y una landing
// estática nunca cumple eso: la página la sirve www.physicsstudylab.com y la app vive en
// pay.physicsstudylab.com, así que el navegador manda Origin y /api/ev contestaba 403. Resultado:
// el panel veía CERO visitas mientras Meta contaba 143 en la misma semana (comprobado el 8/11/2026
// con `curl -H 'Origin: https://www.physicsstudylab.com' -X POST .../api/ev` → 403).
//
// Al abrirle la puerta a las landings, el peligro se da vuelta: aceptar un origen ajeno y dejar que
// cualquiera invente visitas. Por eso los casos de abajo no son inventados, son los hosts REALES:
// `select slug, landing_url from funnels` el 8/11/2026, tienda physicsstudylab.
//
//   npm run test:origen-landing
import test from "node:test";
import assert from "node:assert/strict";
import { originAllowed, hostOf, bareHost } from "../src/lib/req-guard-shared.ts";

/** Lo que hay declarado hoy en los checkouts de physicsstudylab. */
const DECLARADAS = [
  "https://www.physicsstudylab.com",   // kit-complete
  "https://physicsstudylab.com",       // kit-physics-solved
  "https://physicsstudylab.com/maths", // maths-illustrated (con ruta: vale el host)
  "https://www.physicsstudylab.com/part107",
];
const landings = new Set(DECLARADAS.map((u) => bareHost(hostOf(u))));
/** Una petición que llega al dominio de tienda, como en producción. */
const ctx = { own: ["pay.physicsstudylab.com"], crossSite: true, landings };

test("la landing declarada puede mandar eventos (el 403 que dejaba el panel en cero)", () => {
  assert.equal(originAllowed("https://www.physicsstudylab.com", ctx), true);
  assert.equal(originAllowed("https://physicsstudylab.com", ctx), true);
});

test("una ruta en landing_url autoriza el host, no la ruta", () => {
  assert.deepEqual([...landings].sort(), ["physicsstudylab.com", "www.physicsstudylab.com"]);
});

test("sin la lista de landings seguiría cortando: la lista es lo que lo arregla", () => {
  assert.equal(originAllowed("https://www.physicsstudylab.com", { ...ctx, landings: new Set() }), false);
});

test("el propio dominio de la app sigue valiendo", () => {
  assert.equal(originAllowed("https://pay.physicsstudylab.com", ctx), true);
});

test("un dominio ajeno no entra, ni disfrazado del nuestro", () => {
  for (const o of [
    "https://evil.net",
    "https://physicsstudylab.com.evil.net",      // sufijo: el host no es el nuestro
    "https://wwwphysicsstudylab.com",            // sin el punto
    "https://www.physicsstudylab.com.br",
    "null",                                       // origen opaco (sandbox, data:)
    "no es una url",
  ]) assert.equal(originAllowed(o, ctx), false, o);
});

test("sin Origin: vale si no lo pide otro sitio", () => {
  assert.equal(originAllowed(null, { ...ctx, crossSite: false }), true);
  assert.equal(originAllowed(null, ctx), false);
});

test("pruebas y vista previa: localhost y los despliegues de Vercel", () => {
  for (const o of ["http://localhost:3000", "http://127.0.0.1:8080", "https://checkout-eta-six.vercel.app"])
    assert.equal(originAllowed(o, ctx), true, o);
});
