import { db, getProductById, type Product } from "./db";

/**
 * Qué se le ofrece a un comprador después de pagar.
 *
 * Mismo modelo que la plataforma anterior: cada funnel post-compra tiene un "trigger",
 * el conjunto de productos del pedido que lo dispara (principal + order
 * bumps). Así el que agarró 2 bumps en el checkout ve otras ofertas que el
 * que no agarró ninguno.
 *
 * Reglas, en orden:
 *  1. Si el pedido ya tiene funnel elegido, se respeta. Comprar el upsell del
 *     paso 1 cambia lo que tiene, y no queremos que eso cambie el funnel.
 *  2. Coincidencia exacta del trigger.
 *  3. El trigger más grande que esté contenido en lo que compró.
 *  4. Sin funnels post-compra: los upsells cargados en el embudo del checkout.
 *
 * Niveles: la cadena son hasta 3 escalones (OTO 1, OTO 2, OTO 3). Un nivel
 * puede tener varios OTO alternativos según lo que compró en el checkout
 * (show_if): el comprador ve uno solo. Cada OTO puede tener un downsell
 * (kind = 'downsell'), que solo aparece si lo RECHAZÓ. Después de cualquier
 * respuesta en un nivel (sí al OTO, sí o no al downsell, o no a un OTO sin
 * downsell) se pasa al nivel siguiente. Nunca se ofrece algo que ya tiene:
 * ni el producto, ni su base (variant_of), ni un pack con algo suyo adentro.
 * Las cadenas viejas, sin niveles, se comportan como antes: cada OTO es su
 * propio nivel.
 */

/**
 * Condición de un paso (pp_steps.show_if). owns_* mira todo lo que el
 * comprador ya tiene (checkout + lo que aceptó antes en la cadena);
 * checkout_* mira solo lo que compró en el checkout (principal, bumps, bonos),
 * así una rama «si agregó X en el checkout» no se abre porque X lo compró
 * después en un downsell.
 */
export type ShowIf = { owns_any?: string[]; owns_none?: string[]; checkout_any?: string[]; checkout_none?: string[] };

export type StepMeta = {
  kind: "oto" | "downsell";
  /** Índice del OTO del que cuelga (solo downsells). */
  parent: number | null;
  /** Solo se muestra si se cumple (null = siempre). */
  showIf: ShowIf | null;
  /** Producto archivado (active = false): no se ofrece. En el panel es un lugar reservado («próximamente»). */
  active: boolean;
  /** Escalón (1, 2, 3…). Los downsells, el de su OTO. */
  level: number;
};

export type Chain = {
  ppFunnelId: string | null;
  name: string | null;
  /** Cadena completa, incluidos los que ya tiene: el índice de /oferta/N apunta acá. */
  steps: Product[];
  /** Mismo largo que steps: si cada paso es OTO o downsell, de qué OTO, y su condición. */
  meta: StepMeta[];
  /**
   * Lo que ya tiene: los productos del pedido (principal, bumps, OTOs
   * aceptados) y, si alguno es un pack, todo lo que incluye.
   */
  owned: Set<string>;
  /** Solo lo del checkout (principal, bumps, incluidos y bonos), con lo que incluyen. */
  checkoutOwned: Set<string>;
  /** Solo en simulaciones del panel: la cadena está pausada (los compradores reales no la ven). */
  paused?: boolean;
};

type OrderRef = { id: string; store_id: string; funnel_id: string | null; pp_funnel_id?: string | null };

/**
 * Lo que tiene, completo: cada producto, su base si es una variante de precio
 * (variant_of), y lo que incluyen los packs.
 */
export async function expandOwned(ids: Iterable<string>) {
  const out = new Set([...ids].filter(Boolean));
  if (!out.size) return out;
  const { data } = await db.from("products").select("id,includes,variant_of").in("id", [...out]);
  for (const r of data ?? []) {
    for (const id of (r.includes as string[] | null) ?? []) out.add(id);
    if (r.variant_of) out.add(r.variant_of as string);
  }
  return out;
}

export async function resolveChain(order: OrderRef): Promise<Chain> {
  const { data: items } = await db
    .from("order_items")
    .select("product_id,kind")
    .eq("order_id", order.id);

  const owned = await expandOwned((items ?? []).map((i) => i.product_id as string));
  const checkoutOwned = await expandOwned((items ?? []).filter((i) => i.kind !== "upsell").map((i) => i.product_id as string));
  const trigger = new Set(
    (items ?? [])
      .filter((i) => i.kind === "main" || i.kind === "bump")
      .map((i) => i.product_id as string)
  );

  let ppId = order.pp_funnel_id ?? null;
  if (!ppId) {
    ppId = await pickFunnel(order.store_id, order.funnel_id, trigger);
    if (ppId) await db.from("orders").update({ pp_funnel_id: ppId }).eq("id", order.id);
  }
  const chain = await chainFor(ppId, order.funnel_id);
  return { ...chain, owned, checkoutOwned };
}

/** Qué funnel post-compra dispara un conjunto de productos comprados. */
export async function pickFunnel(
  storeId: string,
  checkoutFunnelId: string | null,
  trigger: Set<string>,
  opts: { includePaused?: boolean } = {}
): Promise<string | null> {
  return (await pickFunnelRow(storeId, checkoutFunnelId, trigger, opts))?.id ?? null;
}

/**
 * Igual que pickFunnel, y con `includePaused` (solo el panel: simulación y
 * compra de prueba) también mira las cadenas pausadas si no hay una activa,
 * para poder probar una cadena antes de prenderla.
 */
async function pickFunnelRow(
  storeId: string,
  checkoutFunnelId: string | null,
  trigger: Set<string>,
  opts: { includePaused?: boolean } = {}
): Promise<{ id: string; active: boolean } | null> {
  let q = db
    .from("pp_funnels")
    .select("id,active,trigger_product_ids,checkout_funnel_id")
    .eq("store_id", storeId);
  if (!opts.includePaused) q = q.eq("active", true);
  const { data: candidates } = await q;

  const pick = (rows: NonNullable<typeof candidates>) => {
    const usable = rows.filter((c) => !c.checkout_funnel_id || c.checkout_funnel_id === checkoutFunnelId);
    const exact = usable.find(
      (c) =>
        c.trigger_product_ids.length === trigger.size &&
        c.trigger_product_ids.every((id: string) => trigger.has(id))
    );
    const contained = usable
      .filter((c) => c.trigger_product_ids.every((id: string) => trigger.has(id)))
      .sort((a, b) => b.trigger_product_ids.length - a.trigger_product_ids.length)[0];
    return exact ?? contained ?? null;
  };
  const all = candidates ?? [];
  const row = pick(all.filter((c) => c.active)) ?? (opts.includePaused ? pick(all.filter((c) => !c.active)) : null);
  return row ? { id: row.id as string, active: row.active !== false } : null;
}

type StepRow = {
  id: string; sort_order: number; product_id: string;
  kind?: string | null; downsell_of?: string | null; show_if?: unknown; level?: number | null;
};

/**
 * Nivel de cada paso ya ordenado: el guardado, o (cadenas viejas) uno nuevo
 * por cada OTO. Los downsells, el de su OTO.
 */
export function resolveLevels<R extends StepRow>(ordered: { row: R; parentRow: R | null }[]) {
  const levelOf = new Map<string, number>();
  let last = 0;
  for (const s of ordered) {
    if (s.parentRow) continue;
    const lv = s.row.level ?? last + 1;
    levelOf.set(s.row.id, lv);
    last = Math.max(last, lv);
  }
  return ordered.map((s) => levelOf.get(s.parentRow ? s.parentRow.id : s.row.id) ?? 1);
}

/** show_if tal como viene de la base: solo listas de ids; lo demás se ignora. */
export function parseShowIf(raw: unknown): ShowIf | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
  const out: ShowIf = {};
  for (const k of ["owns_any", "owns_none", "checkout_any", "checkout_none"] as const) if (ids(r[k]).length) out[k] = ids(r[k]);
  return Object.keys(out).length ? out : null;
}

/**
 * Ordena los pasos: cada OTO seguido de sus downsells. Un downsell sin OTO
 * se descarta.
 */
export function orderSteps<R extends StepRow>(rows: R[]) {
  const byOrder = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const out: { row: R; parentRow: R | null }[] = [];
  for (const o of byOrder.filter((r) => r.kind !== "downsell")) {
    out.push({ row: o, parentRow: null });
    for (const d of byOrder) if (d.kind === "downsell" && d.downsell_of === o.id) out.push({ row: d, parentRow: o });
  }
  return out;
}

/**
 * Etiqueta corta de cada producto de una cadena post-compra: «OTO 1», «DS 1»
 * (el downsell lleva el nivel de su OTO). Para el push y los items del pedido.
 * Un producto está una sola vez por cadena (único en pp_steps).
 */
export async function stepTags(ppFunnelId: string | null | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ppFunnelId) return out;
  const { data } = await db.from("pp_steps").select("id,sort_order,product_id,kind,downsell_of,level").eq("pp_funnel_id", ppFunnelId);
  const ordered = orderSteps((data ?? []) as StepRow[]);
  const levels = resolveLevels(ordered);
  ordered.forEach((s, i) => out.set(s.row.product_id, `${s.parentRow ? "DS" : "OTO"} ${levels[i]}`));
  return out;
}

async function chainFor(ppId: string | null, checkoutFunnelId: string | null) {
  if (ppId) {
    const { data: f } = await db
      .from("pp_funnels")
      .select("id,name,pp_steps(id,sort_order,product_id,kind,downsell_of,show_if,level)")
      .eq("id", ppId)
      .maybeSingle();
    const ordered = orderSteps((f?.pp_steps ?? []) as StepRow[]);
    const [products, { data: flags }] = await Promise.all([
      Promise.all(ordered.map((s) => getProductById(s.row.product_id))),
      db.from("products").select("id,active").in("id", ordered.length ? ordered.map((s) => s.row.product_id) : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const isActive = new Map((flags ?? []).map((r) => [r.id as string, r.active !== false]));
    const levels = resolveLevels(ordered);
    const steps: Product[] = [];
    const meta: StepMeta[] = [];
    const indexOfRow = new Map<string, number>();
    ordered.forEach((s, i) => {
      const p = products[i];
      if (!p) return;
      const showIf = parseShowIf(s.row.show_if);
      if (s.parentRow) {
        const parent = indexOfRow.get(s.parentRow.id);
        if (parent === undefined) return; // su OTO no quedó en la cadena
        meta.push({ kind: "downsell", parent, showIf, active: isActive.get(p.id) ?? true, level: levels[i] });
      } else {
        indexOfRow.set(s.row.id, steps.length);
        meta.push({ kind: "oto", parent: null, showIf, active: isActive.get(p.id) ?? true, level: levels[i] });
      }
      steps.push(p);
    });
    return { ppFunnelId: ppId, name: f?.name ?? null, steps, meta };
  }

  // Sin funnels post-compra configurados: la cadena del embudo del checkout.
  if (!checkoutFunnelId) return { ppFunnelId: null, name: null, steps: [] as Product[], meta: [] as StepMeta[] };
  const { data: legacy } = await db
    .from("funnel_items")
    .select("sort_order,product_id")
    .eq("funnel_id", checkoutFunnelId)
    .eq("role", "upsell")
    .order("sort_order");
  const steps = (
    await Promise.all((legacy ?? []).map((s) => getProductById(s.product_id)))
  ).filter((p): p is Product => !!p);
  return { ppFunnelId: null, name: null, steps, meta: steps.map((_, i): StepMeta => ({ kind: "oto", parent: null, showIf: null, active: true, level: i + 1 })) };
}

/**
 * Simulación para el panel: "si alguien compra este embudo y tilda estos
 * bumps, ¿qué ve después de pagar?". Usa exactamente la misma lógica que
 * el checkout real, así lo que muestra el panel es lo que pasa.
 *
 * `full`: la cadena entera, con `owned` = lo que tiene al salir del checkout,
 * para recorrerla con las mismas reglas que un pedido (simulación, compra de
 * prueba, diagrama). Sin `full`: solo los OTO que vería si rechaza todo, con
 * sus downsells (la lista de "qué le ofrece").
 */
export async function simulate(
  storeId: string, checkoutFunnelId: string, bumpIds: string[],
  opts: { full?: boolean; includePaused?: boolean; ppFunnelId?: string | null } = {},
): Promise<Chain> {
  const { data: f } = await db
    .from("funnels")
    .select("main_product_id,funnel_items(role,product_id)")
    .eq("id", checkoutFunnelId)
    .single();
  const trigger = new Set([f?.main_product_id, ...bumpIds].filter(Boolean) as string[]);
  // Como en el pedido real: lo incluido y los bonos del checkout también son suyos.
  const bundled = ((f?.funnel_items ?? []) as { role: string; product_id: string }[])
    .filter((i) => i.role === "included" || i.role === "bonus").map((i) => i.product_id);
  const [pp, owned] = await Promise.all([
    opts.ppFunnelId ? forcedFunnel(storeId, checkoutFunnelId, opts.ppFunnelId) : pickFunnelRow(storeId, checkoutFunnelId, trigger, { includePaused: opts.includePaused }),
    expandOwned([...trigger, ...bundled]),
  ]);
  const chain: Chain = { ...(await chainFor(pp?.id ?? null, checkoutFunnelId)), owned, checkoutOwned: owned, paused: pp ? !pp.active : false };
  if (opts.full) return chain;

  // Se sacan los que no puede ver (ya los tiene, o no cumplen la condición), y con ellos sus downsells.
  const keep: boolean[] = [];
  chain.steps.forEach((_, i) => {
    const m = chain.meta[i];
    keep.push(eligible(chain, i) && (m?.kind !== "downsell" || (m.parent !== null && keep[m.parent])));
  });
  const newIndex = new Map<number, number>();
  keep.forEach((k, i) => { if (k) newIndex.set(i, newIndex.size); });
  return {
    ...chain,
    steps: chain.steps.filter((_, i) => keep[i]),
    meta: chain.meta.filter((_, i) => keep[i]).map((m) => (m.parent === null ? m : { ...m, parent: newIndex.get(m.parent) ?? null })),
  };
}

/** Una cadena elegida a mano en el panel (para probarla aunque no sea la que se dispara): de esta tienda y de este checkout. */
async function forcedFunnel(storeId: string, checkoutFunnelId: string, ppId: string) {
  const { data } = await db.from("pp_funnels").select("id,active,checkout_funnel_id").eq("id", ppId).eq("store_id", storeId).maybeSingle();
  if (!data || (data.checkout_funnel_id && data.checkout_funnel_id !== checkoutFunnelId)) return null;
  return { id: data.id as string, active: data.active !== false };
}

type ChainLike = { steps: Product[]; meta?: StepMeta[]; owned: Set<string>; checkoutOwned?: Set<string> };
const isDownsell = (c: ChainLike, i: number) => c.meta?.[i]?.kind === "downsell";

type Owned = Pick<Product, "id" | "includes" | "variant_of"> & { is_library?: boolean | null };
/** El producto «de verdad»: una variante de precio cuenta como su base. */
export const baseOf = (p: Pick<Product, "id" | "variant_of">) => p.variant_of ?? p.id;
/** Lo que trae, como productos base: lo que incluye si es un pack, o él mismo. */
export const contentOf = (p: Owned) => ((p.includes ?? []).filter(Boolean).length ? (p.includes ?? []).filter(Boolean) : [baseOf(p)]);

/** ¿Ya lo tiene? El producto (o su base), o todo lo que incluye si es un pack. */
export function ownsProduct(owned: Set<string>, p: Owned) {
  if (owned.has(p.id) || owned.has(baseOf(p))) return true;
  const inc = (p.includes ?? []).filter(Boolean);
  return inc.length > 0 && inc.every((id) => owned.has(id));
}

/**
 * ¿Ya tiene algo de esto? El producto o CUALQUIERA de lo que incluye: un pack
 * del que ya tiene un libro no se le ofrece (nunca se cobra dos veces un libro);
 * para ese caso la cadena tiene que ofrecer el resto con una condición.
 */
export function overlapsOwned(owned: Set<string>, p: Owned) {
  return owned.has(p.id) || owned.has(baseOf(p)) || (p.includes ?? []).some((id) => owned.has(id));
}

/** ¿Se cumple la condición del paso con lo que tiene (y con lo que compró en el checkout)? */
export function conditionMet(showIf: ShowIf | null | undefined, owned: Set<string>, checkoutOwned: Set<string> = owned) {
  if (!showIf) return true;
  const any = (l: string[] | undefined, set: Set<string>) => !l?.length || l.some((id) => set.has(id));
  const none = (l: string[] | undefined, set: Set<string>) => !l?.length || !l.some((id) => set.has(id));
  return any(showIf.owns_any, owned) && none(showIf.owns_none, owned)
    && any(showIf.checkout_any, checkoutOwned) && none(showIf.checkout_none, checkoutOwned);
}

/**
 * El paso i se le puede ofrecer: está activo, no tiene nada de lo que trae
 * (ni el producto ni nada de lo que incluye) y cumple su condición.
 */
export function eligible(chain: ChainLike, i: number) {
  const p = chain.steps[i];
  const m = chain.meta?.[i];
  // La biblioteca completa es la excepción: se ofrece salvo que ya tenga todo lo que trae.
  const taken = p?.is_library ? ownsProduct(chain.owned, p) : !!p && overlapsOwned(chain.owned, p);
  return !!p && m?.active !== false && !taken && conditionMet(m?.showIf, chain.owned, chain.checkoutOwned ?? chain.owned);
}

/** La misma cadena, como si ya hubiera comprado `p` (su base y lo que incluye). */
export function withProduct<C extends ChainLike>(chain: C, p: Owned): C {
  return { ...chain, owned: new Set([...chain.owned, p.id, baseOf(p), ...(p.includes ?? [])]) };
}

const levelOf = (c: ChainLike, i: number) => c.meta?.[i]?.level ?? i + 1;

/**
 * El primer OTO que se le puede ofrecer de un nivel posterior a `level`, o -1.
 * `notSameAs`: lo que acaba de rechazar. Un OTO que trae EXACTAMENTE esos
 * mismos libros se saltea (pasa a la alternativa siguiente del nivel): no se le
 * vuelve a ofrecer lo mismo más barato en otro nivel. Uno que trae una parte
 * sí se ofrece (es un paso más chico).
 */
export function nextLevel(chain: ChainLike, level: number, notSameAs?: Owned | null) {
  const declined = notSameAs ? new Set(contentOf(notSameAs)) : null;
  for (let i = 0; i < chain.steps.length; i++) {
    if (isDownsell(chain, i) || levelOf(chain, i) <= level) continue;
    if (!eligible(chain, i)) continue;
    if (declined) {
      const c = new Set(contentOf(chain.steps[i]));
      if (c.size === declined.size && [...c].every((x) => declined.has(x))) continue;
    }
    return i;
  }
  return -1;
}

/**
 * Primer OTO que se le puede ofrecer desde `from`, o -1 si no queda nada.
 * Los downsells no cuentan: solo se llega a uno rechazando su OTO.
 */
export function firstPending(chain: ChainLike, from = 0) {
  for (let i = from; i < chain.steps.length; i++) {
    if (isDownsell(chain, i)) continue;
    if (eligible(chain, i)) return i;
  }
  return -1;
}

/**
 * ¿Se muestra el paso i? Un OTO, si se le puede ofrecer. Un downsell, además,
 * solo si no tiene lo de su OTO (si aceptó el OTO, el downsell se saltea).
 */
export function showable(chain: ChainLike, i: number) {
  if (!eligible(chain, i)) return false;
  if (!isDownsell(chain, i)) return true;
  const parent = chain.meta![i].parent;
  return parent !== null && !!chain.steps[parent] && !ownsProduct(chain.owned, chain.steps[parent]);
}

/** Si el paso i no se puede mostrar, a cuál ir (-1 = a las descargas). */
export function resolveStep(chain: ChainLike, i: number) {
  if (showable(chain, i)) return i;
  return isDownsell(chain, i) ? nextLevel(chain, levelOf(chain, i)) : firstPending(chain, i);
}

/** Después de comprar el paso i (OTO o downsell): el nivel siguiente, ya con eso comprado. */
export function afterAccept(chain: ChainLike, i: number) {
  const p = chain.steps[i];
  return nextLevel(p ? withProduct(chain, p) : chain, levelOf(chain, i));
}

/**
 * Después de rechazar el paso i: el downsell de ese OTO si tiene uno que se
 * pueda mostrar; si no (o si ya era el downsell), el nivel siguiente.
 */
export function afterDecline(chain: ChainLike, i: number) {
  if (!isDownsell(chain, i)) {
    for (let j = i + 1; j < chain.steps.length; j++) {
      if (isDownsell(chain, j) && chain.meta![j].parent === i && eligible(chain, j)) return j;
    }
  }
  return nextLevel(chain, levelOf(chain, i), chain.steps[i] ?? null);
}

/**
 * Autogenera un funnel post-compra por cada combinación de order bumps.
 *
 * Para un embudo con principal P y bumps B1..Bn crea 2^n funnels: el trigger
 * es P + los bumps de esa combinación, y los pasos son los productos del
 * "pool" que el comprador todavía no tiene, hasta `maxSteps`.
 *
 * Reemplaza los autogenerados anteriores de ese embudo; los armados a mano
 * no se tocan.
 */
export async function autogenerate(opts: {
  checkoutFunnelId: string;
  maxSteps: number;
  reserveMinutes?: number;
}) {
  const { data: f } = await db
    .from("funnels")
    .select("id,store_id,name,main_product_id,funnel_items(role,sort_order,product_id)")
    .eq("id", opts.checkoutFunnelId)
    .single();
  if (!f?.main_product_id) throw new Error("El embudo no tiene producto principal");

  const byRole = (role: string) =>
    [...f.funnel_items]
      .filter((i) => i.role === role)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => i.product_id as string);

  const bumps = [...new Set(byRole("bump"))];
  // Lo que se puede ofrecer: upsells primero (en su orden), después bumps.
  const pool = [...new Set([...byRole("upsell"), ...bumps])].filter(
    (id) => id !== f.main_product_id
  );
  if (bumps.length > 8) throw new Error("Más de 8 bumps: serían más de 256 funnels");

  const { data: names } = await db
    .from("products")
    .select("id,short_name")
    .in("id", [f.main_product_id, ...pool]);
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.short_name]));

  await db
    .from("pp_funnels")
    .delete()
    .eq("checkout_funnel_id", f.id)
    .eq("auto_generated", true);

  let created = 0;
  for (let mask = 0; mask < 1 << bumps.length; mask++) {
    const chosen = bumps.filter((_, i) => mask & (1 << i));
    const steps = pool.filter((id) => !chosen.includes(id)).slice(0, opts.maxSteps);
    if (!steps.length) continue;

    const label = chosen.length
      ? `${nameOf.get(f.main_product_id)} + ${chosen.map((id) => nameOf.get(id)).join(", ")}`
      : `${nameOf.get(f.main_product_id)} solo`;

    const { data: pp, error } = await db
      .from("pp_funnels")
      .insert({
        store_id: f.store_id,
        checkout_funnel_id: f.id,
        name: label,
        trigger_product_ids: [f.main_product_id, ...chosen],
        reserve_minutes: opts.reserveMinutes ?? 10,
        auto_generated: true,
        sort_order: mask,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await db.from("pp_steps").insert(
      steps.map((product_id, i) => ({ pp_funnel_id: pp.id, product_id, sort_order: i }))
    );
    created++;
  }
  return { created, bumps: bumps.length, pool: pool.length };
}
