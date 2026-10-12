import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db, getFunnel, getProductById, itemsByRole } from "@/lib/db";
import { renderDelivery } from "@/lib/email";
import { withBrand } from "@/lib/brand";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";
import { replyToMessage, syncAllInboxes, syncInbox } from "@/lib/inbox";
import { scanAlerts } from "@/lib/alerts";
import { checkLinks, linksOf } from "@/lib/link-check";
import { recoverCart } from "@/lib/cart-recovery";
import { AI_MISSING, aiConfigured, autoSendable, draftReply, sendAiReply } from "@/lib/ai-reply";
import { clickUrl, liveTrackBase, publicOrigin } from "@/lib/mail-track";
import { allStores, defineTool, findOrderId, getStore, storeArg, UserError } from "./util";
import { embeddedRef } from "@/lib/order-ref";

/**
 * Centro de avisos por el MCP: avisos abiertos, mails enviados con aperturas,
 * clics y rebotes, el buzón de cada tienda (leer y responder) y la
 * sincronización IMAP a pedido.
 */

/** «#1001» del pedido embebido (orders(number,status)); sin él, la referencia vieja. */
const ref8 = (id: string | null, emb?: unknown) => (id ? embeddedRef(id, emb) : null);

export function registerMailCenterTools(server: McpServer) {
  defineTool(server, "list_alerts", {
    title: "List alerts",
    kind: "read",
    description:
      "Alerts of the notification center, newest first: email_failed (an email could not be sent by any provider), email_bounced (a buyer's mailbox rejected our email), not_opened_24h (paid order whose tracked delivery email was not opened nor any download clicked in 24 h), new_inbox_message (a person wrote to the store mailbox), stripe_dispute, webhook_error (Stripe event still failing after 15 min), delivery_error (paid order not delivered), broken_link (a delivery link does not open a real file/folder). Each has severity info|warn|error, title, body, link (panel path) and ref. Default: only unresolved.",
    input: z.object({
      store: storeArg.optional(),
      kind: z.string().optional(),
      severity: z.enum(["info", "warn", "error"]).optional(),
      include_resolved: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ store, kind, severity, include_resolved, limit }) => {
      let q = db.from("alerts").select("id,store_id,kind,severity,title,body,link,ref_id,created_at,resolved_at").order("created_at", { ascending: false }).limit(limit);
      if (store) q = q.eq("store_id", (await getStore(store)).id);
      if (kind) q = q.eq("kind", kind);
      if (severity) q = q.eq("severity", severity);
      if (!include_resolved) q = q.is("resolved_at", null);
      const [{ data, error }, stores] = await Promise.all([q, allStores()]);
      if (error) throw new Error(error.message);
      const slug = new Map(stores.map((s) => [s.id, s.slug]));
      return (data ?? []).map((a) => ({ ...a, store: a.store_id ? slug.get(a.store_id) ?? null : null, store_id: undefined }));
    },
  });

  defineTool(server, "resolve_alert", {
    title: "Resolve alert",
    kind: "write",
    idempotent: true,
    description: "Mark one alert (id from list_alerts) as resolved, or every unresolved alert of a kind with `all_of_kind`. Some alerts close by themselves (a later open/click closes not_opened_24h; a later successful delivery closes delivery_error/email_failed; a link that opens again closes broken_link).",
    input: z.object({ id: z.string().uuid().optional(), all_of_kind: z.string().optional() }),
    handler: async ({ id, all_of_kind }) => {
      if (!id && !all_of_kind) throw new UserError("Pass id or all_of_kind.");
      let q = db.from("alerts").update({ resolved_at: new Date().toISOString() }).is("resolved_at", null);
      q = id ? q.eq("id", id) : q.eq("kind", all_of_kind!);
      const { data, error } = await q.select("id");
      if (error) throw new Error(error.message);
      return { resolved: data?.length ?? 0 };
    },
  });

  defineTool(server, "list_emails", {
    title: "List sent emails with opens, clicks and bounces",
    kind: "read",
    description:
      "Emails sent to buyers (delivery, upsell, recovery, test, reply), newest first, with tracking: tracked (sent with open pixel + tracked links), opened_at/open_count, clicked_at/click_count, downloaded_at (clicked a download link: Drive / own file), bounced_at/bounce_reason (from the mailbox DSN), status sent|failed + error (also 'link roto: …' when a link in it did not open). Filters: store, kind, status (sent|failed|bounced|opened|not_opened|downloaded), order (#1001 / uuid / old 8-char ref / pi_), to (email), days (default 7, max 90).",
    input: z.object({
      store: storeArg.optional(),
      kind: z.enum(["delivery", "upsell", "recovery", "test", "reply"]).optional(),
      status: z.enum(["sent", "failed", "bounced", "opened", "not_opened", "downloaded"]).optional(),
      order: z.string().optional(),
      to: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ store, kind, status, order, to, days, limit }) => {
      let q = db.from("email_log")
        .select("id,created_at,store_id,kind,to_email,subject,provider,status,error,order_id,tracked,opened_at,open_count,clicked_at,click_count,downloaded_at,bounced_at,bounce_reason,orders(number,status)")
        .gte("created_at", new Date(Date.now() - days * 864e5).toISOString()).order("created_at", { ascending: false }).limit(limit);
      if (store) q = q.eq("store_id", (await getStore(store)).id);
      if (kind) q = q.eq("kind", kind);
      if (order) q = q.eq("order_id", await findOrderId(order));
      if (to) q = q.ilike("to_email", to.trim());
      if (status === "sent" || status === "failed") q = q.eq("status", status);
      if (status === "bounced") q = q.not("bounced_at", "is", null);
      if (status === "opened") q = q.not("opened_at", "is", null);
      if (status === "downloaded") q = q.not("downloaded_at", "is", null);
      if (status === "not_opened") q = q.eq("status", "sent").eq("tracked", true).is("opened_at", null).is("bounced_at", null);
      const [{ data, error }, stores] = await Promise.all([q, allStores()]);
      if (error) throw new Error(error.message);
      const slug = new Map(stores.map((s) => [s.id, s.slug]));
      return (data ?? []).map(({ store_id, orders, ...m }) => ({ ...m, store: store_id ? slug.get(store_id) ?? null : null, order_ref: ref8(m.order_id, orders) }));
    },
  });

  defineTool(server, "list_inbox", {
    title: "List store mailbox messages",
    kind: "read",
    description:
      "Messages received in a store's mailbox (INBOX, synced every 5 minutes; call sync_inbox first for the very latest), newest first: id, from, subject, date, 200-char snippet, is_bounce, linked order (latest order of the sender, or of the bounced recipient), read (in the panel or webmail) and replied. Filters: unread_only, bounces_only, buyers_only (linked to an order), query (subject/sender contains), days (default 14, max 90). Read one with read_message.",
    input: z.object({
      store: storeArg,
      unread_only: z.boolean().default(false),
      bounces_only: z.boolean().default(false),
      buyers_only: z.boolean().default(false),
      query: z.string().max(80).optional(),
      days: z.number().int().min(1).max(90).default(14),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    handler: async ({ store, unread_only, bounces_only, buyers_only, query, days, limit }) => {
      const s = await getStore(store);
      let q = db.from("inbox_messages").select("id,from_email,from_name,reply_to,subject,date,text,is_bounce,order_id,read_at,replied_at,attachments,orders(number,status)")
        .eq("store_id", s.id).eq("direction", "in").gte("date", new Date(Date.now() - days * 864e5).toISOString())
        .order("date", { ascending: false }).limit(limit);
      if (unread_only) q = q.is("read_at", null);
      if (bounces_only) q = q.eq("is_bounce", true);
      if (buyers_only) q = q.not("order_id", "is", null);
      if (query) {
        const v = query.replace(/[,()"*%\\]/g, " ").trim();
        if (v) q = q.or(`subject.ilike.*${v}*,from_email.ilike.*${v}*,from_name.ilike.*${v}*`);
      }
      const [{ data, error }, { data: st }] = await Promise.all([
        q, db.from("inbox_sync_state").select("synced_at,error").eq("store_id", s.id).eq("mailbox", "INBOX").maybeSingle(),
      ]);
      if (error) throw new Error(error.message);
      return {
        synced_at: st?.synced_at ?? null, sync_error: st?.error ?? null,
        messages: (data ?? []).map(({ text, attachments, orders, ...m }) => ({
          ...m, snippet: (text ?? "").replace(/\s+/g, " ").slice(0, 200), order_ref: ref8(m.order_id, orders),
          attachments: ((attachments ?? []) as { name: string | null }[]).map((a) => a.name),
        })),
      };
    },
  });

  defineTool(server, "read_message", {
    title: "Read a mailbox message",
    kind: "read",
    description:
      "Full plain text of one mailbox message (id from list_inbox), with headers, linked order (ref, status, amount, delivered), the email of ours it bounced (if a bounce), attachment names and the replies already sent from the panel/MCP. mark_read=true marks it read in the panel (never on the mail server).",
    input: z.object({ id: z.string().uuid(), mark_read: z.boolean().default(false) }),
    handler: async ({ id, mark_read }) => {
      const { data: m } = await db.from("inbox_messages")
        .select("id,store_id,direction,message_id,in_reply_to,from_email,from_name,reply_to,to_email,subject,date,text,is_bounce,email_log_id,order_id,read_at,replied_at,attachments")
        .eq("id", id).maybeSingle();
      if (!m) throw new UserError("Message not found. Use list_inbox to get ids.");
      const [{ data: order }, { data: bounced }, { data: replies }] = await Promise.all([
        m.order_id ? db.from("orders").select("id,number,status,email,name,amount_total,currency,delivered_at,created_at").eq("id", m.order_id).maybeSingle() : Promise.resolve({ data: null }),
        m.email_log_id ? db.from("email_log").select("kind,to_email,subject,created_at,bounce_reason,order_id,orders(number,status)").eq("id", m.email_log_id).maybeSingle() : Promise.resolve({ data: null }),
        db.from("inbox_messages").select("date,to_email,text").eq("store_id", m.store_id).eq("direction", "out").eq("in_reply_to", m.message_id).order("date"),
      ]);
      if (mark_read && !m.read_at) await db.from("inbox_messages").update({ read_at: new Date().toISOString() }).eq("id", id);
      const { store_id: _s, ...rest } = m;
      return {
        ...rest, text: (m.text ?? "").slice(0, 30_000),
        order: order ? { ...order, ref: ref8(order.id, order) } : null,
        bounced_email: bounced ? (({ orders, ...b }) => ({ ...b, order_ref: ref8(b.order_id, orders) }))(bounced) : null,
        replies_sent: replies ?? [],
      };
    },
  });

  defineTool(server, "reply_message", {
    title: "Reply to a mailbox message",
    kind: "write",
    external: true,
    description:
      "SENDS A REAL EMAIL to the sender of a mailbox message (id from list_inbox), from the store's own mailbox (SMTP), in the same thread (In-Reply-To/References, 'Re:' subject, original quoted below). A copy is saved in the mailbox Sent folder; the message is marked replied. Write `text` in the buyer's language, plain text, signed with the store name. Only call after the owner approved the exact text. Cannot reply to bounces/no-reply senders.",
    input: z.object({ id: z.string().uuid(), text: z.string().min(1).max(20_000) }),
    handler: async ({ id, text }) => {
      try {
        return await replyToMessage(id, text);
      } catch (e) {
        throw new UserError((e as Error).message);
      }
    },
  });

  defineTool(server, "check_delivery_email", {
    title: "Check every link of a checkout's delivery email",
    kind: "read",
    external: true,
    description:
      "Renders the REAL delivery email of a checkout (main product + included + bonus + every bump, in its language) and opens every link in it like a browser (redirects, 8 s): each must end in a 2xx real file/folder (Drive 404 or a sign-in page = broken). Returns subject and, per link, final URL, page title (for Drive: the file/folder name) and ok/reason. With track_base it also returns the tracked /api/m/c link each button would carry on that origin (only for testing the redirect; nothing is logged). Sends nothing.",
    input: z.object({
      store: storeArg,
      checkout: z.string().min(1).describe("Checkout (funnel) slug, see list_checkouts."),
      locale: z.enum(LOCALES as unknown as [Locale, ...Locale[]]).optional(),
      track_base: z.string().url().optional(),
    }),
    handler: async ({ store, checkout, locale, track_base }) => {
      const f = await getFunnel(store, checkout, { anyState: true });
      if (!f) throw new UserError(`Checkout "${checkout}" not found in "${store}". Use list_checkouts.`);
      const main = f.main_product_id ? await getProductById(f.main_product_id) : null;
      if (!main) throw new UserError("The checkout has no main product.");
      const loc = locale ?? ((f.settings as { locale?: string } | null)?.locale as Locale | undefined) ?? (f.stores.default_locale as Locale);
      const extras = [...itemsByRole(f, "included"), ...itemsByRole(f, "bonus"), ...itemsByRole(f, "bump")];
      const mailLoc = (LOCALES as readonly string[]).includes(loc) ? loc : DEFAULT_LOCALE;
      // Con la marca de ese idioma, como el mail real (fulfill): en otro idioma firma con el nombre de ese idioma.
      const { subject, html } = renderDelivery({
        to: "", name: "Test", store: withBrand(f.stores, mailLoc), locale: mailLoc,
        main, extras, currency: "USD", orderRef: "#1001", total: 0,
      });
      const [results, { data: fh }] = await Promise.all([
        checkLinks(linksOf(html)),
        db.from("funnels").select("checkout_host").eq("id", f.id).maybeSingle(),
      ]);
      const host = fh?.checkout_host ?? null;
      const probe = randomUUID();
      const base = track_base?.replace(/\/+$/, "");
      return {
        subject, checkout_host: host,
        tracking_live_on_checkout_host: !!(await liveTrackBase(publicOrigin(host) ?? publicOrigin(f.stores.domain)).catch(() => null)),
        links: results.map((r) => ({ ...r, ...(base ? { tracked_url: clickUrl(base, probe, r.url) } : {}) })),
        broken: results.filter((r) => !r.ok).length,
      };
    },
  });

  defineTool(server, "draft_reply", {
    title: "AI draft for a mailbox message",
    kind: "read",
    external: true,
    description:
      "The in-app AI (Claude) reads a mailbox message (id from list_inbox) with full context — the customer's orders in that store (items, amounts, dates, delivery links, what happened to each delivery email: sent/opened/downloaded/bounced), the refund policy in the offer's language, the thread — and returns a validated classification (intent delivery_problem|access_issue|refund_request|product_question|chargeback_threat|other, suggested actions, refund eligibility per policy + reason, needs_human, notes for el dueño, confidence, warnings from the post-check) plus a short reply draft in the customer's language signed as the store. decision: auto (retention first: never offers money; escalate=true when el dueño must decide), refund (el dueño refunded — use after refund_order), no_refund (el dueño declined: policy-based reply). Every link the customer is entitled to (main, bumps, bonuses, upsells, pack contents) is in its context. Cached per decision; regenerate=true forces a new one; dry_run=true does not save the draft nor raise the «Decidí: reembolso» alert. Sends nothing. Needs GEMINI_API_KEY or ANTHROPIC_API_KEY on the server.",
    input: z.object({ message_id: z.string().uuid(), decision: z.enum(["auto", "refund", "no_refund"]).default("auto"), regenerate: z.boolean().default(false), dry_run: z.boolean().default(false) }),
    handler: async ({ message_id, decision, regenerate, dry_run }) => {
      if (!aiConfigured()) throw new UserError(AI_MISSING);
      try {
        const d = await draftReply(message_id, { decision, force: regenerate, dry: dry_run });
        return { ...d, autopilot_would_send: autoSendable(d) };
      } catch (e) {
        throw new UserError((e as Error).message);
      }
    },
  });

  defineTool(server, "send_reply", {
    title: "Send a reply (AI-marked) to a mailbox message",
    kind: "write",
    external: true,
    description:
      "SENDS A REAL EMAIL: replies to a mailbox message from the store mailbox in the same thread, logged as an AI reply (email_log kind reply, ai=true, «IA» badge in the panel). Use the text from draft_reply (edited if needed) once the owner approved it. resend_delivery_order (#1001 / uuid / old 8-char ref) first resends that order's delivery email (only for the customer's own paid order). Never use it to promise or confirm a refund that was not done with refund_order.",
    input: z.object({ message_id: z.string().uuid(), text: z.string().min(1).max(20_000), resend_delivery_order: z.string().min(1).optional() }),
    handler: async ({ message_id, text, resend_delivery_order }) => {
      try {
        const orderId = resend_delivery_order ? await findOrderId(resend_delivery_order) : null;
        if (orderId) {
          const [{ data: m }, { data: o }] = await Promise.all([
            db.from("inbox_messages").select("store_id,from_email,reply_to").eq("id", message_id).maybeSingle(),
            db.from("orders").select("store_id,email").eq("id", orderId).maybeSingle(),
          ]);
          const who = [m?.from_email, m?.reply_to].filter(Boolean).map((x) => x!.toLowerCase());
          if (!m || !o || o.store_id !== m.store_id || !who.includes((o.email ?? "").toLowerCase())) {
            throw new UserError("That order is not from this customer in this store: resend it with resend_delivery if you are sure.");
          }
        }
        return await sendAiReply(message_id, text, { resendOrderId: orderId });
      } catch (e) {
        throw e instanceof UserError ? e : new UserError((e as Error).message);
      }
    },
  });

  defineTool(server, "set_ai_autopilot", {
    title: "Turn the mailbox AI autopilot on/off",
    kind: "write",
    idempotent: true,
    description: "Per store, default OFF. When ON, every 5 minutes the AI auto-replies (emails that arrived after it was turned on, < 6 h old, 1 reply per customer per 24 h) ONLY to: delivery/access problems of the customer's own paid, unrefunded order (resends the delivery and replies); product questions fully answerable from context; and the FIRST reply to a refund request of a verified order when it is a retention reply (never mentions or offers money). Second refund asks, legit refunds per policy, chargebacks, unverifiable purchases and low confidence wait for el dueño (draft ready + «Decidí: reembolso» alert). Only change it when el dueño asks.",
    input: z.object({ store: storeArg, on: z.boolean() }),
    handler: async ({ store, on }) => {
      const s = await getStore(store);
      const { error } = await db.from("store_ai").upsert({ store_id: s.id, autopilot: on, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return { store, autopilot: on, ai_key_configured: aiConfigured() };
    },
  });

  defineTool(server, "preview_cart_email", {
    title: "Preview the abandoned-cart email of a cart",
    kind: "read",
    external: true,
    description:
      "Renders, WITHOUT sending, the AI abandoned-cart email for one cart (checkout_id from list_abandoned_checkouts): subject, full HTML, source (ai | template fallback), the checkout URL with the signed discount (funnel settings.recovery: discountPercent, validHours) and its expiry, plus notes (why the AI copy was rejected, broken link). `locale` overrides the language for the preview only. The discount link in the preview is real (signed for that cart). To send it, use send_recovery (respects all exclusions: bought, unsubscribed, bounced, test address, DE/AT consent, funnel switch off).",
    input: z.object({ checkout_id: z.string().uuid(), locale: z.enum(LOCALES as unknown as [Locale, ...Locale[]]).optional() }),
    handler: async ({ checkout_id, locale }) => {
      const r = await recoverCart(checkout_id, { preview: true, locale });
      if ("skipped" in r) throw new UserError(`No se puede armar: ${r.skipped}`);
      return "preview" in r ? r.preview : r;
    },
  });

  defineTool(server, "sync_inbox", {
    title: "Sync store mailbox now",
    kind: "write",
    idempotent: true,
    external: true,
    description:
      "Fetch new messages from the store mailbox(es) now via IMAP (read-only on the server: nothing is marked read there), detect bounces (marks the bounced email + alert), link senders to their orders, and re-run the alert scan. Without store: every store with a mailbox. INBOX runs automatically every 5 minutes; `mailbox` syncs another folder on demand (e.g. \"INBOX.Junk\", needs store).",
    input: z.object({ store: storeArg.optional(), mailbox: z.string().min(1).max(100).optional() }),
    handler: async ({ store, mailbox }) => {
      if (mailbox && !store) throw new UserError("Pass store together with mailbox.");
      const inbox = store ? [await syncInbox((await getStore(store)).id, mailbox)] : await syncAllInboxes();
      const alerts = await scanAlerts().catch((e) => ({ error: (e as Error).message }));
      return { inbox, alerts };
    },
  });
}
