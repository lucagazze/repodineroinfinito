import { randomBytes } from "crypto";
import { db } from "./db";
import { sha256 } from "./secrets";

/**
 * Tokens para la API y el servidor MCP: el acceso directo de Claude (y de
 * cualquier script) sin pasar por el login del panel. Se guarda solo el hash;
 * el token se muestra una vez, al crearlo.
 */

export async function createApiToken(name: string) {
  const token = `cp_${randomBytes(24).toString("base64url")}`;
  const { error } = await db.from("api_tokens").insert({ name: name.slice(0, 80) || "Sin nombre", token_hash: sha256(token) });
  if (error) throw new Error(error.message);
  return token;
}

export async function revokeApiToken(id: string) {
  await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
}

export async function listApiTokens() {
  const { data } = await db
    .from("api_tokens")
    .select("id,name,last_used_at,revoked_at,created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Valida "Authorization: Bearer cp_..." y marca el uso. Devuelve el nombre del token o null. */
export async function verifyApiToken(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.match(/^Bearer\s+(cp_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const { data } = await db
    .from("api_tokens")
    .select("id,name,revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data.name;
}
