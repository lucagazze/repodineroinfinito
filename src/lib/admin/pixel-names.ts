import { db } from "@/lib/db";
import { metaBusy, metaGet } from "./meta-conn";

/**
 * El nombre de cada pixel, para mostrarlo primero en todo el panel (el número
 * va chico, al lado). Sale de la tabla pixels; si un pixel no tiene nombre ahí
 * (o es uno que carga una landing y no es nuestro), se lo pide a Meta
 * (GET /{pixel}?fields=name, solo lectura) y, si es nuestro, se guarda.
 */

const fromMeta = new Map<string, { at: number; name: string | null }>();
const TTL = 6 * 3600_000;

async function metaName(id: string): Promise<string | null> {
  const hit = fromMeta.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.name;
  // Es un detalle: si la cuenta está cerca del límite de Meta, no se pregunta.
  if (await metaBusy()) return null;
  const name = await metaGet<{ name?: string }>(id, { fields: "name" }, 6000).then((j) => j.name?.trim() || null).catch(() => null);
  fromMeta.set(id, { at: Date.now(), name });
  return name;
}

/** { pixel_id: nombre } de esos pixels (los que no tienen nombre en ningún lado no aparecen). */
export async function pixelNames(ids: string[]): Promise<Record<string, string>> {
  const want = [...new Set(ids.filter((x) => /^\d{6,20}$/.test(x)))];
  if (!want.length) return {};
  const { data } = await db.from("pixels").select("id,pixel_id,name").in("pixel_id", want);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if ((r.name as string | null)?.trim()) out[r.pixel_id as string] = (r.name as string).trim();
  const missing = want.filter((id) => !out[id]);
  await Promise.all(missing.map(async (id) => {
    const name = await metaName(id);
    if (!name) return;
    out[id] = name;
    // Si es nuestro y no tenía nombre, queda guardado.
    const mine = (data ?? []).filter((r) => r.pixel_id === id && !(r.name as string | null)?.trim()).map((r) => r.id as string);
    if (mine.length) await db.from("pixels").update({ name }).in("id", mine);
  }));
  return out;
}

/** «Mi Oferta (1234567890123456)» o, sin nombre, solo el número: para los textos de diagnóstico. */
export const pixelText = (id: string, names: Record<string, string>) => (names[id] ? `${names[id]} (${id})` : id);

/** «el pixel Mi Oferta (…)», sin repetir «Pixel» si el nombre ya empieza así («Pixel principal (salud)»). */
export const pixelRef = (ids: string[], names: Record<string, string>) => {
  const t = ids.map((id) => pixelText(id, names)).join(", ");
  return /^pixel/i.test(t) ? t : `${ids.length > 1 ? "Pixels" : "Pixel"} ${t}`;
};
