import { db } from "./db";

/**
 * Copia en Supabase de los PDF de Drive (migración 065). La biblioteca baja de la copia (rápido, sin el límite de
 * descargas de Drive); si un archivo todavía no está copiado, lo entrega desde Drive y lo copia para la próxima.
 */
const BUCKET = "entregas";
export const driveDownloadUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
const safe = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "libro.pdf";

/** Link firmado (10 min) para bajar la copia con su nombre, o null si no está copiado. */
export async function mirroredUrl(driveId: string, name: string): Promise<string | null> {
  const { data: m } = await db.from("delivery_mirror").select("path").eq("drive_id", driveId).maybeSingle();
  if (!m) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(m.path as string, 600, { download: name });
  return data?.signedUrl ?? null;
}

/** Copia un PDF de Drive al bucket (si no estaba). Se llama después de responder (after). */
export async function mirrorDrive(driveId: string, name: string): Promise<void> {
  try {
    const { data: has } = await db.from("delivery_mirror").select("drive_id").eq("drive_id", driveId).maybeSingle();
    if (has) return;
    const r = await fetch(driveDownloadUrl(driveId), { cache: "no-store", redirect: "follow" });
    if (!r.ok || /text\/html/.test(r.headers.get("content-type") ?? "")) return;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 1000 || String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") return;
    const path = `drive/${driveId}/${safe(name)}`;
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "application/pdf", upsert: true });
    if (error) return console.warn("[copia] subir", driveId, error.message);
    await db.from("delivery_mirror").upsert({ drive_id: driveId, path, name, bytes: buf.length });
  } catch (e) {
    console.warn("[copia]", driveId, (e as Error).message);
  }
}
