import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { checkoutUrl } from "@/lib/checkout-url";
import { defineTool, getStore, storeArg, UserError, fetchAll } from "./util";

/**
 * Ofertas: la unidad con la que el dueño mira el negocio. Una oferta vive en una
 * tienda (la cuenta de Stripe que cobra) y agrupa sus checkouts por mercado
 * (funnels.offer_id + market_label), cada uno con sus bumps, post-compra y pixels.
 */

const slugArg = z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type OfferRow = { id: string; store_id: string; slug: string; name: string; image_url: string | null; notes: string; active: boolean };

async function offerBySlug(storeId: string, slug: string): Promise<OfferRow | null> {
  const { data } = await db.from("offers").select("id,store_id,slug,name,image_url,notes,active").eq("store_id", storeId).eq("slug", slug).maybeSingle();
  return (data as OfferRow) ?? null;
}

async function offerSales(funnelIds: string[], sinceIso: string) {
  if (!funnelIds.length) return { orders: 0, gross: {} as Record<string, number>, gross_usd: 0, checkouts_opened: 0, conversion: null as number | null };
  const [orders, { count: opened }, rates] = await Promise.all([
    fetchAll<{ currency: string | null; amount_total: number | null; status: string }>((a, b) =>
      db.from("orders").select("currency,amount_total,status").in("funnel_id", funnelIds).gte("created_at", sinceIso).range(a, b)),
    db.from("checkouts").select("id", { count: "exact", head: true }).in("funnel_id", funnelIds).gte("created_at", sinceIso),
    getRates(),
  ]);
  const paid = orders.filter((o) => o.status === "paid");
  const gross: Record<string, number> = {};
  let usd = 0;
  for (const o of paid) {
    const cur = (o.currency ?? "USD").toUpperCase();
    const amt = Number(o.amount_total ?? 0);
    gross[cur] = Math.round(((gross[cur] ?? 0) + amt) * 100) / 100;
    usd += amt / (rates[cur] ?? 1);
  }
  return {
    orders: paid.length,
    gross,
    gross_usd: Math.round(usd * 100) / 100,
    checkouts_opened: opened ?? 0,
    conversion: opened ? Math.round((paid.length / opened) * 1000) / 10 : null,
  };
}

export function registerOfferTools(server: McpServer) {
  defineTool(server, "list_offers", {
    title: "List offers",
    kind: "read",
    description:
      "Offers (the owner's unit of business): each belongs to a store (the Stripe account that charges) and groups its checkouts per market (market_label like «EE. UU. + Reino Unido»). Returns store, slug, name, active, notes, checkouts (slug, market_label, active, public URL) and sales of the last 30 days (paid orders, gross per currency and in USD, checkouts opened, conversion %). Inactive offers are paused or archived.",
    input: z.object({
      store: z.string().optional().describe("Store slug. Omit for all stores."),
      include_inactive: z.boolean().default(false),
    }),
    handler: async ({ store, include_inactive }) => {
      let q = db.from("offers").select("id,slug,name,category,image_url,notes,active,sort_order,stores!inner(slug,name),funnels(id,slug,name,market_label,active,checkout_host,checkout_path,landing_url)").order("sort_order");
      if (store) q = q.eq("stores.slug", store);
      if (!include_inactive) q = q.eq("active", true);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      return Promise.all((data ?? []).map(async (o) => {
        const st = o.stores as unknown as { slug: string; name: string };
        const fs = (o.funnels ?? []) as { id: string; slug: string; name: string; market_label: string; active: boolean; checkout_host: string | null; checkout_path: string | null; landing_url: string | null }[];
        return {
          store: st.slug, slug: o.slug, name: o.name, category: o.category, active: o.active, notes: o.notes, image_url: o.image_url,
          checkouts: fs.map((f) => ({ slug: f.slug, name: f.name, market_label: f.market_label, active: f.active, url: checkoutUrl(f, st.slug), landing_url: f.landing_url })),
          sales_30d: await offerSales(fs.map((f) => f.id), since),
        };
      }));
    },
  });

  defineTool(server, "upsert_offer", {
    title: "Create or update an offer",
    kind: "write",
    idempotent: true,
    description:
      "Create or update an offer of a store and (optionally) assign checkouts to it with their market label. `checkouts`: [{checkout: <checkout slug>, market_label: 'EE. UU.' | 'Reino Unido' | 'Italia' | ...}] — each listed checkout is moved into this offer (a checkout belongs to one offer). Other fields are partial: omit to keep. Use one offer per product idea; one checkout per country/market when they need different bumps, post-purchase or prices.",
    input: z.object({
      store: storeArg,
      slug: slugArg.describe("Offer slug (permanent id inside the store), e.g. 'my-offer'."),
      name: z.string().min(1).max(120).optional(),
      category: z.string().min(1).max(60).nullable().optional()
        .describe("Panel category in Spanish that groups the same product idea across countries, e.g. 'Uñas' for Uñas USA / Uñas Alemania / Uñas Francia, 'ECG', 'Física'. Reuse an existing category (list_offers) when the offer is the same idea in another country."),
      image_url: z.string().regex(/^https:\/\/\S+$/).nullable().optional(),
      notes: z.string().max(2000).optional(),
      active: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(9999).optional(),
      checkouts: z.array(z.object({ checkout: z.string().min(1), market_label: z.string().max(60).default("") })).max(30).optional(),
    }),
    handler: async ({ store, slug, checkouts, ...patch }) => {
      const s = await getStore(store);
      let offer = await offerBySlug(s.id, slug);
      if (!offer) {
        if (!patch.name) throw new UserError(`Offer "${slug}" does not exist in ${store}: pass \`name\` to create it.`);
        const { data, error } = await db.from("offers").insert({ store_id: s.id, slug, ...patch }).select("id,store_id,slug,name,image_url,notes,active").single();
        if (error) throw new Error(error.message);
        offer = data as OfferRow;
      } else if (Object.keys(patch).length) {
        const { error } = await db.from("offers").update(patch).eq("id", offer.id);
        if (error) throw new Error(error.message);
      }
      for (const c of checkouts ?? []) {
        const { data: f } = await db.from("funnels").select("id").eq("store_id", s.id).eq("slug", c.checkout).maybeSingle();
        if (!f) throw new UserError(`Checkout "${c.checkout}" not found in ${store}. Use list_checkouts.`);
        const { error } = await db.from("funnels").update({ offer_id: offer.id, market_label: c.market_label }).eq("id", f.id);
        if (error) throw new Error(error.message);
      }
      const { data: fs } = await db.from("funnels").select("slug,market_label,active").eq("offer_id", offer.id);
      return { offer: { store, slug, ...(await offerBySlug(s.id, slug)) }, checkouts: fs ?? [] };
    },
  });

  defineTool(server, "offer_summary", {
    title: "Offer sales summary",
    kind: "read",
    description:
      "Sales of ONE offer over a date range, total and per checkout/market: paid orders, gross per currency and USD (today's ECB rate), checkouts opened, conversion %. Dates YYYY-MM-DD (UTC days; to inclusive). Default: last 7 days. For bump/upsell/UTM detail use sales_summary (store level) or list_orders filtered by checkout.",
    input: z.object({
      store: storeArg,
      offer: slugArg,
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    handler: async ({ store, offer, from }) => {
      const s = await getStore(store);
      const o = await offerBySlug(s.id, offer);
      if (!o) throw new UserError(`Offer "${offer}" not found in ${store}. Use list_offers (include_inactive: true).`);
      const since = from ? new Date(`${from}T00:00:00Z`).toISOString() : new Date(Date.now() - 7 * 864e5).toISOString();
      const { data: fs } = await db.from("funnels").select("id,slug,market_label").eq("offer_id", o.id);
      const per = await Promise.all((fs ?? []).map(async (f) => ({ checkout: f.slug, market_label: f.market_label, ...(await offerSales([f.id], since)) })));
      return { offer: o.name, store, since, total: await offerSales((fs ?? []).map((f) => f.id), since), by_checkout: per };
    },
  });
}
