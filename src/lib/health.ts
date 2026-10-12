import { db } from "./db";
import { decrypt } from "./secrets";
import { stripeWith } from "./stripe";
import { loadCheckoutFresh } from "./checkout-data";
import { quoteFrom } from "./pricing";
import { getRates, priceFor } from "./fx";
import { simulate, firstPending } from "./postpurchase";
import { resolveSettings } from "./checkout-settings";
import { webhookUrl } from "./stripe-connect";

/**
 * Salud del checkout y del post-pago, sin efectos: solo lecturas (base,
 * Stripe). Lo usan /api/health/checkout (el monitor de pg_cron cada 2 min y
 * el deploy seguro) y el Diagnóstico.
 *
 *  - la base responde;
 *  - cada checkout ACTIVO carga desde la base (sin caché) con su producto
 *    principal y un precio en su moneda;
 *  - la llave de Stripe de cada tienda funciona (lectura barata de la cuenta);
 *  - el webhook de cada cuenta está activo, apunta a esta app y escucha
 *    payment_intent.succeeded (sin él, una venta cobrada no se entrega);
 *  - la cadena post-compra de cada checkout activo resuelve y lo que ofrece
 *    tiene precio.
 */

export type HealthCheck = { name: string; ok: boolean; detail?: string; ms?: number; slow?: boolean };

/**
 * Una prueba de un checkout o de su cadena que solo TARDA (espera turno en la fila de la base mientras el
 * monitor abre ~45 checkouts a la vez) no es una caída: queda «lenta» y no dispara el aviso. Los errores de
 * verdad (sin producto, sin precio, cadena rota) sí. La base, Stripe y los webhooks siguen siendo estrictos,
 * y cada página de checkout tiene además su propio control en el monitor.
 */
const softTimeout = (c: HealthCheck): HealthCheck => (!c.ok && /: más de \d+ s$/.test(c.detail ?? "") ? { ...c, ok: true, slow: true, detail: `lento: ${c.detail}` } : c);

const NEEDED_EVENTS = ["payment_intent.succeeded"];

// Stripe no cambia cada 2 minutos: se consulta como mucho cada 5 (el monitor
// llama seguido y no hace falta gastar la cuota de la API).
let stripeCache: { at: number; checks: HealthCheck[] } | null = null;
const STRIPE_TTL = 5 * 60_000;

async function timed(name: string, fn: () => Promise<string | void>): Promise<HealthCheck> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t, detail: (e as Error).message.slice(0, 300) };
  }
}

/**
 * De a `n` por vez. Con ~40 checkouts, probarlos todos juntos eran ~80
 * consultas de golpe cada 2 minutos: alguna quedaba esperando más de 8 s en la base y el control marcaba caída
 * una oferta al azar, aunque los compradores pagaban bien. De a tandas cada prueba tarda menos y no se pisan.
 */
async function inBatches<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: más de ${ms / 1000} s`)), ms))]);

async function stripeChecks(): Promise<HealthCheck[]> {
  if (stripeCache && Date.now() - stripeCache.at < STRIPE_TTL) return stripeCache.checks;
  const { data: rows, error } = await db
    .from("store_stripe")
    .select("store_id,secret_key_enc,webhook_endpoint_id,stores!inner(slug,active)")
    .eq("stores.active", true);
  if (error) throw new Error(`store_stripe: ${error.message}`);
  const checks: HealthCheck[] = [];
  await Promise.all((rows ?? []).map(async (r) => {
    const slug = (r.stores as unknown as { slug: string }).slug;
    const key = decrypt(r.secret_key_enc);
    // Tiendas con llave de PRUEBA de Stripe (laboratorio de los agentes): no venden, no cuentan para la salud.
    if (/^(sk|rk)_test_/.test(key)) return;
    const stripe = stripeWith(key);
    checks.push(await timed(`stripe:${slug}`, async () => {
      const acct = await withTimeout(stripe.accounts.retrieve(), 8000, "Stripe");
      if (!acct.charges_enabled) throw new Error("la cuenta de Stripe no puede cobrar (charges_enabled = false)");
    }));
    checks.push(await timed(`webhook:${slug}`, async () => {
      if (!r.webhook_endpoint_id) throw new Error("sin webhook guardado: las ventas no se registrarían");
      const w = await withTimeout(stripe.webhookEndpoints.retrieve(r.webhook_endpoint_id), 8000, "Stripe");
      if (w.status !== "enabled") throw new Error(`webhook ${w.status}`);
      if (w.url !== webhookUrl(r.store_id)) throw new Error(`el webhook apunta a ${w.url}`);
      const missing = NEEDED_EVENTS.filter((e) => !w.enabled_events.includes(e) && !w.enabled_events.includes("*"));
      if (missing.length) throw new Error(`el webhook no escucha ${missing.join(", ")}`);
    }));
  }));
  // Solo se cachea lo que salió bien: si algo falla, el próximo llamado vuelve a mirar.
  if (checks.every((c) => c.ok)) stripeCache = { at: Date.now(), checks };
  return checks;
}

export async function checkoutHealth(): Promise<{ ok: boolean; checks: HealthCheck[] }> {
  const checks: HealthCheck[] = [];

  const dbCheck = await timed("db", async () => {
    const { error } = await withTimeout(Promise.resolve(db.from("stores").select("id").limit(1)), 5000, "base");
    if (error) throw new Error(error.message);
  });
  checks.push(dbCheck);
  if (!dbCheck.ok) return { ok: false, checks };

  const { data: funnels, error } = await db
    .from("funnels")
    .select("id,slug,settings,stores!inner(id,slug,active)")
    .eq("active", true)
    .eq("stores.active", true);
  if (error) return { ok: false, checks: [...checks, { name: "funnels", ok: false, detail: error.message }] };

  const rates = await getRates();
  const [stripe, perFunnel] = await Promise.all([
    stripeChecks().catch((e) => [{ name: "stripe", ok: false, detail: (e as Error).message }] as HealthCheck[]),
    inBatches(funnels ?? [], 8, async (f) => {
      const st = f.stores as unknown as { id: string; slug: string };
      const settings = resolveSettings(f.settings);
      // La moneda base del checkout (la fija de la oferta, o USD): la que siempre tiene que tener precio.
      const currency = settings.currency || "USD";
      const out: HealthCheck[] = [];
      out.push(softTimeout(await timed(`checkout:${st.slug}/${f.slug}`, async () => {
        const data = await withTimeout(loadCheckoutFresh(st.slug, f.slug), 12_000, "carga del checkout");
        if (!data) throw new Error("no carga (inactivo o borrado)");
        if (!data.main) throw new Error("sin producto principal");
        const q = quoteFrom(data, { currency, bumpSlugs: [], rates });
        if (!q || !(q.total > 0)) throw new Error(`sin precio en ${currency}`);
        return `${data.main.short_name} · ${q.total} ${q.currency}`;
      })));
      out.push(softTimeout(await timed(`postcompra:${st.slug}/${f.slug}`, async () => {
        const chain = await withTimeout(simulate(st.id, f.id, [], { full: true }), 12_000, "cadena post-compra");
        if (!chain.steps.length) return "sin ofertas post-compra";
        const first = firstPending(chain);
        const noPrice = chain.steps.filter((p, i) => chain.meta[i]?.active !== false && !priceFor(p, currency, rates)?.amount).map((p) => p.slug);
        if (noPrice.length) throw new Error(`sin precio en ${currency}: ${noPrice.join(", ")}`);
        return `${chain.name ?? "cadena simple"} · ${chain.steps.length} pasos · primero ${first >= 0 ? chain.steps[first].slug : "—"}`;
      })));
      return out;
    }),
  ]);
  checks.push(...stripe, ...perFunnel.flat());
  return { ok: checks.every((c) => c.ok), checks };
}
