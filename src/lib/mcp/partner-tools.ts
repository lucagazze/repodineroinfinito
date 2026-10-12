import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { raiseAlert } from "@/lib/alerts";
import { partnerScope, type PartnerScope } from "@/lib/partner-scope";
import { partnerNumbers } from "@/lib/partner";
import { offerList } from "@/lib/admin/offers";
import { resolveRange } from "@/lib/admin/range";
import { registerAll } from "./server";

/**
 * MCP del socio (/api/mcp-socio, 09/10). Son las
 * MISMAS herramientas del MCP del dueño (con sus validaciones y su registro en mcp_audit), pero solo una lista cerrada y
 * cada pedido pasa por un control: la tienda, la oferta, el checkout, el producto y el post-pago tienen que ser del
 * socio (partner-scope); los listados se filtran a lo suyo. Nunca: reembolsos, mails a compradores, Stripe, píxeles,
 * tiendas, borrar, datos de compradores ni ofertas ajenas. Cada cambio de precio le avisa al dueño.
 */

type Cb = (args: unknown, ctx: unknown) => Promise<{ content?: { type: string; text: string }[]; isError?: boolean }>;
type Captured = { config: Record<string, unknown>; cb: Cb };

/** Las herramientas del MCP del dueño, sin registrarlas en ningún lado: para reusar su lógica tal cual. */
function captureAdminTools(): Map<string, Captured> {
  const tools = new Map<string, Captured>();
  const fake = new Proxy({}, {
    get: (_t, prop) => prop === "registerTool"
      ? (name: string, config: Record<string, unknown>, cb: Cb) => { tools.set(name, { config, cb }); }
      : () => undefined,
  });
  registerAll(fake as McpServer);
  return tools;
}

class Denied extends Error {}
const deny = (msg: string): never => { throw new Denied(msg); };
const key = (store: unknown, slug: unknown) => `${String(store ?? "")}/${String(slug ?? "")}`;
const slugsOfShowIf = (v: unknown) => (v && typeof v === "object" ? Object.values(v as Record<string, unknown>).flat().map(String) : []);

type Rule = {
  pre?: (a: Record<string, unknown>, sc: PartnerScope) => void | Promise<void>;
  /** Filtra la respuesta (JSON) a lo del socio. */
  post?: (out: unknown, sc: PartnerScope, a: Record<string, unknown>) => unknown;
};

const needStore = (a: Record<string, unknown>, sc: PartnerScope) => { if (!sc.stores.has(String(a.store ?? ""))) deny(`La tienda «${a.store}» no es tuya. Tus tiendas: ${[...sc.stores.keys()].join(", ") || "(ninguna)"}.`); };
const needOffer = (a: Record<string, unknown>, sc: PartnerScope) => { needStore(a, sc); if (!sc.offers.has(key(a.store, a.offer))) deny(`La oferta «${a.offer}» no es tuya.`); };
const needFunnel = (a: Record<string, unknown>, sc: PartnerScope, field = "checkout") => { needStore(a, sc); if (!sc.funnels.has(key(a.store, a[field]))) deny(`El checkout «${a[field]}» no es tuyo.`); };
const needProduct = (store: unknown, slug: unknown, sc: PartnerScope) => { if (!sc.products.has(key(store, slug))) deny(`El producto «${slug}» no es tuyo: solo podés usar productos de tus ofertas o los que creaste.`); };
const needPp = (id: unknown, sc: PartnerScope) => { if (!sc.pps.has(String(id ?? ""))) deny("Ese post-pago no es de tus checkouts."); };
const filterList = (pred: (x: Record<string, unknown>) => boolean) => (out: unknown) => (Array.isArray(out) ? out.filter((x) => pred(x as Record<string, unknown>)) : out);

const RULES: Record<string, Rule> = {
  get_guide: {},
  list_offers: {
    pre: (a, sc) => { if (a.store) needStore(a, sc); },
    post: (out, sc) => filterList((x) => sc.offers.has(key(x.store, x.slug)))(out),
  },
  offer_summary: { pre: (a, sc) => needOffer(a, sc) },
  list_products: { pre: (a, sc) => needStore(a, sc), post: (out, sc, a) => filterList((x) => sc.products.has(key(a.store, x.slug)))(out) },
  get_product: { pre: (a, sc) => { needStore(a, sc); needProduct(a.store, a.product, sc); } },
  upsert_product: {
    pre: async (a, sc) => {
      needStore(a, sc);
      const { data } = await db.from("products").select("id").eq("store_id", sc.stores.get(String(a.store))!).eq("slug", String(a.slug)).maybeSingle();
      if (data) needProduct(a.store, a.slug, sc);
    },
  },
  list_checkouts: { pre: (a, sc) => needStore(a, sc), post: (out, sc, a) => filterList((x) => sc.funnels.has(key(a.store, x.slug)))(out) },
  get_checkout: { pre: (a, sc) => needFunnel(a, sc) },
  update_checkout: {
    pre: (a, sc) => {
      needFunnel(a, sc);
      for (const f of ["new_slug", "active", "pixel_ids", "public_url"]) if (a[f] !== undefined) deny(`«${f}» lo cambia el dueño: pedíselo.`);
      if (a.main_product) needProduct(a.store, a.main_product, sc);
      for (const it of (a.items as { product?: string }[] | undefined) ?? []) needProduct(a.store, it.product, sc);
    },
  },
  update_checkout_style: { pre: (a, sc) => needFunnel(a, sc) },
  list_postpurchase: { pre: (a, sc) => needStore(a, sc), post: (out, sc) => filterList((x) => sc.pps.has(String(x.id)))(out) },
  upsert_postpurchase: {
    pre: (a, sc) => {
      needStore(a, sc);
      if (!a.checkout) deny("Indicá checkout: el post-pago tiene que ser de uno de tus checkouts.");
      needFunnel(a, sc);
      if (a.id) needPp(a.id, sc);
      const steps = (a.steps as (string | { product: string; downsell_of?: string; show_if?: unknown })[]) ?? [];
      const slugs = [...((a.trigger_products as string[]) ?? []), ...steps.flatMap((s) => (typeof s === "string" ? [s] : [s.product, ...(s.downsell_of ? [s.downsell_of] : []), ...slugsOfShowIf(s.show_if)]))];
      for (const s of slugs) needProduct(a.store, s, sc);
    },
  },
  upsert_pp_step: {
    pre: (a, sc) => {
      needStore(a, sc); needPp(a.postpurchase, sc); needProduct(a.store, a.product, sc);
      if (a.downsell_of) needProduct(a.store, a.downsell_of, sc);
      for (const s of slugsOfShowIf(a.show_if)) needProduct(a.store, s, sc);
    },
  },
  simulate_postpurchase: {
    pre: (a, sc) => {
      needFunnel(a, sc);
      if (a.postpurchase) needPp(a.postpurchase, sc);
      for (const b of (a.bumps as string[] | undefined) ?? []) needProduct(a.store, b, sc);
    },
  },
  list_ad_creatives: { pre: (a, sc) => needOffer(a, sc) },
  upsert_ad_creative: { pre: (a, sc) => needOffer(a, sc) },
  set_offer_ads_folder: { pre: (a, sc) => needOffer(a, sc) },
  upload_media: { pre: (a, sc) => needStore(a, sc) },
};

/** Precios de un producto, para avisarle al dueño si la IA del socio los cambió. */
async function pricesOf(storeId: string, slug: string) {
  const { data } = await db.from("products").select("id,short_name,name,product_prices(currency,amount,compare_at)").eq("store_id", storeId).eq("slug", slug).maybeSingle();
  if (!data) return null;
  const list = ((data.product_prices ?? []) as { currency: string; amount: number; compare_at: number | null }[])
    .map((p) => `${p.currency} ${Number(p.amount)}${p.compare_at ? ` (antes ${Number(p.compare_at)})` : ""}`).sort();
  return { id: data.id as string, name: (data.short_name || data.name) as string, prices: list.join(" · ") };
}

export const PARTNER_INSTRUCTIONS = `You are connected to the owner's checkout app (checkout-propio) as a PARTNER (socio). You only see and change YOUR offers: their checkouts, post-purchase chains, products, ads section and sales numbers. Anything else is rejected.
FIRST: call get_guide and read it (Spanish): it explains how offers, products, bumps, post-purchase (3 levels, one half-price downsell per OTO) and presale content work. Then my_offers to see what is yours.
Money is in MAJOR units (19.90 = 19.90 USD). New products you create (upsert_product) become yours; add them to your checkout with update_checkout (items) or to your post-purchase with upsert_postpurchase / upsert_pp_step, and test with simulate_postpurchase (with and without bumps).
Not available here (ask the owner): refunds, emails to buyers, buyer personal data, Stripe, pixels, store settings, checkout URL/slug/activation, deleting, landing pages and Meta campaigns. Every change is logged, and the owner is notified of every price change.`;

export function registerPartnerTools(server: McpServer) {
  const admin = captureAdminTools();
  const reg = server.registerTool.bind(server) as unknown as (name: string, config: Record<string, unknown>, cb: Cb) => unknown;

  for (const [name, rule] of Object.entries(RULES)) {
    const t = admin.get(name);
    if (!t) continue;
    const description = `${String(t.config.description ?? "")}\n\n[Partner access: only your own offers, checkouts, products and post-purchase.]`;
    reg(name, { ...t.config, description }, async (rawArgs, ctx) => {
      const email = (ctx as { http?: { authInfo?: { clientId?: string } } })?.http?.authInfo?.clientId ?? "";
      const a = (rawArgs ?? {}) as Record<string, unknown>;
      try {
        const sc = await partnerScope(email);
        await rule.pre?.(a, sc);
        const before = name === "upsert_product" && sc.stores.get(String(a.store)) ? await pricesOf(sc.stores.get(String(a.store))!, String(a.slug)) : null;
        const res = await t.cb(rawArgs, { ...(ctx as object), http: { authInfo: { clientId: `socio:${email}` } } });
        if (res.isError) return res;
        if (name === "upsert_product") {
          const storeId = sc.stores.get(String(a.store))!;
          if (!before) await db.from("products").update({ partner_email: email }).eq("store_id", storeId).eq("slug", String(a.slug)).is("partner_email", null);
          const after = await pricesOf(storeId, String(a.slug));
          if (before && after && before.prices !== after.prices) {
            await raiseAlert({
              kind: "partner_change", severity: "warn", storeId, ref: after.id, link: "/admin/socios",
              title: `${email} cambió el precio de «${after.name}»`, body: `Antes: ${before.prices || "—"}\nAhora: ${after.prices || "—"}`,
            }).catch(() => {});
          }
        }
        if (rule.post && res.content?.[0]?.text) {
          try {
            const out = rule.post(JSON.parse(res.content[0].text), sc, a);
            return { content: [{ type: "text", text: JSON.stringify(out) }] };
          } catch { /* no era JSON: va tal cual */ }
        }
        return res;
      } catch (e) {
        const msg = e instanceof Denied ? e.message : (e as Error).message || "Error";
        return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    });
  }

  // Sus números: ingresos (Stripe) y gasto en anuncios (Meta) de sus ofertas, como en /socio.
  reg("my_offers", {
    title: "My offers and numbers",
    description: "Your offers with their checkouts (slug, market, public URL), and for each one the money in a date range: revenue charged in Stripe, Stripe fees, refunds, Meta ad spend, result and ROAS (USD, Argentina days). Dates YYYY-MM-DD; default last 7 days.",
    inputSchema: z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    annotations: { readOnlyHint: true },
  }, async (rawArgs, ctx) => {
    const email = (ctx as { http?: { authInfo?: { clientId?: string } } })?.http?.authInfo?.clientId ?? "";
    try {
      const a = (rawArgs ?? {}) as { since?: string; until?: string };
      const sc = await partnerScope(email);
      const R = resolveRange({ desde: a.since, hasta: a.until, r: a.since ? undefined : "7d" });
      const mine = (await offerList()).filter((o) => sc.offers.has(`${o.store.slug}/${o.slug}`));
      const out = await Promise.all(mine.map(async (o) => {
        const n = await partnerNumbers(o, R.since, R.until);
        return {
          store: o.store.slug, offer: o.slug, name: o.name, active: o.active,
          checkouts: o.markets.map((f) => ({ slug: f.slug, market: f.market_label, active: f.active })),
          range: { since: R.since, until: R.until },
          revenue_usd: +n.gross.toFixed(2), fees_usd: +n.fees.toFixed(2), refunds_usd: +n.refunded.toFixed(2), ad_spend_usd: +n.spend.toFixed(2),
          result_usd: +n.result.toFixed(2), roas: n.spend ? +(n.gross / n.spend).toFixed(2) : null, sales: n.sales,
        };
      }));
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
    }
  });
}
