import { createHash, randomBytes } from "crypto";
import { db } from "./db";

/**
 * Lo que es de un socio (para su IA por MCP): sus ofertas (partners.offer_ids), sus checkouts, los post-pagos de
 * esos checkouts y los productos que usan (principal, bumps, bonus, upsells, pasos del post-pago, sus packs y sus
 * variantes de precio), más los que creó su IA (products.partner_email). Se calcula en cada pedido: lo que el dueño le
 * asigna o le saca rige al instante.
 */
export type PartnerScope = {
  email: string;
  stores: Map<string, string>;          // slug → id
  offers: Set<string>;                  // "tienda/oferta"
  funnels: Set<string>;                 // "tienda/checkout"
  pps: Set<string>;                     // id del post-pago
  products: Set<string>;                // "tienda/producto"
};

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function newPartnerToken() {
  const token = `cs_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashToken(token), hint: `${token.slice(0, 6)}…${token.slice(-4)}` };
}

/** El socio dueño de este token (Authorization: Bearer cs_…), si está activo. */
export async function partnerForToken(header: string | null): Promise<string | null> {
  const t = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^cs_[A-Za-z0-9_-]{20,}$/.test(t)) return null;
  const { data } = await db.from("partners").select("email,active").eq("mcp_token_hash", hashToken(t)).maybeSingle();
  return data?.active ? (data.email as string) : null;
}

export async function partnerScope(email: string): Promise<PartnerScope> {
  const { data: p } = await db.from("partners").select("email,offer_ids,active").eq("email", email).maybeSingle();
  if (!p?.active) throw new Error("Socio inactivo");
  const offerIds = (p.offer_ids as string[]) ?? [];
  const sc: PartnerScope = { email, stores: new Map(), offers: new Set(), funnels: new Set(), pps: new Set(), products: new Set() };
  const { data: offers } = offerIds.length ? await db.from("offers").select("id,slug,store_id,stores!inner(slug)").in("id", offerIds) : { data: [] };
  const storeSlug = new Map<string, string>();
  for (const o of offers ?? []) {
    const ss = (o.stores as unknown as { slug: string }).slug;
    storeSlug.set(o.store_id as string, ss);
    sc.stores.set(ss, o.store_id as string);
    sc.offers.add(`${ss}/${o.slug}`);
  }
  const { data: funnels } = offerIds.length ? await db.from("funnels").select("id,slug,store_id,main_product_id").in("offer_id", offerIds) : { data: [] };
  const fIds = (funnels ?? []).map((f) => f.id as string);
  for (const f of funnels ?? []) sc.funnels.add(`${storeSlug.get(f.store_id as string)}/${f.slug}`);
  const [{ data: items }, { data: pps }] = fIds.length
    ? await Promise.all([
        db.from("funnel_items").select("product_id").in("funnel_id", fIds),
        db.from("pp_funnels").select("id,trigger_product_ids").in("checkout_funnel_id", fIds),
      ])
    : [{ data: [] }, { data: [] }];
  for (const pp of pps ?? []) sc.pps.add(pp.id as string);
  const ppIds = [...sc.pps];
  const { data: steps } = ppIds.length ? await db.from("pp_steps").select("product_id").in("pp_funnel_id", ppIds) : { data: [] };
  const ids = new Set<string>([
    ...(funnels ?? []).map((f) => f.main_product_id as string),
    ...(items ?? []).map((i) => i.product_id as string),
    ...(steps ?? []).map((s) => s.product_id as string),
    ...(pps ?? []).flatMap((pp) => (pp.trigger_product_ids as string[]) ?? []),
  ].filter(Boolean));
  const storeIds = [...sc.stores.values()];
  const { data: created } = storeIds.length ? await db.from("products").select("id").in("store_id", storeIds).eq("partner_email", email) : { data: [] };
  for (const c of created ?? []) ids.add(c.id as string);
  // Sus packs (includes), las bases de sus variantes y las variantes de precio de los suyos (los «-half» del post-pago).
  if (storeIds.length) {
    const { data: all } = await db.from("products").select("id,slug,store_id,includes,variant_of").in("store_id", storeIds);
    for (let pass = 0; pass < 3; pass++) {
      for (const pr of all ?? []) {
        if (ids.has(pr.id as string)) {
          for (const x of (pr.includes as string[] | null) ?? []) ids.add(x);
          if (pr.variant_of) ids.add(pr.variant_of as string);
        } else if (pr.variant_of && ids.has(pr.variant_of as string)) ids.add(pr.id as string);
      }
    }
    for (const pr of all ?? []) if (ids.has(pr.id as string)) sc.products.add(`${storeSlug.get(pr.store_id as string)}/${pr.slug}`);
  }
  return sc;
}
