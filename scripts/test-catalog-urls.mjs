// Las URLs absolutas del catálogo (políticas que se citan a sí mismas, links de
// mails, lo que audita el panel) tienen que caer en un host donde la ruta
// /catalogo/{tienda} se sirva de verdad.
//
// El defecto que guarda esta prueba: `appBase()` es UNA dirección para todas las
// tiendas (PUBLIC_BASE_URL). Con dos tiendas, la de Physics quedaba armada sobre
// el dominio de Finance, donde el middleware resuelve la ruta contra ESA tienda y
// devuelve 404. Medido el 8/11/2026 en producción:
//   https://pay.physicsstudylab.com/catalogo/physicsstudylab/refund-policy  200
//   https://pay.financestudylab.com/catalogo/physicsstudylab/refund-policy  404
// La política de reembolso de Physics se citaba seis veces en esa URL muerta.
//
// Correr:
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs --test scripts/test-catalog-urls.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

// src/lib/catalog.ts arrastra src/lib/db.ts, que exige las claves al cargarse.
// Acá no se consulta la base: sólo se llaman funciones puras, así que van
// marcadores que no sirven para conectarse a nada. Por eso el import es
// dinámico: un import normal se iza y correría antes de esto.
process.env.SUPABASE_URL ||= "https://test.invalid";
process.env.SUPABASE_SERVICE_KEY ||= "sin-uso-en-esta-prueba";
process.env.PUBLIC_BASE_URL = "https://pay.financestudylab.com";

const { catalogUrls } = await import("../src/lib/catalog.ts");

const physics = { slug: "physicsstudylab", domain: "pay.physicsstudylab.com", catalog_domain: null };
const finance = { slug: "financestudylab", domain: "pay.financestudylab.com", catalog_domain: null };

test("el dominio propio de la tienda gana a PUBLIC_BASE_URL", () => {
  assert.equal(catalogUrls(physics).refund, "https://pay.physicsstudylab.com/catalogo/physicsstudylab/refund-policy");
  assert.equal(catalogUrls(physics).terms, "https://pay.physicsstudylab.com/catalogo/physicsstudylab/terms");
  assert.equal(catalogUrls(physics).home, "https://pay.physicsstudylab.com/catalogo/physicsstudylab");
});

test("la tienda cuyo dominio ES el host de la app no cambia", () => {
  assert.equal(catalogUrls(finance).refund, "https://pay.financestudylab.com/catalogo/financestudylab/refund-policy");
});

test("sin dominio propio cae en PUBLIC_BASE_URL", () => {
  assert.equal(
    catalogUrls({ slug: "nueva", domain: null, catalog_domain: null }).privacy,
    "https://pay.financestudylab.com/catalogo/nueva/privacy",
  );
});

test("con dominio de catálogo manda el catálogo, y home lleva barra", () => {
  const u = catalogUrls({ slug: "physicsstudylab", domain: "pay.physicsstudylab.com", catalog_domain: "catalogo.physicsstudylab.com" });
  assert.equal(u.contact, "https://catalogo.physicsstudylab.com/contact");
  assert.equal(u.home, "https://catalogo.physicsstudylab.com/");
});

test("ninguna URL del catálogo puede quedar en el dominio de otra tienda", () => {
  for (const url of Object.values(catalogUrls(physics))) {
    assert.ok(!url.includes("financestudylab"), `${url} apunta al dominio de la otra tienda`);
  }
});
