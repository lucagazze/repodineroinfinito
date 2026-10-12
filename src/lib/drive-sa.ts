import { createSign } from "node:crypto";

/**
 * Drive con la cuenta de servicio de Google (GOOGLE_SA_JSON), editora de la carpeta de entregas y de nada más.
 * No puede mandar a la papelera lo que no es suyo, pero sí sacar un archivo de una carpeta y moverlo a otra:
 * con eso la app saca el aviso de preventa de la carpeta de entrega cuando el libro ya está.
 * Sin la variable, todo devuelve null y la app solo avisa.
 */
/** «<carpeta>/_Avisos de preventa ya resueltos»: ahí van los avisos que se sacan (no se borra nada). */
export const NOTICE_ARCHIVE_FOLDER = "1e4UTLEVETE9DYdI5NY9fE93BWbmINxsz";

type Sa = { client_email: string; private_key: string };
let cached: { token: string; exp: number } | null = null;

function sa(): Sa | null {
  try {
    const raw = process.env.GOOGLE_SA_JSON?.trim();
    if (!raw) return null;
    const j = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as Sa;
    return j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}

async function token(): Promise<string | null> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const k = sa();
  if (!k) return null;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(k.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) { console.error("[drive-sa] token", r.status, (await r.text()).slice(0, 200)); return null; }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[]; trashed: boolean };

/** Un archivo según la API de Drive (no la vista pública, que tarda en enterarse de lo borrado o movido). */
export async function driveFile(id: string): Promise<DriveFile | null> {
  const t = await token();
  if (!t) return null;
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed`, {
      headers: { authorization: `Bearer ${t}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? ((await r.json()) as DriveFile) : null;
  } catch {
    return null;
  }
}

/** Saca el archivo de `from` y lo deja en la carpeta de avisos resueltos. true = ya no está en `from`. */
export async function moveToNoticeArchive(id: string, from: string): Promise<boolean> {
  const t = await token();
  if (!t) return false;
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?addParents=${NOTICE_ARCHIVE_FOLDER}&removeParents=${encodeURIComponent(from)}&fields=id,parents`, {
      method: "PATCH", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: "{}",
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) { console.error("[drive-sa] mover", id, r.status, (await r.text()).slice(0, 200)); return false; }
    const j = (await r.json()) as { parents?: string[] };
    return !(j.parents ?? []).includes(from);
  } catch (e) {
    console.error("[drive-sa] mover", id, (e as Error).message);
    return false;
  }
}
