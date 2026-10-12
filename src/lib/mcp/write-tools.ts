import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db, getProductById, STORE_COLS, type Product, type Store } from "@/lib/db";
import { encrypt, decrypt, sha256 } from "@/lib/secrets";
import { stripeForStore } from "@/lib/stripe";
import { connectStripe, disconnectStripe, registerDomains } from "@/lib/stripe-connect";
import { sendDelivery } from "@/lib/email";
import { uploadImage } from "@/lib/media";
import { mergeSettings, resolveSettings } from "@/lib/checkout-settings";
import { mergePostcompraPage, postcompraWarnings, POSTCOMPRA_DOC } from "@/lib/postcompra-page";
import { cleanOtoHtml, POSTCOMPRA_HTML_DOC } from "@/lib/postcompra-html";
import { autogenerate, orderSteps, resolveLevels } from "@/lib/postpurchase";
import { ppProblems, type PpRow } from "./pp-validate";
import { showIfInput, showIfIds, showIfSlugs, showIfText } from "./show-if";
import { recoverCheckout } from "@/lib/recovery";
import { fromMinor, toMinor } from "@/lib/fx";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";
import {
  appBaseUrl, assertTimezone, checkoutUrls, confirmArg, defineTool, findOrderId, getFunnelRow, getProduct, getStore, hexColor, httpsUrl,
  normalizeHost, num, productsBySlugs, r2, slugArg, storeArg, storeProducts, UserError,
  type FunnelRow, type ProductRow, type StoreRow,
} from "./util";
import { checkoutDetail, pixelOut, productOut } from "./read-tools";
import { downloadPublic, extFor } from "./download";
import { droppedFields, stylePatchSchema, styleFieldList } from "./style";
import { orderRef } from "@/lib/order-ref";

/** Herramientas que cambian datos. Cada llamada queda en mcp_audit (ver defineTool). */

// ------------------------------------------------------------------ tiendas

const looseJson = z.record(z.string(), z.unknown());

const storeFields = {
  name: z.string().trim().min(1).max(120).describe("Store/brand name shown on the checkout, emails and card statement summary."),
  display_name: z.string().trim().max(120).nullable().describe("Sender name for emails; null = name."),
  support_email: z.email().describe("Support address: buyers reply to it; shown in emails and footer."),
  default_locale: z.enum(LOCALES).describe("Language when the buyer's can't be inferred."),
  timezone: z.string().describe('IANA timezone for reports, e.g. "Europe/Rome".'),
  guarantee_days: z.number().int().min(0).max(365).describe("Money-back guarantee days shown on checkout and emails."),
  domain: z.string().nullable().describe('Custom checkout hostname, e.g. "checkout.mybrand.com" (no https://). null = none. After changing it: point DNS to the app hosting, then register_apple_pay_domains.'),
  catalog_domain: z.string().nullable().describe('Hostname of the public catalog site (the site Stripe reviews), e.g. "mybrand.com". null = none.'),
  logo_url: httpsUrl.nullable().describe("Logo image (https). Upload it first with upload_media."),
  email_from: z.email().nullable().describe("Sender address; its domain must be verified in the mail provider (Postmark/Brevo). null = env DELIVERY_FROM fallback."),
  legal_name: z.string().trim().max(200).nullable().describe("Legal entity shown in footer/emails, e.g. \"Acme Digital LLC\"."),
  legal_address: z.string().trim().max(300).nullable(),
  statement_descriptor: z.string().trim().regex(/^(?=.*[A-Za-z])[^<>\\'"*]{5,22}$/, "5-22 chars, at least one letter, no < > \\ ' \" *").nullable()
    .describe("Text on the buyer's card statement (5-22 chars)."),
  brand: z.looseObject({
    payButton: hexColor.nullable().describe("Store-wide pay button color, used by checkouts whose style colors.pay is empty."),
    primary: hexColor.nullable().describe("Brand color of the thank-you and upsell pages."),
    accent: hexColor.nullable(),
    guaranteeImage: httpsUrl.nullable().describe("Default guarantee badge image under the pay button."),
  }).partial().describe("Brand JSON, merged key by key; null removes a key."),
  business: z.looseObject({
    tagline: z.string().max(200).nullable(),
    about: z.string().max(4000).nullable(),
    audience: z.string().max(500).nullable(),
    phone: z.string().max(40).nullable(),
    reply_hours: z.string().max(100).nullable(),
    languages: z.array(z.string()).nullable(),
    catalog_enabled: z.boolean().nullable(),
  }).partial().describe("Business info for the public catalog (who we are, contact). Merged key by key; null removes a key."),
  thankyou: looseJson.describe("Thank-you page JSON, merged key by key (null removes a key)."),
  delivery_email: looseJson.describe("Delivery email JSON, merged key by key (null removes a key)."),
  sales_webhook_url: httpsUrl.nullable().describe("POSTed on every paid sale (JSON, HMAC-SHA256 signature in X-Signature). null = off."),
  meta_ad_account_id: z.string().regex(/^(act_)?\d{5,20}$/, 'Like "act_1234567890123456"').nullable(),
  active: z.boolean().describe("false = store disabled."),
};

const storePatch = z.object(storeFields).partial().strict();

function mergeJson(cur: Record<string, unknown> | null | undefined, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...(cur ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

async function buildStoreRow(current: StoreRow | null, p: z.infer<typeof storePatch>) {
  const row: Record<string, unknown> = {};
  const hints: string[] = [];
  for (const k of ["name", "display_name", "support_email", "default_locale", "guarantee_days", "logo_url", "email_from",
    "legal_name", "legal_address", "statement_descriptor", "sales_webhook_url", "active"] as const) {
    if (p[k] !== undefined) row[k] = typeof p[k] === "string" ? (p[k] as string).trim() || null : p[k];
  }
  if (p.support_email) row.support_email = p.support_email.toLowerCase();
  if (p.email_from) row.email_from = p.email_from.toLowerCase();
  if (p.timezone !== undefined) { assertTimezone(p.timezone); row.timezone = p.timezone; }
  if (p.meta_ad_account_id !== undefined) row.meta_ad_account_id = p.meta_ad_account_id ? `act_${p.meta_ad_account_id.replace(/^act_/, "")}` : null;
  for (const k of ["domain", "catalog_domain"] as const) {
    if (p[k] === undefined) continue;
    const h = p[k] ? normalizeHost(p[k]!) : null;
    if (h) {
      const { data: clash } = await db.from("stores").select("slug").or(`domain.ilike.${h},catalog_domain.ilike.${h}`);
      const other = (clash ?? []).find((c) => c.slug !== current?.slug);
      if (other) throw new UserError(`Domain ${h} is already used by store "${other.slug}".`);
    }
    row[k] = h;
    if (k === "domain" && h !== (current?.domain ?? null)) {
      hints.push(h
        ? `Checkout domain set to ${h}: add it to the hosting project and point its DNS there, then run register_apple_pay_domains so Apple Pay / Google Pay show on it.`
        : "Custom checkout domain removed: links on the old domain stop working.");
    }
  }
  if (p.brand) row.brand = mergeJson(current?.brand, p.brand);
  if (p.business) row.business = mergeJson(current?.business, p.business);
  if (p.thankyou) row.thankyou = mergeJson(current?.thankyou, p.thankyou);
  if (p.delivery_email) row.delivery_email = mergeJson(current?.delivery_email, p.delivery_email);
  if (p.email_from) hints.push(`Emails will be sent from ${p.email_from}: its domain must be verified in the mail provider or delivery fails.`);
  return { row, hints };
}

// --------------------------------------------------------------- productos

const priceInput = z.object({
  currency: z.string().regex(/^[A-Za-z]{3}$/, "ISO 4217 code like USD, EUR, GBP").transform((c) => c.toUpperCase()),
  amount: z.number().min(0).max(1_000_000).nullable().optional().describe("Price charged, major units (19.90 = 19.90). 0 = free. null clears it."),
  compare_at: z.number().min(0).max(1_000_000).nullable().optional().describe("Struck-through 'before' price, major units. null = none."),
  display_value: z.number().min(0).max(1_000_000).nullable().optional().describe("Stated value of a free bonus ('worth 29 €'), major units. null = none."),
});

const deliveryLink = z.object({ label: z.string().trim().min(1).max(80), url: z.string().regex(/^https?:\/\/\S+$/, "http(s) URL") });

const IMAGE_MAX = 12 * 1024 * 1024;

async function processedImage(storeSlug: string, productId: string, url: string) {
  const d = await downloadPublic(url, { maxBytes: IMAGE_MAX, accept: (t) => /^image\/(jpeg|png|webp|avif|gif)$/.test(t), what: "a product image (jpeg/png/webp/avif)" });
  const file = new File([new Uint8Array(d.buf)], d.filename, { type: d.contentType });
  return uploadImage(file, `${storeSlug}/products/${productId}`);
}

// --------------------------------------------------------------- checkouts

const ROLE_DOC =
  "role: included = delivered together with the main product (not shown as a gift); bonus = free gift listed in the order summary and email; bump = order-bump card inside the checkout, charged in the same payment; upsell = simple 1-click offer after paying (used only when no post-purchase funnel matches).";

const itemInput = z.object({
  product: z.string().min(1).describe("Product slug."),
  role: z.enum(["included", "bonus", "bump", "upsell"]),
  sort_order: z.number().int().min(0).max(999).optional().describe("Display order within its role; default = position in the list."),
});

async function pixelUuids(store: StoreRow, pixelIds: string[]) {
  if (!pixelIds.length) return [];
  const { data } = await db.from("pixels").select("id,pixel_id").eq("store_id", store.id);
  const by = new Map((data ?? []).map((p) => [p.pixel_id, p.id]));
  const missing = pixelIds.filter((p) => !by.has(p));
  if (missing.length) throw new UserError(`Pixel(s) ${missing.join(", ")} are not configured in store "${store.slug}". Add them first with upsert_pixel. Configured: ${[...by.keys()].join(", ") || "(none)"}.`);
  return [...new Set(pixelIds.map((p) => by.get(p)!))];
}

/** Reemplaza los items del embudo: inserta lo nuevo, reordena y recién al final borra lo que sobra. */
async function setItems(store: StoreRow, funnel: { id: string; main_product_id: string | null }, items: z.infer<typeof itemInput>[]) {
  const warnings: string[] = [];
  const bySlug = items.length ? await productsBySlugs(store, items.map((i) => i.product)) : new Map<string, ProductRow>();
  const pos: Record<string, number> = {};
  const desired = items.map((it) => {
    const p = bySlug.get(it.product)!;
    const n = pos[it.role] ?? 0;
    pos[it.role] = n + 1;
    return { product: p, role: it.role, sort_order: it.sort_order ?? n };
  });
  const seen = new Set<string>();
  for (const d of desired) {
    const k = `${d.product.id}:${d.role}`;
    if (seen.has(k)) throw new UserError(`Product "${d.product.slug}" appears twice with role ${d.role}.`);
    seen.add(k);
    if (d.product.id === funnel.main_product_id) throw new UserError(`"${d.product.slug}" is the main product of this checkout; don't add it as an item.`);
    if (!d.product.active) warnings.push(`"${d.product.slug}" is archived (active=false) but will still appear in this checkout.`);
    if ((d.role === "bump" || d.role === "upsell") && !d.product.product_prices.some((x) => num(x.amount))) {
      warnings.push(`${d.role} "${d.product.slug}" has no price: it will not be offered until it has one (upsert_product prices).`);
    }
    if (d.role === "bump" && d.product.kind === "bonus") warnings.push(`"${d.product.slug}" is a bonus-kind product used as a paid bump.`);
  }

  const { data: existing, error } = await db.from("funnel_items").select("id,product_id,role,sort_order").eq("funnel_id", funnel.id);
  if (error) throw new Error(error.message);
  const ex = new Map((existing ?? []).map((e) => [`${e.product_id}:${e.role}`, e]));
  const toInsert = desired.filter((d) => !ex.has(`${d.product.id}:${d.role}`));
  if (toInsert.length) {
    const { error: e1 } = await db.from("funnel_items").insert(
      toInsert.map((d) => ({ funnel_id: funnel.id, product_id: d.product.id, role: d.role, sort_order: d.sort_order }))
    );
    if (e1) throw new Error(`Could not add items (nothing was removed): ${e1.message}`);
  }
  for (const d of desired) {
    const e = ex.get(`${d.product.id}:${d.role}`);
    if (e && e.sort_order !== d.sort_order) await db.from("funnel_items").update({ sort_order: d.sort_order }).eq("id", e.id);
  }
  const toDelete = (existing ?? []).filter((e) => !seen.has(`${e.product_id}:${e.role}`)).map((e) => e.id);
  if (toDelete.length) await db.from("funnel_items").delete().in("id", toDelete);
  return { added: toInsert.length, removed: toDelete.length, warnings };
}

// ----------------------------------------------------------------- registro

export function registerWriteTools(server: McpServer) {
  defineTool(server, "create_store", {
    title: "Create store",
    kind: "write",
    description:
      "Create a new store (brand). Required: slug (permanent, used in URLs /c/{slug}/... and by every tool; cannot be changed later), name, support_email. Any other store field can be set now or later with update_store (same fields). Next steps after creating: connect_stripe, upsert_product, create_checkout, upsert_pixel, diagnose_store.",
    input: z.object({ slug: slugArg("Store"), ...storeFields, name: storeFields.name, support_email: storeFields.support_email }).partial().required({ slug: true, name: true, support_email: true }).strict(),
    handler: async (args) => {
      const { slug, ...patch } = args;
      const { count } = await db.from("stores").select("id", { count: "exact", head: true }).eq("slug", slug);
      if (count) throw new UserError(`A store with slug "${slug}" already exists. Use update_store.`);
      const { row, hints } = await buildStoreRow(null, patch);
      const { error } = await db.from("stores").insert({ slug, default_locale: "en", ...row });
      if (error) throw new UserError(`Could not create the store: ${error.message}`);
      const s = await getStore(slug);
      return { created: s.slug, store: s, hints: [...hints, "Next: connect_stripe, upsert_product, create_checkout, upsert_pixel, then diagnose_store."] };
    },
  });

  defineTool(server, "update_store", {
    title: "Update store settings",
    kind: "write",
    idempotent: true,
    description:
      "Partially update a store: only the fields you pass change. Editable: name, display_name, support_email, default_locale (it|en|es|pt-BR), timezone, guarantee_days, domain (checkout hostname), catalog_domain, logo_url, email_from, legal_name, legal_address, statement_descriptor, brand {payButton, primary, guaranteeImage}, business {tagline, about, audience, phone, reply_hours, languages, catalog_enabled, ...}, thankyou {...}, delivery_email {...}, sales_webhook_url, meta_ad_account_id, active. JSON fields (brand, business, thankyou, delivery_email) are merged key by key; null removes a key. Strings: null or \"\" clears. The slug is immutable. Stripe keys: use connect_stripe; pixels: upsert_pixel; per-checkout look: update_checkout_style.",
    input: z.object({ store: storeArg, ...storePatch.shape }).strict(),
    handler: async ({ store, ...patch }) => {
      const s = await getStore(store);
      if (!Object.keys(patch).length) throw new UserError("Nothing to update: pass at least one field.");
      const { row, hints } = await buildStoreRow(s, patch);
      const { error } = await db.from("stores").update(row).eq("id", s.id);
      if (error) throw new UserError(`Could not update the store: ${error.message}`);
      const after = await getStore(store);
      const { id: _id, ...rest } = after;
      return { updated: Object.keys(row), store: rest, hints };
    },
  });

  // ------------------------------------------------------------- Stripe
  defineTool(server, "connect_stripe", {
    title: "Connect Stripe account",
    kind: "write",
    external: true,
    description:
      "Connect a store to its own Stripe account with its secret key (sk_live_/rk_live_, or _test_) and publishable key (pk_live_/pk_test_), both from the same account and mode. Side effects in that LIVE Stripe account: validates the keys, deletes any previous webhook of this app for the store and creates a new webhook endpoint pointing to this app (payment_intent.*, charge.refunded, charge.dispute.created), and registers the checkout domains for Apple Pay / Google Pay. Keys are stored encrypted and never returned. Returns account id/name, live/test, charges enabled, Apple Pay results and warnings.",
    input: z.object({
      store: storeArg,
      secret_key: z.string().regex(/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/, "Secret key starting with sk_live_, rk_live_ (or _test_)"),
      publishable_key: z.string().regex(/^pk_(live|test)_[A-Za-z0-9]+$/, "Publishable key starting with pk_live_ (or pk_test_)"),
    }),
    handler: async ({ store, secret_key, publishable_key }) => {
      const s = await getStore(store);
      try {
        return await connectStripe(s.id, secret_key, publishable_key);
      } catch (e) {
        throw new UserError((e as Error).message);
      }
    },
  });

  defineTool(server, "disconnect_stripe", {
    title: "Disconnect Stripe account",
    kind: "destructive",
    external: true,
    description:
      "DESTRUCTIVE. Disconnect a store's own Stripe account: deletes this app's webhook endpoint in that Stripe account and removes the stored keys. Afterwards the store charges through the platform env key (or cannot charge at all) and payments of the old account are no longer delivered automatically. Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, confirm: confirmArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const { data } = await db.from("store_stripe").select("account_id").eq("store_id", s.id).maybeSingle();
      if (!data) throw new UserError(`Store "${s.slug}" has no own Stripe account connected.`);
      await disconnectStripe(s.id);
      return { disconnected: data.account_id };
    },
  });

  defineTool(server, "register_apple_pay_domains", {
    title: "Register Apple Pay domains",
    kind: "write",
    idempotent: true,
    external: true,
    description:
      "Register the store's checkout domain (stores.domain) and the app domain as payment method domains in the store's Stripe account, so Apple Pay / Google Pay buttons appear there. Run after changing the checkout domain. Uses the store's own Stripe account, or the platform env account if none is connected. Already-registered domains count as ok.",
    input: z.object({ store: storeArg }),
    handler: async ({ store }) => {
      const s = await getStore(store);
      const conn = await stripeForStore(s.id);
      const results = await registerDomains(conn.stripe, s.id);
      if (conn.connected) {
        const { data } = await db.from("store_stripe").select("apple_pay_domains").eq("store_id", s.id).single();
        const ok = [...new Set([...(data?.apple_pay_domains ?? []), ...results.filter((r) => r.ok).map((r) => r.domain)])];
        await db.from("store_stripe").update({ apple_pay_domains: ok }).eq("store_id", s.id);
      }
      return { stripe_account: conn.connected ? conn.accountId : `platform env account (${conn.livemode ? "live" : "test"})`, results };
    },
  });

  // ----------------------------------------------------------- productos
  defineTool(server, "upsert_product", {
    title: "Create or update product",
    kind: "write",
    external: true,
    description:
      "Create a product (if the slug doesn't exist in the store) or partially update it (only the fields you pass change). Fields: name (required on create; full name shown on checkout and email), short_name (buttons/lists; default = name up to an em dash), description (bump card, upsell page, email), kind: main (sold as checkout main product) | upsell (sold as order bump or 1-click upsell) | bonus (free gift), delivery_url (link the buyer receives, e.g. Drive folder), delivery_links [{label,url}] (extra download buttons; replaces the whole list), image_url, active (false = archived), show_in_catalog, sort_order. "
      + "prices: [{currency, amount, compare_at?, display_value?}] in MAJOR units (19.90 means 19.90 EUR, not cents); upserted per currency, omitted keys keep their current value, null clears. Currencies without a fixed price are converted from the USD price at today's rate (so always set USD). remove_price_currencies deletes fixed prices. "
      + "image_url: by default the image is downloaded (https, jpeg/png/webp, max 12 MB) and stored as an optimized WebP for the checkout plus a JPG for emails (Outlook can't show WebP); set process_image=false to store the URL as-is. "
      + "No Stripe Price sync is needed: checkout, bumps and upsells charge via PaymentIntents with amounts computed server-side from these prices. "
      + "includes: product slugs delivered INSIDE this one (a pack/bundle); [] clears it. Owning a pack counts as owning each included product in post-purchase chains (a step is skipped when the buyer owns its product or everything it includes, and show_if conditions see the included products). "
      + "variant_of: slug of the BASE product in the same store when this one is a price variant of it (e.g. a half-price downsell of the same book); null clears it. A variant is the same thing for post-purchase rules: owning either counts as owning the base, and a downsell that is a variant of its OTO is shown as «lo mismo, más barato». The base can't be itself a variant, and a product that other products point to can't become a variant. "
      + POSTCOMPRA_DOC + " The response includes the saved postcompra_page and a postcompra_preview URL (sample buyer, buttons disabled) to check it.",
    input: z.object({
      store: storeArg,
      slug: slugArg("Product").describe("Product slug (permanent id inside the store)."),
      name: z.string().trim().min(1).max(200).optional(),
      short_name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(2000).optional(),
      kind: z.enum(["main", "upsell", "postcompra", "bonus"]).optional()
        .describe("Category: main = Principal (the checkout's main product) · upsell = added inside the checkout (order bump) · postcompra = offered 1-click after paying · bonus = free bonus included."),
      prices: z.array(priceInput).max(30).optional(),
      remove_price_currencies: z.array(z.string().regex(/^[A-Za-z]{3}$/)).optional(),
      delivery_url: z.string().regex(/^https?:\/\/\S+$/, "http(s) URL").nullable().optional(),
      delivery_links: z.array(deliveryLink).max(20).optional(),
      image_url: httpsUrl.nullable().optional(),
      process_image: z.boolean().default(true),
      email_image_url: httpsUrl.nullable().optional().describe("Only with process_image=false: JPG/PNG cover for emails."),
      active: z.boolean().optional(),
      show_in_catalog: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(9999).optional(),
      includes: z.array(z.string().min(1)).max(30).optional().describe("Product slugs delivered inside this product (pack). [] clears."),
      variant_of: z.string().trim().min(1).max(120).nullable().optional()
        .describe("Slug of the base product (same store) when this one is a price variant of it, e.g. a half-price downsell. null clears."),
      presale: z.boolean().optional().describe("PRE-SALE (preventa): sold before the content exists. The buyer sees «delivered within N days» on the post-purchase page, the order-bump card and the delivery email, and the panel's «Preventas» page tracks who is owed it and the deadline (first sale + presale_days), with alerts 24 h before and when late. Set it on the base product AND its half-price variant. false = the content is ready (same as «Ya está el contenido» in the panel)."),
      presale_days: z.number().int().min(1).max(60).optional().describe("Days promised for a pre-sale product (default 3)."),
      presale_pages: z.number().int().min(1).max(500).nullable().optional().describe("PRE-SALE plan: how many pages the book will have (shown in «Contenido pendiente» so whoever writes it knows the target). Always set it when creating a pre-sale book."),
      presale_outline: z.string().max(6000).nullable().optional().describe("PRE-SALE plan: the table of contents the book will have, one line per chapter/page (e.g. «p.3 Che cos'è la psicometria»). Must match what the cover and description promise. Always set it when creating a pre-sale book."),
      postcompra_page: looseJson.optional()
        .describe("Partial patch of the post-purchase (OTO) page content, merged into what is saved; null in a key resets it to the default. Fields in the tool description."),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const { data: existing } = await db.from("products").select("id,image_url,kind,postcompra_page,presale").eq("store_id", s.id).eq("slug", a.slug).maybeSingle();
      const warnings: string[] = [];
      const row: Record<string, unknown> = { updated_by_admin_at: new Date().toISOString() };
      if (a.presale !== undefined) {
        row.presale = a.presale;
        // La fecha de inicio solo cuando ENTRA en preventa: volver a guardarlo no la pisa.
        if (a.presale) { if (!existing?.presale) row.presale_since = new Date().toISOString(); } else if (existing?.presale !== false) row.content_ready_at = new Date().toISOString();
      }
      if (a.presale_days !== undefined) row.presale_days = a.presale_days;
      if (a.presale_pages !== undefined) row.presale_pages = a.presale_pages;
      if (a.presale_outline !== undefined) row.presale_outline = a.presale_outline?.trim() || null;
      for (const k of ["name", "short_name", "description", "kind", "delivery_url", "active", "show_in_catalog", "sort_order"] as const) {
        if (a[k] !== undefined) row[k] = a[k];
      }
      if (a.delivery_links) row.delivery_links = a.delivery_links;
      if (a.includes !== undefined) {
        const inc = [...new Set(a.includes)].filter((x) => x !== a.slug);
        const bySlug = inc.length ? await productsBySlugs(s, inc) : new Map<string, ProductRow>();
        row.includes = inc.map((x) => bySlug.get(x)!.id);
      }
      if (a.variant_of !== undefined) {
        if (a.variant_of === null) row.variant_of = null;
        else {
          if (a.variant_of === a.slug) throw new UserError("variant_of can't be the product itself.");
          const base = (await productsBySlugs(s, [a.variant_of])).get(a.variant_of)!;
          const { data: b } = await db.from("products").select("id,variant_of").eq("id", base.id).maybeSingle();
          if (b?.variant_of) throw new UserError(`"${a.variant_of}" is itself a variant of another product: point variant_of to that base instead.`);
          if (existing?.id) {
            const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("variant_of", existing.id);
            if (count) throw new UserError(`"${a.slug}" is the base of ${count} other product(s): it can't become a variant itself.`);
          }
          row.variant_of = base.id;
        }
      }
      if (a.postcompra_page !== undefined) {
        warnings.push(...postcompraWarnings(a.postcompra_page));
        row.postcompra_page = mergePostcompraPage(existing?.postcompra_page, a.postcompra_page);
      }

      let id = existing?.id as string | undefined;
      if (!id) {
        if (!a.name) throw new UserError(`Product "${a.slug}" doesn't exist yet: pass name to create it.`);
        row.short_name ??= (a.name.split("—")[0].trim() || a.name).slice(0, 80);
        row.kind ??= "main";
        row.description ??= "";
        const { data, error } = await db.from("products").insert({ ...row, store_id: s.id, slug: a.slug }).select("id").single();
        if (error) throw new UserError(`Could not create the product: ${error.message}`);
        id = data.id as string;
      } else {
        const { error } = await db.from("products").update(row).eq("id", id);
        if (error) throw new UserError(`Could not update the product: ${error.message}`);
      }

      if (a.image_url === null) {
        await db.from("products").update({ image_url: null, email_image_url: null }).eq("id", id);
      } else if (a.image_url !== undefined && a.image_url !== existing?.image_url) {
        if (a.process_image) {
          const { web, email } = await processedImage(s.slug, id, a.image_url);
          await db.from("products").update({ image_url: web, email_image_url: email }).eq("id", id);
        } else {
          await db.from("products").update({ image_url: a.image_url, email_image_url: a.email_image_url ?? null }).eq("id", id);
        }
      } else if (a.email_image_url !== undefined) {
        await db.from("products").update({ email_image_url: a.email_image_url }).eq("id", id);
      }

      for (const p of a.prices ?? []) {
        const vals: Record<string, unknown> = { product_id: id, currency: p.currency };
        for (const k of ["amount", "compare_at", "display_value"] as const) if (p[k] !== undefined) vals[k] = p[k] === null ? null : r2(p[k]!);
        const { error } = await db.from("product_prices").upsert(vals, { onConflict: "product_id,currency" });
        if (error) throw new UserError(`Price ${p.currency}: ${error.message}`);
        if (p.amount != null && p.compare_at != null && p.compare_at <= p.amount) warnings.push(`${p.currency}: compare_at (${p.compare_at}) is not higher than amount (${p.amount}); no discount will show.`);
      }
      if (a.remove_price_currencies?.length) {
        await db.from("product_prices").delete().eq("product_id", id).in("currency", a.remove_price_currencies.map((c) => c.toUpperCase()));
      }

      const p = await getProduct(s, a.slug);
      if (p.kind !== "bonus" && !p.product_prices.some((x) => x.currency === "USD" && num(x.amount) != null)) {
        warnings.push("No USD price: buyers outside the currencies with a fixed price cannot be quoted. Add {currency:\"USD\", amount: ...}.");
      }
      if (p.kind !== "bonus" && !p.delivery_url && !(p.delivery_links ?? []).length) warnings.push("No delivery_url / delivery_links: the delivery email will have no download button.");
      if (p.image_url && !p.email_image_url && /\.webp(\?|$)/i.test(p.image_url)) warnings.push("Cover is WebP without an email JPG: Outlook won't show it. Re-run with process_image=true.");
      return {
        [existing ? "updated" : "created"]: p.slug, product: productOut(p), warnings,
        ...(a.includes !== undefined ? { includes: a.includes.filter((x) => x !== a.slug) } : {}),
        ...(a.variant_of !== undefined ? { variant_of: a.variant_of } : {}),
        ...(a.postcompra_page !== undefined ? {
          postcompra_page: row.postcompra_page,
          postcompra_preview: `${appBaseUrl()}/oferta/preview?store=${encodeURIComponent(s.slug)}&product=${encodeURIComponent(p.slug)}&lang=${encodeURIComponent(s.default_locale)}`,
        } : {}),
      };
    },
  });

  defineTool(server, "set_postcompra_html", {
    title: "Set post-purchase landing HTML",
    kind: "write",
    idempotent: true,
    description:
      "Upload (or replace) the full HTML landing of a product's 1-click post-purchase (OTO) page. When a product has it, /oferta shows this page instead of the template (postcompra_page of upsert_product). Pass html \"\" (or null) to remove it and go back to the template. "
      + POSTCOMPRA_HTML_DOC
      + " Returns how many accept/decline hooks were found and a preview URL (sample buyer, accept/decline simulated, nothing charged).",
    input: z.object({
      store: storeArg,
      product: z.string().min(1).describe("Product slug."),
      html: z.string().max(600_000).nullable().describe("Full HTML document of the landing. \"\" or null removes it."),
    }),
    handler: async ({ store, product, html }) => {
      const s = await getStore(store);
      const p = await getProduct(s, product);
      const raw = html ?? "";
      const clean = raw.trim() ? cleanOtoHtml(raw) : "";
      const { error } = await db.from("products")
        .update({ postcompra_html: clean || null, updated_by_admin_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) throw new UserError(`Could not save: ${error.message}`);

      const count = (re: RegExp) => (clean.match(re) ?? []).length;
      const accept = count(/data-oto\s*=\s*["']accept["']/gi);
      const decline = count(/data-oto\s*=\s*["']decline["']/gi);
      const warnings: string[] = [];
      if (clean) {
        if (clean.length !== raw.length && /<script|\son[a-z]+\s*=|javascript:/i.test(raw)) warnings.push("JavaScript was removed (<script>, on…= attributes or javascript: links): the page cannot run its own JS.");
        if (!accept) warnings.push('No data-oto="accept" element: the buyer has no way to buy.');
        if (!decline) warnings.push('No data-oto="decline" element: the buyer has no visible way to continue without buying.');
      }
      return {
        product: p.slug,
        mode: clean ? "html landing" : "template (postcompra_page)",
        saved_chars: clean.length,
        accept_hooks: accept,
        decline_hooks: decline,
        preview: `${appBaseUrl()}/oferta/preview?store=${encodeURIComponent(s.slug)}&product=${encodeURIComponent(p.slug)}&lang=${encodeURIComponent(s.default_locale)}`,
        warnings,
      };
    },
  });

  defineTool(server, "activate_products", {
    title: "Activate new books (one step)",
    kind: "write",
    idempotent: true,
    description:
      "One step to turn on books that were waiting as placeholders (active=false, shown as «Próximamente» in the post-purchase chain): sets each product's Drive link (delivery_url) and active=true, optionally adds them to the store's complete-library product (add_to_library: its includes and book_count), and returns every post-purchase chain that uses them with its rule checks in Spanish (empty = OK). Refused, with nothing saved, if a product would end up active without any delivery link. Packs (products with includes) are activated the same way; pass them together with their books.",
    input: z.object({
      store: storeArg,
      products: z.array(z.object({
        slug: z.string().min(1).describe("Product slug."),
        delivery_url: httpsUrl.optional().describe("Public Drive link of the PDF/folder. Omit to keep the current one."),
      })).min(1).max(20),
      add_to_library: z.string().optional().describe("Slug of the complete-library product (is_library) that must also include these books. Only products without includes (single books) are added."),
    }),
    handler: async ({ store, products, add_to_library }) => {
      const s = await getStore(store);
      const bySlug = await productsBySlugs(s, products.map((x) => x.slug));
      const missing = products.filter((x) => {
        const p = bySlug.get(x.slug)!;
        return p.kind !== "bonus" && !x.delivery_url && !p.delivery_url && !(p.delivery_links ?? []).length;
      });
      if (missing.length) throw new UserError(`No se activó nada: ${missing.map((x) => `«${x.slug}»`).join(", ")} no tiene link de descarga. Pasá delivery_url (link público de Drive) para cada uno.`);

      const lib = add_to_library ? await getProduct(s, add_to_library) : null;
      const { data: libRow } = lib ? await db.from("products").select("id,includes,book_count,is_library").eq("id", lib.id).single() : { data: null };
      if (lib && !libRow?.is_library) throw new UserError(`No se activó nada: «${lib.slug}» no es la biblioteca completa (is_library = false).`);

      const now = new Date().toISOString();
      for (const x of products) {
        const p = bySlug.get(x.slug)!;
        const row: Record<string, unknown> = { active: true, updated_by_admin_at: now };
        if (x.delivery_url) row.delivery_url = x.delivery_url;
        const { error } = await db.from("products").update(row).eq("id", p.id);
        if (error) throw new UserError(`Could not activate ${p.slug}: ${error.message}`);
      }

      let library: Record<string, unknown> | null = null;
      if (lib && libRow) {
        const { data: inc } = await db.from("products").select("id,includes").in("id", products.map((x) => bySlug.get(x.slug)!.id));
        const singles = (inc ?? []).filter((r) => !((r.includes as string[] | null) ?? []).length).map((r) => r.id as string);
        const before = ((libRow.includes as string[] | null) ?? []).filter(Boolean);
        const added = singles.filter((id) => !before.includes(id));
        const includes = [...before, ...added];
        const book_count = libRow.book_count == null ? null : Number(libRow.book_count) + added.length;
        const { error } = await db.from("products").update({ includes, ...(book_count == null ? {} : { book_count }), updated_by_admin_at: now }).eq("id", lib.id);
        if (error) throw new UserError(`Activated, but could not update the library: ${error.message}`);
        library = {
          product: lib.slug, added: added.length, includes: includes.length, book_count,
          todo: "Copy the new PDFs into the library's Drive folder and update its page (book count, gallery) with upsert_product.",
        };
      }

      const ids = products.map((x) => bySlug.get(x.slug)!.id);
      const { data: uses } = await db.from("pp_steps").select("pp_funnel_id").in("product_id", ids);
      const chainIds = [...new Set((uses ?? []).map((u) => u.pp_funnel_id as string))];
      const chains = [];
      for (const id of chainIds) {
        const [{ data: f }, { data: rows }] = await Promise.all([
          db.from("pp_funnels").select("id,name,active").eq("id", id).single(),
          db.from("pp_steps").select("id,product_id,kind,downsell_of,level,sort_order,show_if").eq("pp_funnel_id", id),
        ]);
        chains.push({ id, name: f?.name, active: f?.active, checks: await ppProblems((rows ?? []) as PpRow[]) });
      }
      return {
        activated: products.map((x) => x.slug),
        library,
        chains,
        next: "Run simulate_postpurchase for each checkout and a Compra de prueba before announcing them.",
      };
    },
  });

  defineTool(server, "delete_product", {
    title: "Delete product",
    kind: "destructive",
    description:
      "DESTRUCTIVE. Delete a product from a store (also removes it from checkouts and post-purchase steps). If it was ever sold it is archived (active=false) instead, to keep order history. Refused while it is the main product of a checkout (change or delete that checkout first). Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, product: z.string().min(1), confirm: confirmArg }),
    handler: async ({ store, product }) => {
      const s = await getStore(store);
      const p = await getProduct(s, product);
      const { data: asMain } = await db.from("funnels").select("slug").eq("main_product_id", p.id);
      if (asMain?.length) throw new UserError(`"${p.slug}" is the main product of checkout(s) ${asMain.map((f) => f.slug).join(", ")}. Change their main_product (update_checkout) or delete them first.`);
      const { count } = await db.from("order_items").select("id", { count: "exact", head: true }).eq("product_id", p.id);
      if (count) {
        await db.from("products").update({ active: false, updated_by_admin_at: new Date().toISOString() }).eq("id", p.id);
        return { archived: p.slug, reason: `It has ${count} sold items, so it was archived (active=false) instead of deleted.` };
      }
      await db.from("funnel_items").delete().eq("product_id", p.id);
      const { error } = await db.from("products").delete().eq("id", p.id);
      if (error) throw new UserError(`Could not delete: ${error.message}`);
      return { deleted: p.slug };
    },
  });

  defineTool(server, "upload_media", {
    title: "Upload media file",
    kind: "write",
    external: true,
    description:
      "Download a public file from source_url (https only, max 15 MB; images, mp4/webm/mov video or PDF) and store it in the app's public Storage bucket `media` under {store}/{path}. Images (jpeg/png/webp/avif) are optimized by default into a WebP (max 1000 px, for checkout/web) plus a JPG (480 px, for emails); gif/svg/video/pdf are stored as-is. Returns the public URL(s) to use in image_url, logo_url, guarantee images, etc. A timestamp is added to the file name so CDNs never serve an old version.",
    input: z.object({
      store: storeArg,
      source_url: httpsUrl.describe("Direct public https link to the file (for Google Drive use https://drive.google.com/uc?export=download&id=FILE_ID)."),
      path: z.string().regex(/^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]{0,150}$/i, 'Relative path without extension, e.g. "products/kit-cover" or "checkout/guarantee"')
        .describe("Destination inside the store folder (no leading slash, no '..')."),
      optimize_image: z.boolean().default(true),
    }),
    handler: async ({ store, source_url, path, optimize_image }) => {
      const s = await getStore(store);
      const d = await downloadPublic(source_url, {
        maxBytes: 15 * 1024 * 1024,
        accept: (t) => /^image\//.test(t) || /^video\/(mp4|webm|quicktime)$/.test(t) || t === "application/pdf",
        what: "upload_media (images, mp4/webm/mov video, pdf)",
      });
      const base = `${s.slug}/${path.replace(/\/+$/, "").replace(/\.[a-z0-9]{2,4}$/i, "")}`;
      if (optimize_image && /^image\/(jpeg|png|webp|avif)$/.test(d.contentType)) {
        if (d.buf.length > IMAGE_MAX) throw new UserError("Images to optimize must be ≤ 12 MB (or pass optimize_image=false).");
        const out = await uploadImage(new File([new Uint8Array(d.buf)], d.filename, { type: d.contentType }), base);
        return { url: out.web, email_url: out.email, content_type: "image/webp", source_bytes: d.buf.length };
      }
      const key = `${base}-${Date.now().toString(36)}.${extFor(d.contentType)}`;
      const { error } = await db.storage.from("media").upload(key, d.buf, { contentType: d.contentType, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return { url: db.storage.from("media").getPublicUrl(key).data.publicUrl, content_type: d.contentType, bytes: d.buf.length };
    },
  });

  // ----------------------------------------------------------- checkouts
  const stylePatch = stylePatchSchema();

  defineTool(server, "create_checkout", {
    title: "Create checkout",
    kind: "write",
    description:
      `Create a checkout (funnel) in a store. Required: slug (URL part: {app}/c/{store}/{slug} and https://{store domain}/{slug}), name, main_product (slug of the product charged when the checkout opens; must have a price). Optional: items [{product, role, sort_order?}] (${ROLE_DOC}), active (default true), pixel_ids (Meta pixel ids already added with upsert_pixel that load ONLY on this checkout, besides the store-wide ones), style (same partial object as update_checkout_style). Returns the full checkout (URLs, items, pixels, resolved style, warnings).`,
    input: z.object({
      store: storeArg,
      slug: slugArg("Checkout"),
      name: z.string().trim().min(1).max(120),
      main_product: z.string().min(1).describe("Main product slug."),
      items: z.array(itemInput).max(60).default([]),
      active: z.boolean().default(true),
      pixel_ids: z.array(z.string().regex(/^\d{6,20}$/)).default([]).describe("Meta pixel ids (digits)."),
      style: stylePatch.optional().describe("Initial style patch; see update_checkout_style for every field."),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const { data: clash } = await db.from("funnels").select("id").eq("store_id", s.id).eq("slug", a.slug).maybeSingle();
      if (clash) throw new UserError(`Checkout "${a.slug}" already exists in "${s.slug}". Use update_checkout.`);
      const main = await getProduct(s, a.main_product);
      const warnings: string[] = [];
      if (main.kind !== "main") warnings.push(`Main product "${main.slug}" has kind=${main.kind}.`);
      const pix = await pixelUuids(s, a.pixel_ids);
      const { data: f, error } = await db.from("funnels").insert({
        store_id: s.id, slug: a.slug, name: a.name, main_product_id: main.id, active: a.active, pixel_ids: pix,
        settings: a.style ? mergeSettings({}, a.style) : {},
      }).select("id,main_product_id").single();
      if (error) throw new UserError(`Could not create the checkout: ${error.message}`);
      const res = await setItems(s, f, a.items);
      const detail = await checkoutDetail(s, await getFunnelRow(s, a.slug));
      return { created: a.slug, ...detail, warnings: [...warnings, ...res.warnings, ...detail.warnings] };
    },
  });

  defineTool(server, "update_checkout", {
    title: "Update checkout",
    kind: "write",
    idempotent: true,
    description:
      `Partially update a checkout (funnel); only what you pass changes. name; new_slug (renames the URL: old links and ads stop working); main_product (product slug); active (false = paused, URL returns 404); items: the COMPLETE desired list [{product, role, sort_order?}] that REPLACES all current items (${ROLE_DOC}) — new ones are inserted first and removed ones deleted last, so a failure never leaves the checkout empty; pass [] to remove all; pixel_ids: COMPLETE list of Meta pixel ids that load only on this checkout (replaces; store-wide all_funnels pixels always load too); style: partial style patch merged like update_checkout_style; public_url / landing_url / meta_campaign_ids_add|remove: where it lives on the brand domain, its landing and the Meta campaigns that send to it. Returns the full checkout.`,
    input: z.object({
      store: storeArg,
      checkout: z.string().min(1).describe("Current checkout slug."),
      name: z.string().trim().min(1).max(120).optional(),
      new_slug: slugArg("Checkout").optional(),
      main_product: z.string().min(1).optional(),
      active: z.boolean().optional(),
      items: z.array(itemInput).max(60).optional(),
      pixel_ids: z.array(z.string().regex(/^\d{6,20}$/)).optional(),
      style: stylePatch.optional(),
      public_url: z.string().url().regex(/^https:\/\/[^/]+\/.+/).nullable().optional()
        .describe("The checkout's PUBLIC address on the brand domain, e.g. https://pay.tumarca.com/fr/chimie/paiement (sets checkout_host + checkout_path; the site's vercel.json must rewrite that path to https://<your-app>.vercel.app/<same path> BEFORE you set this, or the monitor marks it down). null clears it (back to /c/{store}/{slug})."),
      landing_url: z.string().url().regex(/^https:\/\//).nullable().optional()
        .describe("The offer's landing page (the monitor checks it links to this checkout). null clears."),
      meta_campaign_ids_add: z.array(z.string().regex(/^\d{6,25}$/)).max(50).optional()
        .describe("Meta campaign ids that send traffic to this checkout (linking them makes their spend count for this offer in Métricas and gives the bid pilot the real price)."),
      meta_campaign_ids_remove: z.array(z.string().regex(/^\d{6,25}$/)).max(50).optional(),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const f = await getFunnelRow(s, a.checkout);
      const warnings: string[] = [];
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (a.name !== undefined) row.name = a.name;
      if (a.active !== undefined) row.active = a.active;
      if (a.new_slug && a.new_slug !== f.slug) {
        const { data: clash } = await db.from("funnels").select("id").eq("store_id", s.id).eq("slug", a.new_slug).maybeSingle();
        if (clash) throw new UserError(`Slug "${a.new_slug}" is already used by another checkout.`);
        row.slug = a.new_slug;
        warnings.push(`URL changed from /${f.slug} to /${a.new_slug}: update ads and links.`);
      }
      if (a.main_product) {
        const main = await getProduct(s, a.main_product);
        row.main_product_id = main.id;
        if (main.kind !== "main") warnings.push(`Main product "${main.slug}" has kind=${main.kind}.`);
        // El principal no puede quedar también como item.
        await db.from("funnel_items").delete().eq("funnel_id", f.id).eq("product_id", main.id);
      }
      if (a.pixel_ids) row.pixel_ids = await pixelUuids(s, a.pixel_ids);
      if (a.style) row.settings = mergeSettings(f.settings, a.style);
      if (a.public_url !== undefined) {
        if (a.public_url === null) { row.checkout_host = null; row.checkout_path = null; }
        else { const u = new URL(a.public_url); row.checkout_host = u.host; row.checkout_path = u.pathname.replace(/\/+$/, ""); }
      }
      if (a.landing_url !== undefined) row.landing_url = a.landing_url;
      if (a.meta_campaign_ids_add || a.meta_campaign_ids_remove) {
        const { data: cur } = await db.from("funnels").select("meta_campaign_ids").eq("id", f.id).single();
        const set = new Set<string>(((cur?.meta_campaign_ids as string[] | null) ?? []));
        for (const c of a.meta_campaign_ids_add ?? []) set.add(c);
        for (const c of a.meta_campaign_ids_remove ?? []) set.delete(c);
        row.meta_campaign_ids = [...set];
      }
      const { error } = await db.from("funnels").update(row).eq("id", f.id);
      if (error) throw new UserError(`Could not update the checkout: ${error.message}`);
      if (a.items) {
        const res = await setItems(s, { id: f.id, main_product_id: (row.main_product_id as string) ?? f.main_product_id }, a.items);
        warnings.push(...res.warnings, `Items: ${res.added} added, ${res.removed} removed.`);
      }
      const detail = await checkoutDetail(s, await getFunnelRow(s, (row.slug as string) ?? f.slug));
      return { updated: Object.keys(row).filter((k) => k !== "updated_at").concat(a.items ? ["items"] : []), ...detail, warnings: [...warnings, ...detail.warnings] };
    },
  });

  defineTool(server, "update_checkout_style", {
    title: "Update checkout style",
    kind: "write",
    idempotent: true,
    description:
      "Change the look and copy of one checkout (funnels.settings). `patch` is a PARTIAL nested object: only the fields you send change, everything else keeps its saved value (mode=replace starts from the defaults instead). Unknown fields or wrong types are rejected with an error. Empty string \"\" means 'use the translated default'. Returns the fully resolved settings and the list of changed fields. Fields (section.field (type, default): meaning):\n"
      + styleFieldList()
      + "\nExample patch: {\"colors\":{\"pay\":\"#0a7d33\"},\"payButton\":{\"text\":\"Get instant access\"},\"countdown\":{\"show\":true,\"minutes\":10},\"exitOffer\":{\"show\":true,\"title\":\"Wait!\",\"text\":\"10% off if you finish now\",\"discountPercent\":10}}. Upload images first with upload_media.",
    input: z.object({
      store: storeArg,
      checkout: z.string().min(1).describe("Checkout (funnel) slug."),
      patch: stylePatch,
      mode: z.enum(["merge", "replace"]).default("merge"),
    }),
    handler: async ({ store, checkout, patch, mode }) => {
      const s = await getStore(store);
      const f = await getFunnelRow(s, checkout);
      const before = resolveSettings(f.settings);
      const after = mode === "replace" ? resolveSettings(patch) : mergeSettings(f.settings, patch);
      const { error } = await db.from("funnels").update({ settings: after, updated_at: new Date().toISOString() }).eq("id", f.id);
      if (error) throw new UserError(`Could not save: ${error.message}`);
      const changed: string[] = [];
      const b = before as unknown as Record<string, unknown>, c = after as unknown as Record<string, unknown>;
      for (const k of Object.keys(c)) {
        const bv = b[k], cv = c[k];
        if (cv && typeof cv === "object") {
          for (const kk of Object.keys(cv)) {
            const x = (bv as Record<string, unknown>)?.[kk], y = (cv as Record<string, unknown>)[kk];
            if (JSON.stringify(x) !== JSON.stringify(y)) changed.push(`${k}.${kk}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
          }
        } else if (JSON.stringify(bv) !== JSON.stringify(cv)) changed.push(`${k}: ${JSON.stringify(bv)} → ${JSON.stringify(cv)}`);
      }
      const dropped = droppedFields(patch as Record<string, unknown>, c);
      return { checkout: f.slug, ...checkoutUrls(s, f.slug), changed, ...(dropped.length ? { not_applied: dropped } : {}), settings: after };
    },
  });

  defineTool(server, "delete_checkout", {
    title: "Delete checkout",
    kind: "destructive",
    description:
      "DESTRUCTIVE. Delete a checkout (funnel) and its items and checkout-specific post-purchase funnels. If it has orders it is paused (active=false) instead, to keep order history. Its URL stops working either way. Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, checkout: z.string().min(1), confirm: confirmArg }),
    handler: async ({ store, checkout }) => {
      const s = await getStore(store);
      const f = await getFunnelRow(s, checkout);
      const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("funnel_id", f.id);
      if (count) {
        await db.from("funnels").update({ active: false, updated_at: new Date().toISOString() }).eq("id", f.id);
        return { paused: f.slug, reason: `It has ${count} orders, so it was paused (active=false) instead of deleted.` };
      }
      const { error } = await db.from("funnels").delete().eq("id", f.id);
      if (error) throw new UserError(`Could not delete: ${error.message}`);
      return { deleted: f.slug };
    },
  });

  // -------------------------------------------------------------- pixels
  defineTool(server, "upsert_pixel", {
    title: "Add or update Meta pixel",
    kind: "write",
    idempotent: true,
    description:
      "Add a Meta (Facebook) pixel to a store or update it (matched by pixel_id). Fields: name, capi_token (Conversions API access token from Events Manager; stored encrypted, never returned; null removes it), test_event_code (e.g. TEST12345: while set, server events go ONLY to Events Manager > Test events and do not count for ads; null removes it), all_funnels (true = loads on every checkout of the store; false = only on checkouts that select it). attach_to_checkouts / detach_from_checkouts: checkout slugs whose own pixel list gets this pixel added/removed (one pixel per offer is the recommended setup: don't mark it all_funnels if the store sells several offers).",
    input: z.object({
      store: storeArg,
      pixel_id: z.string().regex(/^\d{6,20}$/, "Pixel id: digits only, e.g. 1234567890123456"),
      name: z.string().trim().max(80).optional(),
      capi_token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,600}$/, "Looks wrong: paste the Conversions API access token (starts with EAA...)").nullable().optional(),
      test_event_code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/).nullable().optional(),
      all_funnels: z.boolean().optional(),
      attach_to_checkouts: z.array(z.string()).optional(),
      detach_from_checkouts: z.array(z.string()).optional(),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const { data: ex } = await db.from("pixels").select("id").eq("store_id", s.id).eq("pixel_id", a.pixel_id).maybeSingle();
      const row: Record<string, unknown> = {};
      if (a.name !== undefined) row.name = a.name;
      if (a.capi_token !== undefined) row.capi_token_enc = a.capi_token ? encrypt(a.capi_token) : null;
      if (a.test_event_code !== undefined) row.test_event_code = a.test_event_code || null;
      if (a.all_funnels !== undefined) row.all_funnels = a.all_funnels;
      let id = ex?.id as string | undefined;
      if (id) {
        if (Object.keys(row).length) {
          const { error } = await db.from("pixels").update(row).eq("id", id);
          if (error) throw new UserError(error.message);
        }
      } else {
        const { data, error } = await db.from("pixels").insert({ store_id: s.id, pixel_id: a.pixel_id, name: a.name ?? "", ...row }).select("id").single();
        if (error) throw new UserError(error.message);
        id = data.id as string;
      }
      for (const [list, add] of [[a.attach_to_checkouts, true], [a.detach_from_checkouts, false]] as const) {
        for (const slug of list ?? []) {
          const f = await getFunnelRow(s, slug);
          const set = new Set(f.pixel_ids ?? []);
          if (add) set.add(id!); else set.delete(id!);
          await db.from("funnels").update({ pixel_ids: [...set], updated_at: new Date().toISOString() }).eq("id", f.id);
        }
      }
      const { data: p } = await db.from("pixels").select("id,pixel_id,name,capi_token_enc,test_event_code,all_funnels").eq("id", id).single();
      const { data: funnels } = await db.from("funnels").select("slug,pixel_ids").eq("store_id", s.id);
      return { [ex ? "updated" : "created"]: a.pixel_id, pixel: pixelOut(p!, (funnels ?? []).filter((f) => (f.pixel_ids ?? []).includes(id!)).map((f) => f.slug)) };
    },
  });

  defineTool(server, "delete_pixel", {
    title: "Delete Meta pixel",
    kind: "destructive",
    description:
      "DESTRUCTIVE. Remove a Meta pixel (and its stored CAPI token) from a store and from every checkout that selected it. Purchases stop being reported to it immediately. Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, pixel_id: z.string().regex(/^\d{6,20}$/), confirm: confirmArg }),
    handler: async ({ store, pixel_id }) => {
      const s = await getStore(store);
      const { data: p } = await db.from("pixels").select("id").eq("store_id", s.id).eq("pixel_id", pixel_id).maybeSingle();
      if (!p) throw new UserError(`Pixel ${pixel_id} is not configured in "${s.slug}". Use list_pixels.`);
      const { data: funnels } = await db.from("funnels").select("id,slug,pixel_ids").eq("store_id", s.id).contains("pixel_ids", [p.id]);
      for (const f of funnels ?? []) {
        await db.from("funnels").update({ pixel_ids: (f.pixel_ids ?? []).filter((x: string) => x !== p.id) }).eq("id", f.id);
      }
      await db.from("pixels").delete().eq("id", p.id);
      return { deleted: pixel_id, removed_from_checkouts: (funnels ?? []).map((f) => f.slug) };
    },
  });

  defineTool(server, "test_pixel", {
    title: "Send test Purchase to pixel",
    kind: "write",
    external: true,
    description:
      "Send ONE test Purchase event through the Conversions API to a single pixel, ONLY if that pixel has a test_event_code set (so it lands in Events Manager > Test events and never affects ads). Refuses otherwise: set test_event_code first with upsert_pixel, and remove it after testing. Uses the pixel's CAPI token (or the env META_CAPI_TOKEN). value in major units (default 1.00), currency default USD. Returns Meta's response (events_received / error).",
    input: z.object({
      store: storeArg,
      pixel_id: z.string().regex(/^\d{6,20}$/),
      value: z.number().min(0).max(100000).default(1),
      currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD"),
    }),
    handler: async ({ store, pixel_id, value, currency }) => {
      const s = await getStore(store);
      const { data: p } = await db.from("pixels").select("pixel_id,capi_token_enc,test_event_code").eq("store_id", s.id).eq("pixel_id", pixel_id).maybeSingle();
      if (!p) throw new UserError(`Pixel ${pixel_id} is not configured in "${s.slug}".`);
      if (!p.test_event_code) throw new UserError("Refused: this pixel has no test_event_code, so the event would count as a real purchase. Set one with upsert_pixel (Events Manager > Test events shows the code), then retry.");
      const token = p.capi_token_enc ? decrypt(p.capi_token_enc) : process.env.META_CAPI_TOKEN;
      if (!token) throw new UserError("No Conversions API token for this pixel (and no env META_CAPI_TOKEN). Add capi_token with upsert_pixel.");
      const eventId = `mcp-test-${Date.now()}`;
      const body = {
        data: [{
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          event_source_url: checkoutUrls(s, "test").url,
          user_data: { em: sha256("test@example.com"), external_id: sha256("mcp-test"), client_user_agent: "checkout-propio-mcp-test" },
          custom_data: { currency: currency.toUpperCase(), value: Number(value.toFixed(2)), content_type: "product", content_ids: ["mcp-test"], order_id: eventId },
        }],
        test_event_code: p.test_event_code,
      };
      const res = await fetch(`https://graph.facebook.com/v23.0/${p.pixel_id}/events?access_token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json().catch(() => ({}))) as { events_received?: number; fbtrace_id?: string; error?: { message: string } };
      if (!j.events_received) throw new UserError(`Meta rejected the event: ${j.error?.message ?? `HTTP ${res.status}`}`);
      return { sent: true, pixel_id, test_event_code: p.test_event_code, event_id: eventId, events_received: j.events_received, fbtrace_id: j.fbtrace_id, check: "Events Manager > Test events" };
    },
  });

  // ------------------------------------------------------------- mercados
  defineTool(server, "upsert_market", {
    title: "Add or update market",
    kind: "write",
    idempotent: true,
    description:
      "Create or update a market of a store, matched by currency (one market per currency). Buyers from its countries (ISO-2 codes, e.g. [\"IT\",\"SM\",\"VA\"]) pay in that currency: products with a fixed price in it use that price, the rest are converted from USD at today's rate. countries REPLACES the market's list; a country can only be in one market of the store. is_default=true unmarks the other markets. Returns the market and which active products lack a fixed price in that currency.",
    input: z.object({
      store: storeArg,
      currency: z.string().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()),
      name: z.string().trim().max(60).optional(),
      countries: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(80).optional(),
      is_default: z.boolean().optional(),
    }),
    handler: async ({ store, currency, name, countries, is_default }) => {
      const s = await getStore(store);
      const { data: markets } = await db.from("markets").select("id,name,currency,countries").eq("store_id", s.id);
      const cc = countries ? [...new Set(countries.map((c) => c.toUpperCase()))] : undefined;
      if (cc) {
        for (const m of markets ?? []) {
          if (m.currency === currency) continue;
          const dup = cc.filter((c) => (m.countries ?? []).includes(c));
          if (dup.length) throw new UserError(`${dup.join(", ")} already belong to market "${m.name}" (${m.currency}). Remove them there first with upsert_market.`);
        }
      }
      const ex = (markets ?? []).find((m) => m.currency === currency);
      const row: Record<string, unknown> = { store_id: s.id, currency };
      if (name !== undefined || !ex) row.name = name || ex?.name || currency;
      if (cc !== undefined) row.countries = cc;
      if (is_default !== undefined) row.is_default = is_default;
      const { error } = await db.from("markets").upsert(row, { onConflict: "store_id,currency" });
      if (error) throw new UserError(error.message);
      if (is_default) await db.from("markets").update({ is_default: false }).eq("store_id", s.id).neq("currency", currency);
      const { data: m } = await db.from("markets").select("name,currency,countries,is_default").eq("store_id", s.id).eq("currency", currency).single();
      const products = await storeProducts(s.id);
      const noPrice = products.filter((p) => p.active && p.kind !== "bonus" && !p.product_prices.some((x) => x.currency === currency && num(x.amount) != null)).map((p) => p.slug);
      return { market: m, products_without_fixed_price: noPrice, note: noPrice.length ? `These will be converted from USD with 'charm' rounding (e.g. 26.43 → 26.90). Set a fixed ${currency} price with upsert_product if you want an exact price.` : undefined };
    },
  });

  defineTool(server, "delete_market", {
    title: "Delete market",
    kind: "destructive",
    description:
      "DESTRUCTIVE. Delete a store's market (by currency). Its countries go back to automatic local-currency conversion from USD; fixed product prices in that currency stay stored but are only used if the country's local currency is that one. Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, currency: z.string().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()), confirm: confirmArg }),
    handler: async ({ store, currency }) => {
      const s = await getStore(store);
      const { data } = await db.from("markets").delete().eq("store_id", s.id).eq("currency", currency).select("name");
      if (!data?.length) throw new UserError(`No ${currency} market in "${s.slug}". Use list_markets.`);
      return { deleted: currency, name: data[0].name };
    },
  });

  // --------------------------------------------------------- post-compra
  defineTool(server, "upsert_postpurchase", {
    title: "Create or update post-purchase funnel",
    kind: "write",
    description:
      "Create (no id) or replace (with id) a post-purchase funnel: the 1-click offers shown after paying, organised in LEVELS — OTO 1, OTO 2, OTO 3 (max 3), each with at most ONE downsell. trigger_products = the exact set of products bought (main product + order bumps taken) that fires it. "
      + "steps = in order; a plain slug is an OTO on the next level. Object form: {product, level?: 1-3, downsell_of?: '<slug of an OTO in this list>', show_if?}. Several OTOs with the same level are ALTERNATIVES for different buyers (use show_if with checkout_any/checkout_none, e.g. pack if no bump, the other book if one bump); the buyer sees one, then goes to the next level. A downsell is shown ONLY after its OTO was declined; after any answer in a level the buyer goes to the next level. "
      + "show_if: {owns_any|owns_none|checkout_any|checkout_none: [slugs]} — owns_* = what the buyer already has (checkout + accepted so far, packs = their includes, variants = their base); checkout_* = only what was bought IN THE CHECKOUT. "
      + "Rules enforced (rejected with an error in Spanish): max 3 OTO levels; one downsell per OTO; a downsell must be the SAME offer as its OTO at a lower price (about half): a price-variant product with variant_of = the OTO, whose page gives a true reason (e.g. price only on this page right after the purchase) — never the same product id, never a different book, never more expensive; the same offer (product or its price variant) cannot be OTO in two different levels (books may repeat inside different offers: the engine never offers what the buyer already owns). The engine also never offers what the buyer owns (product, its base, or a pack with anything they own; a library only if they own all of it) and skips archived (inactive) products — use one as an 'OTO 2 coming soon' placeholder. "
      + "To change one step use upsert_pp_step. checkout = limit it to one checkout slug (null/omitted = any checkout of the store). reserve_minutes = 'offer reserved for N minutes' timer (0-120, default 10). Selection rule at purchase time: exact trigger match, else the largest trigger contained in what was bought. Use simulate_postpurchase to verify.",
    input: z.object({
      store: storeArg,
      id: z.uuid().optional().describe("Existing post-purchase funnel id (from list_postpurchase) to replace."),
      name: z.string().trim().min(1).max(120),
      checkout: z.string().nullable().optional(),
      trigger_products: z.array(z.string()).min(1).max(10),
      steps: z.array(z.union([
        z.string(),
        z.object({
          product: z.string().min(1),
          level: z.number().int().min(1).max(3).optional().describe("OTO level 1-3 (omitted = the next one). Ignored for downsells (they take their OTO's level)."),
          downsell_of: z.string().min(1).optional().describe("Slug of the OTO step (in this same list) this product is the downsell of."),
          show_if: showIfInput,
        }),
      ])).min(1).max(16),
      active: z.boolean().default(true),
      reserve_minutes: z.number().int().min(0).max(120).default(10),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const entries = a.steps.map((x) => (typeof x === "string" ? { product: x, level: undefined, downsell_of: undefined, show_if: undefined } : x));
      const slugs = entries.map((e) => e.product);
      const condSlugs = entries.flatMap((e) => Object.values(e.show_if ?? {}).flat() as string[]);
      const bySlug = await productsBySlugs(s, [...a.trigger_products, ...slugs, ...condSlugs]);
      const trig = [...new Set(a.trigger_products)].map((x) => bySlug.get(x)!);
      const steps = slugs.map((x) => bySlug.get(x)!);
      const roleKey = (e: { product: string; downsell_of?: string }) => `${e.product}:${e.downsell_of ? "downsell" : "oto"}`;
      if (new Set(entries.map(roleKey)).size !== entries.length) throw new UserError("Un producto aparece dos veces con el mismo papel (OTO o downsell).");
      for (const e of entries) {
        if (!e.downsell_of) continue;
        if (!entries.find((x) => x.product === e.downsell_of && !x.downsell_of)) throw new UserError(`«${e.product}» es downsell de «${e.downsell_of}», que no es un OTO de esta cadena.`);
      }
      const overlap = steps.filter((p) => trig.some((t) => t.id === p.id));
      if (overlap.length) throw new UserError(`${overlap.map((p) => p.slug).join(", ")} are in trigger_products: the buyer already owns them, they would never be offered.`);
      const bonus = steps.filter((p) => p.kind === "bonus");
      if (bonus.length) throw new UserError(`${bonus.map((p) => p.slug).join(", ")} are free bonus products; steps must be paid products (kind main/upsell/postcompra).`);
      const warnings: string[] = [];
      for (const p of new Set(steps)) if (!p.product_prices.some((x) => num(x.amount))) warnings.push(`Step "${p.slug}" has no price: it will be skipped.`);

      // Las filas tal como quedarían, para validar las reglas antes de tocar nada.
      let lastLevel = 0;
      const cond = (e: (typeof entries)[number]) => showIfIds(e.show_if, bySlug);
      const draft: PpRow[] = entries.map((e, i) => {
        const level = e.downsell_of ? null : e.level ?? lastLevel + 1;
        if (level) lastLevel = Math.max(lastLevel, level);
        return { id: `new-${i}`, product_id: steps[i].id, kind: e.downsell_of ? "downsell" : "oto", downsell_of: null, level, sort_order: (level ?? 0) * 100 + i, show_if: cond(e) };
      });
      entries.forEach((e, i) => {
        if (!e.downsell_of) return;
        const pi = entries.findIndex((x) => x.product === e.downsell_of && !x.downsell_of);
        draft[i].downsell_of = draft[pi].id;
        draft[i].sort_order = draft[pi].sort_order + 1;
      });
      const problems = await ppProblems(draft);
      if (problems.length) throw new UserError(problems.join(" "));

      let funnel: FunnelRow | null = null;
      if (a.checkout) {
        funnel = await getFunnelRow(s, a.checkout);
        const { data: its } = await db.from("funnel_items").select("product_id").eq("funnel_id", funnel.id).eq("role", "bump");
        const buyable = new Set([funnel.main_product_id, ...(its ?? []).map((i) => i.product_id)]);
        const never = trig.filter((t) => !buyable.has(t.id));
        if (never.length) warnings.push(`${never.map((t) => t.slug).join(", ")} are neither the main product nor a bump of "${funnel.slug}": this funnel can never fire there.`);
      }

      const row = {
        store_id: s.id, name: a.name, checkout_funnel_id: funnel?.id ?? null,
        trigger_product_ids: trig.map((t) => t.id), active: a.active, reserve_minutes: a.reserve_minutes, auto_generated: false,
      };
      let id = a.id;
      if (id) {
        const { data: ex } = await db.from("pp_funnels").select("id").eq("id", id).eq("store_id", s.id).maybeSingle();
        if (!ex) throw new UserError(`Post-purchase funnel ${id} not found in "${s.slug}". Use list_postpurchase.`);
        const { error } = await db.from("pp_funnels").update(row).eq("id", id);
        if (error) throw new UserError(error.message);
        await db.from("pp_steps").delete().eq("pp_funnel_id", id);
      } else {
        const { data, error } = await db.from("pp_funnels").insert(row).select("id").single();
        if (error) throw new UserError(error.message);
        id = data.id as string;
      }
      // Primero los OTO (los downsells necesitan el id del paso del que cuelgan).
      const otos = draft.filter((d) => d.kind === "oto");
      const { data: otoRows, error: e2 } = await db.from("pp_steps")
        .insert(otos.map((d) => ({ pp_funnel_id: id, product_id: d.product_id, sort_order: d.sort_order, kind: "oto", level: d.level, show_if: d.show_if ?? null })))
        .select("id,product_id");
      if (e2) throw new UserError(`Steps not saved: ${e2.message}`);
      const realId = new Map(otos.map((d, k) => [d.id, (otoRows ?? []).find((r) => r.product_id === d.product_id)?.id as string ?? (otoRows ?? [])[k]?.id as string]));
      const downs = draft.filter((d) => d.kind === "downsell")
        .map((d) => ({ pp_funnel_id: id, product_id: d.product_id, sort_order: d.sort_order, kind: "downsell", downsell_of: realId.get(d.downsell_of!)!, show_if: d.show_if ?? null }));
      if (downs.length) {
        const { error: e3 } = await db.from("pp_steps").insert(downs);
        if (e3) throw new UserError(`Downsell steps not saved: ${e3.message}`);
      }

      const { data: same } = await db.from("pp_funnels").select("id,name,trigger_product_ids,checkout_funnel_id").eq("store_id", s.id).eq("active", true).neq("id", id);
      const key = (ids: string[]) => [...ids].sort().join(",");
      const dup = (same ?? []).filter((x) => key(x.trigger_product_ids) === key(row.trigger_product_ids) && (x.checkout_funnel_id ?? null) === row.checkout_funnel_id);
      if (dup.length) warnings.push(`Other active funnels have the same trigger and scope (${dup.map((d) => d.name).join(", ")}): only one of them will ever fire.`);
      return {
        [a.id ? "updated" : "created"]: id, name: a.name, checkout: funnel?.slug ?? "(any)", trigger_products: trig.map((t) => t.slug),
        steps: entries.map((e, i) => `${draft[i].level ? `L${draft[i].level} ` : ""}${e.product}${e.downsell_of ? ` (downsell of ${e.downsell_of})` : ""}${showIfText(e.show_if)}`),
        active: a.active, warnings,
      };
    },
  });

  defineTool(server, "upsert_pp_step", {
    title: "Add or change one post-purchase step",
    kind: "write",
    description:
      "Add, change or remove one step of a post-purchase funnel (id from list_postpurchase). A chain has LEVELS — OTO 1, OTO 2, OTO 3 (max 3) — each with at most one downsell. A step is identified by product + kind (oto/downsell). "
      + "kind \"oto\" (default): level 1-3 (omitted = keep its level, or the next level if new); position = its place among the alternatives of that level. Several OTOs in one level are alternatives for different buyers (show_if with checkout_any / checkout_none, e.g. the 2-book pack if no bump, the other book if they took one): the buyer sees one, then goes to the next level. "
      + "kind \"downsell\": downsell_of = product slug of an OTO of the same funnel; shown ONLY after that OTO was declined; then (yes or no) the next level. "
      + "show_if: owns_any / owns_none look at everything the buyer already has (checkout + accepted so far; packs = their includes, variants = their base); checkout_any / checkout_none look ONLY at what was bought in the checkout. null removes the condition; omitted keeps it. "
      + "Rejected with an error in Spanish if the result breaks a rule: more than 3 OTO levels; more than one downsell per OTO; a downsell that is not the same offer as its OTO at a lower price (a price variant: variant_of = the OTO; never the same product id, never a different book); the same offer (product or its price variant) as OTO in two different levels (books MAY repeat across levels inside different offers: the engine never offers what the buyer owns). remove=true deletes the step (and an OTO's downsell). Check with simulate_postpurchase or the panel's simulation.",
    input: z.object({
      store: storeArg,
      postpurchase: z.uuid().describe("Post-purchase funnel id (list_postpurchase)."),
      product: z.string().min(1).describe("Product slug of the step."),
      kind: z.enum(["oto", "downsell"]).default("oto"),
      level: z.number().int().min(1).max(3).optional().describe("Only for kind=oto: OTO level 1-3."),
      downsell_of: z.string().min(1).optional().describe("Required for kind=downsell: product slug of the OTO step it hangs from."),
      position: z.number().int().min(1).max(10).optional().describe("Only for kind=oto: 1-based place among the alternatives of its level."),
      show_if: showIfInput,
      remove: z.boolean().default(false),
    }),
    handler: async (a) => {
      const s = await getStore(a.store);
      const { data: pp } = await db.from("pp_funnels")
        .select("id,name,trigger_product_ids,pp_steps(id,sort_order,product_id,kind,downsell_of,show_if,level)")
        .eq("id", a.postpurchase).eq("store_id", s.id).maybeSingle();
      if (!pp) throw new UserError(`Post-purchase funnel ${a.postpurchase} not found in "${s.slug}". Use list_postpurchase.`);
      const rows = (pp.pp_steps ?? []) as PpRow[];
      // Niveles explícitos para todas (las cadenas viejas no los tenían).
      const ord0 = orderSteps(rows);
      const lv0 = resolveLevels(ord0);
      const levelNow = new Map(ord0.map((x, i) => [x.row.id, lv0[i]]));
      let next: PpRow[] = rows.map((r) => ({ ...r, level: r.kind === "downsell" ? null : levelNow.get(r.id) ?? r.level }));

      const prod = await getProduct(s, a.product);
      const existing = next.find((r) => r.product_id === prod.id && (r.kind === "downsell") === (a.kind === "downsell")) ?? null;
      const warnings: string[] = [];

      if (a.remove) {
        if (!existing) throw new UserError(`«${prod.slug}» no es un ${a.kind} de esta cadena.`);
        next = next.filter((r) => r.id !== existing.id && r.downsell_of !== existing.id);
      } else {
        if (prod.kind === "bonus") throw new UserError(`"${prod.slug}" is a free bonus product; steps must be paid products.`);
        if ((pp.trigger_product_ids as string[]).includes(prod.id)) throw new UserError(`"${prod.slug}" is in this funnel's trigger: the buyer already owns it.`);
        if (!prod.product_prices.some((x) => num(x.amount))) warnings.push(`"${prod.slug}" has no price: it will be skipped.`);
        const condSlugs = Object.values(a.show_if ?? {}).flat() as string[];
        const bySlug = condSlugs.length ? await productsBySlugs(s, condSlugs) : new Map<string, ProductRow>();
        const cond = a.show_if === undefined ? undefined : showIfIds(a.show_if, bySlug);

        if (a.kind === "downsell") {
          if (!a.downsell_of) throw new UserError("Un downsell necesita downsell_of (el slug de un OTO de esta cadena).");
          if (a.level) throw new UserError("Un downsell no lleva nivel: toma el de su OTO.");
          const parent = await getProduct(s, a.downsell_of);
          const parentRow = next.find((r) => r.product_id === parent.id && r.kind !== "downsell");
          if (!parentRow) throw new UserError(`«${parent.slug}» no es un OTO de esta cadena.`);
          if (existing) Object.assign(existing, { downsell_of: parentRow.id, ...(cond !== undefined ? { show_if: cond } : {}) });
          else next.push({ id: "new", product_id: prod.id, kind: "downsell", downsell_of: parentRow.id, level: null, sort_order: 0, show_if: cond ?? null });
        } else {
          if (a.downsell_of) throw new UserError("downsell_of solo va con kind=downsell.");
          const maxLevel = Math.max(0, ...next.filter((r) => r.kind !== "downsell").map((r) => r.level ?? 0));
          const level = a.level ?? existing?.level ?? maxLevel + 1;
          if (existing) Object.assign(existing, { level, ...(cond !== undefined ? { show_if: cond } : {}) });
          else next.push({ id: "new", product_id: prod.id, kind: "oto", downsell_of: null, level, sort_order: 0, show_if: cond ?? null });
          // Lugar entre las alternativas de su nivel.
          const me = existing ?? next.find((r) => r.id === "new")!;
          const peers = next.filter((r) => r.kind !== "downsell" && r.level === level && r !== me).sort((x, y) => x.sort_order - y.sort_order);
          peers.splice(a.position ? Math.min(a.position - 1, peers.length) : existing ? peers.filter((r) => r.sort_order < me.sort_order).length : peers.length, 0, me);
          peers.forEach((r, k) => (r.sort_order = level * 100 + k * 10));
        }
        // Orden: nivel, alternativa; cada downsell pegado a su OTO.
        for (const r of next) if (r.kind !== "downsell" && !(r.sort_order >= (r.level ?? 0) * 100 && r.sort_order < (r.level ?? 0) * 100 + 100)) r.sort_order = (r.level ?? 0) * 100 + 90;
        for (const r of next) if (r.kind === "downsell") r.sort_order = (next.find((o) => o.id === r.downsell_of)?.sort_order ?? 0) + 1;
      }

      const problems = await ppProblems(next);
      if (problems.length) throw new UserError(problems.join(" "));

      const keep = new Set(next.map((r) => r.id));
      const gone = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
      if (gone.length) await db.from("pp_steps").delete().in("id", gone);
      for (const r of next.filter((x) => x.id !== "new" && x.kind !== "downsell")) {
        await db.from("pp_steps").update({ sort_order: r.sort_order, level: r.level, show_if: r.show_if ?? null }).eq("id", r.id);
      }
      for (const r of next.filter((x) => x.id === "new" && x.kind !== "downsell")) {
        const { error } = await db.from("pp_steps").insert({ pp_funnel_id: pp.id, product_id: r.product_id, kind: "oto", level: r.level, sort_order: r.sort_order, show_if: r.show_if ?? null });
        if (error) throw new UserError(error.message);
      }
      for (const r of next.filter((x) => x.kind === "downsell")) {
        const row = { downsell_of: r.downsell_of, sort_order: r.sort_order, show_if: r.show_if ?? null, level: null };
        const { error } = r.id === "new"
          ? await db.from("pp_steps").insert({ ...row, pp_funnel_id: pp.id, product_id: r.product_id, kind: "downsell" })
          : await db.from("pp_steps").update(row).eq("id", r.id);
        if (error) throw new UserError(error.message);
      }

      const { data: after } = await db.from("pp_steps").select("id,sort_order,product_id,kind,downsell_of,show_if,level").eq("pp_funnel_id", pp.id);
      const names = new Map((await storeProducts(s.id)).map((p) => [p.id, p.slug]));
      const ord = orderSteps((after ?? []) as PpRow[]);
      const lv = resolveLevels(ord);
      return {
        postpurchase: pp.id, name: pp.name,
        steps: ord.map((x, i) => `L${lv[i]} ${names.get(x.row.product_id)}${x.parentRow ? ` (downsell of ${names.get(x.parentRow.product_id)})` : ""}${showIfText(showIfSlugs(x.row.show_if, names))}`),
        warnings,
      };
    },
  });

  defineTool(server, "autogenerate_postpurchase", {
    title: "Auto-generate post-purchase funnels",
    kind: "write",
    description:
      "Generate one post-purchase funnel per combination of a checkout's order bumps (2^bumps funnels, max 8 bumps): trigger = main product + that combination, steps = the checkout's upsell items then its bumps the buyer didn't take, up to max_steps. REPLACES the previously auto-generated funnels of that checkout (manual ones are kept).",
    input: z.object({
      store: storeArg,
      checkout: z.string().min(1),
      max_steps: z.number().int().min(1).max(6).default(2),
      reserve_minutes: z.number().int().min(0).max(120).default(10),
    }),
    handler: async ({ store, checkout, max_steps, reserve_minutes }) => {
      const s = await getStore(store);
      const f = await getFunnelRow(s, checkout);
      try {
        return { checkout: f.slug, ...(await autogenerate({ checkoutFunnelId: f.id, maxSteps: max_steps, reserveMinutes: reserve_minutes })) };
      } catch (e) {
        throw new UserError((e as Error).message);
      }
    },
  });

  defineTool(server, "delete_postpurchase", {
    title: "Delete post-purchase funnel",
    kind: "destructive",
    description: "DESTRUCTIVE. Delete one post-purchase funnel (by id from list_postpurchase). Buyers matching its trigger fall back to another funnel or the checkout's simple upsell chain. Requires confirm: true, only after the user explicitly asked for it.",
    input: z.object({ store: storeArg, id: z.uuid(), confirm: confirmArg }),
    handler: async ({ store, id }) => {
      const s = await getStore(store);
      const { data } = await db.from("pp_funnels").delete().eq("id", id).eq("store_id", s.id).select("name");
      if (!data?.length) throw new UserError(`Post-purchase funnel ${id} not found in "${s.slug}".`);
      return { deleted: id, name: data[0].name };
    },
  });

  // ------------------------------------------------------------- pedidos
  defineTool(server, "resend_delivery", {
    title: "Resend delivery email",
    kind: "write",
    external: true,
    description:
      "Send the delivery email of a PAID order again to the buyer (real email, through the store's mail provider), with the main product and every bonus/included/bump/upsell item of the order and their download links. On success marks the order delivered and clears delivery_error. Use after fixing a delivery problem or when a buyer says they didn't get it. Accepts order uuid, 8-char ref or pi_ id.",
    input: z.object({ order: z.string().min(1).describe("Order number (#1001), uuid, old 8-char ref, or pi_ id.") }),
    handler: async ({ order }) => {
      const id = await findOrderId(order);
      const { data: o } = await db.from("orders").select("id,number,store_id,status,email,name,locale,currency,amount_total").eq("id", id).single();
      if (!o) throw new UserError("Order not found.");
      if (o.status !== "paid") throw new UserError(`Order status is "${o.status}": only paid orders are delivered.`);
      if (!o.email) throw new UserError("The order has no buyer email.");
      const { data: items } = await db.from("order_items").select("kind,amount,product_id").eq("order_id", id).order("created_at");
      const mainItem = (items ?? []).find((i) => i.kind === "main");
      const main = mainItem?.product_id ? await getProductById(mainItem.product_id) : null;
      if (!main) throw new UserError("The order has no main product item (or it was deleted).");
      const extras = (await Promise.all((items ?? []).filter((i) => i.kind !== "main" && i.product_id).map((i) => getProductById(i.product_id!))))
        .filter((p): p is Product => !!p);
      const { data: store } = await db.from("stores").select(STORE_COLS).eq("id", o.store_id).single();
      const total = (items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(o.amount_total ?? 0);
      try {
        const r = await sendDelivery({
          to: o.email, name: o.name, store: store as unknown as Store,
          locale: (LOCALES as readonly string[]).includes(o.locale ?? "") ? (o.locale as Locale) : DEFAULT_LOCALE,
          main, extras, currency: o.currency ?? "USD", orderRef: orderRef(o), total, orderId: id,
        });
        if ("skipped" in r) throw new UserError("No mail provider configured (POSTMARK_TOKEN / BREVO_API_KEY): nothing was sent.");
        await db.from("orders").update({ delivered_at: new Date().toISOString(), delivery_error: null }).eq("id", id);
        return { sent_to: o.email, message_id: r.messageId, items: [main.slug, ...extras.map((p) => p.slug)] };
      } catch (e) {
        if (e instanceof UserError) throw e;
        throw new UserError(`Email failed: ${(e as Error).message.slice(0, 300)}`);
      }
    },
  });

  defineTool(server, "refund_order", {
    title: "Refund order",
    kind: "destructive",
    external: true,
    description:
      "MONEY-MOVING. Refund an order through the store's Stripe account. Without amount: refunds the whole main payment (checkout + order bumps) and, if include_upsells (default true), every 1-click upsell payment of the order. With amount (major units of the order currency, e.g. 9.95): partial refund of the MAIN payment only; upsell payments are not touched. Already-refunded payments are skipped. The order status/amount_refunded are updated by the charge.refunded webhook seconds later (not here). Requires confirm: true, only after the user explicitly approved this refund and its amount.",
    input: z.object({
      order: z.string().min(1).describe("Order number (#1001), uuid, old 8-char ref, or pi_ id."),
      confirm: confirmArg,
      amount: z.number().positive().max(1_000_000).optional(),
      include_upsells: z.boolean().default(true),
      reason: z.enum(["requested_by_customer", "duplicate", "fraudulent"]).default("requested_by_customer"),
    }),
    handler: async ({ order, amount, include_upsells, reason }) => {
      const id = await findOrderId(order);
      const { data: o } = await db.from("orders").select("id,number,store_id,status,currency,amount_total,amount_refunded,stripe_payment_intent").eq("id", id).single();
      if (!o) throw new UserError("Order not found.");
      if (o.status === "pending" || o.status === "failed") throw new UserError(`Order status is "${o.status}": nothing was charged yet.`);
      const cur = (o.currency ?? "USD").toUpperCase();
      const refundable = r2(Number(o.amount_total ?? 0) - Number(o.amount_refunded ?? 0));
      if (amount !== undefined && amount > refundable) throw new UserError(`Amount ${amount} ${cur} exceeds what is left to refund on the main payment (${refundable} ${cur}).`);
      const { data: ups } = await db.from("order_items").select("stripe_payment_intent,amount,refunded_amount,currency").eq("order_id", id).eq("kind", "upsell");
      const { stripe, livemode } = await stripeForStore(o.store_id);

      const jobs: { pi: string; minor?: number; what: string }[] = [];
      if (o.stripe_payment_intent) jobs.push({ pi: o.stripe_payment_intent, minor: amount !== undefined ? toMinor(amount, cur) : undefined, what: "main" });
      if (amount === undefined && include_upsells) {
        for (const u of ups ?? []) if (u.stripe_payment_intent && u.stripe_payment_intent !== o.stripe_payment_intent) jobs.push({ pi: u.stripe_payment_intent, what: "upsell" });
      }
      if (!jobs.length) throw new UserError("The order has no Stripe payment to refund.");

      const refunds: unknown[] = [], skipped: string[] = [], failed: string[] = [];
      const done = toMinor(Number(o.amount_refunded ?? 0), cur);
      for (const j of jobs) {
        try {
          const r = await stripe.refunds.create(
            { payment_intent: j.pi, ...(j.minor ? { amount: j.minor } : {}), reason, metadata: { source: "checkout-propio-mcp", order: id } },
            { idempotencyKey: `mcp-refund-${j.pi}-${j.minor ?? "full"}-${done}` }
          );
          refunds.push({ payment: j.what, payment_intent: j.pi, refund_id: r.id, status: r.status, amount: fromMinor(r.amount, r.currency), currency: r.currency.toUpperCase() });
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err.code === "charge_already_refunded") skipped.push(`${j.what} ${j.pi}: already refunded`);
          else failed.push(`${j.what} ${j.pi}: ${err.message}`);
        }
      }
      if (!refunds.length && failed.length) throw new UserError(`Refund failed: ${failed.join(" · ")}`);
      return { order: orderRef(o), mode: livemode ? "live" : "test", refunds, skipped, failed, note: "Order status updates when Stripe's charge.refunded webhook arrives. Buyers see the money in 5-10 business days." };
    },
  });

  defineTool(server, "send_recovery", {
    title: "Send cart recovery email",
    kind: "write",
    external: true,
    description:
      "Send the abandoned-cart recovery email (real email) for one open checkout (checkout_id from list_abandoned_checkouts) with a link back to the same checkout. Skipped automatically if the person already bought in the store after opening it, or if the checkout is no longer open. Marks recovery_sent_at. The hourly cron already does this for carts older than 1 hour, so use it for manual nudges.",
    input: z.object({ checkout_id: z.uuid().describe("checkouts.id from list_abandoned_checkouts (not a checkout slug).") }),
    handler: async ({ checkout_id }) => {
      const r = await recoverCheckout(checkout_id);
      if ("skipped" in r) {
        const why: Record<string, string> = {
          "no aplica": "checkout not found, has no email, or is no longer open (already paid)",
          "ya compró": "the person already bought in this store after opening it (marked as paid)",
          "embudo o producto inexistente": "its checkout or main product no longer exists",
          "sin BREVO_API_KEY": "no mail provider configured",
        };
        const reason = String(r.skipped ?? "unknown");
        throw new UserError(`Not sent: ${why[reason] ?? reason}`);
      }
      return { sent: true, message_id: r.sent };
    },
  });
}
