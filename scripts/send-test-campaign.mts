/**
 * Manda la PRUEBA de una campaña a la casilla de prueba (TEST_EMAIL).
 * Usa sendTest() de src/lib/mkt/send.ts, que esta blindado a TEST_TO.
 * No cambia el estado de la campaña ni le manda a ningun contacto.
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/send-test-campaign.mts <campaignId>
 */
import { readFileSync } from "node:fs";

const PROJ = new URL("..", import.meta.url).pathname;
for (const line of readFileSync(PROJ + ".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

const id = process.argv[2];
if (!id) throw new Error("uso: <campaignId>");

const { TEST_TO } = await import("../src/lib/mkt/consts.ts");
const EXPECTED = "brunogazze@gmail.com";
if (TEST_TO.toLowerCase() !== EXPECTED) {
  throw new Error(`la casilla de prueba es ${TEST_TO || "(vacía)"}, no ${EXPECTED}: no mando nada`);
}

const URL_ = process.env.SUPABASE_URL!, KEY = process.env.SUPABASE_SERVICE_KEY!;
const H = { apikey: KEY, Authorization: "Bearer " + KEY };
const [c] = await fetch(`${URL_}/rest/v1/mkt_campaigns?select=name,status&id=eq.${id}`, { headers: H }).then(r => r.json());
if (!c) throw new Error("campaña no encontrada");
if (c.status !== "draft") throw new Error(`la campaña está en "${c.status}", no en draft: no mando nada`);

console.log("campaña :", c.name);
console.log("estado  :", c.status);
console.log("destino :", TEST_TO, "(casilla de prueba, blindada en send.ts:128)");
console.log("");

const { sendTest } = await import("../src/lib/mkt/send.ts");
const res = await sendTest(id);

for (const r of res) {
  console.log(r.ok ? `OK   [${r.locale}] ${r.subject}` : `FALLO [${r.locale}] ${r.error}`);
  for (const n of r.notes ?? []) console.log(`     nota: ${n}`);
}

const [after] = await fetch(`${URL_}/rest/v1/mkt_campaigns?select=status&id=eq.${id}`, { headers: H }).then(r => r.json());
console.log("\nestado después:", after.status);
