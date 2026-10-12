import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "./db";

/**
 * Autenticación del panel. Una sola persona entra acá, así que no hace falta
 * una tabla de usuarios: contraseña en variable de entorno y una cookie
 * firmada con HMAC.
 *
 * Lo que sí hace falta es que sea real: el panel edita precios y ve los
 * emails de los compradores. Sin esto, cualquiera con la URL entra.
 */

const COOKIE = "cp_admin";

function secret() {
  const s = process.env.ADMIN_SECRET;
  if (!s) throw new Error("Falta ADMIN_SECRET");
  return s;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function makeToken() {
  // El timestamp permite caducar la sesión sin guardar nada del lado servidor.
  const issued = Date.now().toString();
  return `${issued}.${sign(issued)}`;
}

function valid(token: string | undefined): boolean {
  if (!token) return false;
  const [issued, mac] = token.split(".");
  if (!issued || !mac) return false;

  const expected = sign(issued);
  // Comparación de tiempo constante: evita filtrar el MAC byte a byte.
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const age = Date.now() - Number(issued);
  return age >= 0 && age < 30 * 24 * 60 * 60 * 1000; // 30 días
}

export async function isLoggedIn(): Promise<boolean> {
  const jar = await cookies();
  return valid(jar.get(COOKIE)?.value);
}

/**
 * Para TODA server action y ruta del panel. El layout del admin no alcanza:
 * una server action se puede llamar directo por POST sin pasar por la página.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isLoggedIn())) throw new Error("No autorizado");
}

const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60_000;

export type LoginResult = "ok" | "wrong" | "locked";

/** Emails que pueden entrar al panel (ADMIN_EMAILS, separados por coma). */
export function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "?";
}

/** Abre la sesión del panel (cookie firmada, 30 días). */
export async function startSession() {
  const jar = await cookies();
  jar.set(COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

/**
 * Email y contraseña. Primero contra Supabase Auth (el usuario se crea en el
 * proyecto y los registros están cerrados); si no, contra ADMIN_PASSWORD del
 * entorno como respaldo. En los dos casos el email tiene que estar en
 * ADMIN_EMAILS.
 */
export async function login(password: string, email?: string): Promise<LoginResult> {
  const mail = (email ?? "").trim().toLowerCase();
  const allowed = adminEmails();

  // Límite de intentos por IP: sin esto, la contraseña se puede adivinar a fuerza bruta.
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await db.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("ok", false).gte("at", since);
  if ((count ?? 0) >= MAX_FAILS) return "locked";

  const userOk = !allowed.length || allowed.includes(mail);
  let ok = false;
  if (userOk && mail && password) ok = await supabasePasswordOk(mail, password);
  if (!ok && userOk) {
    const expected = process.env.ADMIN_PASSWORD ?? "";
    const a = Buffer.from(password);
    const b = Buffer.from(expected);
    ok = !!expected && a.length === b.length && timingSafeEqual(a, b);
  }
  await db.from("login_attempts").insert({ ip, ok });
  if (!ok) return "wrong";
  await startSession();
  return "ok";
}

async function supabasePasswordOk(email: string, password: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return false;
  const j = (await res.json()) as { user?: { email?: string } };
  return j.user?.email?.toLowerCase() === email;
}

/** Para el ingreso con Google: valida el email que devolvió Supabase. */
export async function loginWithEmail(email: string): Promise<LoginResult> {
  const ok = adminEmails().includes(email.trim().toLowerCase());
  await db.from("login_attempts").insert({ ip: await clientIp(), ok });
  if (!ok) return "wrong";
  await startSession();
  return "ok";
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
