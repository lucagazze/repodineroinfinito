import { z } from "zod";
import { db, getProductById, type Product } from "./db";
import { downloadHref } from "./downloads";
import { legalSections, isCatalogLang, type CatalogLang } from "./catalog-texts";
import { refundableOf, type RefundOutcome } from "./refund";
import { replyToMessage } from "./inbox";
import { resendDeliveryFor } from "./resend-delivery";
import { raiseAlert } from "./alerts";
import { sendPush, PUSH_BODY_MAX } from "./push";
import { brandFor } from "./brand";
import { orderNo, shortId } from "./order-ref";
import { shopifyLookupStores, shopifyOrders } from "./shopify-lookup";
import { legacyOrders, type ExtOrder } from "./legacy-lookup";

/**
 * La IA del buzón: lee un mail de un comprador con todo su contexto (pedidos
 * de esa tienda, qué pasó con los mails de entrega, links, política de
 * reembolso en el idioma de la oferta, el hilo) y devuelve una clasificación
 * validada + un borrador en el idioma del comprador, firmado por la tienda.
 *
 * Nunca inventa: los links que puede pegar son solo los de un pedido del
 * comprador, y si escribe algo que no está en el contexto se marca para que
 * el dueño lo revise. La plata (reembolsos, disputas) siempre la decide el dueño.
 */

export const AI_MISSING = "Falta la clave de la IA (GEMINI_API_KEY o ANTHROPIC_API_KEY en Vercel). El buzón funciona igual, sin borradores.";
/** Gemini (lo que ya paga el dueño) si está su clave; si no, Anthropic. */
const gemini = () => !!process.env.GEMINI_API_KEY?.trim();
export const aiConfigured = () => gemini() || !!process.env.ANTHROPIC_API_KEY?.trim();
const MODEL = () => process.env.AI_MODEL?.trim() || (gemini() ? "gemini-3.5-flash" : "claude-sonnet-5-5");
const API = () => `${(process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;

export const INTENTS = ["delivery_problem", "access_issue", "refund_request", "product_question", "chargeback_threat", "other"] as const;
export const ACTIONS = ["resend_delivery", "refund_full", "refund_partial", "none"] as const;
export type Intent = (typeof INTENTS)[number];
/** auto = lo que recomienda la IA · refund / no_refund = lo que decidió el dueño. */
export type Decision = "auto" | "refund" | "no_refund";
export const MONEY_INTENTS: Intent[] = ["refund_request", "chargeback_threat"];
/**
 * Etapa de un pedido de reembolso (reglas del dueño):
 * ask_reason = todavía no dio un motivo concreto: se le pregunta y se ayuda ·
 * excuse_declined = excusa (no sabía que era PDF, lo compró un familiar, cambió de idea…): no firme y amable ·
 * legit_escalate = motivo lógico y real: decide el dueño · insists_escalate = insiste o amenaza: decide el dueño.
 */
export const REFUND_STAGES = ["none", "ask_reason", "excuse_declined", "legit_escalate", "insists_escalate"] as const;
/** Qué más hace una opción al mandarla: reenviar la entrega, o nada (owner_review = la respuesta de espera: decide el dueño). */
export const OPTION_ACTIONS = ["resend_delivery", "owner_review", "none"] as const;

/** Una de las 2-3 respuestas que el dueño elige (desde el panel o la pantalla rápida del push). */
const Option = z.object({
  label_es: z.string().min(2).transform((t) => t.trim().slice(0, 60)),
  gloss_es: z.string().transform((t) => t.slice(0, 400)),
  reply: z.string().min(10).max(4000),
  action: z.enum(OPTION_ACTIONS),
  recommended: z.boolean(),
});
export type AiOption = z.infer<typeof Option>;

const Out = z.object({
  intent: z.enum(INTENTS),
  language: z.string().min(2).max(10),
  summary_es: z.string().max(600),
  order_ref: z.string().max(20),
  refund_eligible: z.enum(["yes", "no", "unknown"]),
  refund_reason_es: z.string().max(600),
  recommended_decision: z.enum(["refund", "no_refund", "none"]),
  actions: z.array(z.enum(ACTIONS)).max(3),
  refund_amount: z.number().min(0),
  needs_human: z.boolean(),
  /** Le toca decidir al dueño (plata, insistencia, contracargo, compra sin verificar, enojo, duda). */
  escalate: z.boolean(),
  escalate_reason_es: z.string().max(600),
  /** Veces que pidió la plata en el hilo, contando este mail. */
  refund_ask_count: z.number().int().min(0).max(50),
  refund_stage: z.enum(REFUND_STAGES),
  /** Pregunta de producto: todo lo que dice la respuesta sale del contexto. */
  answerable_from_context: z.boolean(),
  notes_es: z.string().max(800),
  confidence: z.number().min(0).max(1),
  /** La recomendada (la opción con recommended=true; se completa por código). */
  reply: z.string().min(10).max(4000),
  /** Una línea: qué quiere la persona (para el push). */
  want_es: z.string().default("").transform((t) => t.slice(0, 140)),
  /** Lo que escribió (sin lo citado), en castellano. */
  message_es: z.string().default("").transform((t) => t.slice(0, 6000)),
  options: z.array(Option).default([]).transform((o) => o.slice(0, 3)),
});

export type AiDraft = z.infer<typeof Out> & {
  decision: Decision; model: string; at: string;
  /** Pedido al que se refiere (validado contra los del comprador). */
  order_id: string | null; order_status: string | null; order_refunded: number;
  refundable: { currency: string; total: number; label: string } | null;
  customer_email: string | null;
  /** Lo que el control posterior encontró raro (links ajenos, pedido inexistente). */
  warnings: string[];
  /** Pedidos de plata del cliente contados en el hilo por código (no solo lo que dice la IA). */
  refund_asks_seen: number;
  /** El borrador habla de reembolso (en una primera respuesta de retención no debería). */
  mentions_refund: boolean;
  /** Compra del checkout anterior (referencia) a la que se refiere: pagada y con link para cada libro. */
  ext_order_ref?: string | null; ext_order_ok?: boolean;
};

const TOOL = {
  name: "triage",
  description: "Classification of the customer email and the reply draft.",
  input_schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: INTENTS, description: "delivery_problem: did not receive / can't find the delivery email or links. access_issue: has the links but can't open/download (permissions, file, device). refund_request: asks for money back. product_question: question about content/format/use. chargeback_threat: mentions bank dispute, chargeback, PayPal claim or fraud report. other: anything else." },
      language: { type: "string", description: "ISO 639-1 code of the language of your reply (the customer's language)." },
      summary_es: { type: "string", description: "One or two short sentences in Spanish for the owner: what the customer wants and what happened." },
      order_ref: { type: "string", description: "The `ref` (order number, e.g. 1001) of the order this is about, ONLY if it is in CONTEXT.orders (buyers may quote it as #1001, or the older 8-character `old_ref`); otherwise empty string." },
      refund_eligible: { type: "string", enum: ["yes", "no", "unknown"], description: "Per CONTEXT.policy, for refund_request/chargeback_threat. unknown when the order can't be verified." },
      refund_reason_es: { type: "string", description: "Why (in Spanish, one sentence), citing the policy rule and the facts (days since purchase, delivery opened/downloaded, reason given)." },
      recommended_decision: { type: "string", enum: ["refund", "no_refund", "none"], description: "none when money is not involved." },
      actions: { type: "array", items: { type: "string", enum: ACTIONS }, description: "Suggested actions for the owner." },
      refund_amount: { type: "number", description: "For refund_full/refund_partial: amount in the order currency, never more than CONTEXT.orders[].refundable. 0 otherwise." },
      needs_human: { type: "boolean", description: "true when the owner must check something before sending (unverified purchase, unclear request, angry customer, anything you are not sure about)." },
      escalate: { type: "boolean", description: "true when the owner must decide: rules 3, 6 and 7 (also a very angry customer, or you are unsure)." },
      escalate_reason_es: { type: "string", description: "If escalate: why, in Spanish, one sentence. Empty otherwise." },
      refund_ask_count: { type: "integer", description: "How many times the customer has asked for money back in CONTEXT.thread plus this message (0 if never)." },
      refund_stage: { type: "string", enum: REFUND_STAGES, description: "For refund_request / chargeback_threat, which of rules 4-7 applies; none otherwise." },
      answerable_from_context: { type: "boolean", description: "For product_question: true only if every statement of your reply is supported by CONTEXT." },
      notes_es: { type: "string", description: "In Spanish: what the owner must verify or decide before sending. Empty if nothing." },
      confidence: { type: "number", description: "0 to 1: how sure you are about intent and draft." },
      want_es: { type: "string", description: "ONE short line in Spanish (max 60 characters) of what the person wants, e.g. «No le llegó el link de descarga», «Pide reembolso: dice que no le sirve»." },
      message_es: { type: "string", description: "The customer's own message (without quoted earlier emails) translated into Spanish (rioplatense). If it is already Spanish, copy it." },
      options: {
        type: "array", minItems: 2, maxItems: 3,
        description: "2 or 3 genuinely different replies the owner can choose from (rule 14). Exactly one has recommended=true.",
        items: {
          type: "object",
          properties: {
            label_es: { type: "string", description: "2-5 words in Spanish, imperative, what this reply does: «Reenviar el link», «Pedir el email de compra», «Pedir el motivo y ayudar», «No, con amabilidad + ayuda», «Ofrecer cambio por otro libro», «Pasar al dueño: reembolso»." },
            gloss_es: { type: "string", description: "One sentence in Spanish: what the reply says to the customer." },
            reply: { type: "string", description: "The complete reply email body: plain text, customer's language, short, warm, signed as the store (rule 12)." },
            action: { type: "string", enum: OPTION_ACTIONS, description: "resend_delivery: sending it also resends the delivery email (only with a verified paid order). owner_review: a holding reply while the owner decides money (refund, chargeback, unverified purchase). none: just the reply." },
            recommended: { type: "boolean", description: "true for the one reply you would send (exactly one)." },
          },
          required: ["label_es", "gloss_es", "reply", "action", "recommended"],
        },
      },
    },
    required: ["intent", "language", "summary_es", "order_ref", "refund_eligible", "refund_reason_es", "recommended_decision", "actions", "refund_amount", "needs_human", "escalate", "escalate_reason_es", "refund_ask_count", "refund_stage", "answerable_from_context", "notes_es", "confidence", "want_es", "message_es", "options"],
  },
};

function system(brand: string) {
  return `You are the customer-support assistant of the online store "${brand}". It sells digital products (PDF and similar), delivered by email right after payment (download links). Nothing is shipped physically. You draft the reply to a customer email; the owner reviews it, and simple cases are sent automatically. Answer ONLY by calling the tool "triage".

Your first goal: a customer who bought must ALWAYS end up with their material. Look through everything in CONTEXT (orders, previous_checkout_orders, stripe_payments, thread) to find what they bought, and when they ask for their content, cannot find it, did not receive it or cannot open it, give them ALL of it at once: every item and every pack content with its own link, one line per book ("Book name: link"), then — if CONTEXT.library exists — one line saying they also have everything in their online library at CONTEXT.library.url (they enter with the email they bought with, no password), then one short line on how to download (spam/promotions folder, Drive's download button, any PDF reader). Never make them ask twice.

Facts and links
1. Use ONLY facts present in CONTEXT (orders, items, links, emails sent, policy, thread, products). Never invent order numbers, dates, amounts, product names, page numbers, contents, links or promises, and never say we did something that is not in CONTEXT (e.g. "we corrected your email", "we updated your account").
2. CONTEXT.orders[].items[] is everything the customer is entitled to: main product, order bumps, bonuses, upsells, and what each pack includes (items[].includes). Copy their links exactly; always include the relevant links when the customer did not receive, cannot find or cannot open something. An entry with status "not_available_yet" has no link yet: say it is not available yet and that we will write as soon as it is, and set needs_human=true. Never write any other URL than the links in CONTEXT.orders, CONTEXT.previous_checkout_orders and CONTEXT.library.url.
1b. An order (in CONTEXT.orders or CONTEXT.previous_checkout_orders) whose found_by is "order_number" or "name" was matched by the order number the customer wrote or by their full name, not by their email: if it clearly fits what they say, use it (give the links), but set needs_human=true so the owner checks it. Never mention how it was found.
2b. CONTEXT.previous_checkout_orders are purchases of this same store made through its previous checkout or its online shop (same store for the customer: never mention another platform). An item with status "check_link" was recognised by a similar name: include its links, but set needs_human=true. status "paid" is a verified purchase: confirm it and copy its items[].links exactly, as in rule 2 (always all the links of what they bought when they did not receive, cannot find or cannot open something). The delivery email of these orders cannot be resent from here: actions=["none"], order_ref = its ref, and write that here are their links. An item with status "no_link": say we are sending it shortly and set needs_human=true. status "not_paid": that payment did not go through (no links); needs_human=true.
2c. CONTEXT.stripe_payments are the card payments of the customer's email in this store (source says which order each one belongs to). Use them only to confirm that a payment exists, its date and amount. A payment with source "not_linked" (paid, but no order found): do not send links; say we are checking it right away; needs_human=true.
3. If the purchase is in neither CONTEXT.orders nor CONTEXT.previous_checkout_orders (a receipt from another platform, another email): do not confirm it and do not send links; kindly ask for the email used at checkout and the receipt so we can sort it out right away. needs_human=true and escalate=true.

Refund requests: the owner's rules, applied in this order (refund_stage says which one)
4. ask_reason: the customer has not given a concrete reason yet, or it is vague ("it doesn't meet my needs", "not useful", "not what I wanted", "I want my money back"). FIRST ask warmly for the concrete reason and details: what exactly did not work for them, which pages or topics, what they expected, what they tried. In the same message offer real help: their links, how to open or print the PDF, and the products/bonuses of their order whose CONTEXT description covers their need. Do NOT mention refunds as an option and never promise one (do not use the word "refund" or its translation). refund_eligible="unknown", recommended_decision="none", escalate=false.
   A file that does not open / cannot be downloaded, reported for the first time: this rule too, with exact instructions (open the link, Drive's download button, any PDF reader app) and the links again; actions=["resend_delivery"] if they have a verified paid order.
5. excuse_declined: the reason is one of these EXCUSES, which are not valid: did not know it was a PDF / thought it was a printed book (the sales page says PDF); a relative, partner, niece, child or someone else made the purchase (ONLY when the cardholder allowed it or does not dispute it: see rule 6b); changed their mind; found it elsewhere; does not need it anymore; too expensive. Reply with a polite, firm no that keeps the customer happy: briefly and kindly why (a digital product delivered instantly, described as a PDF on the sales page), then concrete help to enjoy it (their links, read it on any device, print it at home or at a copy shop, which products/bonuses to start with). Never leave the door open to money. refund_eligible="no", recommended_decision="no_refund", escalate=false.
6. legit_escalate: the reason is LOGICAL and a real problem: the file is corrupt or does not open even AFTER our help in CONTEXT.thread; content materially different from what the sales page / product description promised (specific and checkable against CONTEXT.products, not a matter of taste); a duplicate charge (two paid orders for the same product in CONTEXT.orders, or the customer states it clearly); never received even after we resent it. refund_eligible="yes" if within CONTEXT.store.guarantee_days of the purchase (else "no"), recommended_decision accordingly, escalate=true: the owner decides. Still write a kind holding reply that acknowledges the problem and says we are checking it right now, without promising anything.
6b. Card used WITHOUT the cardholder's permission (unauthorized, "I didn't make this purchase", stolen or lost card, fraud), even if they say a relative or child did it without asking: this is a chargeback risk, never an excuse. intent="chargeback_threat", refund_stage="legit_escalate", escalate=true, recommended_decision as you judge. Reply calmly: thank them for telling us, say we are reviewing it right away and will get back to them shortly; no accusations, no questions about who did it, no promises, no links.
7. insists_escalate: the customer asks for money again after we already declined or explained (no new real problem), or threatens a chargeback, bank dispute, PayPal claim or legal action (then intent=chargeback_threat). escalate=true. Write a calm, kind reply that restates what they have and invites them to reply so we solve it directly; never threaten, never promise.
8. In every case: you never offer or promise a refund yourself, and there are no "no questions asked" refunds. A purchase that is not in CONTEXT.orders goes by rule 3 (escalate=true); a money request about a CONTEXT.previous_checkout_orders purchase follows rules 4-7 but always escalate=true (the owner handles it).
9. CONTEXT.decision (only after the owner decided):
   - "refund": the owner accepted the refund (CONTEXT.refund_done). Confirm it kindly and clearly: we are refunding the full amount to the original payment method and the money will be back in about 5 business days (depending on their bank). No conditions, no questions, no links to sell anything.
   - "no_refund": the owner decided not to refund: rule 5's polite firm no adapted to their reason, plus concrete help. For chargeback threats invite them to reply so we solve it directly; never threaten.
   - "auto": rules 4-8.

Other cases
10. delivery_problem / access_issue with a verified paid order: actions=["resend_delivery"]; write as if the delivery email has just been resent to the order email; include the order's links; suggest checking spam/promotions; mention it if CONTEXT shows the delivery email bounced.
11. product_question: answer only with what CONTEXT says (product names and descriptions, policy, delivery). answerable_from_context=true only if every statement of the reply is supported by CONTEXT; otherwise answer what you can, say we will check the rest, needs_human=true.

Style
12. The reply: ALWAYS in the customer's language, detected from their message (if it is unclear, CONTEXT.offer_language). 50-170 words, warm and human, plain text with line breaks, no markdown, no subject line. Greet by first name if known. Sign off with the store name, e.g. "Best regards,\n${brand} Team" translated. Never mention AI, internal tools, other platforms or systems, or policy section numbers.
13. summary_es, refund_reason_es, escalate_reason_es, notes_es, want_es, message_es, label_es and gloss_es are for the owner: Spanish (rioplatense), short.

Options (the owner picks one from his phone)
14. options: 2 or 3 complete replies that take genuinely different approaches, ALL allowed by rules 1-12 (same facts, same links rules, same language). Exactly one recommended=true: the reply that applies the rules above (rules 4-11 decide which one). Typical sets:
   - delivery_problem / access_issue: «Reenviar el link» (action resend_delivery, with the links) · «Pedir el email de compra» (when the order can't be verified) · «Explicar cómo descargar».
   - refund_request: the rule that applies (pedir el motivo y ayudar / no, con amabilidad + ayuda) · «Ofrecer cambio por otro libro» (only as a non-recommended alternative, naming only products from CONTEXT.products; never money) · «Pasar al dueño: reembolso» (action owner_review: the kind holding reply of rule 6, no promises).
   - chargeback_threat / unauthorized card: «Pasar al dueño» (owner_review, the calm reply of rules 6b/7) recommended, plus a variant.
   - refund_request and chargeback_threat ALWAYS include one owner_review option labelled «Pasar al dueño: reembolso» (or «Pasar al dueño: contracargo»), so the owner can take it from his phone.
   - product_question: the answer from CONTEXT · «Pedir más detalles».
   No option ever offers, promises or confirms a refund unless CONTEXT.decision is "refund"; with CONTEXT.decision "refund" or "no_refund" all options follow that decision.`;
}

/** Pedido de plata en cualquiera de los idiomas de las tiendas. */
const REFUND_RE = /\b(refund\w*|money back|my money|reimburs\w*|rimbors\w*|soldi indietro|i miei soldi|rivoglio .{0,12}soldi|rembours\w*|mon argent|r[üu]ckerstatt\w*|erstatt\w*|geld zur[üu]ck|mein geld|reembols\w*|devoluci[oó]n|mi dinero|devolver (el|mi) dinero|chargeback|storno|cancel\w* (my |the |this )?(order|purchase)|annull\w* (il |l'|mio |questo )?(ordine|acquisto)|cancelar (mi |el |la )?(pedido|compra)|annuler (ma |la )?commande|bestellung stornieren|r[üu]cktritt|widerruf\w*)\b/i;
/** Saca lo citado de un mail respondido (lo que viene después de «On … wrote:», «>», «From:»…). */
const QUOTE_RE = /^(>|On .{0,200}wrote:|El .{0,200}escribi[oó]:|Il giorno .{0,200}scritto:|Le .{0,200}a [ée]crit ?:|Am .{0,200}schrieb|From: |De: |Da: |Von: |-{3,} ?(Original|Messaggio|Message)|_{10,})/m;
const own = (text: string) => { const i = text.search(QUOTE_RE); return i >= 0 ? text.slice(0, i) : text; };
export const asksRefund = (text: string | null | undefined) => REFUND_RE.test(own(text ?? ""));

// ------------------------------------------------------------------ contexto

const fmtMoney = (n: number, cur: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(n);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const URL_RE = /https?:\/\/[^\s<>()"'\]]+/g;
const safeEmail = (e: string | null | undefined) => (e && /^[^\s",()]+@[^\s",()]+$/.test(e) ? e.toLowerCase() : null);

type Msg = {
  id: string; store_id: string; direction: string; message_id: string; from_email: string | null; from_name: string | null;
  reply_to: string | null; subject: string | null; date: string | null; text: string | null; is_bounce: boolean; automated: boolean;
  order_id: string | null; ai_draft: Record<string, AiDraft> | null; replied_at: string | null;
};

export async function buildContext(messageId: string, decision: Decision = "auto", refundDone?: RefundOutcome | null) {
  const { data: m } = await db.from("inbox_messages")
    .select("id,store_id,direction,message_id,from_email,from_name,reply_to,subject,date,text,is_bounce,automated,order_id,ai_draft,replied_at")
    .eq("id", messageId).maybeSingle();
  const msg = m as Msg | null;
  if (!msg) throw new Error("No existe ese mensaje.");
  if (msg.direction !== "in") throw new Error("Solo se responde un mail recibido.");
  if (msg.is_bounce) throw new Error("Es un rebote del servidor de correo: no se responde.");

  const { data: store } = await db.from("stores").select("id,slug,name,display_name,brand,support_email,guarantee_days,default_locale").eq("id", msg.store_id).single();
  if (!store) throw new Error("No existe la tienda.");
  // La marca de base; en un idioma con nombre propio (p. ej. otra marca en francés) la IA firma con ese.
  const brand = brandFor(store);
  const namesByLang = ((store.brand as { names?: Record<string, unknown> } | null)?.names ?? {}) as Record<string, unknown>;
  const brandNames = Object.fromEntries(Object.entries(namesByLang).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()]));
  const customer = [safeEmail(msg.reply_to), safeEmail(msg.from_email)].find(Boolean) ?? null;
  // Para encontrar la compra también sirven los mails que escribe en el texto («compré con otro mail: …»),
  // menos los de la tienda.
  const own = new Set([store.support_email, ...(process.env.OWN_EMAILS ?? "").split(",")].filter(Boolean).map((e) => String(e).toLowerCase()));
  const inText = [...(msg.text ?? "").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((x) => safeEmail(x[0]));
  const emails = [...new Set([safeEmail(msg.reply_to), safeEmail(msg.from_email), ...inText].filter((e): e is string => !!e && !own.has(e.toLowerCase())))].slice(0, 6);

  // Pedidos de esa persona en esta tienda (por email) + el que el sistema ya vinculó.
  const { data: byMail } = emails.length
    ? await db.from("orders").select("id").eq("store_id", store.id).or(emails.map((e) => `email.ilike."${e}"`).join(",")).order("created_at", { ascending: false }).limit(10)
    : { data: [] as { id: string }[] };
  // También por el número de pedido que escribe («ordine 1357», «#1357») si el nombre del pedido es el suyo, y por su
  // nombre completo cuando escribe desde otro mail.
  // Esos dos se marcan (found_by): la IA arma la respuesta con los links, pero no sale sola: la revisa el dueño.
  const nameTokens = (x: string | null | undefined) => (x ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter((w) => w.length >= 3);
  const sender = new Set(nameTokens(msg.from_name));
  const sameName = (n: string | null | undefined) => { const t = nameTokens(n); return t.length >= 2 && sender.size >= 2 && t.filter((w) => sender.has(w)).length >= 2; };
  const quoted = [...new Set([...(msg.text ?? "").matchAll(/(?:#|\b(?:ordine|ordinazione|order|pedido|commande|bestellung|n[.°º]|nr\.?)\s*#?\s*)(\d{3,6})\b/gi)].map((x) => Number(x[1])))].slice(0, 5);
  const { data: byNumber } = quoted.length
    ? await db.from("orders").select("id,name,email").eq("store_id", store.id).in("number", quoted).limit(10)
    : { data: [] as { id: string; name: string | null; email: string | null }[] };
  const foundBy = new Map<string, "email" | "order_number" | "name">();
  for (const o of byMail ?? []) foundBy.set(o.id, "email");
  if (msg.order_id) foundBy.set(msg.order_id, "email");
  for (const o of byNumber ?? []) if (!foundBy.has(o.id) && (emails.includes(String(o.email ?? "").toLowerCase()) || sameName(o.name))) foundBy.set(o.id, emails.includes(String(o.email ?? "").toLowerCase()) ? "email" : "order_number");
  if (!foundBy.size && sender.size >= 2) {
    const { data: byName } = await db.from("orders").select("id,name").eq("store_id", store.id).eq("status", "paid")
      .ilike("name", `%${[...sender][0]}%`).gte("created_at", new Date(Date.now() - 180 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(20);
    const same = (byName ?? []).filter((o) => sameName(o.name as string | null));
    if (same.length && same.length <= 3) for (const o of same) foundBy.set(o.id as string, "name");
  }
  const ids = [...foundBy.keys()];
  const { data: orderRows } = ids.length
    ? await db.from("orders").select("id,number,email,created_at,status,currency,amount_total,amount_refunded,locale,delivered_at,delivery_error,funnel_id,stripe_payment_intent,funnels(slug,market_label)").in("id", ids).order("created_at", { ascending: false })
    : { data: [] as never[] };
  const [{ data: items }, { data: logs }, { data: dls }] = ids.length
    ? await Promise.all([
        db.from("order_items").select("order_id,kind,amount,currency,product_id,refunded_amount,stripe_payment_intent").in("order_id", ids).order("created_at"),
        db.from("email_log").select("order_id,kind,status,created_at,tracked,opened_at,open_count,clicked_at,downloaded_at,bounced_at,bounce_reason,error,ai").in("order_id", ids).order("created_at"),
        db.from("downloads").select("order_id,at").in("order_id", ids),
      ])
    : [{ data: [] as never[] }, { data: [] as never[] }, { data: [] as never[] }];
  const pids = [...new Set((items ?? []).map((i) => i.product_id).filter(Boolean) as string[])];
  const products = new Map((await Promise.all(pids.map((p) => getProductById(p)))).filter((p): p is Product => !!p).map((p) => [p.id, p]));
  // Lo que traen los packs y la base de las variantes de precio: también es suyo.
  type Row = { id: string; name: string; active: boolean | null; delivery_url: string | null; delivery_links: { url: string }[] | null; variant_of: string | null };
  const extraIds = [...new Set([...products.values()].flatMap((p) => [...(p.includes ?? []), ...(p.variant_of ? [p.variant_of] : [])]))].filter((id) => !products.has(id));
  const { data: extraRows } = extraIds.length
    ? await db.from("products").select("id,name,active,delivery_url,delivery_links,variant_of").in("id", extraIds)
    : { data: [] as Row[] };
  const extra = new Map(((extraRows ?? []) as Row[]).map((r) => [r.id, r]));
  const http = (u: string | null | undefined): u is string => !!u && /^https?:\/\//.test(u);
  const rowLinks = (r: { delivery_url: string | null; delivery_links?: { url: string }[] | null } | undefined) => (r ? [r.delivery_url, ...(r.delivery_links ?? []).map((l) => l.url)].filter(http) : []);
  const baseLinks = (variantOf: string | null | undefined) => (variantOf ? rowLinks(products.get(variantOf) ?? extra.get(variantOf)) : []);

  const now = Date.now();
  const orders = await Promise.all((orderRows ?? []).map(async (o) => {
    const cur = (o.currency ?? "USD").toUpperCase();
    const left = await refundableOf(o.id);
    const daysSince = Math.floor((now - +new Date(o.created_at)) / 864e5);
    const its = (items ?? []).filter((i) => i.order_id === o.id);
    return {
      // El número que ve el comprador (#1001); old_ref: la referencia de los mails de antes.
      ref: orderNo(o),
      // Cómo se encontró: por su mail (verificado) o por número de pedido / nombre (probable: revisa el dueño).
      found_by: foundBy.get(o.id) ?? "email",
      old_ref: shortId(o.id),
      id: o.id,
      email: o.email,
      purchased_on: day(o.created_at),
      days_since_purchase: daysSince,
      within_guarantee: daysSince <= (store.guarantee_days ?? 30),
      status: o.status,
      currency: cur,
      total_paid: Number(o.amount_total ?? 0) + its.filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.amount ?? 0), 0),
      refunded: Number(o.amount_refunded ?? 0) + its.reduce((a, i) => a + Number(i.refunded_amount ?? 0), 0),
      refundable: left?.total ?? 0,
      language: o.locale,
      checkout: (o.funnels as unknown as { slug: string; market_label: string | null } | null)?.market_label || (o.funnels as unknown as { slug: string } | null)?.slug || null,
      delivery_email_sent_at: o.delivered_at,
      delivery_error: o.delivery_error,
      items: its.map((i) => {
        const p = products.get(i.product_id ?? "");
        let links = p ? [downloadHref(p, o.id), ...(p.delivery_links ?? []).map((l) => l.url)].filter(http) : [];
        if (p && !links.length) links = baseLinks(p.variant_of);
        const includes = (p?.includes ?? []).filter(Boolean).map((id) => {
          const r = products.get(id) ?? extra.get(id);
          // Dentro de un pack va el link del libro (no /d/: esa ruta solo baja lo que está en el pedido).
          const l = r ? (rowLinks(r as Row).length ? rowLinks(r as Row) : baseLinks((r as Row).variant_of)) : [];
          return { product: r?.name ?? "(producto)", links: l, status: l.length ? "available" : (r as Row | undefined)?.active === false ? "not_available_yet" : "no_link" };
        });
        return {
          kind: i.kind, product: p?.name ?? "(producto borrado)", amount: Number(i.amount ?? 0), links,
          ...(!links.length ? { status: p && (p as Product & { active?: boolean }).active === false ? "not_available_yet" : "no_link" } : {}),
          ...(includes.length ? { includes } : {}),
        };
      }),
      emails_sent: (logs ?? []).filter((l) => l.order_id === o.id).map((l) => ({
        kind: l.kind, at: l.created_at, status: l.status, tracked: l.tracked,
        opened: !!l.opened_at, opens: l.open_count, clicked_download: !!l.downloaded_at || !!l.clicked_at,
        bounced: l.bounced_at ? l.bounce_reason || true : false, error: l.error,
      })),
      direct_downloads: (dls ?? []).filter((d) => d.order_id === o.id).length,
    };
  }));

  // Lo que dice Stripe de esos emails en esta tienda (los movimientos sincronizados cada 15 min) y las compras del
  // checkout anterior (referencia), con los links de cada libro cuando se pueden saber sin dudas.
  const [impul, shop, { data: txns }] = await Promise.all([
    legacyOrders(emails, store).catch((): ExtOrder[] => []),
    shopifyLookupStores().includes(store.slug) ? shopifyOrders(emails, msg.from_name).catch((): ExtOrder[] => []) : Promise.resolve([] as ExtOrder[]),
    emails.length
      ? db.from("stripe_balance_txns").select("created_at,amount,currency,payment_intent,ext_order,reporting_category,type")
        .eq("store_id", store.id).in("buyer", [...new Set(emails.flatMap((e) => [e, e.toLowerCase()]))])
        .order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const ext: ExtOrder[] = [...impul, ...shop];
  const piOrder = new Map<string, string>();
  for (const o of orderRows ?? []) if (o.stripe_payment_intent) piOrder.set(o.stripe_payment_intent, orderNo(o));
  for (const i of items ?? []) {
    const o = (orderRows ?? []).find((x) => x.id === i.order_id);
    if (o && i.stripe_payment_intent) piOrder.set(i.stripe_payment_intent, orderNo(o));
  }
  const extNo = new Map(ext.map((e) => [e.order_id, e.ref]));
  const stripePayments = (txns ?? []).map((t) => {
    const cat = String(t.reporting_category ?? t.type);
    const app = t.payment_intent ? piOrder.get(t.payment_intent) : undefined;
    return {
      date: String(t.created_at).slice(0, 16).replace("T", " "),
      kind: cat === "charge" ? "payment" : cat === "refund" ? "refund" : cat === "dispute" ? "dispute" : cat,
      amount: Math.abs(Number(t.amount ?? 0)), currency: String(t.currency ?? "").toUpperCase(),
      source: app ? `order #${app}` : t.ext_order ? (extNo.has(t.ext_order) ? `previous checkout order ${extNo.get(t.ext_order)}` : "previous checkout") : "not_linked",
    };
  }).filter((t) => ["payment", "refund", "dispute"].includes(t.kind));

  // Hilo: lo que escribió esta persona y lo que le respondimos desde el panel.
  const { data: thread } = emails.length
    ? await db.from("inbox_messages").select("id,direction,date,subject,text,ai")
      .eq("store_id", store.id).or(emails.flatMap((e) => [`from_email.eq."${e}"`, `to_email.eq."${e}"`]).join(","))
      .order("date", { ascending: false }).limit(10)
    : { data: [] as never[] };

  const text = msg.text ?? "";
  const receipts = [...new Set([...text.matchAll(/#?\b\d{4}-\d{4}\b/g)].map((x) => x[0]))];
  const offerLang = orders[0]?.language || store.default_locale || "en";
  const lang: CatalogLang = isCatalogLang(offerLang) ? offerLang : isCatalogLang(offerLang.slice(0, 2)) ? (offerLang.slice(0, 2) as CatalogLang) : "en";
  const policy = legalSections(lang, "refund", {
    brand, legalName: null, address: null, email: store.support_email, phone: null, replyHours: null, replyText: null,
    days: store.guarantee_days ?? 30, statement: null, currency: orders[0]?.currency ?? "USD", refundUrl: "", usLaw: false,
  }).filter((s) => ["refundFull", "beforeDispute", "delivery"].includes(s.id)).map((s) => `${s.title}: ${s.paras.join(" ")}`);

  const { data: catalog } = await db.from("products").select("name,short_name,description").eq("store_id", store.id).eq("active", true).limit(60);
  const { data: libRow } = await db.from("stores").select("library_domain").eq("id", store.id).maybeSingle();
  const libraryUrl = (libRow as { library_domain?: string | null } | null)?.library_domain ? `https://${(libRow as { library_domain: string }).library_domain}` : null;

  const ctx = {
    decision,
    refund_done: decision === "refund"
      ? refundDone
        ? { amount: refundDone.refunds.reduce((a, r) => a + r.amount, 0) || refundDone.requested, currency: refundDone.currency, pending_owner_approval: refundDone.needs_approval }
        : { note: "The owner approved the refund; it is being processed now." }
      : null,
    store: {
      name: brand, support_email: store.support_email, guarantee_days: store.guarantee_days ?? 30,
      ...(Object.keys(brandNames).length ? { name_by_language: brandNames, name_note: "When your reply is in one of these languages, the store is called by that name everywhere (greeting, text and sign-off)." } : {}),
    },
    offer_language: offerLang,
    today: new Date().toISOString().slice(0, 10),
    customer: { name: msg.from_name, email: customer },
    message: { subject: msg.subject, date: msg.date, text: text.slice(0, 5000) },
    receipt_numbers_quoted: receipts.length ? { values: receipts, note: "Receipt numbers in this format cannot be verified here. Do not mention platforms or systems to the customer." } : undefined,
    orders: orders.map(({ id: _id, ...o }) => o),
    orders_note: orders.length ? undefined : ext.length ? "No order in the current checkout; see previous_checkout_orders." : "No order of this customer's email exists in this store's checkout.",
    previous_checkout_orders: ext.length ? ext.map(({ order_id: _o, ...e }) => ({ ...e, items: e.items.map(({ productId: _p, ...i }) => i) })) : undefined,
    stripe_payments: stripePayments.length ? stripePayments : undefined,
    thread: (thread ?? []).filter((t) => t.id !== msg.id).reverse().map((t) => ({
      from: t.direction === "in" ? "customer" : "store", date: t.date, subject: t.subject, text: (t.text ?? "").slice(0, 1500),
    })),
    policy,
    // La biblioteca solo tiene las compras de este checkout, y se entra con el mail de compra: solo si la compra salió por su mail.
    library: libraryUrl && orders.some((o) => o.found_by === "email") ? { url: libraryUrl, how: "The customer's online library: they open it, type the email they bought with and are in at once (no password); every book of their CONTEXT.orders purchases is there ready to download." } : undefined,
    products: (catalog ?? []).map((p) => ({ name: p.name, short: p.short_name, description: (p.description ?? "").slice(0, 160) })),
  };
  // Lo más nuevo del hilo: un borrador anterior a esto quedó viejo.
  // Y una compra posterior al borrador también lo deja viejo: se rehace con los links de lo que compró
  const newestOrder = [...(orderRows ?? []).map((o) => o.created_at as string), ...ext.map((e) => e.purchased_on), ...(txns ?? []).map((t) => String(t.created_at))]
    .reduce((a, o) => (o > a ? o : a), "");
  const latest = [(thread ?? []).reduce((a, t) => (t.date && t.date > a ? t.date : a), msg.date ?? ""), newestOrder].reduce((a, b) => (b > a ? b : a), "");
  const threadIn = (thread ?? []).filter((t) => t.id !== msg.id && t.direction === "in" && (!msg.date || !t.date || t.date <= msg.date)).map((t) => t.text ?? "");
  // Insiste: ya había pedido la plata, le respondimos, y vuelve a pedirla (regla del dueño: decide él).
  const before = (thread ?? []).filter((t) => t.id !== msg.id && t.date && (!msg.date || t.date <= msg.date));
  const firstAsk = before.filter((t) => t.direction === "in" && asksRefund(t.text)).map((t) => t.date!).sort()[0];
  const insisted = !!firstAsk && asksRefund(msg.text) && before.some((t) => t.direction === "out" && t.date! > firstAsk);
  return { msg, store, brand: brandFor(store, offerLang), baseBrand: brand, brandNames, customer, orders, ext, ctx, latest, threadIn, insisted, libraryUrl: ctx.library ? libraryUrl : null };
}

// ------------------------------------------------------------------ IA

type JsonTool = { name: string; description: string; input_schema: Record<string, unknown> };

/**
 * Llamada a la IA con salida JSON forzada a un esquema (Gemini si está su
 * clave; si no, Anthropic con una herramienta). La usan los borradores del
 * buzón y los mails de carritos abandonados.
 */
export async function aiJson(sys: string, user: string, tool: JsonTool, opts: { temperature?: number; maxTokens?: number } = {}): Promise<unknown> {
  if (!aiConfigured()) throw new Error(AI_MISSING);
  return gemini() ? callGemini(sys, user, tool, opts) : callClaude(sys, user, tool, opts);
}

async function callAi(sys: string, user: string, timeoutMs?: number): Promise<unknown> {
  // Tres respuestas completas: más lugar que una.
  return gemini() ? callGemini(sys, user, TOOL, { timeoutMs }) : callClaude(sys, user, TOOL, { maxTokens: 4000, timeoutMs });
}

/** Gemini con salida JSON forzada al mismo esquema que la herramienta "triage". */
async function callGemini(sys: string, user: string, tool: JsonTool = TOOL, opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys.replace(`Answer ONLY by calling the tool "${tool.name}".`, "Answer ONLY with the JSON object of the response schema.") }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: 8192, responseMimeType: "application/json", responseJsonSchema: tool.input_schema },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 50_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // Saldo prepago de Google AI Studio agotado: no es un error de la app.
    if (res.status === 402 || /prepayment credits are depleted/i.test(body)) {
      throw new Error("Se terminó el saldo de la IA (Gemini). Cargá saldo en aistudio.google.com → Billing y volvé a tocar «Responder con IA». Mientras tanto se puede responder a mano.");
    }
    throw new Error(`La IA respondió ${res.status}: ${body}`);
  }
  const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const c = j.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`La IA no devolvió la clasificación${c?.finishReason === "MAX_TOKENS" ? " (se cortó por largo)" : ""}.`);
  }
}

async function callClaude(sys: string, user: string, tool: JsonTool = TOOL, opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error(AI_MISSING);
  const res = await fetch(API(), {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL(), max_tokens: opts.maxTokens ?? 900, temperature: opts.temperature ?? 0.3, system: sys,
      tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 50_000),
  });
  if (!res.ok) throw new Error(`La IA respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { stop_reason?: string; content?: { type: string; input?: unknown }[] };
  const used = j.content?.find((b) => b.type === "tool_use");
  if (!used?.input) throw new Error(`La IA no devolvió la clasificación${j.stop_reason === "max_tokens" ? " (se cortó por largo)" : ""}.`);
  return used.input;
}

/** Borrador + clasificación + 2-3 opciones de respuesta de un mail. Usa el guardado salvo `force` (o si llegó algo nuevo en el hilo). */
export async function draftReply(messageId: string, opts: { decision?: Decision; force?: boolean; refundDone?: RefundOutcome | null; dry?: boolean; timeoutMs?: number } = {}): Promise<AiDraft> {
  const decision = opts.decision ?? "auto";
  const { msg, brand, baseBrand, brandNames, customer, orders, ext, ctx, latest, threadIn, insisted, libraryUrl } = await buildContext(messageId, decision, opts.refundDone);
  const cached = msg.ai_draft?.[decision];
  // Los guardados antes de las opciones se rehacen (la pantalla rápida las necesita).
  if (cached && !opts.force && !opts.dry && !opts.refundDone && cached.at >= latest && "escalate" in cached && cached.options?.length) return cached;

  const raw = (await callAi(system(brand), `CONTEXT (JSON):\n${JSON.stringify(ctx, null, 1)}`, opts.timeoutMs)) as Record<string, unknown> | null;
  // La recomendada es el borrador principal (el que usan el panel, el piloto y el MCP).
  const rawOpts = Array.isArray(raw?.options) ? (raw.options as Record<string, unknown>[]) : [];
  const rawRec = rawOpts.find((o) => o?.recommended === true) ?? rawOpts[0];
  if (raw && typeof raw === "object" && typeof raw.reply !== "string" && typeof rawRec?.reply === "string") raw.reply = rawRec.reply;
  const parsed = Out.safeParse(raw);
  if (!parsed.success) throw new Error(`La IA devolvió una clasificación inválida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const d = parsed.data;
  // Una sola recomendada (la primera marcada; si ninguna, la primera) y es la del borrador.
  const recAt = Math.max(0, d.options.findIndex((o) => o.recommended));
  d.options = d.options.map((o, i) => ({ ...o, recommended: i === recAt }));
  if (d.options.length) d.reply = d.options[recAt].reply;
  // Respaldo por código: si respondió en un idioma con nombre propio de marca, ese nombre (nunca el de base).
  const localBrand = brandNames[d.language.slice(0, 2).toLowerCase()];
  if (localBrand && localBrand !== baseBrand) {
    d.reply = d.reply.split(baseBrand).join(localBrand);
    d.options = d.options.map((o) => ({ ...o, reply: o.reply.split(baseBrand).join(localBrand) }));
  }

  // Control posterior: nada que no salga del contexto.
  const warnings: string[] = [];
  const ref = d.order_ref.replace(/^#/, "").toUpperCase();
  const order = orders.find((o) => o.ref === ref || o.old_ref === ref) ?? null;
  // Compra del checkout anterior: no se le puede reenviar la entrega desde acá (van los links en la respuesta).
  const extOrder = order ? null : ext.find((e) => e.ref === ref) ?? null;
  if (ref && !order && !extOrder) warnings.push(`La IA nombró el pedido #${ref}, que no es de este comprador.`);
  if (!order && d.actions.some((a) => a !== "none")) {
    if (orders.length && !extOrder) warnings.push("Sugiere una acción sin decir sobre qué pedido.");
    d.actions = ["none"];
  }
  if (extOrder) d.options = d.options.map((o) => (o.action === "resend_delivery" ? { ...o, action: "none" as const } : o));
  const allowed = new Set([
    ...orders.flatMap((o) => o.items.flatMap((i) => [...i.links, ...(i.includes ?? []).flatMap((x) => x.links)])),
    ...ext.flatMap((e) => e.items.flatMap((i) => i.links)),
    ...(libraryUrl ? [libraryUrl, `${libraryUrl}/`] : []),
  ]);
  if (order && order.found_by !== "email") warnings.push(`Encontré la compra #${order.ref} por ${order.found_by === "name" ? "el nombre" : "el número de pedido"}, no por su mail: revisá que sea esa persona antes de mandar.`);
  if (extOrder?.found_by === "name") warnings.push(`Encontré la compra ${extOrder.ref} por el nombre o un mail casi igual (${extOrder.email}), no por su mail: revisá que sea esa persona antes de mandar.`);
  if (extOrder && extOrder.items.some((i) => i.status === "check_link")) warnings.push(`Compra ${extOrder.ref}: hay libros reconocidos por un nombre parecido; revisá los links antes de mandar.`);
  const foreignIn = (t: string) => [...new Set((t.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")).filter((u) => !allowed.has(u)))];
  const foreign = foreignIn(d.reply);
  if (foreign.length) warnings.push(`El borrador trae links que no son de sus pedidos: ${foreign.join(" · ")}`);
  // Cada opción, con el mismo control. Reenviar la entrega solo con un pedido pagado verificado.
  const paid = !!order && order.status === "paid";
  d.options = d.options.map((o) => {
    const bad = foreignIn(o.reply);
    if (bad.length && !o.recommended) warnings.push(`«${o.label_es}» trae links que no son de sus pedidos: ${bad.join(" · ")}`);
    if (o.action === "resend_delivery" && !paid) {
      warnings.push(`«${o.label_es}» reenvía la entrega, pero no hay un pedido pagado verificado: va sin reenvío.`);
      return { ...o, action: "none" as const };
    }
    return o;
  });
  if (order && d.refund_amount > order.refundable) d.refund_amount = order.refundable;
  const left = order ? await refundableOf(order.id) : null;

  // Insistencia contada por código: los mails del cliente (sin lo citado) que piden la plata.
  const asks = [...threadIn, msg.text ?? ""].filter(asksRefund).length;
  const money = MONEY_INTENTS.includes(d.intent);
  // Respaldo por código de las reglas del dueño: motivo real, insistencia, contracargo o compra sin verificar → decide él.
  // (Un 2.º mail que trae el motivo que le pedimos no es insistir: insistir lo marca la IA o un 3.er pedido.)
  const escalate = d.escalate || d.intent === "chargeback_threat" || d.refund_eligible === "yes"
    || d.refund_stage === "legit_escalate" || d.refund_stage === "insists_escalate" || insisted
    || (money && (Math.max(asks, d.refund_ask_count) >= 3 || !order));
  const draft: AiDraft = {
    ...d,
    escalate,
    escalate_reason_es: escalate && !d.escalate_reason_es
      ? (d.intent === "chargeback_threat" ? "Amenaza con contracargo." : !order ? "No encuentro la compra para verificarla."
        : d.refund_stage === "legit_escalate" || d.refund_eligible === "yes" ? "Da un motivo real según la política." : "Insiste con la plata.")
      : d.escalate_reason_es,
    refund_asks_seen: asks,
    mentions_refund: asksRefund(d.reply),
    order_ref: order ? order.ref : "",
    needs_human: d.needs_human || warnings.length > 0,
    decision, model: MODEL(), at: new Date().toISOString(),
    order_id: order?.id ?? null, order_status: order?.status ?? null, order_refunded: order?.refunded ?? 0,
    refundable: left && left.total > 0 ? { currency: left.currency, total: left.total, label: fmtMoney(left.total, left.currency) } : null,
    customer_email: customer, warnings,
    ext_order_ref: extOrder?.ref ?? null,
    ext_order_ok: !!extOrder && extOrder.status === "paid" && extOrder.items.length > 0 && extOrder.items.every((i) => i.links.length > 0 && i.status === "available"),
  };
  if (opts.dry) return draft;
  const { data: fresh } = await db.from("inbox_messages").select("ai_draft").eq("id", messageId).single();
  await db.from("inbox_messages").update({ ai_draft: { ...((fresh?.ai_draft as Record<string, AiDraft> | null) ?? {}), [decision]: draft } }).eq("id", messageId);
  // El push (también el de reembolso o contracargo) sale uno solo por mail, con estas opciones: pushMailOnce.
  // Plata con algo para decidir: aviso al dueño (uno por mail; se cierra al responder).
  // (Si el mail ya se respondió, no hay nada que decidir: no se levanta un aviso viejo.)
  if (decision === "auto" && (money || insisted) && escalate && !msg.replied_at) {
    const { data: st } = await db.from("stores").select("slug").eq("id", msg.store_id).maybeSingle();
    await raiseAlert({
      kind: "refund_decision", severity: d.intent === "chargeback_threat" ? "error" : "warn", storeId: msg.store_id, ref: msg.id, at: msg.date ?? undefined,
      link: `/admin/mails?s=${st?.slug ?? ""}&m=${msg.id}`,
      title: `Decidí: ${msg.from_name || customer || "un comprador"} ${d.intent === "chargeback_threat" ? "amenaza con contracargo" : "pide reembolso"}${order ? ` · #${order.ref}${draft.refundable ? ` (${draft.refundable.label})` : ""}` : ""}`,
      body: [draft.escalate_reason_es, d.summary_es, d.refund_reason_es].filter(Boolean).join(" · "),
    }).catch(() => {});
  }
  return draft;
}

/**
 * ¿La puede mandar sola el piloto? Solo con todo verificado y nada que decidir:
 * - entrega / acceso de un pedido pagado y sin reembolsos (reenvía y contesta);
 * - preguntas de producto que se contestan con el contexto;
 * - pedidos de reembolso de una compra verificada: preguntar el motivo (1.er
 *   mail, sin nombrar el reembolso) o el no amable ante una excusa.
 * Lo demás (insiste, contracargo, compra sin verificar, duda) espera al dueño.
 */
export function autoSendable(d: AiDraft): { ok: boolean; why: string } {
  const no = (why: string) => ({ ok: false, why });
  if (d.intent === "chargeback_threat") return no("contracargo o compra no autorizada: decidís vos");
  if (d.decision !== "auto") return no("decisión del dueño");
  if (d.needs_human || d.warnings.length) return no("hay algo para revisar");
  if (d.escalate) return no(d.escalate_reason_es || "le toca decidir al dueño");
  if (d.actions.some((a) => a.startsWith("refund"))) return no("sugiere plata");
  const paidOrder = !!d.order_id && d.order_status === "paid" && d.order_refunded === 0;
  if (d.intent === "delivery_problem" || d.intent === "access_issue") {
    if (!paidOrder && d.ext_order_ok) return d.confidence >= 0.75 ? { ok: true, why: "entrega (checkout anterior, con los links)" } : no("poca seguridad");
    if (!paidOrder) return no("sin pedido pagado verificado");
    if (!d.actions.includes("resend_delivery")) return no("no propone reenviar la entrega");
    return d.confidence >= 0.75 ? { ok: true, why: "entrega" } : no("poca seguridad");
  }
  if (d.intent === "product_question") {
    if (!d.answerable_from_context) return no("no todo sale del contexto");
    if (d.actions.includes("resend_delivery") && !paidOrder) return no("reenvío sin pedido verificado");
    return d.confidence >= 0.8 ? { ok: true, why: "pregunta" } : no("poca seguridad");
  }
  if (d.intent === "refund_request") {
    if (!paidOrder) return no("sin pedido pagado verificado");
    if (d.refund_eligible === "yes") return no("según la política corresponde: decidís vos");
    const asks = Math.max(d.refund_asks_seen, d.refund_ask_count);
    if (d.confidence < 0.8) return no("poca seguridad");
    // 1.er pedido sin motivo: pregunta el motivo y ayuda, sin nombrar el reembolso.
    if (d.refund_stage === "ask_reason") {
      if (asks > 1) return no("ya pidió antes");
      return d.mentions_refund ? no("el borrador habla de reembolso") : { ok: true, why: "pide motivo" };
    }
    // Excusa (PDF, familiar, cambió de idea…): no firme y amable, hasta el 2.º mail (el que trae el motivo).
    if (d.refund_stage === "excuse_declined") return asks > 2 ? no("insiste") : { ok: true, why: "excusa" };
    return no("le toca decidir al dueño");
  }
  return no("tipo de mail que espera al dueño");
}

/** Manda una respuesta (de la IA o editada) y, si se pide, reenvía antes la entrega. */
export async function sendAiReply(messageId: string, text: string, opts: { resendOrderId?: string | null; locale?: string | null } = {}) {
  let resent: { sent_to: string } | null = null;
  if (opts.resendOrderId) resent = await resendDeliveryFor(opts.resendOrderId);
  // El idioma del borrador decide la marca del remitente (p. ej. otro nombre en francés).
  let locale = opts.locale ?? null;
  if (!locale) {
    const { data: m } = await db.from("inbox_messages").select("ai_draft").eq("id", messageId).maybeSingle();
    const last = Object.values((m?.ai_draft ?? {}) as Record<string, AiDraft>).sort((a, b) => b.at.localeCompare(a.at))[0];
    locale = last?.language?.slice(0, 2).toLowerCase() ?? null;
  }
  const r = await replyToMessage(messageId, text, { ai: true, locale });
  return { ...r, resent_delivery_to: resent?.sent_to ?? null };
}

// ------------------------------------------------------------------ push del mail

/** «Uñas Alemania»: categoría (u oferta) y mercado del pedido; sin pedido, la tienda. */
export async function mailWhere(storeId: string, orderId: string | null) {
  if (orderId) {
    const { data: o } = await db.from("orders").select("funnels(name,market_label,offers(name,category))").eq("id", orderId).maybeSingle();
    const f = (o?.funnels ?? null) as unknown as { name: string | null; market_label: string | null; offers: { name: string | null; category?: string | null } | null } | null;
    const what = f?.offers?.category?.trim() || f?.offers?.name?.trim() || f?.name?.trim() || "";
    const where = [what, f?.market_label?.trim() && !what.includes(f.market_label.trim()) ? f.market_label.trim() : ""].filter(Boolean).join(" ");
    if (where) return where;
  }
  const { data: st } = await db.from("stores").select("name,display_name").eq("id", storeId).maybeSingle();
  return st?.display_name || st?.name || "";
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/**
 * UN push por mail de una persona: «✉️ Mail · Uñas Alemania» · «No le llegó el
 * link de descarga» · «IA: Reenviar el link». Reembolso o contracargo: el tipo
 * «refund», mismo formato. Si el piloto ya respondió solo: «ai_reply» (en vez
 * de este, nunca los dos). Abre la pantalla rápida (/admin/mails/r/{id}); en
 * Chrome/Android trae además «Ver opciones» y «Enviar: …» (que abre la
 * pantalla con esa opción elegida esperando la confirmación: nunca manda solo).
 * Con «names»: el nombre o email de quien escribió. Sin IA: el asunto.
 */
export async function pushMailOnce(id: string, d: AiDraft | null, how: { autoSent?: string | null; force?: boolean } = {}) {
  const now = new Date().toISOString();
  let q = db.from("inbox_messages").update({ mail_pushed_at: now }).eq("id", id).is("mail_pushed_at", null);
  if (!how.force) q = q.not("mail_push_due_at", "is", null);
  const { data: won } = await q.select("id,store_id,from_name,from_email,reply_to,subject,order_id,read_at,replied_at");
  const m = won?.[0];
  if (!m) return null;
  // Ya lo leyó o lo respondió (acá o en el webmail): no hace falta avisar.
  if (!how.autoSent && (m.read_at || m.replied_at)) return null;
  const money = !!d && MONEY_INTENTS.includes(d.intent);
  if (money) await db.from("inbox_messages").update({ money_pushed_at: now }).eq("id", id).is("money_pushed_at", null);
  const where = await mailWhere(m.store_id, d?.order_id ?? m.order_id);
  const head = how.autoSent ? "🤖 La IA respondió" : d?.intent === "chargeback_threat" ? "🚨 Contracargo" : d?.intent === "refund_request" ? "⚠️ Reembolso" : "✉️ Mail";
  const title = `${head}${where ? ` · ${where}` : ""}`;
  const recAt = d?.options?.findIndex((o) => o.recommended) ?? -1;
  const rec = recAt >= 0 ? d!.options[recAt] : null;
  const want = oneLine(d?.want_es || d?.summary_es || String(m.subject || "(sin asunto)"), 90);
  const ia = how.autoSent ? `Le mandó: ${how.autoSent}` : rec ? `IA: ${rec.label_es}` : d ? "" : "La IA todavía no lo leyó";
  // Una sola línea (máximo 3 en el iPhone): lo que quiere y, si entra, la sugerencia de la IA.
  const body = ia && `${want} · ${ia}`.length <= PUSH_BODY_MAX ? `${want} · ${ia}` : want || ia;
  const who = oneLine(String(m.from_name || m.reply_to || m.from_email || ""), 40);
  const url = `/admin/mails/r/${id}`;
  return sendPush(how.autoSent ? "ai_reply" : money ? "refund" : "mail", {
    title, body,
    named: { title, body: who ? `${who} · ${body}` : body },
    url, tag: `mail:${id}`,
    actions: rec && !how.autoSent
      ? [{ action: "open", title: "Ver opciones", url }, { action: "send", title: oneLine(`Enviar: ${rec.label_es}`, 40), url: `${url}?o=${recAt}&confirm=1` }]
      : undefined,
  });
}

/** Los que la IA no alcanzó a leer (o sin IA): a los `afterMs` sale el push igual, sin resumen. */
export async function pushOverdueMails(afterMs = 9 * 60_000) {
  const { data } = await db.from("inbox_messages").select("id,ai_draft")
    .is("mail_pushed_at", null).not("mail_push_due_at", "is", null)
    .lte("mail_push_due_at", new Date(Date.now() - afterMs).toISOString()).order("mail_push_due_at").limit(10);
  let n = 0;
  for (const r of data ?? []) {
    const d = ((r.ai_draft ?? null) as Record<string, AiDraft> | null)?.auto ?? null;
    const res = await pushMailOnce(r.id, d).catch(() => null);
    if (res?.sent) n++;
  }
  return n;
}

// ------------------------------------------------------------------ piloto

/** Cuánto espera el piloto antes de responder solo. */
export const AUTO_REPLY_WAIT_MS = 15 * 60_000;

/** ¿Le mandamos algo a esa persona después de su mail? (a mano, la IA, un reenvío de la entrega, cualquier mail). */
async function wroteToSince(storeId: string, who: string, since: string) {
  const esc = who.replace(/[\\%_]/g, "\\$&");
  const [{ count: outs }, { count: logs }] = await Promise.all([
    db.from("inbox_messages").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("direction", "out").ilike("to_email", esc).gt("date", since),
    db.from("email_log").select("id", { count: "exact", head: true }).eq("store_id", storeId).ilike("to_email", esc).gt("created_at", since),
  ]);
  return (outs ?? 0) + (logs ?? 0) > 0;
}

type PilotMsg = { id: string; store_id: string; from_email: string | null; reply_to: string | null; from_name: string | null; subject: string | null; date: string | null };

/** Responde sola un mail (ya decidido que se puede) y avisa: push «la IA respondió» y el aviso del panel. */
async function autoReplyNow(c: PilotMsg, d: AiDraft, can: ReturnType<typeof autoSendable>, slug: string) {
  const to = (c.reply_to || c.from_email || "").toLowerCase();
  const resend = d.actions.includes("resend_delivery") && !!d.order_id && d.order_status === "paid";
  await sendAiReply(c.id, d.reply, { resendOrderId: resend ? d.order_id : null, locale: d.language.slice(0, 2).toLowerCase() });
  // Un solo push por mail: el de «la IA respondió» en vez del de mail nuevo.
  const rec = d.options.find((o) => o.recommended);
  const pushed = !!(await pushMailOnce(c.id, d, { autoSent: rec?.label_es || "la respuesta recomendada", force: true }))?.sent;
  await raiseAlert({
    kind: "ai_autoreply", severity: "info", storeId: c.store_id, ref: c.id, link: `/admin/mails?s=${slug}&m=${c.id}`,
    title: `La IA respondió sola a ${c.from_name || to}: ${c.subject || "(sin asunto)"}`,
    body: `${can.why === "pide motivo" ? "Pedido de reembolso: preguntó el motivo y ofreció ayuda (sin ofrecer plata). " : can.why === "excusa" ? "Pedido de reembolso con una excusa: respondió que no, con amabilidad, y lo ayudó a usarlo. " : ""}${resend ? `Reenvió la entrega del pedido #${d.order_ref}. ` : ""}${d.summary_es}`,
  });
  return pushed;
}

/**
 * Los que esperaban sus 15 minutos: si nadie le escribió en el medio (ni él de nuevo, ni nosotros: a mano, la IA o un
 * reenvío) y sigue sin responder, la IA responde sola con el borrador que ya tenía.
 */
async function runDueAutoReplies(slugOf: Map<string, string>, out: { auto_sent: number; pushed: number; errors: string[] }) {
  const { data } = await db.from("inbox_messages").select("id,store_id,from_email,reply_to,from_name,subject,date")
    .lte("ai_auto_due_at", new Date().toISOString()).is("ai_auto_done_at", null).order("ai_auto_due_at").limit(5);
  for (const c of (data ?? []) as PilotMsg[]) {
    const { data: claimed } = await db.from("inbox_messages").update({ ai_auto_done_at: new Date().toISOString() }).eq("id", c.id).is("ai_auto_done_at", null).select("replied_at");
    if (!claimed?.length || claimed[0].replied_at || !c.date) continue;
    try {
      const who = safeEmail(c.reply_to) ?? safeEmail(c.from_email);
      if (!who) continue;
      const { count: later } = await db.from("inbox_messages").select("id", { count: "exact", head: true })
        .eq("store_id", c.store_id).eq("direction", "in").gt("date", c.date).or(`from_email.eq."${who}",reply_to.eq."${who}"`);
      if (later || (await wroteToSince(c.store_id, who, c.date))) continue;
      const d = await draftReply(c.id);
      const can = autoSendable(d);
      if (!can.ok) continue;
      if (await autoReplyNow(c, d, can, slugOf.get(c.store_id) ?? "")) out.pushed++;
      out.auto_sent++;
    } catch (e) {
      out.errors.push(`${c.id.slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

/**
 * Cron del buzón (cada 5 min): la IA lee los mails nuevos de personas (últimas
 * 48 h, sin responder; hasta 3 a la vez), deja el borrador y las opciones, y
 * manda UN push por mail con lo que pide y la opción recomendada. En las
 * tiendas con piloto automático responde sola lo que autoSendable permite
 * (entrega, preguntas de producto, primer intento de retención), recién a los
 * 15 minutos del mail y solo si en el medio nadie le escribió. Nunca mueve plata.
 */
export async function runAiPilot(budgetMs = 30_000) {
  const t0 = Date.now();
  const out = { drafted: 0, auto_sent: 0, pushed: 0, errors: [] as string[] };
  if (!aiConfigured()) return { ...out, pushed: await pushOverdueMails(0), skipped: "sin clave de IA" };
  const [{ data: on }, { data: boxes }, { data: cands }, { data: slugs }] = await Promise.all([
    db.from("store_ai").select("store_id,updated_at").eq("autopilot", true),
    db.from("store_mail").select("store_id,username"),
    db.from("inbox_messages").select("id,store_id,from_email,reply_to,from_name,subject,date,ai_draft,mail_push_due_at,mail_pushed_at")
      .eq("direction", "in").eq("is_bounce", false).eq("automated", false).is("replied_at", null).is("ai_pilot_at", null)
      .gte("date", new Date(Date.now() - 48 * 3600_000).toISOString()).order("date", { ascending: true }).limit(12),
    db.from("stores").select("id,slug"),
  ]);
  const slugOf = new Map((slugs ?? []).map((s) => [s.id as string, s.slug as string]));
  await runDueAutoReplies(slugOf, out).catch((e) => out.errors.push(`a los 15 min: ${(e as Error).message.slice(0, 120)}`));
  // Desde cuándo está prendido: lo que llegó antes ya lo estaba atendiendo el dueño.
  const autoSince = new Map((on ?? []).map((r) => [r.store_id, r.updated_at as string]));
  const own = new Set((boxes ?? []).map((b) => b.username.toLowerCase()));
  // Primero los que esperan su push.
  const queue = [...(cands ?? [])].sort((a, b) => Number(!(a.mail_push_due_at && !a.mail_pushed_at)) - Number(!(b.mail_push_due_at && !b.mail_pushed_at))).slice(0, 6);

  const one = async (c: (typeof queue)[number]) => {
    // Cada lectura tarda 10-25 s: no se empieza una que no entra en el tiempo del cron.
    const left = budgetMs - (Date.now() - t0);
    if (left < 15_000) return;
    const { data: claimed } = await db.from("inbox_messages").update({ ai_pilot_at: new Date().toISOString() }).eq("id", c.id).is("ai_pilot_at", null).select("id");
    if (!claimed?.length || own.has((c.from_email ?? "").toLowerCase())) return;
    try {
      // Si esa persona escribió después (o ya le respondimos), se atiende el último mail del hilo, no este (y su push lo reemplaza).
      const who = safeEmail(c.reply_to) ?? safeEmail(c.from_email);
      if (who && c.date) {
        const { count: later } = await db.from("inbox_messages").select("id", { count: "exact", head: true })
          .eq("store_id", c.store_id).gt("date", c.date).or(`from_email.eq."${who}",to_email.eq."${who}"`);
        if (later) {
          await db.from("inbox_messages").update({ mail_pushed_at: new Date().toISOString() }).eq("id", c.id).is("mail_pushed_at", null);
          return;
        }
      }
      const d = await draftReply(c.id, { timeoutMs: Math.max(10_000, left - 3_000) });
      out.drafted++;
      // El aviso de «mail nuevo» lleva lo que entendió la IA: se decide sin abrirlo.
      await db.from("alerts").update({ body: `IA: ${d.summary_es}${d.notes_es ? ` · ${d.notes_es}` : ""}`.slice(0, 1000) })
        .eq("kind", "new_inbox_message").eq("ref_id", c.id);
      const since = autoSince.get(c.store_id);
      const can = autoSendable(d);
      // Respuesta sola: piloto prendido antes de que llegara el mail, mail de las últimas 6 h y todo verificado.
      const to = (c.reply_to || c.from_email || "").toLowerCase();
      let auto = !!since && !!c.date && c.date >= since && Date.now() - +new Date(c.date) <= 6 * 3600_000 && can.ok;
      if (auto) {
        // Freno a los ida y vuelta con contestadores: una respuesta automática por persona cada 24 h.
        const { count } = await db.from("email_log").select("id", { count: "exact", head: true })
          .eq("kind", "reply").eq("ai", true).ilike("to_email", to.replace(/[\\%_]/g, "\\$&")).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
        auto = !count;
      }
      // A los 15 minutos del mail, no antes: le da tiempo al dueño a responder él. Mientras, sale el aviso de siempre.
      const due = c.date ? +new Date(c.date) + AUTO_REPLY_WAIT_MS : 0;
      if (auto && Date.now() < due) {
        await db.from("inbox_messages").update({ ai_auto_due_at: new Date(due).toISOString() }).eq("id", c.id);
        if ((await pushMailOnce(c.id, d))?.sent) out.pushed++;
        return;
      }
      // Ya pasaron los 15 minutos: si en el medio le mandamos algo, no se le responde de nuevo.
      if (auto && who && c.date && (await wroteToSince(c.store_id, who, c.date))) auto = false;
      if (!auto) {
        if ((await pushMailOnce(c.id, d))?.sent) out.pushed++;
        return;
      }
      await db.from("inbox_messages").update({ ai_auto_done_at: new Date().toISOString() }).eq("id", c.id);
      if (await autoReplyNow(c as PilotMsg, d, can, slugOf.get(c.store_id) ?? "")) out.pushed++;
      out.auto_sent++;
    } catch (e) {
      out.errors.push(`${c.id.slice(0, 8)}: ${(e as Error).message.slice(0, 120)}`);
      // La IA no pudo: el aviso sale igual, sin resumen (lo que haya guardado de antes, si hay).
      const prev = ((c.ai_draft ?? null) as Record<string, AiDraft> | null)?.auto ?? null;
      if ((await pushMailOnce(c.id, prev).catch(() => null))?.sent) out.pushed++;
    }
  };
  // Hasta 3 a la vez.
  for (let i = 0; i < queue.length; i += 3) await Promise.all(queue.slice(i, i + 3).map(one));
  out.pushed += await pushOverdueMails();
  return out;
}
