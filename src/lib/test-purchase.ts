import { randomBytes } from "crypto";
import { incluidosDe } from "./incluidos";
import { db, getProductById, STORE_COLS, type Product, type Store } from "./db";
import { getRates, priceFor } from "./fx";
import { quote } from "./pricing";
import { sendDelivery } from "./email";
import { pickLocale, type Locale } from "./i18n";
import { currencyFrom } from "./pricing";
import { orderRef } from "./order-ref";

/**
 * Compras de prueba del panel: el recorrido real de un checkout (resumen →
 * cadena post-compra → gracias) sin cobrar nada.
 *
 * Al terminar se crea un pedido con status 'test' y se manda el MISMO mail de
 * entrega que recibe un comprador (plantilla, remitente, idioma, links), más
 * un mail por cada OTO "aceptado", como pasa con un upsell real. Queda en
 * email_log como cualquier otro.
 *
 * Lo que NO hace: Stripe, la compra a Meta (CAPI o pixel), el webhook de
 * ventas, site_events. Y como todo lo que cuenta ventas filtra status = 'paid',
 * no aparece en métricas, ventas, clientes ni en el repaso de entregas.
 */

export const TEST_PREFIX = "test_";
export const newRun = () => randomBytes(9).toString("base64url");
export const DEFAULT_TEST_EMAIL = process.env.TEST_EMAIL || "";

/** Países para elegir en el panel: moneda (por mercado) e idioma como un comprador real. */
export const TEST_COUNTRIES: [string, string][] = [
  ["US", "Estados Unidos"], ["GB", "Reino Unido"], ["CA", "Canadá"], ["AU", "Australia"], ["IE", "Irlanda"], ["NZ", "Nueva Zelanda"],
  ["IT", "Italia"], ["FR", "Francia"], ["DE", "Alemania"], ["AT", "Austria"], ["CH", "Suiza"], ["ES", "España"],
  ["MX", "México"], ["AR", "Argentina"], ["CO", "Colombia"], ["CL", "Chile"], ["BR", "Brasil"], ["PT", "Portugal"],
];

/** País por defecto de un checkout: el de su mercado (market_label) o el del idioma de la tienda. */
export function defaultCountry(marketLabel: string | null | undefined, storeLocale: string | null | undefined) {
  const m = (marketLabel ?? "").toLowerCase();
  const byLabel: [RegExp, string][] = [
    [/ee\.? ?uu|usa|estados unidos|united states/, "US"], [/reino unido|uk\b|united kingdom|gran breta/, "GB"],
    [/canad/, "CA"], [/austral/, "AU"], [/italia|italy/, "IT"], [/franc/, "FR"], [/aleman|alemania|german|deutsch/, "DE"],
    [/espa/, "ES"], [/m[eé]xico/, "MX"], [/argentin/, "AR"], [/brasil|brazil/, "BR"],
  ];
  for (const [re, cc] of byLabel) if (re.test(m)) return cc;
  return ({ it: "IT", fr: "FR", de: "DE", es: "ES", "pt-BR": "BR" } as Record<string, string>)[storeLocale ?? ""] ?? "US";
}

/** Idioma y moneda de un comprador de ese país, con las mismas reglas que el checkout. */
export async function buyerSettings(storeId: string, storeLocale: string | null, funnelSettings: unknown, country: string) {
  const fixed = ((funnelSettings ?? {}) as { locale?: string }).locale;
  const locale: Locale = pickLocale({ fixed, country, storeDefault: storeLocale });
  const [{ data: markets }, rates] = await Promise.all([
    db.from("markets").select("currency,countries").eq("store_id", storeId),
    getRates(),
  ]);
  return { locale, currency: currencyFrom((markets ?? []) as { currency: string; countries: string[] }[], country, rates) };
}

export type TestRun = {
  run: string;
  storeSlug: string;
  funnelId: string;
  /** Ids de los bumps tildados. */
  bumps: string[];
  /** Slugs de los OTO/downsells "aceptados", en orden. */
  got: string[];
  country: string;
  currency: string;
  locale: Locale;
  email: string;
  name: string | null;
};

type OrderRow = { id: string; stripe_session_id: string };

/**
 * Crea el pedido de prueba y manda los mails. Idempotente por `run`: volver a
 * llamar (recargar la página) devuelve el mismo pedido sin mandar nada.
 */
export async function finishTestRun(r: TestRun): Promise<OrderRow> {
  const key = `${TEST_PREFIX}${r.run}`;
  const { data: prev } = await db.from("orders").select("id,stripe_session_id").eq("stripe_session_id", key).maybeSingle();
  if (prev) return prev as OrderRow;

  const { data: f } = await db.from("funnels").select("id,slug,store_id,stores!inner(slug)").eq("id", r.funnelId).single();
  if (!f) throw new Error("checkout no encontrado");
  const productsBy = new Map<string, Product>();
  const bumpSlugs: string[] = [];
  for (const id of r.bumps) {
    const p = await getProductById(id);
    if (p) { productsBy.set(p.id, p); bumpSlugs.push(p.slug); }
  }
  const q = await quote({ storeSlug: r.storeSlug, funnelSlug: f.slug, currency: r.currency, bumpSlugs });
  if (!q) throw new Error("el checkout no tiene precio en esa moneda");

  const rates = await getRates();
  const { data: rows } = await db.from("products").select("id,slug").eq("store_id", f.store_id).in("slug", r.got.length ? r.got : ["-"]);
  const accepted: { product: Product; amount: number }[] = [];
  for (const slug of [...new Set(r.got)]) {
    const id = (rows ?? []).find((x) => x.slug === slug)?.id;
    const p = id ? await getProductById(id) : null;
    const price = p ? priceFor(p, r.currency, rates) : null;
    if (p && price?.amount) accepted.push({ product: p, amount: Number(price.amount) });
  }

  const cur = r.currency.toUpperCase();
  const { data: order, error } = await db.from("orders").insert({
    store_id: f.store_id, funnel_id: f.id, stripe_session_id: key, status: "test",
    email: r.email, name: r.name, country: r.country, locale: r.locale, currency: cur, amount_total: q.total,
    tracking: { test: true, run: r.run },
  }).select("id,stripe_session_id").single();
  if (error || !order) throw new Error(`no se pudo crear el pedido de prueba: ${error?.message}`);

  const main = q.lines.find((l) => l.role === "main")!;
  const { error: e2 } = await db.from("order_items").insert([
    { order_id: order.id, product_id: main.product.id, kind: "main", amount: main.amount, currency: cur },
    ...q.included.map((p) => ({ order_id: order.id, product_id: p.id, kind: "included", amount: 0, currency: cur })),
    ...q.bonuses.map((b) => ({ order_id: order.id, product_id: b.product.id, kind: "bonus", amount: 0, currency: cur })),
    ...q.lines.filter((l) => l.role === "bump").map((l) => ({ order_id: order.id, product_id: l.product.id, kind: "bump", amount: l.amount, currency: cur })),
    ...accepted.map((a) => ({ order_id: order.id, product_id: a.product.id, kind: "upsell", amount: a.amount, currency: cur })),
  ]);
  if (e2) throw new Error(`no se pudieron guardar los items: ${e2.message}`);

  // Lo que cada producto entrega adentro suyo, con el MISMO helper que usan
  // el checkout y el OTO. Si la prueba lo armara por su cuenta volveria a
  // pasar lo de antes: el test pasando mientras la entrega real sale corta.
  const comprados = [main.product.id, ...q.included.map((x) => x.id), ...q.bonuses.map((b) => b.product.id),
                     ...q.lines.filter((l) => l.role === "bump").map((l) => l.product.id),
                     ...accepted.map((a2) => a2.product.id)];
  const dentro = await incluidosDe(f.store_id, comprados).catch(() => [] as string[]);
  if (dentro.length) {
    const { error: e3 } = await db.from("order_items").insert(dentro.map((id) => ({
      order_id: order.id, product_id: id, kind: "included" as const, amount: 0, currency: cur,
    })));
    if (e3 && e3.code !== "23505") console.error("[prueba] incluidos:", e3.message);
  }

  await sendTestMails(order.id);
  return order as OrderRow;
}

/**
 * Los mails de un pedido de prueba, igual que los de un pedido real: el de
 * entrega (principal + incluidos + bonos + bumps) y uno por cada upsell.
 */
export async function sendTestMails(orderId: string) {
  const { data: o } = await db.from("orders")
    .select("id,store_id,status,email,name,locale,currency,amount_total,order_items(kind,amount,currency,product_id,created_at)")
    .eq("id", orderId).single();
  if (!o || o.status !== "test" || !o.email) throw new Error("no es un pedido de prueba con email");
  const { data: store } = await db.from("stores").select(STORE_COLS).eq("id", o.store_id).single();
  const items = ((o.order_items ?? []) as { kind: string; amount: number; currency: string | null; product_id: string; created_at: string }[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const prod = async (id: string) => getProductById(id);
  const mainItem = items.find((i) => i.kind === "main");
  const main = mainItem ? await prod(mainItem.product_id) : null;
  if (!main) throw new Error("el pedido no tiene producto principal");
  const of = async (kinds: string[]) => (await Promise.all(items.filter((i) => kinds.includes(i.kind)).map((i) => prod(i.product_id)))).filter((p): p is Product => !!p);
  const extras = [...(await of(["included", "bonus"])), ...(await of(["bump"]))];
  const locale = (o.locale as Locale) ?? "en";
  const cur = (o.currency ?? "USD").toUpperCase();
  // Las pruebas no llevan número de pedido: «T-81324400».
  const ref = orderRef({ id: o.id, status: "test" });

  const errors: string[] = [];
  const send = async (args: Parameters<typeof sendDelivery>[0]) => {
    try {
      const res = await sendDelivery(args);
      if ("skipped" in res) errors.push("no hay proveedor de mail configurado");
    } catch (e) {
      errors.push((e as Error).message);
    }
  };
  await send({
    to: o.email, name: o.name, store: store as unknown as Store, locale, main, extras, currency: cur,
    orderRef: ref, total: Number(o.amount_total ?? 0), orderId: o.id,
  });
  for (const it of items.filter((i) => i.kind === "upsell")) {
    const p = await prod(it.product_id);
    if (!p) continue;
    await send({
      to: o.email, name: o.name, store: store as unknown as Store, locale, main: p, extras: [], currency: (it.currency ?? cur).toUpperCase(),
      orderRef: ref, total: Number(it.amount), orderId: o.id, kind: "upsell",
    });
  }
  await db.from("orders").update(errors.length
    ? { delivery_error: errors.join(" · ").slice(0, 500) }
    : { delivered_at: new Date().toISOString(), delivery_error: null }).eq("id", o.id);
  return { ok: !errors.length, errors };
}

/** Borra un pedido de prueba (y por cascada sus items y su registro de mails). Nunca toca uno real. */
export async function deleteTestOrder(orderId: string) {
  await db.from("orders").delete().eq("id", orderId).eq("status", "test");
}

export type TestOrderRow = {
  id: string; created_at: string; email: string | null; country: string | null; currency: string | null; locale: string | null;
  amount_total: number | null; delivered_at: string | null; delivery_error: string | null; stripe_session_id: string;
  items: { kind: string; amount: number; name: string }[];
  mails: { kind: string; status: string; error: string | null; created_at: string }[];
};

/** Las pruebas recientes de unos checkouts, con sus items y mails. */
export async function recentTestOrders(funnelIds: string[], limit = 12): Promise<TestOrderRow[]> {
  if (!funnelIds.length) return [];
  const { data } = await db.from("orders")
    .select("id,created_at,email,country,currency,locale,amount_total,delivered_at,delivery_error,stripe_session_id,order_items(kind,amount,products(short_name)),email_log(kind,status,error,created_at)")
    .eq("status", "test").in("funnel_id", funnelIds)
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((o) => ({
    ...(o as unknown as TestOrderRow),
    items: ((o.order_items ?? []) as unknown as { kind: string; amount: number; products: { short_name: string } | null }[])
      .map((i) => ({ kind: i.kind, amount: Number(i.amount), name: i.products?.short_name ?? "—" })),
    mails: ((o.email_log ?? []) as unknown as TestOrderRow["mails"]).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}
