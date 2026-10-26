/**
 * Vista previa local de una campaña: usa el renderer real (src/lib/mkt/render.ts)
 * y escribe el HTML a un archivo. No manda nada ni toca la base.
 *   node --experimental-strip-types scripts/render-weekly-screen.mts <campaignId> <outFile>
 */
import { readFileSync, writeFileSync } from "node:fs";

const PROJ = new URL("..", import.meta.url).pathname;
for (const line of readFileSync(PROJ + ".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

const [id, out, localeArg] = process.argv.slice(2);
if (!id || !out) throw new Error("uso: <campaignId> <outFile> [locale]");

const { renderCampaign, newCtx } = await import("../src/lib/mkt/render.ts");

const URL_ = process.env.SUPABASE_URL!, KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: KEY, Authorization: "Bearer " + KEY };
const q = async (p: string) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

const [c] = await q(`mkt_campaigns?select=*&id=eq.${id}`);
if (!c) throw new Error("campaña no encontrada");
const [store] = await q(`stores?select=*&id=eq.${c.store_id}`);
if (!store) throw new Error("tienda no encontrada");

const locale = (localeArg ?? c.segment?.locales?.[0] ?? c.fallback_locale ?? "en") as "en";
const version = c.versions[locale];
if (!version) throw new Error(`la campaña no tiene versión "${locale}" (hay: ${Object.keys(c.versions).join(", ")})`);

const r = await renderCampaign({
  campaignId: c.id,
  discount: null,          // sin descuento => no necesita SECRETS_KEY
  version,
  locale,
  store,
  to: { email: "preview@example.com", name: null, country: null, products: [] },
  sendId: null,
  base: null,              // vista previa: sin link de baja real
  test: true,
  ctx: newCtx([]),         // sin catálogo: la carta no tiene bloques de producto
});

writeFileSync(out, r.html);
console.log("status de la campaña :", c.status);
console.log("locale               :", locale);
console.log("subject              :", r.subject);
console.log("preheader            :", r.preheader);
console.log("skip                 :", r.skip ?? "(ninguno)");
console.log("notes                :", r.notes.length ? r.notes.join(" | ") : "(ninguna)");
console.log("productLinks         :", r.productLinks.length);
console.log("asteriscos sueltos   :", (r.html.match(/\*/g) ?? []).length);
console.log("bytes                :", r.html.length);
console.log("archivo              :", out);
