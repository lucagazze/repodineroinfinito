import { db, type Product } from "./db";
import { getRates, priceFor } from "./fx";
import { orderSteps, resolveLevels } from "./postpurchase";
import { productAlias } from "./admin/privacy";
import { isRealSale } from "./real-sale";
import { money, secs, viaText, errorText, payErrorText, type Line } from "./event-labels";
import { fetchAll } from "./fetch-all";

/**
 * Convierte filas de site_events en líneas legibles para el panel. Lo que
 * sabe de cada pedido lo saca de la base: el producto de cada oferta pos-pago
 * (el que trae el evento; si es una vista, el de otro evento de la misma carga
 * de página o la vista que anotó el servidor en upsell_events), su paso en la
 * cadena del pedido (OTO 1, Downsell 2… por pp_steps de ese producto: nunca
 * por el /oferta/{n} de la dirección, que cambia cuando se rearma la cadena),
 * su precio en la moneda del pedido, lo cobrado de verdad (order_items) y qué
 * se compró en el checkout (bumps). Si no se sabe el paso, «la oferta» sin
 * número antes que un número equivocado.
 * Regla de verdad: «Compró» solo si hay una fila upsell de ese producto en
 * order_items; «Pagó» solo si el pedido es una venta real (pagado, con el
 * pago en Stripe). Un evento del navegador solo nunca alcanza.
 * Con caché corta: «En vivo» lo pide cada 5 s.
 */

export type StoryRow = {
  id: number; at: string; page: Line["page"]; event: string;
  path: string | null; order_id?: string | null; data: Record<string, unknown> | null;
};

type Prod = Pick<Product, "id" | "slug" | "name" | "short_name" | "product_prices"> & { store_id: string | null };
/** Lugar de un producto en la cadena: OTO o downsell y su nivel (null = está en varios niveles). */
type StepMeta = { kind: "oto" | "downsell"; level: number | null };
type OrderLite = {
  id: string; store_id: string | null; funnel_id: string | null; pp_funnel_id: string | null; currency: string | null; amount_total: number | string | null;
  status: string | null; stripe_payment_intent: string | null; stripe_session_id: string | null; is_test?: boolean | null; created_at: string;
  order_items: { kind: string; amount: number | string | null; currency: string | null; product_id: string }[];
};

const TTL = 5 * 60_000;
const ORDER_TTL = 45_000;
const prodCache = new Map<string, { at: number; p: Prod | null }>();
const slugCache = new Map<string, { at: number; list: Prod[] }>();
const stepCache = new Map<string, { at: number; byProduct: Map<string, StepMeta | null> }>();
/** Vistas de ofertas que anotó el servidor (upsell_events), por pedido: [producto, cuándo]. */
const viewCache = new Map<string, { at: number; rows: [string, number][] }>();
const orderCache = new Map<string, { at: number; o: OrderLite | null }>();
const piCache = new Map<string, { at: number; id: string | null }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fresh = <T extends { at: number }>(m: Map<string, T>, k: string, ttl: number) => {
  const h = m.get(k);
  return h && Date.now() - h.at < ttl ? h : undefined;
};
const trim = <T>(m: Map<string, T>) => { if (m.size > 5000) m.clear(); };
const PROD_COLS = "id,slug,name,short_name,store_id,product_prices(currency,amount,compare_at,display_value,stripe_price_id)";
const ORDER_COLS = "id,store_id,funnel_id,pp_funnel_id,currency,amount_total,status,stripe_payment_intent,stripe_session_id,is_test,created_at,order_items(kind,amount,currency,product_id)";

async function products(ids: string[], slugs: string[] = []) {
  const needIds = [...new Set(ids)].filter((id) => !fresh(prodCache, id, TTL));
  const needSlugs = [...new Set(slugs)].filter((s) => !fresh(slugCache, s, TTL));
  const [a, b] = await Promise.all([
    needIds.length ? db.from("products").select(PROD_COLS).in("id", needIds) : Promise.resolve({ data: [] }),
    needSlugs.length ? db.from("products").select(PROD_COLS).in("slug", needSlugs) : Promise.resolve({ data: [] }),
  ]);
  trim(prodCache); trim(slugCache);
  const now = Date.now();
  for (const id of needIds) prodCache.set(id, { at: now, p: null });
  for (const sl of needSlugs) slugCache.set(sl, { at: now, list: [] });
  for (const p of (a.data ?? []) as unknown as Prod[]) prodCache.set(p.id, { at: now, p });
  for (const p of (b.data ?? []) as unknown as Prod[]) {
    prodCache.set(p.id, { at: now, p });
    slugCache.get(p.slug)?.list.push(p);
  }
}
const prodById = (id: string) => prodCache.get(id)?.p ?? null;
/** El mismo slug puede estar en dos tiendas: el de la tienda del pedido. */
const prodBySlug = (sl: string, storeId?: string | null) => {
  const list = slugCache.get(sl)?.list ?? [];
  return list.find((p) => p.store_id === storeId) ?? list[0] ?? null;
};
const nameOf = (p: Prod | null) => (p ? p.short_name || p.name : null);

/** `force`: pedidos que se buscan sí o sí (un «sí» recién tocado: su cobro puede haber entrado hace segundos). */
async function orders(ids: string[], pis: string[], force: string[] = []) {
  const must = new Set(force);
  const needIds = [...new Set(ids)].filter((id) => must.has(id) || !fresh(orderCache, id, ORDER_TTL));
  const needPis = [...new Set(pis)].filter((pi) => !fresh(piCache, pi, ORDER_TTL));
  const [a, b] = await Promise.all([
    needIds.length ? db.from("orders").select(ORDER_COLS).in("id", needIds) : Promise.resolve({ data: [] }),
    needPis.length ? db.from("orders").select(ORDER_COLS).in("stripe_payment_intent", needPis) : Promise.resolve({ data: [] }),
  ]);
  trim(orderCache); trim(piCache);
  const now = Date.now();
  for (const id of needIds) orderCache.set(id, { at: now, o: null });
  // Un pago sin pedido todavía (el webhook tarda): se vuelve a buscar en la próxima.
  for (const pi of needPis) piCache.set(pi, { at: now - ORDER_TTL + 5000, id: null });
  for (const o of ([...(a.data ?? []), ...(b.data ?? [])] as unknown as OrderLite[])) {
    orderCache.set(o.id, { at: now, o });
    if (o.stripe_payment_intent) piCache.set(o.stripe_payment_intent, { at: now, id: o.id });
  }
}
const orderOf = (id: string | null | undefined) => (id ? orderCache.get(id)?.o ?? null : null);

const chainKeyOf = (o: OrderLite) => (o.pp_funnel_id ? `pp:${o.pp_funnel_id}` : o.funnel_id ? `fu:${o.funnel_id}` : "");

/**
 * El lugar de cada producto en la cadena pos-pago de cada pedido (pp_steps de
 * su pp_funnel, también los de productos archivados; o los upsells del
 * checkout en cadenas viejas). Un producto que está en dos lugares distintos
 * queda sin número.
 */
async function steps(list: OrderLite[]) {
  const need = [...new Set(list.map(chainKeyOf).filter((k) => k && !fresh(stepCache, k, TTL)))];
  if (!need.length) return;
  const ppIds = need.filter((k) => k.startsWith("pp:")).map((k) => k.slice(3));
  const fuIds = need.filter((k) => k.startsWith("fu:")).map((k) => k.slice(3));
  type Row = { id: string; pp_funnel_id: string; sort_order: number; product_id: string; kind: string | null; downsell_of: string | null; level: number | null };
  const [st, legacy] = await Promise.all([
    ppIds.length
      ? fetchAll((a, b) => db.from("pp_steps").select("id,pp_funnel_id,sort_order,product_id,kind,downsell_of,level").in("pp_funnel_id", ppIds).order("id").range(a, b)).then((data) => ({ data }))
      : Promise.resolve({ data: [] }),
    fuIds.length ? db.from("funnel_items").select("funnel_id,sort_order,product_id").in("funnel_id", fuIds).eq("role", "upsell") : Promise.resolve({ data: [] }),
  ]);
  const stepRows = (st.data ?? []) as Row[];
  const legacyRows = (legacy.data ?? []) as { funnel_id: string; sort_order: number; product_id: string }[];
  const now = Date.now();
  trim(stepCache);
  const put = (m: Map<string, StepMeta | null>, pid: string, meta: StepMeta) => {
    if (!m.has(pid)) return m.set(pid, meta);
    const cur = m.get(pid);
    if (!cur) return;
    if (cur.kind !== meta.kind) m.set(pid, null);
    else if (cur.level !== meta.level) m.set(pid, { kind: cur.kind, level: null });
  };
  for (const pp of ppIds) {
    const ordered = orderSteps(stepRows.filter((r) => r.pp_funnel_id === pp));
    const levels = resolveLevels(ordered);
    const m = new Map<string, StepMeta | null>();
    ordered.forEach((x, i) => put(m, x.row.product_id, { kind: x.parentRow ? "downsell" : "oto", level: levels[i] ?? null }));
    stepCache.set(`pp:${pp}`, { at: now, byProduct: m });
  }
  for (const fu of fuIds) {
    const m = new Map<string, StepMeta | null>();
    legacyRows.filter((r) => r.funnel_id === fu).sort((a, b) => a.sort_order - b.sort_order)
      .forEach((r, i) => put(m, r.product_id, { kind: "oto", level: i + 1 }));
    stepCache.set(`fu:${fu}`, { at: now, byProduct: m });
  }
}
const metaOf = (o: OrderLite, productId: string) => stepCache.get(chainKeyOf(o))?.byProduct.get(productId) ?? null;

/** Las vistas de ofertas que anotó el servidor para esos pedidos (para las vistas del navegador sin producto). */
async function upsellViews(orderIds: string[]) {
  const need = [...new Set(orderIds)].filter((id) => !fresh(viewCache, id, ORDER_TTL));
  if (!need.length) return;
  const { data } = await db.from("upsell_events").select("order_id,product_id,created_at").eq("event", "view").in("order_id", need);
  const now = Date.now();
  trim(viewCache);
  for (const id of need) viewCache.set(id, { at: now, rows: [] });
  for (const r of data ?? []) viewCache.get(r.order_id as string)?.rows.push([r.product_id as string, Date.parse(r.created_at as string)]);
}
/** La vista del servidor más cercana antes de esa (el servidor la anota al armar la página, segundos antes). */
function viewedAt(orderId: string, at: string): string | null {
  const t = Date.parse(at) + 15_000;
  let best: [string, number] | null = null;
  for (const v of viewCache.get(orderId)?.rows ?? []) if (v[1] <= t && v[1] > t - 6 * 3600_000 && (!best || v[1] > best[1])) best = v;
  return best?.[0] ?? null;
}

const PAGE_STEP: Record<Line["page"], string> = { landing: "Landing", checkout: "Checkout", oferta: "Post-pago", gracias: "Gracias" };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

type Ctx = {
  rates: Record<string, number>;
  /** Producto (slug) de cada carga de página (pv) del pos-pago, sacado de sus otros eventos. */
  pvProduct: Map<string, string>;
};

function orderIdOf(r: StoryRow): string | null {
  if (r.order_id) return r.order_id;
  const o = str(r.data?.order);
  if (o && UUID.test(o)) return o;
  const pi = r.event === "paid" ? str(r.data?.pi) : null;
  return pi ? piCache.get(pi)?.id ?? null : null;
}

/** Lo que se compró en el checkout: «My Offer + Bump A». */
function checkoutItems(o: OrderLite) {
  const items = o.order_items.filter((i) => i.kind === "main" || i.kind === "bump")
    .sort((a, b) => (a.kind === "main" ? -1 : b.kind === "main" ? 1 : 0));
  const names = items.map((i) => nameOf(prodById(i.product_id))).filter(Boolean) as string[];
  const main = items.find((i) => i.kind === "main");
  const bumps = items.filter((i) => i.kind === "bump").length;
  return {
    item: names.length ? names.join(" + ") : null,
    alias: main ? `${productAlias(main.product_id)}${bumps ? ` + ${bumps} bump${bumps > 1 ? "s" : ""}` : ""}` : null,
  };
}

function base(r: StoryRow, step: string): Line {
  return {
    key: String(r.id), at: r.at, page: r.page, event: r.event, icon: "landing", tone: "", title: "", item: null, itemAlias: null,
    amount: null, detail: null, personal: false, step, short: "", cats: [],
  };
}

function paidLine(o: OrderLite, at: string, key: string): Line {
  const it = checkoutItems(o);
  const amount = money(o.amount_total, o.currency);
  return {
    key, at, page: "checkout", event: "paid", icon: "ok", tone: "ok", title: "Pagó", item: it.item, itemAlias: it.alias,
    amount, detail: o.status === "refunded" ? "después se reembolsó" : null, personal: false, step: "Checkout",
    short: amount ? `✓ pagó ${amount}` : "✓ pagó", cats: ["compras"],
    value: Number(o.amount_total ?? 0) || 0, cur: (o.currency ?? "USD").toUpperCase(),
  };
}

function lineOf(r: StoryRow, ctx: Ctx): Line | null {
  const d = r.data ?? {};
  const o = orderOf(orderIdOf(r));
  if (r.event === "heartbeat") return null;

  if (r.page === "oferta") {
    // El producto: el del evento, el de otro evento de la misma carga de página o la vista del servidor.
    const slug = str(d.product) ?? ctx.pvProduct.get(str(d.pv) ?? "") ?? null;
    let prod = slug ? prodBySlug(slug, o?.store_id) : null;
    if (!prod && o) { const pid = viewedAt(o.id, r.at); if (pid) prod = prodById(pid); }
    const meta = prod && o ? metaOf(o, prod.id) : null;
    const label = meta ? `${meta.kind === "downsell" ? "Downsell" : "OTO"}${meta.level ? ` ${meta.level}` : ""}` : "la oferta";
    const cur = o?.currency ?? "USD";
    const bought = prod && o ? o.order_items.find((i) => i.kind === "upsell" && i.product_id === prod!.id) : undefined;
    const offered = prod ? priceFor(prod as unknown as Product, cur, ctx.rates)?.amount ?? null : null;
    const price = money(bought ? bought.amount : offered, bought?.currency ?? cur);
    const l = base(r, meta ? label : "Oferta");
    l.item = prod ? nameOf(prod) : null;
    l.itemAlias = prod ? productAlias(prod.id) : null;
    l.cats = ["postpago"];
    switch (r.event) {
      case "view": return { ...l, icon: "offer", tone: "", title: `Vio ${label}`, amount: price, short: l.step };
      case "pay_attempt": return { ...l, icon: "wait", tone: "warn", title: `Dijo «sí» a ${label}`, amount: price, detail: "procesando el pago…", short: "procesando…" };
      case "oto_accept":
        if (bought) return {
          ...l, icon: "ok", tone: "ok", title: `Compró ${label}`, amount: price, detail: viaText(d.via), short: price ? `✓ compró ${price}` : "✓ compró", cats: ["compras", "postpago"],
          value: Number(bought.amount ?? 0) || 0, cur: (bought.currency ?? cur).toUpperCase(),
        };
        // Tocó «sí» pero no hay cobro en el pedido (el cliente viejo lo anotaba antes de cobrar).
        return { ...l, icon: "error", tone: "bad", title: `Tocó «sí» en ${label}`, amount: price, detail: "el pago no se completó", short: "⚠ sí, sin cobro", cats: ["postpago", "errores"] };
      case "oto_decline": return { ...l, icon: "no", tone: "muted", title: `No, gracias en ${label}`, short: "✗ no, gracias" };
      case "pay_error":
        if (d.code === "still_processing") return { ...l, icon: "wait", tone: "warn", title: `El pago de ${label} sigue procesando`, amount: price, short: "procesando…" };
        return { ...l, icon: "error", tone: "bad", title: `Error al pagar ${label}`, amount: price, detail: errorText(d.code), short: "⚠ error al pagar", cats: ["postpago", "errores"] };
      case "leave": return { ...l, icon: "leave", tone: "muted", title: "Se fue", detail: typeof d.s === "number" ? `estuvo ${secs(d.s)} en ${label}` : null, short: "se fue", cats: [] };
      default: return { ...l, icon: "offer", title: l.step, short: l.step };
    }
  }

  const step = PAGE_STEP[r.page] ?? r.page;
  const l = base(r, step);
  switch (r.event) {
    case "view":
      if (r.page === "landing") return { ...l, icon: "landing", title: "Entró a la landing", short: step };
      if (r.page === "checkout") return { ...l, icon: "checkout", title: "Vio el checkout", short: step };
      return { ...l, icon: "done", title: "Llegó a la página de gracias", short: step };
    case "cta_click": return { ...l, icon: "click", tone: "brand", title: "Tocó el botón de compra", detail: str(d.t) ? `«${str(d.t)}»` : null, short: "clic al checkout" };
    case "lead": return { ...l, icon: "mail", tone: "brand", title: "Dejó el email", detail: str(d.email), personal: true, short: "dejó el email" };
    case "pay_attempt": {
      const n = num(d.bumps) ?? 0;
      const how = [d.method === "express" ? "pago exprés (Apple Pay, Google Pay, Link…)" : null, n ? `con ${n} bump${n > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
      return { ...l, icon: "card", tone: "warn", title: "Intentó pagar", amount: money(d.total, d.currency), detail: how || null, short: "intentó pagar" };
    }
    case "pay_error": return { ...l, icon: "error", tone: "bad", title: "Error al pagar", detail: payErrorText(d), short: "⚠ error al pagar", cats: ["errores"] };
    case "paid":
      if (o && isRealSale(o)) return { ...paidLine(o, r.at, l.key) };
      if (o) return { ...l, icon: "error", tone: "bad", title: "El pago no se completó", amount: money(d.total, d.currency), detail: "Stripe no lo dio por cobrado", short: "⚠ pago sin cobrar", cats: ["errores"] };
      // Todavía sin pedido (el aviso de Stripe tarda unos segundos).
      return { ...l, icon: "wait", tone: "warn", title: "Pago enviado", amount: money(d.total, d.currency), detail: "esperando la confirmación de Stripe", short: "procesando…" };
    case "download": {
      const p = str(d.product) ? prodBySlug(str(d.product)!, o?.store_id) : null;
      return { ...l, icon: "download", tone: "brand", title: "Descargó", item: nameOf(p), itemAlias: p ? productAlias(p.id) : null, short: "descargó" };
    }
    case "leave": return { ...l, icon: "leave", tone: "muted", title: "Se fue", detail: typeof d.s === "number" ? `estuvo ${secs(d.s)} en ${step === "Landing" ? "la landing" : step === "Checkout" ? "el checkout" : "gracias"}` : null, short: "se fue" };
    default: return { ...l, title: r.event, short: r.event };
  }
}

/**
 * Líneas de varias pestañas (cada grupo en orden de hora, de la más vieja a
 * la más nueva). Agrega el «Pagó» del pedido cuando el pago fue por
 * redirección y el checkout no llegó a mandarlo, saca los dobles y las
 * salidas que no son la última.
 */
export async function describeSessions(groups: StoryRow[][], opts: { synth?: boolean; leaves?: boolean } = {}): Promise<Line[][]> {
  const all = groups.flat();
  const pis = all.filter((r) => r.event === "paid").map((r) => str(r.data?.pi)).filter(Boolean) as string[];
  const ids = all.map((r) => r.order_id ?? (UUID.test(str(r.data?.order) ?? "") ? str(r.data?.order) : null)).filter(Boolean) as string[];
  const acceptIds = all.filter((r) => r.event === "oto_accept").map((r) => orderIdOf(r)).filter(Boolean) as string[];
  const [rates] = await Promise.all([getRates(), orders(ids, pis, acceptIds)]);
  const found = [...new Set([...ids, ...pis.map((pi) => piCache.get(pi)?.id ?? "")])].map(orderOf).filter((o): o is OrderLite => !!o);
  const slugs = all.filter((r) => r.event === "download" || r.page === "oferta").map((r) => str(r.data?.product)).filter(Boolean) as string[];
  const withOffers = [...new Set(all.filter((r) => r.page === "oferta").map(orderIdOf).filter(Boolean) as string[])];
  await Promise.all([steps(found), upsellViews(withOffers)]);
  const viewed = withOffers.flatMap((id) => (viewCache.get(id)?.rows ?? []).map((v) => v[0]));
  await products([...found.flatMap((o) => o.order_items.map((i) => i.product_id)), ...viewed], slugs);

  return groups.map((rows) => {
    const pvProduct = new Map<string, string>();
    for (const r of rows) {
      const pv = str(r.data?.pv), pr = str(r.data?.product);
      if (r.page === "oferta" && pv && pr && !pvProduct.has(pv)) pvProduct.set(pv, pr);
    }
    const ctx: Ctx = { rates, pvProduct };
    const out: Line[] = [];
    const paid = new Set<string>();
    const accepted = new Map<string, { line: Line; n: number }>();
    let unresolvedPaid = 0;
    for (const r of rows) {
      const oid = orderIdOf(r);
      if (r.event === "paid" && r.page === "checkout") {
        if (oid) paid.add(oid); else unresolvedPaid++;
      } else if (opts.synth !== false && oid && (r.page === "oferta" || r.page === "gracias") && !paid.has(oid)) {
        paid.add(oid);
        const o = orderOf(oid);
        // Solo si pagó en esta visita (pago por redirección): si volvió horas después
        // (el link del mail), el «Pagó» ya está en la visita en que pagó.
        const inSession = !!o && Date.parse(o.created_at) >= Date.parse(rows[0].at) - 10 * 60_000;
        if (unresolvedPaid > 0) unresolvedPaid--;
        else if (o && inSession && isRealSale(o)) out.push(paidLine(o, o.created_at < r.at ? o.created_at : r.at, `paid-${oid}`));
      }
      const l = lineOf(r, ctx);
      if (!l) continue;
      // El mismo evento dos veces seguidas (doble clic, «atrás»): una sola línea.
      const prev = out[out.length - 1];
      if (prev && prev.event === l.event && prev.title === l.title && Date.parse(l.at) - Date.parse(prev.at) < 20_000) continue;
      // Un OTO se compra una sola vez por pedido: un segundo «aceptó» no suma. Los «sí» sin
      // cobro del mismo paso van en una sola línea con la cuenta de intentos.
      if (l.event === "oto_accept") {
        const k = `${oid ?? ""}|${l.step}|${l.tone}`;
        const seen = accepted.get(k);
        if (seen) {
          if (l.tone === "bad") {
            seen.n++;
            seen.line.detail = `el pago no se completó · ${seen.n} intentos`;
            seen.line.short = `⚠ sí, sin cobro ×${seen.n}`;
          }
          continue;
        }
        accepted.set(k, { line: l, n: 1 });
      }
      out.push(l);
    }
    // Las salidas al pasar de una página a otra no dicen nada: solo la última, si se fue del todo.
    const lines = out.filter((l, i) => l.event !== "leave" || (opts.leaves !== false && i === out.length - 1));
    // Entró y se fue sin hacer nada más en esa página: una sola línea.
    const n = lines.length;
    if (n >= 2 && lines[n - 1].event === "leave" && lines[n - 2].event === "view" && lines[n - 2].step === lines[n - 1].step) {
      const v = lines[n - 2], lv = lines[n - 1];
      lines.splice(n - 2, 2, { ...v, icon: "leave", tone: "muted", title: `${v.title} y se fue`, detail: lv.detail?.replace(/ en .*$/, "") ?? null, short: `${v.short} · se fue` });
    }
    // Las descargas seguidas, en una sola línea: «Descargó 3 archivos».
    const folded: Line[] = [];
    let run = 0;
    for (const l of lines) {
      const prev = folded[folded.length - 1];
      if (l.event === "download" && prev?.event === "download") {
        run++;
        folded[folded.length - 1] = {
          ...prev, title: `Descargó ${run} archivos`, short: `descargó ${run}`,
          item: [prev.item, l.item].filter(Boolean).join(" · ") || null, itemAlias: `${run} productos`,
        };
        continue;
      }
      run = l.event === "download" ? 1 : 0;
      folded.push(l);
    }
    return folded;
  });
}

/**
 * Lo gastado de verdad por los pedidos de esas filas (después de describeSessions,
 * que deja los pedidos en caché): el checkout de cada venta real más cada OTO
 * cobrado (order_items upsell), por moneda. Cuenta aunque el pago haya sido en
 * otra visita de la misma persona.
 */
export function spentOf(rows: StoryRow[]): string | null {
  const sums = new Map<string, number>();
  for (const id of new Set(rows.map(orderIdOf).filter(Boolean) as string[])) {
    const o = orderOf(id);
    if (!o || !isRealSale(o)) continue;
    const cur = (o.currency ?? "USD").toUpperCase();
    sums.set(cur, (sums.get(cur) ?? 0) + (Number(o.amount_total ?? 0) || 0));
    for (const i of o.order_items) {
      if (i.kind !== "upsell") continue;
      const c = (i.currency ?? cur).toUpperCase();
      sums.set(c, (sums.get(c) ?? 0) + (Number(i.amount ?? 0) || 0));
    }
  }
  return sums.size ? [...sums].map(([c, v]) => money(v, c)).join(" + ") : null;
}

/** Cada evento por separado (feeds sueltos, como el de Inicio). */
export async function describeEach(rows: StoryRow[]): Promise<Map<number, Line>> {
  const lines = await describeSessions(rows.map((r) => [r]), { synth: false });
  const out = new Map<number, Line>();
  lines.forEach((ls, i) => { const l = ls.find((x) => x.key === String(rows[i].id)); if (l) out.set(rows[i].id, l); });
  return out;
}

/** Para un feed suelto que ya tiene su propio armado (Inicio): etiqueta, tono y detalle legibles. */
export function feedLabel(l: Line | undefined): { label?: string; tone?: string; detail?: string | null; personal?: boolean } {
  if (!l) return {};
  return { label: l.title, tone: l.tone, detail: [l.amount, l.detail].filter(Boolean).join(" · ") || null, personal: l.personal };
}
