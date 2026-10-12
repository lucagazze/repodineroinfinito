import { db } from "./db";
import { storeProducts } from "./fetch-all";

/**
 * Compras hechas en una plataforma anterior (si la tienda vendía en otro checkout antes de esta app y cobraba con
 * las mismas cuentas de Stripe), para que la IA del buzón y la biblioteca de clientes las reconozcan y pasen los
 * links del libro aunque la compra no esté en esta base.
 *
 * Conexión (opcional, por variables de entorno): una función RPC de Postgres de solo lectura en otro proyecto de
 * Supabase (o cualquier PostgREST) que recibe { p_key, p_emails } y devuelve las filas con la forma de `Raw`.
 *   LEGACY_LOOKUP_URL   https://<proyecto>.supabase.co
 *   LEGACY_LOOKUP_ANON  su clave publicable (pública por diseño)
 *   LEGACY_LOOKUP_KEY   la clave que valida la función (en la otra base, guardar solo su hash)
 *   LEGACY_LOOKUP_RPC   nombre de la función (por defecto orders_lookup)
 * Sin LEGACY_LOOKUP_URL / LEGACY_LOOKUP_KEY no se consulta nada y devuelve [].
 *
 * Los links salen de los productos de ESTA tienda con el mismo nombre (con o sin el subtítulo «— …»): si el
 * nombre no aparece, o aparece con links distintos, ese libro va sin link (la IA no inventa: lo deja para el dueño).
 */
type Raw = {
  order_id: string; order_number: number; status: string; ext_store: string | null; store_name: string | null; subdomain: string | null;
  total: number | null; currency: string | null; buyer_total: number | null; buyer_currency: string | null; customer_email: string;
  order_created_at: string; items: { name?: string; type?: string; price?: number; quantity?: number }[]; is_post_purchase: boolean; parent_order_id: string | null;
};
export type ExtItem = { product: string; kind: string; links: string[]; status: "available" | "no_link" | "check_link"; /** El producto de la app (su base), si se reconoce sin dudas. */ productId?: string | null };
export type ExtOrder = {
  ref: string; order_id: string; parent_ref: string | null; email: string; purchased_on: string; days_since_purchase: number;
  status: "paid" | "not_paid"; raw_status: string; is_post_purchase: boolean; total_paid: number; currency: string; items: ExtItem[];
  /** «name»: no salió por su mail sino por su nombre o un mail casi igual (gnail.com, .con): lo revisa el dueño. */
  found_by?: "email" | "name";
};

const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const head = (x: string | null | undefined) => norm((x ?? "").split(/ [—–-] /)[0]);
const http = (u: string | null | undefined): u is string => !!u && /^https?:\/\//.test(u);

async function lookup(emails: string[]): Promise<Raw[]> {
  const key = process.env.LEGACY_LOOKUP_KEY?.trim();
  const base = process.env.LEGACY_LOOKUP_URL?.trim().replace(/\/+$/, "");
  if (!key || !base || !emails.length) return [];
  const anon = process.env.LEGACY_LOOKUP_ANON?.trim() ?? "";
  const rpc = process.env.LEGACY_LOOKUP_RPC?.trim() || "orders_lookup";
  try {
    const r = await fetch(`${base}/rest/v1/rpc/${encodeURIComponent(rpc)}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { ...(anon ? { apikey: anon, authorization: `Bearer ${anon}` } : {}), "content-type": "application/json" },
      body: JSON.stringify({ p_key: key, p_emails: emails.slice(0, 6) }),
    });
    if (!r.ok) { console.error("[legacy] lookup", r.status, (await r.text()).slice(0, 200)); return []; }
    return (await r.json()) as Raw[];
  } catch (e) {
    console.error("[legacy] lookup", (e as Error).message);
    return [];
  }
}

export async function legacyOrders(emails: string[], store: { id: string; slug: string; name: string; display_name?: string | null }): Promise<ExtOrder[]> {
  const raw = await lookup(emails);
  if (!raw.length) return [];
  // De qué tienda de la app es cada tienda de la plataforma anterior: la cuenta de Stripe con la que cobró, el subdominio o el nombre.
  const extIds = [...new Set(raw.map((o) => o.ext_store).filter((x): x is string => !!x))];
  const { data: mine } = extIds.length
    ? await db.from("stripe_balance_txns").select("ext_store").eq("store_id", store.id).in("ext_store", extIds).limit(500)
    : { data: [] as { ext_store: string }[] };
  const ours = new Set((mine ?? []).map((r) => r.ext_store as string));
  const names = new Set([norm(store.name), norm(store.display_name)].filter(Boolean));
  const rows = raw.filter((o) => (o.ext_store && ours.has(o.ext_store)) || o.subdomain === store.slug || names.has(norm(o.store_name)));
  if (!rows.length) return [];

  // Los links de cada libro: los productos de esta tienda con ese nombre.
  type P = { id: string; name: string; short_name: string | null; delivery_url: string | null; delivery_links: { url: string }[] | null; variant_of: string | null };
  // Sin el corte de 1000 filas de Supabase (la tienda ya tiene más productos).
  const all = await storeProducts<P>(store.id, "id,name,short_name,delivery_url,delivery_links,variant_of");
  const byId = new Map(all.map((p) => [p.id, p]));
  const own = (p: P | undefined) => (p ? [p.delivery_url, ...(p.delivery_links ?? []).map((l) => l.url)].filter(http) : []);
  const linksOf = (p: P) => { const l = own(p); return l.length ? l : own(byId.get(p.variant_of ?? "")); };
  const index = new Map<string, Set<string>>();
  const bases = new Map<string, Set<string>>();
  for (const p of all) {
    const key = linksOf(p).join(" ");
    if (!key) continue;
    for (const k of new Set([norm(p.name), norm(p.short_name), `h:${head(p.name)}`, `h:${head(p.short_name)}`])) {
      if (!k || k === "h:") continue;
      (index.get(k) ?? index.set(k, new Set()).get(k)!).add(key);
      (bases.get(k) ?? bases.set(k, new Set()).get(k)!).add(p.variant_of ?? p.id);
    }
  }
  const find = (name: string): { links: string[]; productId: string | null } => {
    for (const k of [norm(name), `h:${head(name)}`]) {
      const s = index.get(k);
      const b = bases.get(k);
      if (s?.size === 1) return { links: [...s][0].split(" "), productId: b?.size === 1 ? [...b][0] : null };
      if (s && s.size > 1) return { links: [], productId: null }; // mismo nombre con links distintos: mejor que lo vea el dueño
    }
    return { links: [], productId: null };
  };

  const numberOf = new Map(rows.map((o) => [o.order_id, String(o.order_number)]));
  const now = Date.now();
  return rows.map((o) => {
    const paid = o.status === "approved";
    return {
      ref: String(o.order_number), order_id: o.order_id, parent_ref: o.parent_order_id ? numberOf.get(o.parent_order_id) ?? null : null,
      email: o.customer_email, purchased_on: o.order_created_at.slice(0, 10),
      days_since_purchase: Math.floor((now - Date.parse(o.order_created_at)) / 864e5),
      status: paid ? "paid" : "not_paid", raw_status: o.status, is_post_purchase: o.is_post_purchase,
      total_paid: Number(o.buyer_total ?? o.total ?? 0), currency: (o.buyer_currency ?? o.currency ?? "").toUpperCase(),
      items: (o.items ?? []).map((i) => {
        const hit = paid ? find(i.name ?? "") : { links: [], productId: null };
        return { product: i.name ?? "(producto)", kind: i.type ?? "", links: hit.links, status: hit.links.length ? "available" : "no_link", productId: hit.productId } as ExtItem;
      }),
    };
  });
}
