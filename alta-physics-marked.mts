/**
 * Alta de Physics Marked: el producto, su variante lite y la tapa.
 *
 * Los planes de Whop y el paso del post-pago van aparte, en un segundo paso,
 * para que si Whop falla no queden productos a medio crear.
 *
 * Es idempotente: se puede correr dos veces sin duplicar nada.
 */
import { db } from "@/lib/db";
import { readFileSync } from "fs";

const PH = "97879900-b4b5-4ae5-880a-32deb872967c";
const ARCHIVO = "physicsstudylab/Physics Marked.pdf";
const NOMBRE = "Physics Marked.pdf";

// ---------------------------------------------------------------- la tapa
const jpg = readFileSync("/Users/brunogazze/Documents/physicstudylab/img/physicsmarked/cover.jpg");
const clave = "physicsstudylab/physics-marked.jpg";
const up = await db.storage.from("media").upload(clave, jpg, {
  contentType: "image/jpeg", upsert: true, cacheControl: "31536000",
});
if (up.error) throw new Error(`tapa: ${up.error.message}`);
const tapa = db.storage.from("media").getPublicUrl(clave).data.publicUrl;
const r = await fetch(tapa);
console.log(`  tapa: HTTP ${r.status} · ${((await r.arrayBuffer()).byteLength / 1024).toFixed(0)} KB`);
console.log(`        ${tapa}`);

// ------------------------------------------------------------ las paginas
const SUB = "How a mark is given · The ten command words · Show that · The six-mark answer · What you throw away · The practicals";

const PAGINA_OTO = {
  topBar: "ONE MORE THING — ADDED TO THIS ORDER",
  headline: "YOU KNOW THE PHYSICS. DO YOU KNOW HOW IT'S MARKED?",
  intro: "{first-name}, one thing before your files.",
  pitch:
    "Last year 205,017 students sat Physical Sciences. Only 59,385 reached 50 %.\n\n" +
    "Most of them did not know less physics than the rest. They lost marks on how they wrote it down: " +
    "a bare answer with no equation, a missing unit, an explanation where the question said describe.\n\n" +
    "This is the book about that. Not more physics — where the marks actually are.",
  bullets: [
    "**M, A and B marks**, and why a wrong answer with working beats a right one without",
    "**The ten command words**, one page each — what each pays for and what it refuses to pay for",
    "**Error carried forward**: why one mistake costs one mark, not the whole question",
  ],
  boxTitle: "Physics Marked",
  boxKicker: "44 PAGES · EXAM TECHNIQUE",
  boxSubtitle: SUB,
  ctaText: "Yes — add it for {price}",
  ctaNote: "One click. Same payment method, no card details to re-enter.",
  noThanks: "No thanks — take me to my files",
  footnote: "Instant A4 PDF. Same 30-day guarantee.",
  guaranteeNote: "Covered by the same 30-day guarantee as your kit.",
  bottomBar: "PHYSICS STUDY LAB",
};

const PAGINA_LITE = {
  ...PAGINA_OTO,
  topBar: "BEFORE YOU GO — HALF PRICE ON THIS PAGE ONLY",
  headline: "SAME 44 PAGES. HALF THE PRICE.",
  intro: "No hard feelings, {first-name}. One last thing and you're done.",
  pitch:
    "Same 44 pages. Nothing removed, nothing shortened.\n\n" +
    "The only difference is the price, and the only reason it is lower is that you are seeing it here, " +
    "right after your purchase, with nothing extra for us to pay to reach you. That is the whole explanation. " +
    "It goes back to {compare} everywhere else.",
  bullets: [
    "**The same 44 pages** — every command word, every mark type, every habit",
    "**Nothing is cut.** The only change is what you pay for it",
    "**Written for the exam you are actually sitting**, not for a syllabus",
  ],
};

// --------------------------------------------------------------- el alta
async function upsert(fila: Record<string, unknown>) {
  const { data: ya } = await db.from("products").select("id").eq("store_id", PH)
    .eq("slug", fila.slug as string).maybeSingle();
  if (ya) {
    const { error } = await db.from("products").update(fila).eq("id", ya.id);
    if (error) throw new Error(`${fila.slug}: ${error.message}`);
    return { id: ya.id as string, nuevo: false };
  }
  const { data, error } = await db.from("products").insert({ store_id: PH, ...fila }).select("id").single();
  if (error) throw new Error(`${fila.slug}: ${error.message}`);
  return { id: data!.id as string, nuevo: true };
}

const base = await upsert({
  slug: "physics-marked",
  name: "Physics Marked — where the marks are, and how to get them",
  short_name: "Physics Marked",
  description: "Physics Marked — where the marks are, and how to get them (GCSE / A-Level)",
  kind: "upsell",
  sort_order: 80,
  active: true,
  show_in_catalog: false,
  image_url: tapa,
  delivery_file: ARCHIVO,
  delivery_file_name: NOMBRE,
  postcompra_page: PAGINA_OTO,
  includes: [],
  subscription: false,
});
console.log(`  ${base.nuevo ? "creado" : "actualizado"}  physics-marked        ${base.id}`);

const lite = await upsert({
  slug: "physics-marked-lite",
  name: "Physics Marked — where the marks are, and how to get them",
  short_name: "Physics Marked",
  description: "Physics Marked — same book, post-purchase price",
  kind: "postcompra",
  sort_order: 81,
  active: true,
  show_in_catalog: false,
  image_url: tapa,
  delivery_file: ARCHIVO,          // el mismo archivo: la lite no recorta nada
  delivery_file_name: NOMBRE,
  postcompra_page: PAGINA_LITE,
  includes: [],
  subscription: false,
  variant_of: base.id,
});
console.log(`  ${lite.nuevo ? "creado" : "actualizado"}  physics-marked-lite   ${lite.id}`);

// --------------------------------------------------------------- precios
const PRECIOS: [string, string, number, number | null][] = [
  // producto, moneda, importe, compare_at
  ["physics-marked", "GBP", 9.99, null],
  ["physics-marked", "USD", 12.99, null],
  ["physics-marked-lite", "GBP", 4.99, 9.99],
  ["physics-marked-lite", "USD", 6.49, 12.99],
];
const ids: Record<string, string> = { "physics-marked": base.id, "physics-marked-lite": lite.id };
for (const [slug, cur, amount, cmp] of PRECIOS) {
  const pid = ids[slug];
  const { data: ya } = await db.from("product_prices").select("id")
    .eq("product_id", pid).eq("currency", cur).maybeSingle();
  const fila = { product_id: pid, currency: cur, amount, compare_at: cmp };
  const { error } = ya
    ? await db.from("product_prices").update(fila).eq("id", ya.id)
    : await db.from("product_prices").insert(fila);
  if (error) throw new Error(`precio ${slug} ${cur}: ${error.message}`);
  console.log(`  precio  ${slug.padEnd(20)} ${cur} ${amount}${cmp ? `  (antes ${cmp})` : ""}`);
}

console.log("\n  productos y precios listos. Faltan los planes de Whop y el paso del post-pago.");
