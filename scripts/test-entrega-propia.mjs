// La entrega con archivo propio (products.delivery_file), contra los archivos REALES del bucket.
//
// Esta prueba existe porque el panel de preventas daba por hecho lo que no podia ver: `folderCheck`
// solo sabia leer carpetas de Drive, y en las tiendas que entregan por Storage cortaba con 409.
// Al abrirle esa puerta, el peligro se da vuelta: aflojar el criterio y marcar «listo» un libro
// que no existe, que es peor que el 409. Por eso los numeros de abajo no son elegidos, son
// MEDIDOS: `select name, (metadata->>'size')::bigint from storage.objects where bucket_id='entregas'`
// el 7/11/2026, 35 archivos ya entregados a compradores reales.
//
//   npm run test:entrega-propia
import test from "node:test";
import assert from "node:assert/strict";
import { fileVerdict, MIN_FILE_BYTES } from "../src/lib/admin/presale-shared.ts";

const PDF = "%PDF-1.4\n...";
const ZIP = "PK\u0003\u0004\u0014\u0000";

// Los extremos reales del bucket: el mas liviano de todo, el PDF mas liviano, y los dos que
// dispararon este arreglo. Si alguno de estos diera «todavia no», el panel mentiria al reves.
const REALES = [
  ["financestudylab/the-valuation-sheet.xlsx", ZIP, 31325],
  ["financestudylab/la-hoja-de-valuacion.xlsx", ZIP, 33071],
  ["physicsstudylab/The Two-Week Study Plan.pdf", PDF, 189017],
  ["physicsstudylab/The Last Week.pdf", PDF, 458810],
  ["physicsstudylab/Maths Marked.pdf", PDF, 734015],
  ["physicsstudylab/Maths Illustrated.pdf", PDF, 4993520],
  ["physicsstudylab/The Part 107 Figure Book.pdf", PDF, 40403663],
];

test("los archivos ya entregados pasan todos", () => {
  for (const [name, head, bytes] of REALES) {
    const v = fileVerdict(name, head, bytes);
    assert.equal(v.ok, true, `${name} deberia pasar y dijo: ${v.why}`);
  }
});

test("el piso de Drive (1 MB) habria rechazado entregas reales", () => {
  // La razon de que el piso sea otro: con 1 MB, 19 de los 35 archivos del bucket quedaban afuera.
  const bajoUnMega = REALES.filter(([, , b]) => b < 1_000_000);
  assert.ok(bajoUnMega.length >= 5, "hay entregas reales de menos de 1 MB");
  assert.ok(MIN_FILE_BYTES < 31325, "el piso tiene que quedar debajo del archivo real mas liviano");
});

test("lo que NO es la entrega no pasa", () => {
  // Una pagina de error de Storage guardada con nombre de PDF.
  assert.equal(fileVerdict("t/x.pdf", "<!DOCTYPE html><html>", 54000).ok, false);
  // Un PDF de verdad pero de peso de marcador de lugar.
  const chico = fileVerdict("t/x.pdf", PDF, 4000);
  assert.equal(chico.ok, false);
  assert.match(chico.why, /pesa 4 KB/);
  // Un .xlsx que no es un zip.
  assert.equal(fileVerdict("t/x.xlsx", "texto suelto", 90000).ok, false);
  // Un archivo vacio.
  assert.equal(fileVerdict("t/x.pdf", "", 0).ok, false);
});

test("una extension que no conocemos no se inventa un veredicto, pero igual pesa", () => {
  assert.equal(fileVerdict("t/x.mobi", "cualquier cosa", 900000).ok, true);
  assert.equal(fileVerdict("t/x.mobi", "cualquier cosa", 900).ok, false);
});

test("sin tamaño declarado no se juzga el peso, solo el tipo", () => {
  assert.equal(fileVerdict("t/x.pdf", PDF, null).ok, true);
  assert.equal(fileVerdict("t/x.pdf", "<html>", null).ok, false);
});
