// Prueba sin levantar la app: los links que van en un mail a un comprador
// tienen que ser https en un dominio público (src/lib/public-url.ts). Lo corre
// el smoke antes de publicar:  node --experimental-strip-types scripts/check-public-url.mjs
// Sale con código 1 si algún caso falla.
import { publicOrigin, isPublicUrl } from "../src/lib/public-url.ts";

const cases = [
  // [entrada, origen esperado o null]
  ["https://pay.tumarca.com/c/mitienda/mi-oferta?r=x", "https://pay.tumarca.com"],
  ["https://www.otramarca.com/oferta/checkout", "https://www.otramarca.com"],
  ["pay.otramarca.com", "https://pay.otramarca.com"],
  ["https://oferta.otramarca.com:443/en", "https://oferta.otramarca.com"],
  ["http://localhost:3077", null],
  ["https://localhost", null],
  ["http://pay.tumarca.com", null],
  ["https://127.0.0.1/api/m/c/x", null],
  ["https://10.0.0.5", null],
  ["https://192.168.1.20", null],
  ["https://[::1]/x", null],
  ["https://mi-checkout.vercel.app/api/m/c/x", null],
  ["https://mi-checkout-git-main-equipo.vercel.app", null],
  ["https://mi-mac.local/x", null],
  ["https://app.internal", null],
  ["https://pay.tumarca.com:3077", null],
  ["https://abc.ngrok-free.app", null],
  ["https://user:pw@pay.tumarca.com", null],
  ["javascript:alert(1)", null],
  ["", null],
  [null, null],
];

let fail = 0;
for (const [input, want] of cases) {
  const got = publicOrigin(input);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(input)} → ${got}${ok ? "" : ` (esperado ${want})`}`);
}
if (isPublicUrl("http://localhost:3077/api/m/c/x?u=https://pay.tumarca.com")) { fail++; console.log("FAIL isPublicUrl(localhost)"); }
if (!isPublicUrl("https://pay.tumarca.com/api/m/c/x")) { fail++; console.log("FAIL isPublicUrl(pay.*)"); }
console.log(fail ? `\n${fail} casos fallaron` : "\nlinks de mails: todo ok");
process.exit(fail ? 1 : 0);
