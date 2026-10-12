import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Cifrado de las llaves que se guardan en la base (Stripe, webhooks, CAPI).
 *
 * La base ya es solo de servidor (RLS sin políticas), pero un volcado o un
 * backup filtrado no tiene que entregar las llaves de cobro de las tiendas.
 * AES-256-GCM con SECRETS_KEY: sin esa variable, lo guardado no sirve.
 */

function key() {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("Falta SECRETS_KEY");
  // Cualquier texto sirve: se deriva a 32 bytes.
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Secreto con formato desconocido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** Para mostrar una llave guardada sin revelarla: rk_live_…9P */
export function mask(secret: string) {
  const m = secret.match(/^([a-z]{2,3}_(?:live|test)_)/);
  return `${m?.[1] ?? ""}…${secret.slice(-4)}`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
