import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/checkout-settings";
import type { PresaleRow } from "./presale-shared";

/**
 * Prompts para que una IA (Claude Code en la computadora del dueño) escriba los libros de «Contenido pendiente»
 * Todo sale de los datos reales del libro: nombre, idioma, descripción que vio
 * el comprador, páginas e índice prometidos, portada y carpeta de entrega. Nada inventado.
 */
const LANG: Record<string, string> = { it: "italiano", en: "inglés", fr: "francés", de: "alemán", es: "castellano (España)", pt: "portugués" };
const ROOT = process.env.BOOKS_ROOT ?? "";

type Extra = { description: string; lang: string | null };

async function extras(rows: PresaleRow[]): Promise<Map<string, Extra>> {
  const ids = [...new Set(rows.flatMap((r) => [r.id, ...r.productIds]))];
  if (!ids.length) return new Map();
  const [{ data: prods }, { data: items }, { data: mains }, { data: steps }] = await Promise.all([
    db.from("products").select("id,description").in("id", rows.map((r) => r.id)),
    db.from("funnel_items").select("product_id,funnel_id").in("product_id", ids),
    db.from("funnels").select("id,main_product_id,settings").in("main_product_id", ids),
    db.from("pp_steps").select("product_id,pp_funnels(checkout_funnel_id)").in("product_id", ids),
  ]);
  const fids = [...new Set([
    ...(items ?? []).map((i) => i.funnel_id as string),
    ...(mains ?? []).map((m) => m.id as string),
    ...(steps ?? []).map((s) => (s.pp_funnels as unknown as { checkout_funnel_id?: string } | null)?.checkout_funnel_id).filter((x): x is string => !!x),
  ])];
  const { data: fs } = fids.length ? await db.from("funnels").select("id,settings").in("id", fids) : { data: [] as never[] };
  const locOf = new Map((fs ?? []).map((f) => [f.id as string, resolveSettings(f.settings).locale.slice(0, 2)]));
  const desc = new Map((prods ?? []).map((p) => [p.id as string, (p.description as string | null) ?? ""]));
  const out = new Map<string, Extra>();
  for (const r of rows) {
    const set = new Set([r.id, ...r.productIds]);
    const f = [
      ...(items ?? []).filter((i) => set.has(i.product_id as string)).map((i) => i.funnel_id as string),
      ...(mains ?? []).filter((m) => set.has(m.main_product_id as string)).map((m) => m.id as string),
      ...(steps ?? []).filter((s) => set.has(s.product_id as string)).map((s) => (s.pp_funnels as unknown as { checkout_funnel_id?: string } | null)?.checkout_funnel_id ?? ""),
    ].map((id) => locOf.get(id)).find((l) => !!l);
    out.set(r.id, { description: desc.get(r.id) ?? "", lang: f ?? null });
  }
  return out;
}

const folderId = (url: string | null) => url?.match(/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

function block(r: PresaleRow, x: Extra | undefined, due: string, n?: number) {
  const fid = folderId(r.deliveryUrl);
  const lang = x?.lang ? LANG[x.lang] ?? x.lang : "el idioma de la oferta (mirá la descripción)";
  return [
    `### ${n ? `Libro ${n}: ` : ""}«${r.name}»`,
    `- Oferta: ${r.offers.map((o) => `${o.name}${o.role ? ` (${o.role})` : ""}`).join(", ") || r.storeName} · tienda ${r.storeName}`,
    `- Idioma del libro: **${lang}** (todo el libro en ese idioma, sin palabras de otro).`,
    `- Compradores esperando: ${r.orders.length} · ${due}`,
    `- Lo que vio el comprador (la descripción del producto, el libro tiene que cumplirla): ${x?.description?.trim() || "(sin descripción cargada: pedísela al dueño antes de empezar)"}`,
    r.plannedPages ? `- Páginas prometidas: **${r.plannedPages}**` : "- Páginas prometidas: no están cargadas (usá la descripción y avisale al dueño cuántas hiciste).",
    r.plannedOutline ? `- Índice prometido:\n${r.plannedOutline.split("\n").map((l) => `    ${l}`).join("\n")}` : "- Índice prometido: no está cargado (armalo coherente con la descripción).",
    `- Portada (página 1, idéntica a esta): ${r.image ?? "(sin portada cargada: avisale al dueño)"}`,
    `- Carpeta de entrega en Drive: ${r.deliveryUrl ?? "(sin carpeta: avisale al dueño)"}${fid ? ` · ID ${fid}` : ""}`,
    fid ? `- Subir: \`rclone --drive-root-folder-id ${fid} copy "<${r.name}.pdf>" gd: --drive-chunk-size 32M\` y verificar con \`rclone --drive-root-folder-id ${fid} lsl gd:\` (mismos bytes que el archivo local).` : "",
  ].filter(Boolean).join("\n");
}

const RULES = `## Cómo se hace
1. Leé primero la guía de la app con \`get_guide\` (MCP checkout), secciones «hacer-libros», «drive» y «contenido-pendiente».
2. Contenido real y correcto, verificado; los números calculados con código, nunca de memoria. Nada que contradiga la descripción.
3. PDF final: **portada idéntica en la página 1, índice en la 2**, todas las páginas, sin páginas en blanco ni repetidas, nombre del archivo = nombre del libro. Abrilo y revisalo entero antes de subirlo.
4. **No toques** el aviso de preventa de la carpeta (la app lo saca sola cuando aparece el PDF) y **no mandes mails a compradores**: el aviso lo manda el dueño desde la app («Avisar»).
5. Al terminar: panel → Contenido pendiente → «Revisar carpetas ahora». Tiene que aparecer como «hecho» con el peso del PDF.`;

export async function bookPrompts(rows: PresaleRow[], dueOf: (r: PresaleRow) => string): Promise<{ one: Record<string, string>; all: string | null }> {
  if (!rows.length) return { one: {}, all: null };
  const ex = await extras(rows);
  const one: Record<string, string> = {};
  for (const r of rows) {
    one[r.id] = `Tenés que escribir y entregar un libro ilustrado en PDF que ya se vendió en preventa. Trabajá solo, con cuidado, y no lo des por terminado hasta que esté subido y verificado.\n\n${block(r, ex.get(r.id), dueOf(r))}\n\n${RULES}`;
  }
  const all = rows.length > 1
    ? `Tenés que escribir y entregar ${rows.length} libros ilustrados en PDF que ya se vendieron en preventa (hay compradores esperando). Coordiná el trabajo así:\n\n` +
      `- Lanzá **un agente por libro, en paralelo** (de a 4 a 6 a la vez), cada uno en su propia carpeta de proyecto dentro de \`${ROOT}\` (nunca tocan el motor compartido ni la carpeta de otro libro). Empezá por los que vencen primero.\n` +
      `- A cada agente pasale su bloque «Libro N» completo + las reglas de abajo, y pedile que te devuelva la ruta del PDF terminado, la cantidad de páginas y cualquier duda.\n` +
      `- Vos revisás cada PDF (portada, índice, idioma, páginas prometidas) antes de que se suba. Si uno no cumple, lo devolvés con lo que falta.\n` +
      `- Al final, un resumen para el dueño: qué libros quedaron subidos (con el link de la carpeta) y cuáles no, y por qué.\n\n` +
      rows.map((r, i) => block(r, ex.get(r.id), dueOf(r), i + 1)).join("\n\n") + `\n\n${RULES}`
    : null;
  return { one, all };
}
