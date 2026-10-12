import sharp from "sharp";
import { db } from "./db";

/**
 * Sube una imagen y devuelve dos versiones:
 *  - web:   WebP de hasta 1000 px para el checkout y el panel
 *  - email: JPG de 480 px sobre blanco, porque Outlook no muestra WebP y un
 *           PNG de varios MB hace que el email cargue lento en el celular
 */
export async function uploadImage(file: File, path: string) {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");
  if (file.size > 12 * 1024 * 1024) throw new Error("La imagen pesa más de 12 MB");
  const input = Buffer.from(await file.arrayBuffer());

  const web = await sharp(input).rotate().resize({ width: 1000, height: 1400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 }).toBuffer();
  const email = await sharp(input).rotate().flatten({ background: "#ffffff" })
    .resize({ width: 480, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true, mozjpeg: true }).toBuffer();

  const stamp = Date.now().toString(36); // evita que el CDN sirva la versión vieja
  const put = async (key: string, buf: Buffer, type: string) => {
    const { error } = await db.storage.from("media").upload(key, buf, { contentType: type, upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(`No se pudo subir la imagen: ${error.message}`);
    return db.storage.from("media").getPublicUrl(key).data.publicUrl;
  };
  return {
    web: await put(`${path}-${stamp}.webp`, web, "image/webp"),
    email: await put(`${path}-${stamp}-email.jpg`, email, "image/jpeg"),
  };
}
