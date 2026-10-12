#!/usr/bin/env node
/**
 * Instalación de la base en un proyecto de Supabase NUEVO (o re-aplicar el esquema: es idempotente).
 *
 *   npm run setup                 → revisa .env.local, crea tablas/funciones/triggers, buckets y tareas programadas
 *   npm run setup -- --check      → solo revisa las variables (no toca nada)
 *   npm run setup -- --no-cron    → todo menos las tareas programadas (p. ej. si la app todavía no está publicada)
 *
 * Usa la Management API de Supabase (SUPABASE_ACCESS_TOKEN + el ref del proyecto) para correr supabase/schema.sql
 * y supabase/cron.sql, y la Storage API (SUPABASE_SERVICE_KEY) para los buckets «media» (público) y «entregas» (privado).
 * Nunca borra datos.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const NO_CRON = args.has("--no-cron");

// ---------- .env.local (sin dependencias) ----------
for (const file of [".env.local", ".env"]) {
  const p = join(ROOT, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const env = (k) => (process.env[k] ?? "").trim();

const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`);
const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);

// ---------- 1. Variables ----------
console.log("\n1) Variables de entorno (.env.local)");
const REQUIRED = {
  SUPABASE_URL: "URL del proyecto (https://<ref>.supabase.co)",
  SUPABASE_SERVICE_KEY: "service_role / secret key",
  NEXT_PUBLIC_SITE_URL: "dirección pública de la app",
  PUBLIC_BASE_URL: "dirección pública de la app (la misma)",
  ADMIN_EMAILS: "emails que entran al panel",
  ADMIN_PASSWORD: "contraseña del panel",
  ADMIN_SECRET: "texto largo al azar",
  SECRETS_KEY: "texto largo al azar",
  CRON_SECRET: "texto largo al azar",
};
const SETUP_ONLY = { SUPABASE_ACCESS_TOKEN: "token personal de supabase.com (Account > Access Tokens)" };
const GROUPS = [
  ["Entrega por mail (al menos una)", ["POSTMARK_TOKEN", "BREVO_API_KEY"], "o conectar la casilla SMTP de cada tienda con el MCP (set_store_smtp)"],
  ["Stripe de respaldo", ["STRIPE_SECRET_KEY"], "cada tienda carga su llave con connect_stripe: no hace falta"],
  ["Meta (métricas y Conversions API)", ["META_TOKEN", "META_CAPI_TOKEN"], "opcional"],
  ["IA (buzón, Mejoras, email marketing)", ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"], "opcional"],
  ["Notificaciones push", ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"], "opcional: npx web-push generate-vapid-keys"],
  ["Google Drive (preventas, PDFs en la biblioteca)", ["GOOGLE_SA_JSON"], "opcional"],
];
let missing = 0;
for (const [k, what] of Object.entries(REQUIRED)) {
  if (env(k)) ok(k);
  else { bad(`${k} — falta (${what})`); missing++; }
}
for (const [k, what] of Object.entries(SETUP_ONLY)) {
  if (env(k)) ok(`${k} (solo para este script)`);
  else if (!CHECK_ONLY) { bad(`${k} — falta (${what})`); missing++; }
  else warn(`${k} — falta para aplicar la base (${what})`);
}
for (const [name, keys, note] of GROUPS) {
  const have = keys.filter((k) => env(k));
  if (have.length) ok(`${name}: ${have.join(", ")}`);
  else warn(`${name}: sin ${keys.join(" / ")} — ${note}`);
}
if (env("SUPABASE_URL") && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(env("SUPABASE_URL"))) warn("SUPABASE_URL no parece https://<ref>.supabase.co (si es un dominio propio, cargá SUPABASE_PROJECT_REF)");
for (const k of ["NEXT_PUBLIC_SITE_URL", "PUBLIC_BASE_URL"]) if (env(k).endsWith("/")) warn(`${k} termina en «/»: sacale la barra final`);
for (const k of ["ADMIN_SECRET", "SECRETS_KEY", "CRON_SECRET"]) if (env(k) && env(k).length < 24) warn(`${k} es corto: usá 32+ caracteres al azar (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`);

if (missing) { console.log(`\nFaltan ${missing} variables obligatorias. Completá .env.local (ver .env.local.example) y volvé a correr.`); process.exit(1); }
if (CHECK_ONLY) { console.log("\nVariables OK (--check: no se tocó la base)."); process.exit(0); }

// ---------- 2. Esquema ----------
const REF = env("SUPABASE_PROJECT_REF") || (env("SUPABASE_URL").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
if (!REF) { bad("No pude saber el ref del proyecto: cargá SUPABASE_PROJECT_REF."); process.exit(1); }

async function sql(query, label) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${text.slice(0, 600)}`);
  try { return JSON.parse(text); } catch { return text; }
}

console.log(`\n2) Esquema de la base (proyecto ${REF})`);
try {
  await sql(readFileSync(join(ROOT, "supabase/schema.sql"), "utf8"), "schema.sql");
  const [t] = await sql("select count(*)::int as n from pg_tables where schemaname = 'public'", "verificación");
  const [f] = await sql("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'", "verificación");
  ok(`schema.sql aplicado: ${t.n} tablas, ${f.n} funciones`);
  if (t.n < 70) warn("Se esperaban 70 tablas: revisá el error de arriba o corré schema.sql en el SQL Editor.");
} catch (e) {
  bad((e).message);
  console.log("   Alternativa: pegá supabase/schema.sql entero en Supabase > SQL Editor y ejecutalo.");
  process.exit(1);
}

// ---------- 3. Buckets ----------
console.log("\n3) Storage");
const BUCKETS = [
  { id: "media", public: true, file_size_limit: 10_000_000 },
  { id: "entregas", public: false, file_size_limit: 524_288_000, allowed_mime_types: ["application/pdf"] },
];
const sb = env("SUPABASE_URL").replace(/\/+$/, "");
const sh = { authorization: `Bearer ${env("SUPABASE_SERVICE_KEY")}`, apikey: env("SUPABASE_SERVICE_KEY"), "content-type": "application/json" };
for (const b of BUCKETS) {
  const r = await fetch(`${sb}/storage/v1/bucket`, { method: "POST", headers: sh, body: JSON.stringify({ id: b.id, name: b.id, ...b }) });
  const t = await r.text();
  if (r.ok) ok(`bucket «${b.id}» creado (${b.public ? "público" : "privado"})`);
  else if (/already exists|Duplicate/i.test(t)) ok(`bucket «${b.id}» ya existía`);
  else warn(`bucket «${b.id}»: HTTP ${r.status} ${t.slice(0, 200)} (schema.sql también lo crea por SQL)`);
}

// ---------- 4. Tareas programadas ----------
console.log("\n4) Tareas programadas (pg_cron)");
const APP = (env("PUBLIC_BASE_URL") || env("NEXT_PUBLIC_SITE_URL")).replace(/\/+$/, "");
if (NO_CRON) warn("--no-cron: salteadas. Cuando la app esté publicada: npm run setup");
else if (!/^https:\/\//.test(APP) || /localhost|127\.0\.0\.1/.test(APP)) {
  warn(`La app no tiene una dirección pública (${APP || "vacía"}): las tareas necesitan llamar a https://.../api/cron/*.`);
  warn("Publicala en Vercel, poné su dirección en PUBLIC_BASE_URL y volvé a correr npm run setup.");
} else {
  const cron = readFileSync(join(ROOT, "supabase/cron.sql"), "utf8").replaceAll("TU_APP", APP).replaceAll("TU_CRON_SECRET", env("CRON_SECRET").replace(/'/g, "''"));
  try {
    await sql(cron, "cron.sql");
    const jobs = await sql("select jobname from cron.job order by 1", "verificación");
    ok(`${jobs.length} tareas programadas apuntando a ${APP}`);
  } catch (e) { bad((e).message); process.exit(1); }
}

console.log(`
Listo. Sigue:
  npm run dev                → http://localhost:3000/admin (entrar con ADMIN_EMAILS + ADMIN_PASSWORD)
  npx vercel --prod          → publicar (cargar las mismas variables en Vercel)
  Panel > Guía de la app     → conectar Claude por MCP y cargar la primera tienda (ver README).
`);
