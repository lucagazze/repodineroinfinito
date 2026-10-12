import type { McpServer } from "@modelcontextprotocol/server";
import { registerReadTools } from "./read-tools";
import { registerWriteTools } from "./write-tools";
import { registerOfferTools } from "./offer-tools";
import { registerMailTools } from "./mail-tools";
import { registerMailCenterTools } from "./mail-center-tools";
import { registerAdsTools } from "./ads-tools";
import { registerMktTools } from "./mkt-tools";

/** Lo que Claude lee al conectarse: el mapa del negocio y las reglas de uso. */
export const INSTRUCTIONS = `FIRST: call get_guide and read the whole guide (Spanish) before creating or changing anything: it explains every section, how to upload offers, Drive, presale content, post-purchase rules and the 3 ads per offer.
checkout-propio: the owner's own checkout platform (Stripe PaymentIntents + Supabase). It hosts several stores (brands), each with products, checkouts (funnels), Meta pixels, markets (currencies) and post-purchase 1-click upsells.

Offers are the owner's unit of business (list_offers / upsert_offer / offer_summary): an offer belongs to a store and groups one checkout per market (market_label), each with its own bumps, post-purchase and pixels. Inactive offers are kept for reference — do not activate or move traffic for them unless the owner asks.
Identifiers: stores, products and checkouts are addressed by slug (list_stores, list_products, list_checkouts). Orders by the order number buyers see (#1001), uuid, the older 8-char reference, or the Stripe pi_ id.
Money: every amount in and out of this server is in MAJOR units of its currency (19.90 = 19.90 EUR, never cents). *_usd values are converted at today's ECB rate.
Typical setup of a new offer: list_stores → upsert_product (main + bumps/upsells/bonuses, with USD price, delivery_url, image) → upsert_pixel (capi_token) → create_checkout (main_product, items, pixel_ids, style) → get_checkout to verify URLs and warnings → diagnose_store.
Ads: each offer has an «Ads» section in the panel (list_ad_creatives / upsert_ad_creative / set_offer_ads_folder): creatives live in Google Drive, shared «anyone with the link».
Style changes: update_checkout_style with a partial patch (its description lists every field).
Safety: refund_order, disconnect_stripe and delete_* need confirm=true and must only be called after the user explicitly approved that exact action. resend_delivery and send_recovery send real emails; connect_stripe changes the live Stripe account (webhook). Never invent prices, links or pixel ids: ask the user. Every write is logged (get_mcp_audit_log).
Notification center: list_alerts (bounces, failed/unopened deliveries, broken links, new buyer emails, disputes) → list_emails (opens/clicks/downloads/bounces per email) → list_inbox / read_message → reply_message (real email; only with the owner's approved text) or resend_delivery. sync_inbox pulls the mailbox now. AI replies: draft_reply (classification + draft in the buyer's language) → send_reply after the owner approves; money (refund_order) is always the owner's call.
Email marketing (campaigns to past buyers, per language, cross-selling what each one does not own yet): mkt_contacts_summary, mkt_segment_count, list_mkt_campaigns, get_mkt_campaign (stats + attributed revenue), upsert_mkt_campaign_draft and write_mkt_campaign_with_ai. Sending is NEVER possible from here: only drafts; the owner test-sends and sends from the panel (Email marketing) after confirming the exact count.`;

export function registerAll(server: McpServer) {
  registerReadTools(server);
  registerWriteTools(server);
  registerOfferTools(server);
  registerMailTools(server);
  registerMailCenterTools(server);
  registerAdsTools(server);
  registerMktTools(server);
}
