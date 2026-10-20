/* Reproduce el evento payment.succeeded que Whop debio mandar y lo entrega por
   el endpoint REAL de produccion, firmado con el secreto propio de la tienda.
   No es una falsificacion: el pago se verifica antes contra la API de Whop. */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { decrypt } from "../src/lib/secrets.ts";
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
process.env.SECRETS_KEY = env.SECRETS_KEY;
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const { data } = await db.from("store_whop").select("api_key_enc,webhook_secret_enc").maybeSingle();
const key = decrypt(data.api_key_enc);
const secreto = decrypt(data.webhook_secret_enc);

// 1. El pago REAL, tal como lo tiene Whop.
const ID = "pay_ZNeOpbTGxPtyRj";
const pr = await fetch(`https://api.whop.com/api/v1/payments/${ID}`, {
  headers: { authorization: `Bearer ${key}` } });
const pago = await pr.json();
if (pago.status !== "paid") { console.log("  el pago NO esta cobrado:", pago.status); process.exit(1); }
console.log(`  pago verificado contra Whop: ${pago.id} ${pago.status} ${pago.currency} ${pago.settlement_amount ?? pago.total}`);

// 2. El evento, firmado como lo firmaria Whop.
const cuerpo = JSON.stringify({ action: "payment.succeeded", data: pago });
const wid = "msg_replay_" + ID;
const wts = String(Math.floor(Date.now() / 1000));
const firmar = (k) => createHmac("sha256", k).update(`${wid}.${wts}.${cuerpo}`).digest("base64");

for (const [nombre, k] of [["cruda", Buffer.from(secreto, "utf8")],
                           ["base64", Buffer.from(secreto.replace(/^ws_/, ""), "base64")]]) {
  const r = await fetch("https://checkout-eta-six.vercel.app/api/whop/webhook/financestudylab", {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": wid,
               "webhook-timestamp": wts, "webhook-signature": `v1,${firmar(k)}` },
    body: cuerpo,
  });
  const t = await r.text();
  console.log(`  firma ${nombre.padEnd(7)} -> HTTP ${r.status}  ${t.slice(0,220)}`);
  if (r.ok) break;
}
