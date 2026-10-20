import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/secrets.ts";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
process.env.SECRETS_KEY = env.SECRETS_KEY;
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const { data } = await db.from("store_whop").select("api_key_enc").maybeSingle();
const r = await fetch("https://api.whop.com/api/v1/payments/pay_ZNeOpbTGxPtyRj", {
  headers: { authorization: `Bearer ${decrypt(data.api_key_enc)}` } });
const p = await r.json();
const forma = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? `objeto {${Object.keys(v).join(",")}}` : `${typeof v} ${JSON.stringify(v)}`;
for (const k of ["subtotal","total","settlement_amount","refunded_amount","currency","status","substatus"])
  console.log(`  ${k.padEnd(20)} ${forma(p[k])}`);
console.log("\n  --- los objetos de dinero, enteros ---");
for (const k of ["subtotal","total","settlement_amount","refunded_amount"])
  if (p[k] && typeof p[k] === "object") console.log(`  ${k}: ${JSON.stringify(p[k])}`);
console.log("\n  --- quien compro ---");
console.log("  user:   ", JSON.stringify(p.user ?? null).slice(0,200));
console.log("  member: ", JSON.stringify(p.member ?? null).slice(0,160));
console.log("  pm:     ", JSON.stringify(p.payment_method ?? null).slice(0,160));
