#!/usr/bin/env node
/**
 * Smoke test del checkout y el post-pago, contra producción o contra una preview.
 *
 * Prueba TODOS los checkouts públicos de las ofertas activas (la lista sale de
 * /api/health/checkouts, con HEALTH_SECRET): cada uno por su URL pública (SSR
 * con precio y llave de Stripe) y su cotización en /api/pi. Sin esa lista
 * (build viejo o sin HEALTH_SECRET), los fijos de SMOKE_FUNNELS. El paso del
 * navegador es solo para los de SMOKE_FUNNELS (rápido) o, sin ellos, los 3 primeros.
 *
 *   node scripts/smoke.mjs                      → producción (dominios reales)
 *   node scripts/smoke.mjs https://xxx.vercel.app → esa preview (/c/{tienda}/{checkout})
 *
 * Env:
 *   SMOKE_SECRET   header x-smoke: la preview no salta al dominio de producción y
 *                  /api/pi cotiza en modo «dry» (no crea nada en Stripe). Sin él, ese
 *                  chequeo se saltea.
 *   HEALTH_SECRET  para /api/health/checkout (sin él, ese chequeo se saltea).
 *   VERCEL_AUTOMATION_BYPASS_SECRET  si las previews tienen Deployment Protection.
 *   SMOKE_NO_BROWSER=1  sin navegador (solo HTTP).
 *   SMOKE_APP_BASE  la app de producción (https://tu-app.vercel.app): de ahí salen la lista y la salud.
 *                  Si falta, se usa NEXT_PUBLIC_SITE_URL.
 *   SMOKE_FUNNELS   (opcional) JSON con checkouts fijos para el navegador:
 *                  [{"name":"ES oferta","store":"mitienda","funnel":"mi-oferta","url":"https://pay.tumarca.com/mi-oferta"}]
 *   SMOKE_STORE_IDS (opcional) «slug=uuid,otro=uuid»: prueba que el webhook de cada tienda rechace sin firma.
 *
 * No crea nada en Stripe: /api/pi en modo «dry» (solo con el header x-smoke)
 * cotiza como un pago de verdad y prueba la llave de la tienda con una
 * lectura. Si el servidor todavía no tiene el modo «dry» (un build viejo) y
 * crea un pago de verdad, se anula al instante como antes (/api/smoke/cancel).
 * En el navegador, además: cargar el checkout, tildar los bumps y escribir el
 * email NO tiene que llamar a /api/pi ni crear pagos o clientes en Stripe.
 * Sale con código 1 si algo falla.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let FUNNELS = [];
try { FUNNELS = JSON.parse(process.env.SMOKE_FUNNELS || "[]"); } catch { console.error("SMOKE_FUNNELS no es un JSON válido"); process.exit(2); }
const STORE_IDS = Object.fromEntries((process.env.SMOKE_STORE_IDS ?? "").split(",").map((x) => x.trim().split("=")).filter((p) => p.length === 2 && p[0] && p[1]));
// SMOKE_APP_BASE: la app de producción (o un build local), de donde salen la lista y la salud.
const PROD_APP = (process.env.SMOKE_APP_BASE || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
if (!PROD_APP && !(process.argv[2] && process.argv[2] !== "prod")) { console.error("Falta SMOKE_APP_BASE (https://tu-app.vercel.app)"); process.exit(2); }

const arg = process.argv[2] && process.argv[2] !== "prod" ? process.argv[2].replace(/\/+$/, "") : null;
const preview = !!arg;
const SMOKE = process.env.SMOKE_SECRET ?? "";
const HEALTH = process.env.HEALTH_SECRET ?? "";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const UA = "CheckoutSmoke/1.0";

const results = [];
const log = (ok, name, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok === true ? "PASS" : ok === "skip" ? "SKIP" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

function headers(extra = {}) {
  const h = { "User-Agent": UA, ...extra };
  if (preview && SMOKE) h["x-smoke"] = SMOKE;
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}
async function http(url, init = {}) {
  const t = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", ...init, headers: headers(init.headers ?? {}), signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    return { status: res.status, location: res.headers.get("location"), body, ms: Date.now() - t };
  } catch (e) {
    return { status: 0, body: String(e), ms: Date.now() - t };
  }
}
const post = (url, json, extra = {}) => http(url, { method: "POST", body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...extra } });

/**
 * /api/pi con dry:true y el header x-smoke: cotiza y prueba la llave sin crear
 * nada. Un build sin el modo «dry» crea un pago de verdad: se anula al instante
 * (como hacía el smoke antes) y queda dicho en el detalle.
 */
async function quoteDry(f, extra) {
  const pi = await post(`${apiBase(f)}/api/pi`, { store: f.store, funnel: f.funnel, bumps: [], dry: true, ...extra }, { "x-smoke": SMOKE });
  let j = {};
  try { j = JSON.parse(pi.body); } catch { /* */ }
  if (pi.status === 200 && j.dry === true) {
    const pmc = j.pmc ? (j.pmc.error ? ` · medios de pago ${j.pmc.id}: ${j.pmc.error}` : ` · medios de pago ${j.pmc.active ? "activos" : "INACTIVOS"}`) : "";
    return { ok: true, j, clean: !(j.pmc && (j.pmc.error || !j.pmc.active)), detail: `sin crear nada en Stripe (${j.livemode ? "live" : "test"})${pmc}` };
  }
  if (pi.status === 200 && j.pi) {
    // Build viejo: creó el pago. Se anula ya, como antes.
    const cancel = await post(`${apiBase(f)}/api/smoke/cancel`, { pi: j.pi, store: f.store }, { "x-smoke": SMOKE });
    return { ok: true, j, clean: cancel.status === 200, detail: `build sin modo dry: creó ${j.pi} y ${cancel.status === 200 ? "se anuló" : `NO se pudo anular (${cancel.status} ${cancel.body.slice(0, 100)})`}` };
  }
  return { ok: false, j, clean: false, detail: `HTTP ${pi.status} ${pi.body.slice(0, 160)}` };
}

/** Lo que el servidor pasó al checkout (props del componente, en el HTML). */
function parseCheckout(html) {
  const s = html.replace(/\\"/g, '"');
  const main = s.match(/"main":\{"name":"([^"]*)","shortName":"([^"]*)"[^}]*?"amount":([0-9.]+)/);
  const cur = s.match(/"currency":"([A-Z]{3})"/);
  const pk = s.match(/pk_(live|test)_[A-Za-z0-9]{6}/);
  return { shortName: main?.[2] ?? null, amount: main ? Number(main[3]) : null, currency: cur?.[1] ?? null, pk: pk?.[0] ?? null };
}

const checkoutUrl = (f) => (preview ? `${arg}/c/${f.store}/${f.funnel}` : f.url);
const apiBase = (f) => (preview ? arg : new URL(f.url).origin);
const appBase = preview ? arg : PROD_APP;

console.log(`Smoke ${preview ? `PREVIEW ${arg}` : "PRODUCCIÓN"} · ${new Date().toISOString()}`);
if (preview && !SMOKE) console.log("!! sin SMOKE_SECRET: la preview redirige a producción y no se prueba el build nuevo");

// ------------------------------------------------------------------ HTTP
/** Todos los checkouts públicos activos; sin la lista, los fijos de SMOKE_FUNNELS. */
async function allCheckouts() {
  if (!HEALTH) return { list: FUNNELS, from: "fijos (sin HEALTH_SECRET)" };
  const r = await http(`${appBase}/api/health/checkouts?k=${encodeURIComponent(HEALTH)}`);
  let j = {};
  try { j = JSON.parse(r.body); } catch { /* */ }
  if (r.status !== 200 || !Array.isArray(j.checkouts) || !j.checkouts.length) return { list: FUNNELS, from: `fijos (/api/health/checkouts: HTTP ${r.status})` };
  return { list: j.checkouts.map((c) => ({ name: c.name, store: c.store, funnel: c.funnel, url: c.url })), from: "/api/health/checkouts" };
}
const ALL = await allCheckouts();
console.log(`Checkouts: ${ALL.list.length} (${ALL.from})`);
if (!FUNNELS.length) FUNNELS = ALL.list.slice(0, 3);
const parsed = {};
for (const f of ALL.list) {
  const r = await http(checkoutUrl(f));
  const p = parseCheckout(r.body);
  parsed[f.name] = p;
  const ok = r.status === 200 && !!p.shortName && p.amount > 0 && !!p.currency && !!p.pk;
  log(ok, `${f.name} · checkout SSR`, ok ? `${p.shortName} ${p.amount} ${p.currency} · ${r.ms} ms` : `HTTP ${r.status}${r.location ? ` → ${r.location}` : ""} · ${JSON.stringify(p)}`);

  // /api/pi en modo «dry»: el mismo importe que cobraría, sin crear nada en Stripe.
  if (!SMOKE) { log("skip", `${f.name} · /api/pi`, "sin SMOKE_SECRET no se prueba el cobro"); continue; }
  const q = await quoteDry(f, {});
  if (!q.ok) { log(false, `${f.name} · /api/pi`, q.detail); continue; }
  const sameAmount = p.amount != null && Math.abs(Number(q.j.amount) - p.amount) < 0.005 && q.j.currency === p.currency;
  log(sameAmount && q.clean, `${f.name} · /api/pi cotiza lo mismo que muestra`,
    `${q.j.amount} ${q.j.currency} (checkout ${p.amount} ${p.currency}) · ${q.detail}`);
}

// Con el link del mail de carrito abandonado (?r=token): precio con descuento en la página y el mismo al cobrar.
//   SMOKE_R=<token> SMOKE_R_FUNNEL=<slug del checkout>
if (process.env.SMOKE_R && process.env.SMOKE_R_FUNNEL) {
  const f = ALL.list.find((x) => x.funnel === process.env.SMOKE_R_FUNNEL) ?? FUNNELS.find((x) => x.funnel === process.env.SMOKE_R_FUNNEL);
  const token = process.env.SMOKE_R;
  if (!f) log(false, "carrito recuperado", `checkout ${process.env.SMOKE_R_FUNNEL} no está en la lista`);
  else {
    const base = parsed[f.name];
    const r = await http(`${checkoutUrl(f)}?r=${encodeURIComponent(token)}`);
    const p = parseCheckout(r.body);
    const banner = /ck-recov/.test(r.body);
    const cheaper = base?.amount && p.amount && p.amount < base.amount;
    log(r.status === 200 && banner && !!cheaper, `${f.name} · checkout con descuento de carrito`, `${p.amount} ${p.currency} (sin token ${base?.amount}) · banner: ${banner ? "sí" : "NO"}`);
    if (SMOKE) {
      const q = await quoteDry(f, { r: token });
      log(q.ok && q.clean && Math.abs(Number(q.j.amount) - p.amount) < 0.005, `${f.name} · /api/pi con el token cobra el precio con descuento`,
        `${q.j.amount} ${q.j.currency} (página ${p.amount}) · ${q.detail}`);
    }
    const bad = await http(`${checkoutUrl(f)}?r=not-a-valid-token`);
    const pb = parseCheckout(bad.body);
    log(bad.status === 200 && pb.amount === base?.amount, `${f.name} · token inválido → precio normal, sin error`, `HTTP ${bad.status} · ${pb.amount} ${pb.currency}`);
  }
}

// Post-pago y API con datos falsos: nunca un 500.
{
  const base = FUNNELS.length ? apiBase(FUNNELS[0]) : appBase;
  const o = await http(`${base}/oferta/0?session_id=cs_smoke_bogus`);
  log([302, 303, 307, 308].includes(o.status), "oferta sin pedido pagado → redirige", `HTTP ${o.status} → ${o.location ?? "-"}`);
  const g = await http(`${base}/gracias?session_id=cs_smoke_bogus`);
  log(g.status === 200 && g.body.includes("__next_f"), "gracias con pedido inexistente → 200", `HTTP ${g.status}`);
  const u1 = await post(`${base}/api/upsell`, { sessionId: "cs_smoke_bogus", productSlug: "x" });
  log(u1.status === 403, "upsell con pedido inexistente → 403", `HTTP ${u1.status}`);
  const u2 = await post(`${base}/api/upsell`, {});
  log(u2.status === 400, "upsell sin datos → 400", `HTTP ${u2.status}`);
  const c = await post(`${base}/api/upsell/confirm`, { sessionId: "cs_smoke_bogus", pi: "pi_smoke" });
  log(c.status === 403, "upsell/confirm con pedido inexistente → 403", `HTTP ${c.status}`);
  for (const [slug, id] of Object.entries(STORE_IDS)) {
    const w = await post(`${appBase}/api/stripe/webhook/${id}`, {});
    log(w.status === 400, `webhook ${slug} sin firma → 400`, `HTTP ${w.status}`);
  }
  if (HEALTH) {
    const h = await http(`${appBase}/api/health/checkout?k=${encodeURIComponent(HEALTH)}`);
    let hj = {};
    try { hj = JSON.parse(h.body); } catch { /* */ }
    const bad = (hj.checks ?? []).filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`);
    log(h.status === 200 && hj.ok === true, "salud (base, checkouts, Stripe, webhooks, cadenas)",
      h.status === 200 ? `${(hj.checks ?? []).length} chequeos · ${hj.ms} ms` : `HTTP ${h.status} ${bad.join(" | ").slice(0, 300) || h.body.slice(0, 200)}`);
  } else log("skip", "salud", "sin HEALTH_SECRET");
}

// ------------------------------------------------------------- navegador
if (process.env.SMOKE_NO_BROWSER === "1") log("skip", "navegador", "SMOKE_NO_BROWSER=1");
else {
  const py = `
import json, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1])
BLOCK = ("facebook.net", "facebook.com", "clarity.ms", "googletagmanager", "google-analytics", "doubleclick", "tiktok")
OWN_SIDE_EFFECTS = ("/api/ev", "/api/checkout/open", "/api/checkout-lead", "/t.js")
out = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for f in cfg["funnels"]:
        ctx = b.new_context(viewport={"width": 390, "height": 844}, user_agent="Mozilla/5.0 CheckoutSmoke/1.0")
        pg = ctx.new_page()
        host = urlparse(f["url"]).netloc
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
        # Nada de esto puede crear un pago: ni /api/pi ni pedidos a Stripe que creen PaymentIntents o Customers.
        made = []
        def watch(r):
            u = r.url
            if urlparse(u).path == "/api/pi" or (r.method == "POST" and ("api.stripe.com/v1/payment_intents" in u or "api.stripe.com/v1/customers" in u)):
                made.append(r.method + " " + u.split("?")[0])
        pg.on("request", watch)
        def route(r):
            u = r.request.url
            if any(x in u for x in BLOCK): return r.abort()
            if urlparse(u).netloc == host:
                if any(x in urlparse(u).path for x in OWN_SIDE_EFFECTS): return r.abort()
                h = dict(r.request.headers)
                h.update(cfg["headers"])
                return r.continue_(headers=h)
            return r.continue_()
        pg.route("**/*", route)
        res = {"name": f["name"], "ok": False, "detail": ""}
        try:
            pg.goto(f["url"], wait_until="domcontentloaded", timeout=45000)
            pg.wait_for_selector("iframe[title*='payment' i], iframe[name^='__privateStripeFrame']", timeout=30000)
            # El formulario de Stripe con los campos de tarjeta, montado de verdad.
            ok_frame = False
            for _ in range(60):
                for fr in pg.frames:
                    try:
                        if fr.locator("input[name=number], [data-testid], .p-PaymentElement, .Tab, .AccordionItem").count():
                            ok_frame = True; break
                    except Exception:
                        pass
                if ok_frame: break
                pg.wait_for_timeout(500)
            # Tildar y destildar cada bump (cambia el importe del formulario de Stripe).
            nb = 0
            for el in pg.locator("[role=checkbox]").all():
                el.click(); pg.wait_for_timeout(250); el.click(); pg.wait_for_timeout(250); nb += 1
            pg.fill("#ck-email", "smoke-test@example.invalid")
            pg.locator("#ck-first").click()
            btn = pg.locator("button.ck-pay[type=submit]").first
            pg.wait_for_function("() => { const b = document.querySelector('button.ck-pay[type=submit]'); return b && !b.disabled }", timeout=20000)
            pg.wait_for_timeout(1500)
            res["ok"] = ok_frame and btn.is_enabled() and not errs and not made
            res["detail"] = ("Payment Element montado" if ok_frame else "SIN Payment Element") + " · botón de pago habilitado" + (
                (" · " + str(nb) + " bumps tildados, ningún pago creado") if not made else (" · CREÓ PAGOS AL CARGAR: " + "; ".join(made[:3]))) + (
                " · errores: " + "; ".join(errs[:2]) if errs else "")
        except Exception as e:
            res["detail"] = str(e).splitlines()[0][:200]
        out.append(res)
        ctx.close()
    b.close()
print("SMOKE_JSON" + json.dumps(out))
`;
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  const file = join(dir, "browser.py");
  writeFileSync(file, py);
  const bh = {};
  if (preview && SMOKE) bh["x-smoke"] = SMOKE;
  if (BYPASS) { bh["x-vercel-protection-bypass"] = BYPASS; bh["x-vercel-set-bypass-cookie"] = "true"; }
  const cfg = JSON.stringify({ funnels: FUNNELS.map((f) => ({ name: f.name, url: checkoutUrl(f) })), headers: bh });
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", ["-u", file, cfg], { encoding: "utf-8", timeout: 240000 });
  rmSync(dir, { recursive: true, force: true });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("SMOKE_JSON"));
  if (!line) {
    const why = (r.stderr || r.error?.message || "").split("\n").filter(Boolean).slice(-2).join(" ");
    if (/No module named 'playwright'|ENOENT/.test(why)) log("skip", "navegador", `sin Python Playwright: ${why.slice(0, 160)}`);
    else log(false, "navegador", why.slice(0, 300) || "sin salida");
  } else {
    for (const x of JSON.parse(line.slice(10))) log(x.ok, `${x.name} · navegador`, x.detail);
  }
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${failed.length ? `FALLÓ: ${failed.length} de ${results.length}` : `OK: ${results.filter((r) => r.ok === true).length} pasaron, ${results.filter((r) => r.ok === "skip").length} salteados`}`);
process.exit(failed.length ? 1 : 0);
