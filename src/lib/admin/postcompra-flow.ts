import { db, getProductById, type Product } from "@/lib/db";
import { getRates, priceFor } from "@/lib/fx";
import { money, type Locale } from "@/lib/i18n";
import {
  afterAccept, afterDecline, eligible, expandOwned, firstPending, showable, simulate, withProduct, type Chain,
} from "@/lib/postpurchase";
import { stepLabels } from "@/lib/postpurchase-labels";
import { bookCount } from "@/lib/postpurchase-rules";
import { ppProblems, type PpRow } from "@/lib/mcp/pp-validate";
import { checkoutUrl } from "@/lib/checkout-url";
import { buyerSettings, defaultCountry } from "@/lib/test-purchase";

/**
 * El diagrama del post-pago de un checkout para el panel, pensado para leerlo
 * sin saber nada técnico: una columna por escalón (OTO 1 → OTO 2 → OTO 3 →
 * Gracias), cada oferta con lo que trae, su precio y cuántos la compran, y a
 * dónde lleva «Compra» y «No, gracias». Las ramas («si agregó X en el
 * checkout» / «si no») salen de las condiciones de cada paso.
 *
 * Se recorren TODAS las combinaciones de bumps y respuestas con la misma
 * lógica del pedido real, así lo que se ve es lo que pasa.
 */

export type FlowNode = {
  index: number;
  kind: "oto" | "downsell";
  label: string;
  product: { id: string; slug: string; name: string; image: string | null };
  price: string | null;
  compare: string | null;
  /** Lo que trae, en una línea. */
  inside: string;
  stats: { views: number; accepts: number; rate: number | null };
  /** Lugar reservado (producto archivado): «próximamente». */
  placeholder: boolean;
  /** ¿Algún comprador llega a este paso? */
  reachable: boolean;
  acceptTo: string;
  declineTo: string;
  previewUrl: string;
  simUrl: string;
};

export type FlowBranch = { condition: string | null; oto: FlowNode; downsells: FlowNode[] };
export type FlowLevel = { level: string; branches: FlowBranch[] };

/**
 * Un escalón resumido para las tarjetas del panel: el OTO que ve quien no
 * agregó nada en el checkout, qué ven los demás («si agregó X: …»), y su
 * downsell con cuánto menos trae.
 */
export type FlowSlot = {
  level: number;
  placeholder: boolean;
  oto: FlowNode | null;
  alternatives: string[];
  ds: FlowNode | null;
  dsNote: string | null;
};

export type Flow = {
  chainName: string | null;
  days: number;
  currency: string;
  checkout: { name: string; image: string | null; price: string | null; url: string; simUrl: string; bumps: string[]; firstTo: string };
  levels: FlowLevel[];
  /** Compatibilidad: todos los pasos en orden. */
  nodes: FlowNode[];
  summary: { maxTicket: string | null; commonPath: string | null; orders: number };
  /** Siempre 3: OTO 1, OTO 2, OTO 3 (vacío o «próximamente» si no hay). */
  slots: FlowSlot[];
  /** Reglas que la cadena no cumple (vacío = bien). */
  problems: string[];
  /** La cadena está pausada: los compradores reales van directo a las descargas. */
  paused: boolean;
  endSimUrl: string;
};

const END = "Gracias";

/** Todos los subconjuntos de una lista corta (bumps). */
const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

export async function postcompraFlow(
  store: { id: string; slug: string; default_locale?: string | null },
  funnelId: string,
  _picked: string[] = [],
  days = 90,
  ppFunnelId: string | null = null,
): Promise<Flow | null> {
  const { data: f } = await db
    .from("funnels")
    .select("id,slug,name,market_label,main_product_id,settings,checkout_host,checkout_path,funnel_items(role,product_id,sort_order)")
    .eq("id", funnelId)
    .maybeSingle();
  if (!f) return null;

  const country = defaultCountry(f.market_label, store.default_locale);
  const { locale, currency } = await buyerSettings(store.id, store.default_locale ?? null, f.settings, country);
  const bumpIds = [...new Set(((f.funnel_items ?? []) as { role: string; product_id: string; sort_order: number }[])
    .filter((i) => i.role === "bump").sort((a, b) => a.sort_order - b.sort_order).map((i) => i.product_id))].slice(0, 4);

  const [chain, rates, main, bumps] = await Promise.all([
    simulate(store.id, f.id, [], { full: true, includePaused: true, ppFunnelId }),
    getRates(),
    f.main_product_id ? getProductById(f.main_product_id) : Promise.resolve(null),
    Promise.all(bumpIds.map((id) => getProductById(id))),
  ]);
  const bumpProducts = bumps.filter((b): b is Product => !!b);
  const priceRow = (p: Product) => priceFor(p, currency, rates);
  const amountOf = (p: Product) => Number(priceRow(p)?.amount ?? 0);
  const fmt = (n: number) => money(n, currency, locale as Locale);
  const labels = stepLabels(chain.meta);

  // Recorrido de todas las combinaciones: qué pasos ve alguien, a dónde lleva
  // cada respuesta (desde el primer estado que llega) y el ticket máximo.
  const reach = new Set<number>();
  const routes = new Map<number, { accept: number; decline: number }>();
  let best = 0;
  // Por combinación de bumps, qué OTO ve en cada nivel (solo cuenta lo del checkout).
  const picks: { combo: string[]; byLevel: Map<number, number> }[] = [];
  // Lo que tiene en cada combinación, todo a la vez (antes una consulta detrás de la otra: hasta 16 con 4 bumps).
  const combos = subsets(bumpIds);
  const ownedOf = await Promise.all(combos.map((combo) => expandOwned([...chain.owned, ...combo])));
  for (const [ci, combo] of combos.entries()) {
    const owned = ownedOf[ci];
    const base = (main ? amountOf(main) : 0) + combo.reduce((a, id) => a + (bumpProducts.find((b) => b.id === id) ? amountOf(bumpProducts.find((b) => b.id === id)!) : 0), 0);
    const seen = new Map<string, number>();
    const walk = (c: Chain, i: number): number => {
      if (i < 0) return 0;
      const key = `${i}|${[...c.owned].sort().join(",")}`;
      if (seen.has(key)) return seen.get(key)!;
      seen.set(key, 0);
      if (!showable(c, i) || !priceRow(c.steps[i])?.amount) return 0;
      reach.add(i);
      const acc = afterAccept(c, i);
      const dec = afterDecline(c, i);
      if (!routes.has(i)) routes.set(i, { accept: acc, decline: dec });
      const p = c.steps[i];
      const v = Math.max(amountOf(p) + walk(withProduct(c, p), acc), walk(c, dec));
      seen.set(key, v);
      return v;
    };
    const c = { ...chain, owned, checkoutOwned: owned };
    best = Math.max(best, base + walk(c, firstPending(c)));
    const byLevel = new Map<number, number>();
    chain.meta.forEach((m, i) => {
      if (m.kind === "downsell" || byLevel.has(m.level)) return;
      if (eligible(c, i) && priceRow(c.steps[i])?.amount) byLevel.set(m.level, i);
    });
    picks.push({ combo, byLevel });
  }

  // Nombres de los productos que aparecen en condiciones e «includes».
  const refIds = [...new Set([
    ...chain.meta.flatMap((m) => Object.values(m.showIf ?? {}).flat()),
    ...chain.steps.flatMap((p) => p.includes ?? []),
  ])];
  const { data: refRows } = refIds.length ? await db.from("products").select("id,short_name").in("id", refIds) : { data: [] };
  const nameOf = new Map((refRows ?? []).map((r) => [r.id as string, r.short_name as string]));
  const q = (ids: string[] | undefined, sep: string) => (ids ?? []).map((id) => `«${nameOf.get(id) ?? "?"}»`).join(sep);
  const conditionOf = (i: number) => {
    const c = chain.meta[i]?.showIf;
    if (!c) return null;
    const parts: string[] = [];
    // Lo del checkout, en palabras: «Si en el checkout agregó «A» y no «B»».
    const yes = c.checkout_any?.length ? `agregó ${q(c.checkout_any, " o ")}` : "";
    const no = c.checkout_none?.length ? `${yes ? "y no" : "no agregó"} ${q(c.checkout_none, " ni ")}` : "";
    if (yes || no) parts.push(`Si en el checkout ${[yes, no].filter(Boolean).join(" ")}`);
    if (c.owns_any?.length) parts.push(`Si ya tiene ${q(c.owns_any, " o ")}`);
    if (c.owns_none?.length) parts.push(`Si no tiene ${q(c.owns_none, " ni ")}`);
    return parts.join(" · ");
  };

  // Lo que rindió cada paso: vistas y compras de pedidos de este checkout.
  const ids = [...new Set(chain.steps.map((p) => p.id))];
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const stats = new Map<string, { views: number; accepts: number }>();
  const byOrder = new Map<string, { product: string; event: string; at: string }[]>();
  if (ids.length) {
    let qe = db
      .from("upsell_events")
      .select("order_id,product_id,event,created_at,orders!inner(funnel_id)")
      .eq("orders.funnel_id", f.id)
      .in("product_id", ids)
      .in("event", ["view", "accept"])
      .gte("created_at", since);
    if (chain.ppFunnelId) qe = qe.eq("pp_funnel_id", chain.ppFunnelId);
    const { data: ev } = await qe.range(0, 9999);
    for (const e of ev ?? []) {
      const r = stats.get(e.product_id as string) ?? { views: 0, accepts: 0 };
      if (e.event === "view") r.views++;
      else r.accepts++;
      stats.set(e.product_id as string, r);
      const l = byOrder.get(e.order_id as string) ?? [];
      l.push({ product: e.product_id as string, event: e.event as string, at: e.created_at as string });
      byOrder.set(e.order_id as string, l);
    }
  }
  // Camino más común: por pedido, qué vio y qué compró, en orden.
  const shortName = (pid: string) => chain.steps.find((p) => p.id === pid)?.short_name ?? "?";
  const paths = new Map<string, number>();
  for (const evs of byOrder.values()) {
    const viewed = evs.filter((e) => e.event === "view").sort((a, b) => a.at.localeCompare(b.at));
    const bought = new Set(evs.filter((e) => e.event === "accept").map((e) => e.product));
    const key = viewed.map((v) => `${shortName(v.product)}: ${bought.has(v.product) ? "compra" : "no"}`).join(" → ");
    if (key) paths.set(key, (paths.get(key) ?? 0) + 1);
  }
  const common = [...paths.entries()].sort((a, b) => b[1] - a[1])[0];

  const target = (i: number) => {
    if (i < 0) return END;
    const m = chain.meta[i];
    return m?.kind === "downsell" ? `Downsell · ${chain.steps[i].short_name}` : `${labels[i].replace(/[a-z]$/, "")} · ${chain.steps[i].short_name}`;
  };
  const sim = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ store: store.slug, funnel: f.id, lang: locale, currency, ...(ppFunnelId ? { pp: ppFunnelId } : {}), ...extra });
    return `/oferta/simulacion?${qs.toString()}`;
  };
  // Para simular desde un paso hace falta el estado con el que se llega (bumps).
  const bumpsFor = (i: number): Record<string, string> => {
    const c = chain.meta[i]?.showIf;
    const need = [...(c?.checkout_any ?? []), ...(c?.owns_any ?? [])].filter((id) => bumpIds.includes(id));
    return need.length ? { bumps: need.join(",") } : {};
  };

  const nodeOf = (p: Product, i: number): FlowNode => {
    const s = stats.get(p.id) ?? { views: 0, accepts: 0 };
    const pr = priceRow(p);
    const amount = Number(pr?.amount ?? 0);
    const compare = Number(pr?.compare_at ?? 0);
    const inc = (p.includes ?? []).map((id) => nameOf.get(id)).filter(Boolean);
    const r = routes.get(i);
    const desc = (p.description ?? "").trim();
    return {
      index: i,
      kind: chain.meta[i]?.kind ?? "oto",
      label: labels[i],
      product: { id: p.id, slug: p.slug, name: p.short_name, image: p.image_url },
      price: amount ? fmt(amount) : null,
      compare: compare > amount ? fmt(compare) : null,
      inside: inc.length && !p.is_library && (p.book_count ?? inc.length) === inc.length
        ? `Trae: ${inc.join(" + ")}`
        : desc.length > 160 ? `${desc.slice(0, 157).trimEnd()}…` : desc,
      stats: { ...s, rate: s.views ? s.accepts / s.views : null },
      placeholder: chain.meta[i]?.active === false,
      reachable: reach.has(i),
      acceptTo: target(r ? r.accept : afterAccept(chain, i)),
      declineTo: target(r ? r.decline : afterDecline(chain, i)),
      previewUrl: `/oferta/preview?store=${encodeURIComponent(store.slug)}&product=${encodeURIComponent(p.slug)}&lang=${locale}&currency=${currency}`,
      simUrl: sim({ step: String(i), ...bumpsFor(chain.meta[i]?.parent ?? i) }),
    };
  };

  const nodes = chain.steps.map((p, i) => nodeOf(p, i));
  // Los downsells dicen qué son respecto de su OTO: la misma oferta más barata (o, en cadenas viejas, una parte).
  for (const n of nodes) {
    const parent = chain.meta[n.index]?.parent;
    if (n.kind !== "downsell" || parent == null) continue;
    const d = chain.steps[n.index], o = chain.steps[parent];
    const dp = amountOf(d), op = amountOf(o);
    n.inside = (d.variant_of ?? d.id) === (o.variant_of ?? o.id)
      ? `Lo mismo que el OTO, más barato${dp && op ? `: ${fmt(dp)} en vez de ${fmt(op)} (−${Math.round((1 - dp / op) * 100)}%)` : ""}`
      : `Lo mismo que el OTO pero con menos: ${bookCount(d)} de ${bookCount(o)} libro${bookCount(o) === 1 ? "" : "s"}`;
  }
  const levels: FlowLevel[] = [];
  chain.meta.forEach((m, i) => {
    if (m.kind === "downsell") return;
    const level = `OTO ${m.level}`;
    let L = levels.find((x) => x.level === level);
    if (!L) levels.push((L = { level, branches: [] }));
    L.branches.push({
      condition: conditionOf(i),
      oto: nodes[i],
      downsells: nodes.filter((n) => chain.meta[n.index]?.kind === "downsell" && chain.meta[n.index]?.parent === i),
    });
  });

  return {
    chainName: chain.name,
    days,
    currency,
    checkout: {
      name: f.market_label ? `${f.name} · ${f.market_label}` : f.name,
      image: main?.image_url ?? null,
      price: main && amountOf(main) ? fmt(amountOf(main)) : null,
      url: checkoutUrl(f, store.slug),
      simUrl: sim({ step: "0" }),
      bumps: bumpProducts.map((b) => `${b.short_name}${amountOf(b) ? ` (${fmt(amountOf(b))})` : ""}`),
      firstTo: target(firstPending(chain)),
    },
    levels,
    nodes,
    slots: [1, 2, 3].map((level): FlowSlot => {
      const otos = chain.meta.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === "oto" && m.level === level);
      const placeholder = otos.length > 0 && otos.every(({ m }) => m.active === false);
      const none = picks.find((pk) => !pk.combo.length)?.byLevel.get(level);
      const head = none ?? otos.find(({ m }) => m.active !== false)?.i ?? otos[0]?.i;
      const comboText = (combo: string[]) => {
        if (!combo.length) return "Si no agregó nada en el checkout";
        if (combo.length === bumpIds.length && combo.length > 1) return "Si agregó todo en el checkout";
        return `Si en el checkout agregó ${combo.map((id) => `«${bumpProducts.find((b) => b.id === id)?.short_name ?? "?"}»`).join(" y ")}`;
      };
      const alternatives = placeholder ? [] : picks.filter((pk) => pk.combo.length).map((pk) => {
        const i = pk.byLevel.get(level);
        return i === undefined || i < 0 ? `${comboText(pk.combo)}: se saltea` : i === head ? null : `${comboText(pk.combo)}: ${chain.steps[i].short_name}${nodes[i].price ? ` ${nodes[i].price}` : ""}`;
      }).filter((x): x is string => !!x);
      const dsIndex = head === undefined ? -1 : chain.meta.findIndex((m) => m.kind === "downsell" && m.parent === head);
      return {
        level, placeholder,
        oto: head === undefined ? null : nodes[head],
        alternatives,
        ds: dsIndex >= 0 ? nodes[dsIndex] : null,
        dsNote: dsIndex >= 0 ? nodes[dsIndex].inside : null,
      };
    }),
    paused: chain.paused ?? false,
    problems: chain.ppFunnelId
      ? await ppProblems(((await db.from("pp_steps").select("id,product_id,kind,downsell_of,level,sort_order,show_if").eq("pp_funnel_id", chain.ppFunnelId)).data ?? []) as PpRow[])
      : [],
    summary: {
      maxTicket: best ? fmt(best) : null,
      commonPath: common ? `${common[0]} (${common[1]} de ${byOrder.size} pedidos)` : null,
      orders: byOrder.size,
    },
    endSimUrl: sim({ step: "done" }),
  };
}
