import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db, legalOf, type Store } from "@/lib/db";
import { decrypt, mask } from "@/lib/secrets";
import { stripeForStore, dashboardUrl } from "@/lib/stripe";
import { stripeHealth } from "@/lib/stripe-connect";
import { mailProvider, senderOf } from "@/lib/email";
import { resolveSettings } from "@/lib/checkout-settings";
import { afterDecline, eligible, firstPending, orderSteps, resolveLevels, simulate } from "@/lib/postpurchase";
import { stepLabels } from "@/lib/postpurchase-labels";
import { ppProblems, type PpRow } from "./pp-validate";
import { showIfSlugs, showIfText } from "./show-if";
import {
  allStores, assertTimezone, checkoutUrls, dateArg, defineTool, fetchAll, findOrderId, getFunnelRow, getProduct, getStore,
  num, parseRange, productsBySlugs, r2, storeArg, storeProducts, UserError,
  type FunnelRow, type ProductRow, type StoreRow,
} from "./util";
import { CHARGED, loadOrders, orderMoney, salesSummary, usdConverter } from "./sales";
import { embeddedRef, orderRef } from "@/lib/order-ref";
import { GUIDE, guideMarkdown } from "@/lib/guia";
import { catalogFixPrompt, readCatalogStatus, runCatalogStatus } from "@/lib/admin/catalog-status";
import { topicsMap } from "@/lib/catalog-facts";
import { activityReport } from "@/lib/admin/activity-report";

/** Herramientas de lectura: no cambian nada, no se auditan. */

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

/** Cuenta de Stripe del entorno (la que usa una tienda sin cuenta propia conectada). */
export function envStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return { mode: /^(sk|rk)_test_/.test(key) ? "test" : "live", key: mask(key) };
}

function safeMask(enc: string | null) {
  if (!enc) return null;
  try {
    return mask(decrypt(enc));
  } catch {
    return "(stored but cannot be decrypted: SECRETS_KEY changed?)";
  }
}

/**
 * `variantOf` se pasa resuelto a slug: en la base `variant_of` es un id, y
 * devolver un UUID en una respuesta que habla de slugs no le sirve a nadie.
 * Sin pasarlo, al menos se informa que ES una variante en vez de callarlo.
 */
export function productOut(p: ProductRow, variantOf?: string | null) {
  return {
    slug: p.slug,
    name: p.name,
    short_name: p.short_name,
    kind: p.kind,
    active: p.active,
    show_in_catalog: p.show_in_catalog,
    description: p.description,
    delivery_url: p.delivery_url,
    delivery_links: p.delivery_links ?? [],
    // El archivo propio en el bucket privado es entrega tan valida como un link
    // (de hecho la mas segura). Omitirlo aca hacia que get_product mostrara
    // "nada que entregar" sobre un producto que entrega perfecto.
    delivery_file: p.delivery_file,
    variant_of: variantOf ?? (p.variant_of ? "(otro producto de la tienda)" : null),
    includes: p.includes ?? [],
    presale: !!p.presale,
    presale_days: p.presale_days ?? null,
    postcompra_page: p.postcompra_page ?? null,
    image_url: p.image_url,
    email_image_url: p.email_image_url,
    prices: [...(p.product_prices ?? [])]
      .sort((a, b) => (a.currency === "USD" ? -1 : b.currency === "USD" ? 1 : a.currency.localeCompare(b.currency)))
      .map((x) => ({ currency: x.currency, amount: num(x.amount), compare_at: num(x.compare_at), display_value: num(x.display_value) })),
  };
}

/** Dónde se usa cada producto: como principal o como item de cada checkout. */
async function usageMap(storeId: string) {
  const [{ data: funnels }, { data: items }] = await Promise.all([
    db.from("funnels").select("id,slug,active,main_product_id").eq("store_id", storeId),
    db.from("funnel_items").select("product_id,role,sort_order,funnels!inner(slug,active,store_id)").eq("funnels.store_id", storeId),
  ]);
  const m = new Map<string, { checkout: string; role: string; checkout_active: boolean }[]>();
  const add = (pid: string | null, v: { checkout: string; role: string; checkout_active: boolean }) => {
    if (!pid) return;
    m.set(pid, [...(m.get(pid) ?? []), v]);
  };
  for (const f of funnels ?? []) add(f.main_product_id, { checkout: f.slug, role: "main", checkout_active: f.active });
  for (const it of items ?? []) {
    const f = it.funnels as unknown as { slug: string; active: boolean };
    add(it.product_id, { checkout: f.slug, role: it.role, checkout_active: f.active });
  }
  return m;
}

export function pixelOut(p: { id: string; pixel_id: string; name: string; capi_token_enc: string | null; test_event_code: string | null; all_funnels: boolean }, usedBy: string[]) {
  return {
    pixel_id: p.pixel_id,
    name: p.name,
    all_funnels: p.all_funnels,
    capi_token: safeMask(p.capi_token_enc),
    capi_token_source: p.capi_token_enc ? "own token" : process.env.META_CAPI_TOKEN ? "env META_CAPI_TOKEN" : "none (browser pixel only, no server-side Purchase)",
    test_event_code: p.test_event_code,
    loaded_on: p.all_funnels ? "every checkout of the store" : usedBy.length ? usedBy : "no checkout (attach it with update_checkout pixel_ids)",
  };
}

async function storePixels(storeId: string) {
  const [{ data: pixels }, { data: funnels }] = await Promise.all([
    db.from("pixels").select("id,pixel_id,name,capi_token_enc,test_event_code,all_funnels,created_at").eq("store_id", storeId).order("created_at"),
    db.from("funnels").select("slug,pixel_ids").eq("store_id", storeId),
  ]);
  return (pixels ?? []).map((p) => pixelOut(p, (funnels ?? []).filter((f) => (f.pixel_ids ?? []).includes(p.id)).map((f) => f.slug)));
}

/** Detalle completo de un checkout (embudo), el mismo que devuelven create/update_checkout. */
export async function checkoutDetail(store: StoreRow, f: FunnelRow) {
  const [{ data: items }, { data: pixels }, { data: pps }] = await Promise.all([
    db.from("funnel_items").select("role,sort_order,product_id").eq("funnel_id", f.id),
    db.from("pixels").select("id,pixel_id,name,all_funnels,capi_token_enc,test_event_code").eq("store_id", store.id),
    db.from("pp_funnels").select("id,name,active,auto_generated").eq("store_id", store.id).or(`checkout_funnel_id.eq.${f.id},checkout_funnel_id.is.null`),
  ]);
  const products = await storeProducts(store.id);
  const byId = new Map(products.map((p) => [p.id, p]));
  const main = f.main_product_id ? byId.get(f.main_product_id) : null;
  const roles = ["included", "bonus", "bump", "upsell"] as const;
  const own = new Set(f.pixel_ids ?? []);
  const brief = (p: ProductRow | undefined) => p && ({
    slug: p.slug, short_name: p.short_name, kind: p.kind, active: p.active,
    prices: p.product_prices.map((x) => ({ currency: x.currency, amount: num(x.amount), compare_at: num(x.compare_at), display_value: num(x.display_value) })),
  });
  const warnings: string[] = [];
  if (!main) warnings.push("No main product: the checkout URL returns 404 until one is set (update_checkout main_product).");
  else if (!main.product_prices.some((x) => num(x.amount))) warnings.push(`Main product "${main.slug}" has no price: the checkout cannot charge.`);
  else if (!main.product_prices.some((x) => x.currency === "USD" && num(x.amount))) warnings.push(`Main product "${main.slug}" has no USD price: buyers outside its fixed-price markets cannot be quoted (conversion starts from USD).`);
  if (main && !main.delivery_url && !(main.delivery_links ?? []).length && !main.delivery_file) warnings.push(`Main product "${main.slug}" has nothing to deliver (no link and no file): buyers would get an email without a download button.`);
  if (!f.active) warnings.push("Checkout is paused (active=false): its URL returns 404.");

  return {
    slug: f.slug,
    name: f.name,
    active: f.active,
    ...checkoutUrls(store, f.slug),
    main_product: brief(main ?? undefined) ?? null,
    items: Object.fromEntries(roles.map((role) => [
      role,
      (items ?? []).filter((i) => i.role === role).sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({ sort_order: i.sort_order, ...brief(byId.get(i.product_id)) })),
    ])),
    pixels: {
      selected_for_this_checkout: (pixels ?? []).filter((p) => own.has(p.id)).map((p) => ({ pixel_id: p.pixel_id, name: p.name })),
      store_wide_all_funnels: (pixels ?? []).filter((p) => p.all_funnels).map((p) => ({ pixel_id: p.pixel_id, name: p.name })),
      note: "The checkout loads store-wide (all_funnels) pixels plus the ones selected here; never pixels of other checkouts.",
    },
    postpurchase_funnels: {
      total: (pps ?? []).length,
      active: (pps ?? []).filter((p) => p.active).length,
      auto_generated: (pps ?? []).filter((p) => p.auto_generated).length,
      manual: (pps ?? []).filter((p) => !p.auto_generated).map((p) => ({ id: p.id, name: p.name, active: p.active })),
      note: "Details with list_postpurchase; test with simulate_postpurchase.",
    },
    settings: resolveSettings(f.settings),
    settings_saved_overrides: f.settings ?? {},
    warnings,
    updated_at: f.updated_at,
  };
}

export function registerReadTools(server: McpServer) {
  // ------------------------------------------------------------- guía
  defineTool(server, "get_guide", {
    title: "Read the app guide (start here)",
    kind: "read",
    description:
      "The app's information center, in Spanish: what every panel section is for, how to upload a new offer step by step (Drive folders, products, checkout, post-purchase, landing), content that does not exist yet (presale), the 3 ads per offer and where to host them, Meta rules and what must never be done. READ IT ENTIRELY BEFORE CREATING OR CHANGING ANYTHING. `section` returns one part (ids listed in `sections`).",
    input: z.object({ section: z.string().max(60).optional() }),
    handler: async ({ section }) => {
      const markdown = guideMarkdown(section);
      if (!markdown) throw new UserError(`Unknown section «${section}». Valid: ${GUIDE.map((s) => s.id).join(", ")}`);
      return { sections: GUIDE.map((s) => ({ id: s.id, group: s.group, title: s.title })), markdown };
    },
  });

  defineTool(server, "catalog_status", {
    title: "Catalogs and Stripe compliance status",
    kind: "read",
    description:
      "What Stripe reviews: for each store, the public business catalog (served by the app, purchase links that work, legal data, policies, business text) and the Stripe account (website, product description, support email/phone/URL, statement descriptor, charges/payouts enabled, requirements). Returns the problems, the Stripe changes only el dueño can make by hand (with the exact text), and `fix_prompt`: what to do about each one. refresh=true re-checks everything now (≈20 s). Check it at the start of every session and fix what you can.",
    input: z.object({ refresh: z.boolean().default(false) }),
    handler: async ({ refresh }) => {
      const st = refresh ? await runCatalogStatus() : await readCatalogStatus();
      if (!st) return { checked: false, note: "Todavía no se revisó: llamá con refresh: true." };
      return {
        checked_at: new Date(st.at).toISOString(),
        stores: st.stores.map((s) => ({ store: s.slug, name: s.name, catalog: s.url, catalog_problems: s.catalogProblems, stripe_manual_changes: s.stripeTasks, stripe_ok: s.stripeOk })),
        all_ok: st.stores.every((s) => !s.catalogProblems.length && s.stripeOk),
        fix_prompt: catalogFixPrompt(st),
      };
    },
  });

  defineTool(server, "set_catalog_topic", {
    title: "Set the catalog text for an offer category",
    kind: "write",
    description:
      "The business catalog (what Stripe reviews) describes each offer category with a topic and an audience, IN ENGLISH (e.g. category \"ECG\": topic \"reading an ECG\", audience \"nurses and medical students\"). A new category without it shows up in catalog_status. Base it only on what the offer's products say. remove=true deletes an override.",
    input: z.object({
      category: z.string().min(1).max(60).describe("Exactly as in the offer (offers.category), e.g. \"Flebotomía\""),
      topic: z.string().min(3).max(120).optional().describe("English, lower case, fits in «Each title explains one subject…: <topic>»"),
      audience: z.string().min(3).max(160).optional().describe("English, who it is for, e.g. \"phlebotomy students and nurses\""),
      remove: z.boolean().default(false),
    }),
    handler: async ({ category, topic, audience, remove }) => {
      const { data } = await db.from("app_settings").select("value").eq("key", "catalog_topics").maybeSingle();
      const cur = { ...((data?.value as Record<string, { topic: string; who: string }> | null) ?? {}) };
      if (remove) delete cur[category];
      else {
        if (!topic || !audience) throw new UserError("Faltan topic y audience (en inglés).");
        cur[category] = { topic: topic.trim(), who: audience.trim() };
      }
      await db.from("app_settings").upsert({ key: "catalog_topics", value: cur, updated_at: new Date().toISOString() }, { onConflict: "key" });
      const all = await topicsMap();
      return { ok: true, category, now: all[category] ?? null, note: "El catálogo lo toma en ≤5 min (o «Actualizar ahora» en Catálogos). Después: catalog_status con refresh: true." };
    },
  });

  defineTool(server, "partner_access", {
    title: "Partners: which offers each one can see",
    kind: "write",
    description:
      "Partners (socios) log in at the panel's /entrar with their own email and password and only see /socio: Stripe revenue (real charges, fees, refunds) and Meta ad spend of the offers assigned to them — nothing else of the panel. Without offers: lists partners and their offers. With email + offers (offer keys «store~offer» or uuids): sets that partner's offers (replaces the list; add=true appends). Creating a partner or changing a password is done by el dueño in the panel (Socios).",
    input: z.object({
      email: z.string().email().optional(),
      offers: z.array(z.string().min(3)).max(50).optional().describe("Offer keys (mitienda~mi-oferta) or offer uuids"),
      add: z.boolean().default(false),
    }),
    handler: async ({ email, offers, add }) => {
      const { data: all } = await db.from("offers").select("id,slug,name,stores!inner(slug)");
      const rows = (all ?? []).map((o) => ({ id: o.id as string, key: `${(o.stores as unknown as { slug: string }).slug}~${o.slug}`, name: o.name as string }));
      const named = (ids: string[]) => ids.map((id) => rows.find((r) => r.id === id) ?? { id, key: "?", name: "(borrada)" });
      if (email && offers) {
        const mail = email.trim().toLowerCase();
        const { data: p } = await db.from("partners").select("offer_ids").eq("email", mail).maybeSingle();
        if (!p) throw new UserError(`No hay un socio con ${mail}: crealo en el panel (Socios).`);
        const want = offers.map((x) => rows.find((r) => r.id === x || r.key === x));
        const missing = offers.filter((_, i) => !want[i]);
        if (missing.length) throw new UserError(`No existen estas ofertas: ${missing.join(", ")}`);
        const ids = [...new Set([...(add ? (p.offer_ids as string[]) : []), ...want.map((w) => w!.id)])];
        await db.from("partners").update({ offer_ids: ids }).eq("email", mail);
        return { ok: true, email: mail, offers: named(ids) };
      }
      const { data } = await db.from("partners").select("email,name,offer_ids,active,last_login_at").order("created_at");
      return { partners: (data ?? []).map((p) => ({ email: p.email, name: p.name, active: p.active, last_login_at: p.last_login_at, offers: named(p.offer_ids as string[]) })) };
    },
  });

  defineTool(server, "order_activity_report", {
    title: "Order activity report (dispute evidence)",
    kind: "read",
    description:
      "Everything recorded about one order, for answering a chargeback: purchase IP and full user-agent, location, each Stripe charge (card, CVC/address checks, 3D Secure, risk, disputed), delivery emails with every open/click (IP, device), downloads, page views in the 72 h before paying, post-purchase offers shown/accepted/declined, other orders by the same email or IP (and whether they were disputed), consistency checks and numbered facts. `url` is the printable English page in the panel (Save as PDF) to attach to the dispute. Read-only.",
    input: z.object({ order: z.string().min(3).describe("Order number (#1001), uuid or Stripe pi_ id") }),
    handler: async ({ order }) => {
      const id = await findOrderId(order);
      const r = await activityReport(id);
      if (!r) throw new UserError("Order not found.");
      return { url: `${process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || ""}/admin/informe/${id}`, ...r };
    },
  });

  // ------------------------------------------------------------- tiendas
  defineTool(server, "list_stores", {
    title: "List stores",
    kind: "read",
    description:
      "List every store (brand) in the checkout app with: slug (the id used by all other tools), name, checkout domain, catalog domain, default language, active flag, Stripe connection (own account connected? live or test mode; stores without their own account charge through the platform env key), number of products and checkouts, and sales of the last 7 days (charged orders and gross revenue converted to USD). Start here when you don't know the store slug.",
    input: z.object({}),
    handler: async () => {
      const stores = await allStores();
      const [{ data: ss }, { data: prods }, { data: funs }] = await Promise.all([
        db.from("store_stripe").select("store_id,account_id,account_name,livemode"),
        db.from("products").select("store_id,active"),
        db.from("funnels").select("store_id,active"),
      ]);
      const { orders, byOrder } = await loadOrders(null, new Date(Date.now() - 7 * 864e5), new Date(Date.now() + 60_000));
      const toUsd = await usdConverter();
      const env = envStripe();
      return stores.map((s) => {
        const st = (ss ?? []).find((x) => x.store_id === s.id);
        const ord = orders.filter((o) => o.store_id === s.id && CHARGED.has(o.status));
        return {
          slug: s.slug,
          name: s.name,
          active: s.active,
          domain: s.domain,
          catalog_domain: s.catalog_domain,
          default_locale: s.default_locale,
          timezone: s.timezone,
          stripe: st
            ? { own_account: true, account_id: st.account_id, account_name: st.account_name, mode: st.livemode ? "live" : "test" }
            : { own_account: false, fallback: env ? `platform env key (${env.mode} mode)` : "NONE: cannot charge" },
          products: (prods ?? []).filter((p) => p.store_id === s.id).length,
          products_active: (prods ?? []).filter((p) => p.store_id === s.id && p.active).length,
          checkouts: (funs ?? []).filter((f) => f.store_id === s.id).length,
          checkouts_active: (funs ?? []).filter((f) => f.store_id === s.id && f.active).length,
          sales_last_7d: {
            orders: ord.length,
            gross_usd: r2(ord.reduce((a, o) => { const m = orderMoney(o, byOrder.get(o.id)); return a + toUsd(m.gross, m.cur); }, 0)),
          },
        };
      });
    },
  });

  defineTool(server, "get_store", {
    title: "Get store settings",
    kind: "read",
    external: true,
    description:
      "Full configuration of one store: general (name, display_name, support_email, default_locale, timezone, guarantee_days, active), brand (logo_url, brand JSON: payButton/primary colors, guaranteeImage), business JSON (catalog/about info), legal (legal_name, legal_address, statement_descriptor + the effective values used after env fallbacks), thankyou and delivery_email JSON, domains (checkout domain, catalog domain), sales_webhook_url, meta_ad_account_id, live Stripe health (account, live/test, charges enabled, webhook enabled and pointing to this app, last webhook event, Apple Pay domains; calls the Stripe API read-only when an own account is connected), Meta pixels (CAPI tokens masked), markets, and the email provider + sender address. Secrets are never returned.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const [health, pixels, { data: markets }] = await Promise.all([
        stripeHealth(s.id),
        storePixels(s.id),
        db.from("markets").select("name,currency,countries,is_default").eq("store_id", s.id).order("name"),
      ]);
      const env = envStripe();
      const { id: _id, ...rest } = s;
      return {
        ...rest,
        effective_legal: legalOf(s as unknown as Store),
        checkout_base_url: checkoutUrls(s, "{checkout}"),
        stripe: health.connected
          ? health
          : { connected: false, note: env ? `No own Stripe account: charges go through the platform env key (${env.mode} mode). Use connect_stripe to connect the store's account.` : "No Stripe account and no env key: the store cannot charge." },
        pixels,
        markets: markets ?? [],
        mail: {
          provider: mailProvider() ?? "NONE (no POSTMARK_TOKEN / BREVO_API_KEY: delivery emails fail)",
          from: senderOf(s as unknown as Store),
          reply_to: s.support_email,
        },
      };
    },
  });

  defineTool(server, "diagnose_store", {
    title: "Diagnose store health",
    kind: "read",
    external: true,
    description:
      "Run every health check on a store and return a list of {status: ok|warn|error, check, detail, fix_hint}. Checks: Stripe connected / live mode / charges enabled / webhook enabled + URL + last event; email provider + email_from; active checkouts with a missing or unpriced main product; products without delivery link; paid orders not delivered (with delivery_error); failed delivery emails (7 days); Stripe webhook events that failed processing (7 days); disputes (30 days); pixels without a CAPI token or with a test_event_code left on; missing business/legal fields; checkout domain missing or not registered for Apple Pay. Use it after any setup change and when something seems wrong. Calls Stripe read-only when an own account is connected.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      type Check = { status: "ok" | "warn" | "error"; check: string; detail: string; fix_hint?: string };
      const out: Check[] = [];
      const add = (status: Check["status"], check: string, detail: string, fix_hint?: string) =>
        out.push({ status, check, detail, ...(fix_hint && status !== "ok" ? { fix_hint } : {}) });

      const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
      const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
      const tenMin = new Date(Date.now() - 10 * 60_000).toISOString();
      const [health, products, { data: funnels }, { data: undelivered }, { data: evErr }, { data: disputes }, { data: pixels }, { data: mailFails }] =
        await Promise.all([
          stripeHealth(s.id),
          storeProducts(s.id),
          db.from("funnels").select("id,slug,active,main_product_id").eq("store_id", s.id),
          db.from("orders").select("id,number,email,created_at,delivery_error,delivery_attempts").eq("store_id", s.id).eq("status", "paid")
            .is("delivered_at", null).lt("created_at", tenMin).order("created_at", { ascending: false }).limit(50),
          db.from("stripe_events").select("id,type,received_at,error").eq("store_id", s.id).is("processed_at", null)
            .not("error", "is", null).gte("received_at", since7).order("received_at", { ascending: false }).limit(20),
          db.from("stripe_events").select("id,received_at").eq("store_id", s.id).eq("type", "charge.dispute.created").gte("received_at", since30),
          db.from("pixels").select("pixel_id,name,capi_token_enc,test_event_code,all_funnels").eq("store_id", s.id),
          db.from("email_log").select("kind,to_email,error,created_at").eq("store_id", s.id).eq("status", "failed").gte("created_at", since7)
            .order("created_at", { ascending: false }).limit(10),
        ]);

      // Pasarela de cobro. La tienda ELIGE con cual cobra (stores.gateway), asi
      // que revisar Stripe en una tienda de Whop da un "error" que no existe --
      // y un diagnostico que grita en falso entierra los problemas de verdad.
      const pasarela = s.gateway === "whop" ? "whop" : "stripe";
      if (pasarela === "whop") {
        const { data: w } = await db.from("store_whop")
          .select("company_id,webhook_id,webhook_secret_enc,livemode,last_event_at")
          .eq("store_id", s.id).maybeSingle();
        if (!w) {
          add("error", "whop_account", "The store charges with Whop but has no Whop connection: the checkout cannot charge.", "connect_whop with the account's API key.");
        } else {
          add("ok", "whop_account", `Whop account ${w.company_id}${w.livemode ? "" : " (TEST mode)"}`);
          add(w.webhook_secret_enc ? "ok" : "error", "whop_webhook",
              w.webhook_secret_enc ? `Webhook ${w.webhook_id} with signing secret`
                                   : "Webhook without signing secret: every event is rejected and NOTHING gets delivered.",
              "Recreate the webhook capturing its ws_ secret.");
          add(w.last_event_at ? "ok" : "warn", "whop_last_event",
              w.last_event_at ? `Last Whop event received ${w.last_event_at}` : "No Whop event received yet.",
              "Make a test purchase.");
        }
      } else {
      // Stripe
      const env = envStripe();
      if (!health.connected) {
        if (env?.mode === "live") add("warn", "stripe_account", "No own Stripe account connected: charges go through the platform env key (live).", "connect_stripe with the store's live secret + publishable keys so payouts, webhook and Apple Pay are per store.");
        else add("error", "stripe_account", env ? "No own Stripe account and the env key is in TEST mode: real cards are rejected." : "No Stripe account at all: the checkout cannot charge.", "connect_stripe with live keys.");
      } else {
        add(health.livemode ? "ok" : "error", "stripe_mode", health.livemode ? `Live account ${health.accountId} (${health.accountName ?? "no name"})` : "Connected account is in TEST mode.", "connect_stripe again with sk_live_/pk_live_ keys.");
        if (health.error) add("error", "stripe_api", `Stripe API error: ${health.error}`, "The stored key may be revoked or restricted: connect_stripe again with a valid key.");
        else {
          add(health.chargesEnabled ? "ok" : "error", "stripe_charges", health.chargesEnabled ? "Charges enabled" : "Charges are NOT enabled on the Stripe account.", "Finish the account activation in the Stripe dashboard.");
          add(health.payoutsEnabled ? "ok" : "warn", "stripe_payouts", health.payoutsEnabled ? "Payouts enabled" : "Payouts are not enabled.", "Add/verify the bank account in Stripe.");
          add(health.webhookOk ? "ok" : "error", "stripe_webhook", health.webhookOk ? "Webhook enabled" : "Webhook missing or disabled: paid orders will NOT be delivered automatically.", "connect_stripe again (recreates the webhook).");
          if (health.webhookOk && health.webhookUrlOk === false) add("error", "stripe_webhook_url", "Webhook points to a different URL than this app.", "Check PUBLIC_BASE_URL, then connect_stripe again.");
        }
        add(health.lastEventAt ? "ok" : "warn", "stripe_last_event", health.lastEventAt ? `Last webhook event received ${health.lastEventAt}` : "No webhook event received yet.", "Make a test purchase or resend an event from the Stripe dashboard.");
        if (s.domain && !(health.applePayDomains ?? []).includes(s.domain)) {
          add("warn", "apple_pay_domain", `${s.domain} is not registered as a payment method domain: Apple Pay / Google Pay buttons won't show there.`, "register_apple_pay_domains");
        }
      }

      }

      // Mail. Una tienda puede mandar por su PROPIA casilla (store_mail) sin que
      // haya proveedor de plataforma: mirar solo el proveedor daba "los mails de
      // entrega fallan" en una tienda cuyos mails salen perfectamente.
      const provider = mailProvider();
      const { data: propio } = await db.from("store_mail")
        .select("host").eq("store_id", s.id).maybeSingle();
      add(provider || propio ? "ok" : "error", "mail_provider",
          propio ? `Emails sent from the store's own mailbox (${propio.host})`
                 : provider ? `Emails sent with ${provider}`
                 : "No mail provider and no store mailbox: delivery emails fail.",
          "set_store_smtp with the store's mailbox, or set POSTMARK_TOKEN / BREVO_API_KEY.");
      add(s.email_from ? "ok" : "warn", "email_from", s.email_from ? `Sender ${s.email_from}` : `No store sender: emails go out from ${senderOf(s as unknown as Store).email}.`, "update_store email_from with an address on a domain verified in the mail provider.");
      add(mailFails?.length ? "warn" : "ok", "email_failures_7d", mailFails?.length ? `${mailFails.length} failed emails in 7 days, latest: ${mailFails[0].error}` : "No failed emails in 7 days", "get_email_log status=failed for details.");

      // Checkouts y productos
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const f of (funnels ?? []).filter((x) => x.active)) {
        const main = f.main_product_id ? byId.get(f.main_product_id) : null;
        if (!main) add("error", "checkout_main_product", `Active checkout "${f.slug}" has no main product (URL 404).`, `update_checkout store=${s.slug} checkout=${f.slug} main_product=<slug>`);
        else if (!main.product_prices.some((x) => num(x.amount))) add("error", "checkout_price", `Main product "${main.slug}" of checkout "${f.slug}" has no price.`, "upsert_product with prices.");
        // Post-pago: lo que ve después de pagar un comprador sin bumps.
        const chain = await simulate(s.id, f.id, [], { full: true }).catch(() => null);
        if (chain && !chain.steps.length) {
          add("warn", "postpurchase", `Checkout "${f.slug}" has NO post-purchase offers: buyers see nothing after paying.`, "upsert_postpurchase + upsert_pp_step (3 levels, each OTO with a half-price downsell), then simulate_postpurchase.");
        } else if (chain) {
          const levels = new Set(chain.meta.filter((m) => m.kind === "oto").map((m) => m.level)).size;
          add(levels >= 3 ? "ok" : "warn", "postpurchase", `Checkout "${f.slug}": post-purchase "${chain.name ?? "checkout upsells"}" with ${levels} level${levels === 1 ? "" : "s"}${chain.paused ? " (PAUSED)" : ""}.`, "simulate_postpurchase to see each path.");
        }
      }
      if (!(funnels ?? []).some((f) => f.active)) add("warn", "checkouts", "No active checkout.", "create_checkout");
      // delivery_file cuenta: un PDF en el bucket privado es la forma MAS segura de
        // entregar (link firmado de 10 min) y se leia como "sin entrega".
        const noDelivery = products.filter((p) => p.active && p.kind !== "bonus"
          && !p.delivery_url && !(p.delivery_links ?? []).length && !p.delivery_file);
      add(noDelivery.length ? "warn" : "ok", "delivery_links", noDelivery.length ? `Active products with nothing to deliver: ${noDelivery.map((p) => p.slug).join(", ")}` : "Every active main/upsell product has something to deliver", "upsert_product delivery_url=https://... or upload a file.");

      // Pedidos
      add(undelivered?.length ? "error" : "ok", "undelivered_orders", undelivered?.length
        ? `${undelivered.length} paid orders not delivered: ${undelivered.slice(0, 10).map((o) => `${orderRef(o)} ${o.email ?? ""} (${o.delivery_error ?? "no error recorded"})`).join("; ")}`
        : "Every paid order was delivered", "Fix the cause (mail provider / sender / delivery link), then resend_delivery for each order.");
      add(evErr?.length ? "error" : "ok", "stripe_event_errors_7d", evErr?.length
        ? `${evErr.length} webhook events failed: ${evErr.slice(0, 5).map((e) => `${e.type}: ${e.error}`).join("; ")}`
        : "No failed webhook events in 7 days", "get_stripe_events errors_only=true; Stripe retries for 3 days.");
      add(disputes?.length ? "error" : "ok", "disputes_30d", disputes?.length ? `${disputes.length} disputes (chargebacks) in 30 days` : "No disputes in 30 days", "Answer them in the Stripe dashboard with the delivery evidence.");

      // Pixels
      if (!pixels?.length) add("warn", "pixels", "No Meta pixel configured.", "upsert_pixel");
      for (const p of pixels ?? []) {
        if (!p.capi_token_enc && !process.env.META_CAPI_TOKEN) add("warn", "pixel_capi", `Pixel ${p.pixel_id} (${p.name}) has no Conversions API token: purchases blocked by the browser are lost.`, "upsert_pixel capi_token=...");
        if (p.test_event_code) add("warn", "pixel_test_code", `Pixel ${p.pixel_id} still has test_event_code ${p.test_event_code}: server purchases go to Test Events only and do NOT count for ads optimization.`, "upsert_pixel test_event_code=null when testing is done.");
      }

      // Negocio / legal
      const legalMissing = (["legal_name", "legal_address", "statement_descriptor"] as const).filter((k) => !s[k]);
      add(legalMissing.length ? "warn" : "ok", "legal", legalMissing.length ? `Missing ${legalMissing.join(", ")} (env fallbacks used: ${JSON.stringify(legalOf(s as unknown as Store))})` : "Legal fields set", "update_store legal_name / legal_address / statement_descriptor.");
      const b = s.business ?? {};
      // El telefono lo pide STRIPE para su revision del catalogo. Con Whop el
      // comerciante de registro es Whop y esa revision la hace sobre su propia
      // cuenta, asi que un telefono vacio no es un pendiente: es una decision
      // valida de no publicar un numero personal.
      const pideTelefono = pasarela === "stripe";
      const bizMissing = ["tagline", "about", ...(pideTelefono ? ["phone"] : [])].filter((k) => !b[k]);
      add(bizMissing.length ? "warn" : "ok", "business_info", bizMissing.length ? `business.${bizMissing.join(", business.")} empty (shown on the public catalog)` : "Business info set", "update_store business={...}");

      // Dominios
      add(s.domain ? "ok" : "warn", "checkout_domain", s.domain ? `Checkout domain ${s.domain}` : "No custom checkout domain: buyers see the app domain.", "update_store domain=checkout.brand.com, point its DNS to Vercel, then register_apple_pay_domains.");

      const order = { error: 0, warn: 1, ok: 2 };
      out.sort((a, b2) => order[a.status] - order[b2.status]);
      return {
        store: s.slug,
        summary: { error: out.filter((c) => c.status === "error").length, warn: out.filter((c) => c.status === "warn").length, ok: out.filter((c) => c.status === "ok").length },
        checks: out,
      };
    },
  });

  // -------------------------------------------------------------- ventas
  defineTool(server, "sales_summary", {
    title: "Sales summary",
    kind: "read",
    description:
      "Sales report for one store (or all stores if `store` is omitted) over a date range. Returns: charged orders, fully refunded orders, pending payments, gross / refunds / net per currency (major units, e.g. 19.90 EUR) and converted to USD at today's ECB rate, AOV in USD, checkouts opened and conversion rate, order bump take rate (overall and per bump, over orders of checkouts that offered it), 1-click upsell views/accepts/acceptance rate (per product), top products, and breakdowns by country, checkout, utm_source, utm_campaign, utm_content and day. Dates: YYYY-MM-DD are whole days in `timezone` (to is inclusive); default range = last 7 days including today.",
    input: z.object({
      store: z.string().optional().describe("Store slug. Omit for all stores combined."),
      from: dateArg.optional().describe("Start day YYYY-MM-DD (inclusive) or ISO datetime. Default: 6 days before `to`."),
      to: dateArg.optional().describe("End day YYYY-MM-DD (inclusive) or ISO datetime (exclusive). Default: today."),
      timezone: z.string().optional().describe(`IANA timezone for day boundaries. Default: the store's timezone (all stores: ${DEFAULT_TZ}).`),
    }),
    handler: async ({ store, from, to, timezone }) => {
      const stores = store ? [await getStore(store)] : await allStores();
      const tz = timezone ?? (store ? stores[0].timezone : DEFAULT_TZ) ?? DEFAULT_TZ;
      assertTimezone(tz);
      return salesSummary(stores, parseRange(from, to, tz));
    },
  });

  defineTool(server, "list_orders", {
    title: "List orders",
    kind: "read",
    description:
      "List orders, newest first. Filters: store (optional = all stores), status (paid | pending | refunded | failed), email (case-insensitive substring), checkout slug, date range (YYYY-MM-DD days in the store timezone, or ISO datetimes), limit (max 200, default 50) and offset for paging. Each row: id, ref (order number shown to buyers, e.g. #1001; panel test purchases: T-XXXXXXXX), number, created_at, status, buyer email/name/country, currency, amount_total (main checkout charge incl. bumps, major units), upsells_total, amount_refunded, checkout, delivered_at / delivery_error, utm source/campaign/content. Use get_order for full detail.",
    input: z.object({
      store: z.string().optional().describe("Store slug; omit to search all stores."),
      status: z.enum(["paid", "pending", "refunded", "failed"]).optional(),
      email: z.string().min(2).optional().describe("Substring of the buyer email."),
      checkout: z.string().optional().describe("Checkout (funnel) slug; requires store."),
      from: dateArg.optional(),
      to: dateArg.optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    handler: async ({ store, status, email, checkout, from, to, limit, offset }) => {
      const s = store ? await getStore(store) : null;
      if (checkout && !s) throw new UserError("`checkout` filter needs `store` too.");
      const tz = s?.timezone ?? DEFAULT_TZ;
      let q = db.from("orders")
        .select("id,number,created_at,status,email,name,country,currency,amount_total,amount_refunded,delivered_at,delivery_error,utm,stores(slug),funnels(slug),order_items(kind,amount)")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (s) q = q.eq("store_id", s.id);
      if (status) q = q.eq("status", status);
      else q = q.neq("status", "test"); // compras de prueba del panel
      if (email) q = q.ilike("email", `%${email.replace(/[%_]/g, "")}%`);
      if (checkout && s) q = q.eq("funnel_id", (await getFunnelRow(s, checkout)).id);
      if (from || to) {
        const r = parseRange(from, to, tz, 3650);
        q = q.gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString());
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return {
        count: data?.length ?? 0,
        offset,
        orders: (data ?? []).map((o) => {
          const utm = (o.utm ?? {}) as Record<string, string>;
          const items = (o.order_items ?? []) as { kind: string; amount: number }[];
          return {
            id: o.id,
            ref: orderRef(o),
            created_at: o.created_at,
            store: (o.stores as unknown as { slug: string } | null)?.slug,
            checkout: (o.funnels as unknown as { slug: string } | null)?.slug ?? null,
            status: o.status,
            email: o.email, name: o.name, country: o.country,
            currency: o.currency,
            amount_total: num(o.amount_total),
            upsells_total: r2(items.filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.amount), 0)),
            amount_refunded: num(o.amount_refunded),
            delivered_at: o.delivered_at,
            delivery_error: o.delivery_error,
            utm_source: utm.utm_source ?? null, utm_campaign: utm.utm_campaign ?? null, utm_content: utm.utm_content ?? null,
          };
        }),
      };
    },
  });

  defineTool(server, "get_order", {
    title: "Get order detail",
    kind: "read",
    description:
      "Everything about one order: buyer, status, amounts (major units, order currency), items (main / bump / upsell / bonus / included, with product slug, amount, refunded amount and their Stripe PaymentIntent), 1-click upsell events (view/accept/decline/fail), every email sent for it (email_log: delivery/upsell, sent/failed + error), Stripe dashboard links for each payment, delivery status/error/attempts, post-purchase funnel, UTMs and tracking (fbp/fbc/user agent/url; IP removed). Accepts the order uuid, the order number (e.g. 1001 or #1001), the older 8-character reference (e.g. 3F2A9B1C) or a PaymentIntent id (pi_...).",
    input: z.object({ order: z.string().min(1).describe("Order number (#1001), uuid, old 8-char reference, or pi_... PaymentIntent id.") }),
    handler: async ({ order }) => {
      const id = await findOrderId(order);
      const { data: o, error } = await db.from("orders").select("*,stores(slug,name),funnels(slug,name),pp_funnels(name)").eq("id", id).single();
      if (error) throw new Error(error.message);
      const [{ data: items }, { data: events }, { data: mails }, { data: ck }] = await Promise.all([
        db.from("order_items").select("kind,amount,currency,refunded_amount,stripe_payment_intent,created_at,products(slug,short_name,delivery_url)").eq("order_id", id).order("created_at"),
        db.from("upsell_events").select("event,created_at,products(slug)").eq("order_id", id).order("created_at"),
        db.from("email_log").select("kind,to_email,provider,status,error,created_at").eq("order_id", id).order("created_at"),
        db.from("checkouts").select("created_at,utm,bumps,recovery_sent_at").eq("order_id", id).maybeSingle(),
      ]);
      const conn = await stripeForStore(o.store_id);
      const pis = [...new Set([o.stripe_payment_intent, ...(items ?? []).map((i) => i.stripe_payment_intent)].filter(Boolean) as string[])];
      const { ip: _ip, ...tracking } = (o.tracking ?? {}) as Record<string, unknown>;
      return {
        id: o.id,
        ref: orderRef(o),
        store: (o.stores as { slug: string }).slug,
        checkout: (o.funnels as { slug: string } | null)?.slug ?? null,
        status: o.status,
        created_at: o.created_at,
        buyer: { email: o.email, name: o.name, phone: o.phone, country: o.country, locale: o.locale },
        currency: o.currency,
        amount_total: num(o.amount_total),
        amount_refunded: num(o.amount_refunded),
        refunded_at: o.refunded_at,
        total_with_upsells: r2((items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(o.amount_total ?? 0)),
        items: (items ?? []).map((i) => ({
          kind: i.kind,
          product: (i.products as unknown as { slug: string } | null)?.slug ?? "(deleted product)",
          name: (i.products as unknown as { short_name: string } | null)?.short_name ?? null,
          amount: num(i.amount), currency: i.currency, refunded_amount: num(i.refunded_amount),
          payment_intent: i.stripe_payment_intent,
        })),
        delivery: { delivered_at: o.delivered_at, error: o.delivery_error, attempts: o.delivery_attempts, capi_sent_at: o.capi_sent_at },
        emails: mails ?? [],
        upsell_events: (events ?? []).map((e) => ({ event: e.event, product: (e.products as unknown as { slug: string } | null)?.slug, at: e.created_at })),
        postpurchase_funnel: (o.pp_funnels as { name: string } | null)?.name ?? null,
        stripe: { mode: conn.livemode ? "live" : "test", payments: pis.map((pi) => ({ payment_intent: pi, dashboard: dashboardUrl(conn, pi) })), customer: o.stripe_customer },
        utm: { ...((ck?.utm ?? {}) as object), ...((o.utm ?? {}) as object) },
        tracking,
        checkout_session: ck ? { opened_at: ck.created_at, bumps_selected: ck.bumps, recovery_sent_at: ck.recovery_sent_at } : null,
      };
    },
  });

  defineTool(server, "list_customers", {
    title: "List customers",
    kind: "read",
    description:
      "Buyers of a store grouped by email (case-insensitive): name, country, number of charged orders, total spent per currency and in USD (incl. bumps and upsells, minus nothing: refunds shown separately), refunded amount, first/last purchase, and whether any order has a delivery problem (paid but not delivered, or delivery_error). Optional email substring filter and date range (default: all time). Sorted by last purchase (default) or total spent. Max 200 rows.",
    input: z.object({
      store: storeArg,
      email: z.string().min(2).optional(),
      from: dateArg.optional(),
      to: dateArg.optional(),
      sort: z.enum(["last_purchase", "total_spent", "orders"]).default("last_purchase"),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ store, email, from, to, sort, limit }) => {
      const s = await getStore(store);
      const r = from || to ? parseRange(from ?? "2020-01-01", to, s.timezone) : { from: new Date("2020-01-01T00:00:00Z"), to: new Date(Date.now() + 60_000) };
      const { orders, byOrder } = await loadOrders([s.id], r.from, r.to);
      const toUsd = await usdConverter();
      const groups = new Map<string, {
        email: string; name: string | null; country: string | null; orders: number; spent: Record<string, number>; spent_usd: number;
        refunded: Record<string, number>; first: string; last: string; problems: string[];
      }>();
      for (const o of orders) {
        if (!CHARGED.has(o.status) || !o.email) continue;
        const k = o.email.toLowerCase();
        if (email && !k.includes(email.toLowerCase())) continue;
        const m = orderMoney(o, byOrder.get(o.id));
        const g = groups.get(k) ?? { email: o.email, name: o.name, country: o.country, orders: 0, spent: {}, spent_usd: 0, refunded: {}, first: o.created_at, last: o.created_at, problems: [] };
        g.orders++;
        g.spent[m.cur] = r2((g.spent[m.cur] ?? 0) + m.gross);
        g.spent_usd += toUsd(m.gross, m.cur);
        if (m.refunded) g.refunded[m.cur] = r2((g.refunded[m.cur] ?? 0) + m.refunded);
        if (o.created_at < g.first) g.first = o.created_at;
        if (o.created_at > g.last) { g.last = o.created_at; g.name = o.name ?? g.name; g.country = o.country ?? g.country; }
        if (o.status === "paid" && (!o.delivered_at || o.delivery_error)) g.problems.push(`${orderRef(o)}: ${o.delivery_error ?? "not delivered"}`);
        groups.set(k, g);
      }
      const rows = [...groups.values()].sort((a, b) =>
        sort === "total_spent" ? b.spent_usd - a.spent_usd : sort === "orders" ? b.orders - a.orders : b.last.localeCompare(a.last));
      return {
        total_customers: rows.length,
        customers: rows.slice(0, limit).map((g) => ({
          email: g.email, name: g.name, country: g.country, orders: g.orders, spent: g.spent, spent_usd: r2(g.spent_usd),
          refunded: g.refunded, first_purchase: g.first, last_purchase: g.last, delivery_problems: g.problems,
        })),
      };
    },
  });

  defineTool(server, "list_abandoned_checkouts", {
    title: "List abandoned checkouts",
    kind: "read",
    description:
      "Abandoned carts of a store: checkouts where the buyer typed an email but did not pay, opened between `days` days ago and 30 minutes ago, excluding people who bought anyway afterwards. Each row: checkout_id (pass it to send_recovery), created_at, email, name, country, checkout slug, cart amount + currency (major units), bumps selected, recovery_sent_at, and the personal link back to the checkout. Filter `recovery`: not_sent (default) | sent | all.",
    input: z.object({
      store: storeArg,
      days: z.number().int().min(1).max(90).default(7),
      recovery: z.enum(["not_sent", "sent", "all"]).default("not_sent"),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    handler: async ({ store, days, recovery, limit }) => {
      const s = await getStore(store);
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
      const q = db.from("checkouts").select("id,created_at,email,name,country,currency,amount,bumps,funnel_id,recovery_sent_at,locale")
        .eq("store_id", s.id).eq("status", "open").not("email", "is", null).gte("created_at", since).lte("created_at", cutoff);
      const [{ data: open, error }, { data: funnels }, paid] = await Promise.all([
        q.order("created_at", { ascending: false }).limit(1000),
        db.from("funnels").select("id,slug").eq("store_id", s.id),
        fetchAll<{ email: string | null; created_at: string }>((a, b) =>
          db.from("orders").select("email,created_at").eq("store_id", s.id).eq("status", "paid").gte("created_at", since).range(a, b)),
      ]);
      if (error) throw new Error(error.message);
      const lastBuy = new Map<string, string>();
      for (const o of paid) if (o.email) { const k = o.email.toLowerCase(); if (!lastBuy.has(k) || o.created_at > lastBuy.get(k)!) lastBuy.set(k, o.created_at); }
      const fSlug = new Map((funnels ?? []).map((f) => [f.id, f.slug]));
      const rows = (open ?? [])
        .filter((c) => (recovery === "all" ? true : recovery === "sent" ? !!c.recovery_sent_at : !c.recovery_sent_at))
        .filter((c) => !((lastBuy.get(c.email!.toLowerCase()) ?? "") >= c.created_at));
      return {
        count: rows.length,
        checkouts: rows.slice(0, limit).map((c) => {
          const slug = fSlug.get(c.funnel_id ?? "") ?? null;
          return {
            checkout_id: c.id, created_at: c.created_at, email: c.email, name: c.name, country: c.country,
            checkout: slug, amount: num(c.amount), currency: c.currency, bumps: c.bumps, locale: c.locale,
            recovery_sent_at: c.recovery_sent_at,
            link: slug ? `${checkoutUrls(s, slug).url}?email=${encodeURIComponent(c.email!)}` : null,
          };
        }),
      };
    },
  });

  // ------------------------------------------------------------ catálogo
  defineTool(server, "list_products", {
    title: "List products",
    kind: "read",
    description:
      "Products of a store: slug, name, short_name, kind (main = sold as checkout main product, upsell = sold as order bump or 1-click upsell, bonus = free gift), active, show_in_catalog, prices per currency (major units: amount = price charged, compare_at = struck-through price, display_value = stated value of a free bonus), whether it has anything to deliver (a link, several links, or its own file in the private bucket), image URL, and where it's used ([{checkout, role}] with role main|included|bonus|bump|upsell).",
    input: z.object({ store: storeArg, include_inactive: z.boolean().default(true) }),
    handler: async ({ store, include_inactive }) => {
      const s = await getStore(store);
      const [products, usage] = await Promise.all([storeProducts(s.id), usageMap(s.id)]);
      const slugDe = new Map(products.map((p) => [p.id, p.slug]));
      return products.filter((p) => include_inactive || p.active).map((p) => {
        const o = productOut(p, p.variant_of ? slugDe.get(p.variant_of) ?? null : null);
        return {
          slug: o.slug, short_name: o.short_name, kind: o.kind, active: o.active, show_in_catalog: o.show_in_catalog,
          prices: o.prices, has_delivery: !!(p.delivery_url || (p.delivery_links ?? []).length || p.delivery_file), image_url: o.image_url,
          variant_of: o.variant_of, includes: o.includes, presale: o.presale,
          used_in: usage.get(p.id) ?? [],
        };
      });
    },
  });

  defineTool(server, "get_product", {
    title: "Get product",
    kind: "read",
    description:
      "One product in full: name, short_name, description, kind, active, show_in_catalog, prices per currency (major units), everything it delivers (delivery_url, extra delivery_links [{label,url}] and delivery_file, its own file in the private bucket), variant_of / includes / presale, image_url (WebP for the checkout) and email_image_url (JPG for emails), the checkouts that use it and in which role, post-purchase funnels that offer it, and units sold.",
    input: z.object({ store: storeArg, product: z.string().min(1).describe("Product slug (see list_products).") }),
    handler: async ({ store, product }) => {
      const s = await getStore(store);
      const p = await getProduct(s, product);
      const [usage, { count }, { data: steps }] = await Promise.all([
        usageMap(s.id),
        db.from("order_items").select("id", { count: "exact", head: true }).eq("product_id", p.id),
        db.from("pp_steps").select("sort_order,pp_funnels(id,name,active)").eq("product_id", p.id),
      ]);
      return {
        ...productOut(p),
        used_in: usage.get(p.id) ?? [],
        offered_in_postpurchase: (steps ?? []).map((x) => ({ ...(x.pp_funnels as unknown as { id: string; name: string; active: boolean }), step: x.sort_order + 1 })),
        units_sold: count ?? 0,
        updated_at: p.updated_at,
      };
    },
  });

  defineTool(server, "list_checkouts", {
    title: "List checkouts",
    kind: "read",
    description:
      "Checkouts (funnels) of a store: slug, name, active, main product, number of items per role (bonus / included / bump / upsell), public checkout URL(s) (app URL /c/{store}/{checkout} and the custom-domain URL), number of own pixels, and charged orders in the last 30 days.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const [{ data: funnels }, { data: items }, products, recent] = await Promise.all([
        db.from("funnels").select("id,slug,name,active,main_product_id,pixel_ids,sort_order").eq("store_id", s.id).order("sort_order").order("created_at"),
        db.from("funnel_items").select("funnel_id,role,funnels!inner(store_id)").eq("funnels.store_id", s.id),
        storeProducts(s.id),
        fetchAll<{ funnel_id: string | null }>((a, b) => db.from("orders").select("funnel_id").eq("store_id", s.id).in("status", ["paid", "refunded"])
          .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).range(a, b)),
      ]);
      const pSlug = new Map(products.map((p) => [p.id, p.slug]));
      return (funnels ?? []).map((f) => {
        const its = (items ?? []).filter((i) => i.funnel_id === f.id);
        const n = (role: string) => its.filter((i) => i.role === role).length;
        return {
          slug: f.slug, name: f.name, active: f.active,
          main_product: f.main_product_id ? pSlug.get(f.main_product_id) ?? null : null,
          items: { bonus: n("bonus"), included: n("included"), bump: n("bump"), upsell: n("upsell") },
          ...checkoutUrls(s, f.slug),
          own_pixels: (f.pixel_ids ?? []).length,
          orders_30d: recent.filter((o) => o.funnel_id === f.id).length,
        };
      });
    },
  });

  defineTool(server, "get_checkout", {
    title: "Get checkout",
    kind: "read",
    description:
      "One checkout (funnel) in full: active flag, public URL(s), main product with prices, items grouped by role (included = delivered with the main product, bonus = free gift shown in the summary, bump = order bump card charged in the same payment, upsell = simple 1-click chain after paying) in display order with prices, pixels that load on it (selected for this checkout + store-wide all_funnels ones), post-purchase funnels that can fire, the fully resolved style settings (every field, defaults included) plus the raw saved overrides, and setup warnings.",
    input: z.object({ store: storeArg, checkout: z.string().min(1).describe("Checkout (funnel) slug (see list_checkouts).") }),
    handler: async ({ store, checkout }) => {
      const s = await getStore(store);
      return checkoutDetail(s, await getFunnelRow(s, checkout));
    },
  });

  defineTool(server, "list_pixels", {
    title: "List Meta pixels",
    kind: "read",
    description:
      "Meta (Facebook) pixels of a store: pixel_id, name, all_funnels (true = loaded on every checkout of the store), Conversions API token (masked) and its source, test_event_code (when set, server events go ONLY to Events Manager > Test events), and which checkouts load it.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => storePixels((await getStore(store)).id),
  });

  defineTool(server, "list_markets", {
    title: "List markets",
    kind: "read",
    description:
      "Markets of a store: name, currency, countries (ISO-2) and is_default. Buyers from a market's countries pay in its currency using the products' fixed price for that currency (or USD converted at today's rate if the product has none). Countries in no market pay in their local currency converted from USD (enables Pix, OXXO, BLIK, Bizum...), or USD.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const { data } = await db.from("markets").select("name,currency,countries,is_default,created_at").eq("store_id", s.id).order("name");
      return data ?? [];
    },
  });

  defineTool(server, "list_postpurchase", {
    title: "List post-purchase funnels",
    kind: "read",
    description:
      "Post-purchase (1-click upsell) funnels of a store. Each: id, name, active, auto_generated, reserve_minutes, checkout it is limited to (null = any checkout of the store), trigger products (the exact set of main + bumps bought that fires it) and steps (products offered after paying, in order; a downsell is listed right after its OTO as 'slug (downsell of parent)' and is only shown if that OTO was declined; a condition shows as '[only if owns any/none of: …]'), plus orders/views/accepts of the last 90 days. Rules: an order uses an exact trigger match first, else the largest trigger contained in what was bought; if no post-purchase funnel matches, the checkout's own upsell items are offered.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const [{ data: pps }, products, { data: funnels }, perfRows] = await Promise.all([
        db.from("pp_funnels").select("id,name,active,auto_generated,reserve_minutes,trigger_product_ids,checkout_funnel_id,sort_order,pp_steps(id,sort_order,product_id,kind,downsell_of,show_if,level)")
          .eq("store_id", s.id).order("checkout_funnel_id").order("sort_order"),
        storeProducts(s.id),
        db.from("funnels").select("id,slug").eq("store_id", s.id),
        fetchAll<{ pp_funnel_id: string; upsell_events: { event: string }[] }>((a, b) =>
          db.from("orders").select("pp_funnel_id,upsell_events(event)").eq("store_id", s.id).not("pp_funnel_id", "is", null)
            .gte("created_at", new Date(Date.now() - 90 * 864e5).toISOString()).range(a, b)),
      ]);
      const pSlug = new Map(products.map((p) => [p.id, p.slug]));
      const fSlug = new Map((funnels ?? []).map((f) => [f.id, f.slug]));
      const perf = new Map<string, { orders: number; views: number; accepts: number }>();
      for (const o of perfRows) {
        const r = perf.get(o.pp_funnel_id) ?? { orders: 0, views: 0, accepts: 0 };
        r.orders++;
        for (const e of o.upsell_events ?? []) { if (e.event === "view") r.views++; if (e.event === "accept") r.accepts++; }
        perf.set(o.pp_funnel_id, r);
      }
      return (pps ?? []).map((p) => ({
        id: p.id, name: p.name, active: p.active, auto_generated: p.auto_generated, reserve_minutes: p.reserve_minutes,
        checkout: p.checkout_funnel_id ? fSlug.get(p.checkout_funnel_id) ?? null : null,
        trigger_products: (p.trigger_product_ids as string[]).map((id) => pSlug.get(id) ?? id),
        steps: ((ord) => ord.map((x, i, all) => {
          const slug = pSlug.get(x.row.product_id) ?? x.row.product_id;
          const cond = showIfText(showIfSlugs(x.row.show_if, pSlug));
          const lv = `L${resolveLevels(all)[i]} `;
          return x.parentRow ? `${lv}${slug} (downsell of ${pSlug.get(x.parentRow.product_id) ?? x.parentRow.product_id})${cond}` : `${lv}${slug}${cond}`;
        }))(orderSteps(p.pp_steps)),
        last_90d: perf.get(p.id) ?? { orders: 0, views: 0, accepts: 0 },
      }));
    },
  });

  defineTool(server, "simulate_postpurchase", {
    title: "Simulate post-purchase offers",
    kind: "read",
    description:
      "Answer \"if someone buys this checkout and ticks these order bumps, what 1-click offers do they see after paying?\" using exactly the live logic. Returns the post-purchase funnel that fires (or the checkout's simple upsell chain); 'path_if_declines_all' = what this buyer sees answering No to everything (level by level: each OTO, then its downsell); 'chain' = every step of the funnel with its level, condition and whether this buyer can see it; and 'checks' = rule problems of the funnel, in Spanish (max 3 levels, one downsell per OTO, downsell = the same offer cheaper (price variant, variant_of = the OTO), the same offer not repeated as OTO in two levels). Empty checks = OK.",
    input: z.object({
      store: storeArg,
      checkout: z.string().min(1).describe("Checkout (funnel) slug."),
      bumps: z.array(z.string()).default([]).describe("Slugs of the order bumps the buyer took (must be bumps of that checkout)."),
      postpurchase: z.string().uuid().optional().describe("Simulate this post-purchase funnel (id) instead of the one that fires, e.g. a paused one before turning it on."),
    }),
    handler: async ({ store, checkout, bumps, postpurchase }) => {
      const s = await getStore(store);
      const f = await getFunnelRow(s, checkout);
      const bySlug = bumps.length ? await productsBySlugs(s, bumps) : new Map<string, ProductRow>();
      const chain = await simulate(s.id, f.id, bumps.map((b) => bySlug.get(b)!.id), { full: true, includePaused: true, ppFunnelId: postpurchase ?? null });
      const labels = stepLabels(chain.meta);
      const path: string[] = [];
      for (let i = firstPending(chain), guard = 0; i >= 0 && guard < 20; guard++) {
        path.push(`${labels[i]}: ${chain.steps[i].slug}`);
        i = afterDecline(chain, i);
      }
      const { data: rows } = chain.ppFunnelId
        ? await db.from("pp_steps").select("id,product_id,kind,downsell_of,level,sort_order,show_if").eq("pp_funnel_id", chain.ppFunnelId)
        : { data: [] };
      const names = new Map((await storeProducts(s.id)).map((p) => [p.id, p.slug]));
      return {
        fires: chain.ppFunnelId ? { postpurchase_funnel_id: chain.ppFunnelId, name: chain.name, ...(chain.paused ? { paused: "PAUSED (active=false): real buyers skip it and go straight to the thank-you page; this simulation shows it so it can be tested before turning it on" } : {}) } : chain.steps.length ? "the checkout's own upsell items (no post-purchase funnel matched)" : "nothing: buyer goes straight to the thank-you page",
        path_if_declines_all: path,
        chain: chain.steps.map((p, i) => ({
          step: labels[i], product: p.slug, short_name: p.short_name, level: chain.meta[i].level, kind: chain.meta[i].kind,
          ...(chain.meta[i].parent !== null ? { only_if_declined: chain.steps[chain.meta[i].parent!]?.slug } : {}),
          ...(chain.meta[i].showIf ? { condition: showIfText(showIfSlugs(chain.meta[i].showIf, names)).trim() } : {}),
          ...(chain.meta[i].active === false ? { placeholder: "archived product: never offered (coming soon)" } : {}),
          offered_to_this_buyer: chain.meta[i].kind === "downsell" ? eligible(chain, i) && eligible(chain, chain.meta[i].parent!) : eligible(chain, i),
        })),
        checks: await ppProblems((rows ?? []) as PpRow[]),
      };
    },
  });

  // ----------------------------------------------------------- bitácoras
  defineTool(server, "get_email_log", {
    title: "Get email log",
    kind: "read",
    description:
      "Emails sent by a store, newest first (delivery, upsell delivery, cart recovery, test), each with recipient, provider, status sent|failed, provider error and order ref. Filters: status, kind, order (#1001 / uuid / old 8-char ref), days back (default 7, max 90), limit (max 200).",
    input: z.object({
      store: storeArg,
      status: z.enum(["sent", "failed"]).optional(),
      kind: z.enum(["delivery", "upsell", "recovery", "test"]).optional(),
      order: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ store, status, kind, order, days, limit }) => {
      const s = await getStore(store);
      let q = db.from("email_log").select("created_at,kind,to_email,provider,provider_id,status,error,order_id,orders(number,status)")
        .eq("store_id", s.id).gte("created_at", new Date(Date.now() - days * 864e5).toISOString())
        .order("created_at", { ascending: false }).limit(limit);
      if (status) q = q.eq("status", status);
      if (kind) q = q.eq("kind", kind);
      if (order) q = q.eq("order_id", await findOrderId(order));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map(({ orders, ...m }) => ({ ...m, order_ref: m.order_id ? embeddedRef(m.order_id, orders) : null }));
    },
  });

  defineTool(server, "get_stripe_events", {
    title: "Get Stripe webhook events",
    kind: "read",
    description:
      "Stripe webhook events received for a store (from our log, not the Stripe API): id, type, received_at, processed_at and error. errors_only=true returns only events that failed processing (Stripe retries those for 3 days). Events with processed_at set and an `error` text were intentionally ignored (e.g. payments of another platform on the same account). Filters: type (e.g. charge.refunded, charge.dispute.created), days back (default 7, max 90), limit (max 200).",
    input: z.object({
      store: storeArg,
      errors_only: z.boolean().default(false),
      type: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ store, errors_only, type, days, limit }) => {
      const s = await getStore(store);
      let q = db.from("stripe_events").select("id,type,received_at,processed_at,error").eq("store_id", s.id)
        .gte("received_at", new Date(Date.now() - days * 864e5).toISOString()).order("received_at", { ascending: false }).limit(limit);
      if (errors_only) q = q.is("processed_at", null).not("error", "is", null);
      if (type) q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  defineTool(server, "get_mcp_audit_log", {
    title: "Get MCP audit log",
    kind: "read",
    description: "Recent write operations done through this MCP server (tool, arguments with secrets masked, ok/failed, result summary, API token name, time). Newest first, max 200.",
    input: z.object({ tool: z.string().optional(), limit: z.number().int().min(1).max(200).default(30) }),
    handler: async ({ tool, limit }) => {
      let q = db.from("mcp_audit").select("created_at,tool,ok,token_name,args,result_summary").order("created_at", { ascending: false }).limit(limit);
      if (tool) q = q.eq("tool", tool);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, result_summary: (r.result_summary ?? "").slice(0, 300) }));
    },
  });

}
