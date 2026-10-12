import { randomUUID } from "crypto";
import type { ImapFlow, FetchMessageObject } from "imapflow";
import type { AddressObject, ParsedMail } from "mailparser";
import { db } from "./db";
import { smtpFor, type Smtp } from "./email";
import { orderLink, raiseAlert, resolveAlerts, resolveMailAlerts } from "./alerts";
import { withBrand } from "./brand";

/**
 * El buzón de cada tienda (IMAP con el mismo usuario y clave que
 * el SMTP). Se baja solo lo nuevo de INBOX, en modo lectura (EXAMINE +
 * BODY.PEEK): en el servidor no se marca nada como leído. Los rebotes
 * (mailer-daemon / DSN) marcan el mail nuestro que no llegó.
 *
 * Responder sale por el SMTP de la tienda, con In-Reply-To/References para
 * que el comprador lo vea en el mismo hilo, y se guarda en Enviados.
 */

const BOX = "INBOX";
const MAX_BYTES = 200_000;
/** Primera sincronización: los últimos 30 días, hasta 300 mails. Después, de a 100 por vuelta. */
const FIRST_DAYS = 30;
const FIRST_MAX = 300;
const RUN_MAX = 100;
const CHUNK = 25;
const H = 3600_000;

const imapHost = (smtpHost: string) => smtpHost.replace(/^smtp\./i, "imap.");

async function connect(smtp: Smtp): Promise<ImapFlow> {
  const { ImapFlow } = await import("imapflow");
  const c = new ImapFlow({
    host: imapHost(smtp.host), port: 993, secure: true,
    auth: { user: smtp.username, pass: smtp.password },
    logger: false, disableAutoIdle: true,
    connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 45_000,
  });
  // Sin un oyente, un corte de red emite 'error' y tira el proceso.
  c.on("error", (e: Error) => console.warn("[imap]", e.message));
  await c.connect();
  return c;
}

// ------------------------------------------------------------ limpieza HTML

/**
 * HTML de un mail ajeno, listo para mostrar en un iframe con sandbox (sin
 * scripts): fuera scripts, estilos, formularios, frames, on* y links
 * javascript:. El sandbox es la barrera de verdad; esto evita guardar basura.
 */
export function sanitizeHtml(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<(script|style|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math|title|xml)\b[\s\S]*?<\/\1\s*>/gi, "");
  h = h.replace(/<\/?(script|style|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math|link|meta|base|form|input|button|select|textarea|option)\b[^>]*>/gi, "");
  h = h.replace(/\s(on[a-z]+|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  h = h.replace(/\s(href|src|action|background|xlink:href|poster|lowsrc|dynsrc)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (all, _a, _v, d?: string, s?: string, u?: string) => {
      const v = (d ?? s ?? u ?? "").replace(/[\x00-\x20]+/g, "").replace(/&#x?0*(58|3a);?/gi, ":").toLowerCase();
      if (/^(javascript|vbscript|livescript):/.test(v)) return "";
      if (/^data:/.test(v) && !/^data:image\/(png|jpe?g|gif|webp);/.test(v)) return "";
      return all;
    });
  h = h.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (all) => (/expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import/i.test(all) ? "" : all));
  return h;
}

/** Texto plano de un HTML, para la vista previa y la búsqueda. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ----------------------------------------------------------------- ayudas

const firstAddr = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).find((v) => v.address) ?? null;

/** Newsletter, notificación o respuesta automática: se guarda pero no genera aviso. */
function isAutomated(p: ParsedMail, from: string) {
  const auto = String(p.headers.get("auto-submitted") ?? "").toLowerCase();
  const prec = String(p.headers.get("precedence") ?? "").toLowerCase();
  return p.headers.has("list-unsubscribe") || p.headers.has("list-id") || (!!auto && auto !== "no") || /bulk|list|junk/.test(prec)
    || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|newsletter|news|marketing|bounces?)[@+.-]/i.test(from);
}

type Bounce = { recipients: string[]; messageIds: string[]; reason: string };

/** ¿Es un rebote (DSN o mailer-daemon)? Con quién no recibió, el Message-ID original y el motivo. */
function bounceOf(p: ParsedMail, raw: string, from: string, own: string): Bounce | null {
  const ct = p.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  const report = ct?.value === "multipart/report" && /delivery-status/i.test(ct.params?.["report-type"] ?? "");
  const daemon = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(`${from} ${p.from?.text ?? ""}`);
  const subj = /undeliver|delivery status notification|delivery (has )?failed|failure notice|returned mail|could not be delivered|mail delivery failed|non recapitabil|mancata consegna|nicht zustellbar|non remis|no se pudo entregar|devuelto/i
    .test(p.subject ?? "");
  if (!report && !(daemon && (subj || /Final-Recipient|Diagnostic-Code/i.test(raw)))) return null;

  const blob = raw + "\n" + (p.attachments ?? []).map((a) => (Buffer.isBuffer(a.content) ? a.content.toString("utf8") : "")).join("\n");
  const rcpt = new Set<string>();
  const xf = p.headers.get("x-failed-recipients");
  if (typeof xf === "string") xf.split(",").forEach((x) => x.trim() && rcpt.add(x.trim().toLowerCase()));
  for (const m of blob.matchAll(/(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) rcpt.add(m[1].toLowerCase());
  if (!rcpt.size) {
    // Rebote en texto libre: cualquier dirección que no sea nuestra ni del servidor.
    for (const m of (p.text ?? "").matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
      const a = m[0].toLowerCase();
      if (a !== own && !/mailer-daemon|postmaster/.test(a)) rcpt.add(a);
    }
  }
  const ids = new Set<string>();
  for (const m of blob.matchAll(/^Message-I[dD]:\s*(<[^>\s]+>)/gim)) if (m[1] !== p.messageId) ids.add(m[1]);
  const diag = blob.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*)/i)?.[1]
    ?? blob.match(/^Status:\s*(\d\.\d+\.\d+)/im)?.[1]
    ?? (p.text ?? "").split(/\n\s*\n/).map((s) => s.trim()).find((s) => s.length > 20) ?? "";
  return { recipients: [...rcpt].slice(0, 5), messageIds: [...ids].slice(0, 5), reason: diag.replace(/\s+/g, " ").trim().slice(0, 300) };
}

/** El mail nuestro que rebotó: por Message-ID y, si no, el último que mandamos a ese destinatario. */
async function bouncedLog(storeId: string, b: Bounce, at: string) {
  if (b.messageIds.length) {
    const { data } = await db.from("email_log").select("id,order_id,to_email,kind,bounced_at").eq("store_id", storeId).in("provider_id", b.messageIds).limit(1);
    if (data?.[0]) return data[0];
  }
  const rc = b.recipients.filter((r) => /^[^\s",()]+@[^\s",()]+$/.test(r));
  if (!rc.length) return null;
  // ilike para no depender de mayúsculas; después, igualdad exacta (en ilike _ es comodín).
  const { data } = await db.from("email_log").select("id,order_id,to_email,kind,bounced_at")
    .eq("store_id", storeId).eq("status", "sent")
    .or(rc.map((r) => `to_email.ilike."${r}"`).join(","))
    .lte("created_at", at).gte("created_at", new Date(+new Date(at) - 7 * 24 * H).toISOString())
    .order("created_at", { ascending: false }).limit(10);
  return (data ?? []).find((l) => rc.includes(l.to_email.toLowerCase())) ?? null;
}

// --------------------------------------------------------------- sincronizar

export type SyncResult = {
  store: string; mailbox: string; fetched: number; inserted: number; bounces: number; alerts: number;
  flags_updated: number; last_uid: number; first_sync: boolean; skipped?: string; error?: string;
};

/** Baja lo nuevo del buzón de una tienda (INBOX; otra carpeta, p. ej. INBOX.Junk, a pedido). Lo llaman el cron (cada 5 min), el panel y el MCP. */
export async function syncInbox(storeId: string, box = BOX): Promise<SyncResult> {
  const { data: st } = await db.from("stores").select("slug").eq("id", storeId).maybeSingle();
  const slug = st?.slug ?? storeId;
  const res: SyncResult = { store: slug, mailbox: box, fetched: 0, inserted: 0, bounces: 0, alerts: 0, flags_updated: 0, last_uid: 0, first_sync: false };
  const smtp = await smtpFor(storeId);
  if (!smtp) return { ...res, skipped: "la tienda no tiene casilla conectada" };

  const { data: state } = await db.from("inbox_sync_state").select("uid_validity,last_uid").eq("store_id", storeId).eq("mailbox", box).maybeSingle();
  let client: ImapFlow | null = null;
  try {
    client = await connect(smtp);
    // readOnly = EXAMINE: el servidor no cambia ninguna marca (ni \Seen).
    const lock = await client.getMailboxLock(box, { readOnly: true });
    try {
      const mb = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
      const validity = String(mb?.uidValidity ?? "");
      let last = state && state.uid_validity === validity ? Number(state.last_uid) : 0;
      res.first_sync = last === 0;

      let uids: number[] = [];
      if (last > 0) {
        if (!mb?.uidNext || mb.uidNext > last + 1) {
          uids = ((await client.search({ uid: `${last + 1}:*` }, { uid: true })) || []).filter((u) => u > last);
        }
        uids = uids.sort((a, b) => a - b).slice(0, RUN_MAX);
      } else {
        const found = (await client.search({ since: new Date(Date.now() - FIRST_DAYS * 24 * H) }, { uid: true })) || [];
        uids = found.sort((a, b) => a - b).slice(-FIRST_MAX);
      }

      // De a 25 y con tope de 40 s: la primera vez (300 mails) puede no entrar en una sola llamada del cron;
      // lo que quedó sigue en la próxima, porque el avance se guarda después de cada tanda.
      const deadline = Date.now() + 40_000;
      const save = () => db.from("inbox_sync_state").upsert({
        store_id: storeId, mailbox: box, uid_validity: validity, last_uid: last, synced_at: new Date().toISOString(), error: null,
      });
      for (let i = 0; i < uids.length && Date.now() < deadline; i += CHUNK) {
        const part = uids.slice(i, i + CHUNK);
        const parsed: Parsed[] = [];
        // BODY.PEEK[] parcial (2 MB): los adjuntos grandes no hacen falta para leer el mail.
        for await (const msg of client.fetch(part.join(","), { uid: true, flags: true, internalDate: true, source: { maxLength: 2_000_000 } }, { uid: true })) {
          res.fetched++;
          const one = await parse(storeId, box, smtp, validity, msg).catch((e) => { console.warn("[inbox] mensaje", msg.uid, (e as Error).message); return null; });
          if (one) parsed.push(one);
        }
        await saveChunk(storeId, slug, parsed, res);
        // Un mail que no se pudo leer no frena la sincronización: se saltea.
        last = Math.max(last, ...part);
        await save();
      }
      res.last_uid = last;
      await save();

      res.flags_updated = await refreshFlags(client, storeId, box);
    } finally {
      lock.release();
    }
  } catch (e) {
    res.error = (e as Error).message.slice(0, 300);
    // Solo el error: el avance que ya se guardó por tandas no se pisa.
    await db.from("inbox_sync_state").upsert({ store_id: storeId, mailbox: box, synced_at: new Date().toISOString(), error: res.error });
  } finally {
    await client?.logout().catch(() => {});
  }
  return res;
}

export async function syncAllInboxes() {
  const { data } = await db.from("store_mail").select("store_id");
  return Promise.all((data ?? []).map((r) => syncInbox(r.store_id).catch((e) => ({ store: r.store_id, error: (e as Error).message }))));
}

type Parsed = {
  row: Record<string, unknown> & { message_id: string; date: string; text: string; order_id: string | null; email_log_id: string | null };
  bounce: Bounce | null; automated: boolean; seen: boolean; fromEmail: string | null; who: string;
};

async function parse(storeId: string, box: string, smtp: Smtp, validity: string, msg: FetchMessageObject): Promise<Parsed | null> {
  if (!msg.source) return null;
  const { simpleParser } = await import("mailparser");
  // skipImageLinks: las imágenes cid: no se pasan a data: (el HTML quedaría enorme).
  const p = await simpleParser(msg.source, { skipImageLinks: true, skipTextLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 1_500_000 });
  const own = smtp.username.toLowerCase();
  const from = firstAddr(p.from);
  const fromEmail = from?.address?.toLowerCase() ?? null;
  const to = firstAddr(p.to);
  const rt = firstAddr(p.replyTo);
  const date = (p.date && !isNaN(+p.date) ? p.date : msg.internalDate ? new Date(msg.internalDate) : new Date()).toISOString();
  const bounce = bounceOf(p, msg.source.toString("utf8"), fromEmail ?? "", own);
  const text = (p.text || (p.html ? htmlToText(p.html) : "")).slice(0, MAX_BYTES);
  const refs = Array.isArray(p.references) ? p.references.join(" ") : p.references ?? null;
  const flags = msg.flags ?? new Set<string>();
  const now = new Date().toISOString();
  return {
    row: {
      store_id: storeId, mailbox: box, uid: msg.uid, direction: "in",
      message_id: (p.messageId ?? `<imap-${validity}-${msg.uid}@${own.split("@")[1]}>`).slice(0, 500),
      in_reply_to: p.inReplyTo?.slice(0, 500) ?? null, refs: refs?.slice(0, 4000) ?? null,
      from_email: fromEmail, from_name: from?.name?.slice(0, 200) || null, to_email: to?.address?.toLowerCase() ?? null,
      reply_to: rt?.address && rt.address.toLowerCase() !== fromEmail ? rt.address.toLowerCase() : null,
      subject: p.subject?.slice(0, 500) ?? null, date, text, html: p.html ? sanitizeHtml(p.html).slice(0, MAX_BYTES) : null,
      is_bounce: !!bounce, automated: isAutomated(p, fromEmail ?? ""), email_log_id: null, order_id: null,
      // Las partes del aviso de rebote (DSN, encabezados del original) no son adjuntos.
      attachments: (p.attachments ?? []).filter((a) => (a.contentDisposition !== "inline" || !a.related) && !/^(message\/(delivery-status|rfc822)|text\/rfc822-headers)$/i.test(a.contentType))
        .slice(0, 20).map((a) => ({ name: a.filename ?? null, type: a.contentType, size: a.size })),
      read_at: flags.has("\\Seen") ? now : null, replied_at: flags.has("\\Answered") ? now : null,
    },
    bounce, automated: isAutomated(p, fromEmail ?? ""), seen: flags.has("\\Seen"),
    fromEmail: fromEmail && fromEmail !== own ? fromEmail : null,
    who: `${from?.name || fromEmail || "Sin remitente"}: ${p.subject || "(sin asunto)"}`,
  };
}

/** Último pedido de cada email, en una sola consulta (ilike y después igualdad exacta). */
async function latestOrders(storeId: string, emails: string[]) {
  const out = new Map<string, string>();
  const list = [...new Set(emails.filter((e) => /^[^\s",()]+@[^\s",()]+$/.test(e)))];
  if (!list.length) return out;
  const { data } = await db.from("orders").select("id,email").eq("store_id", storeId)
    .or(list.map((e) => `email.ilike."${e}"`).join(",")).order("created_at", { ascending: false }).limit(500);
  for (const o of data ?? []) {
    const k = (o.email ?? "").toLowerCase();
    if (list.includes(k) && !out.has(k)) out.set(k, o.id);
  }
  return out;
}

async function saveChunk(storeId: string, slug: string, parsed: Parsed[], res: SyncResult) {
  if (!parsed.length) return;
  const bounced = new Map<string, Awaited<ReturnType<typeof bouncedLog>>>();
  for (const x of parsed) if (x.bounce) bounced.set(x.row.message_id, await bouncedLog(storeId, x.bounce, x.row.date));
  const orders = await latestOrders(storeId, parsed.map((x) => (x.bounce ? x.bounce.recipients[0] : x.fromEmail) ?? ""));
  for (const x of parsed) {
    const log = bounced.get(x.row.message_id) ?? null;
    const email = x.bounce ? x.bounce.recipients[0] : x.fromEmail;
    x.row.email_log_id = log?.id ?? null;
    x.row.order_id = log?.order_id ?? (email ? orders.get(email) ?? null : null);
    // Lo que escribió una persona, reciente y sin leer en el webmail: queda esperando su push (lo manda la IA con su resumen).
    x.row.mail_push_due_at = !x.bounce && !x.seen && !x.automated && Date.now() - +new Date(x.row.date) < 48 * H ? new Date().toISOString() : null;
  }
  const { data: ins, error } = await db.from("inbox_messages")
    .upsert(parsed.map((x) => x.row), { onConflict: "store_id,message_id", ignoreDuplicates: true }).select("id,message_id");
  if (error) throw new Error(error.message);
  const newId = new Map((ins ?? []).map((r) => [r.message_id as string, r.id as string]));
  res.inserted += newId.size;

  for (const x of parsed) {
    const id = newId.get(x.row.message_id);
    if (!id) continue; // ya estaba
    const age = Date.now() - +new Date(x.row.date);
    const link = `/admin/mails?s=${slug}&m=${id}`;
    const orderId = x.row.order_id;
    if (x.bounce) {
      res.bounces++;
      const log = bounced.get(x.row.message_id) ?? null;
      if (log && !log.bounced_at) {
        await db.from("email_log").update({ bounced_at: x.row.date, bounce_reason: x.bounce.reason || null }).eq("id", log.id);
        await db.from("email_events").insert({ email_log_id: log.id, kind: "bounce", url: null, ua: x.bounce.reason.slice(0, 300) });
      }
      if (age < 7 * 24 * H) {
        const who = log?.to_email ?? x.bounce.recipients[0] ?? "un comprador";
        await raiseAlert({
          kind: "email_bounced", severity: "error", storeId, ref: log ? `log:${log.id}` : `msg:${id}`, at: x.row.date,
          link: orderId ? orderLink(orderId) : link,
          title: `Rebotó ${log?.kind === "delivery" ? "la entrega" : log?.kind === "recovery" ? "la recuperación" : "un mail"} a ${who}`,
          body: `${x.bounce.reason || "Sin motivo en el aviso del servidor."}${orderId ? " Revisá el email del pedido y reenviá la entrega." : ""}`,
        });
        res.alerts++;
      }
      continue;
    }
    // Aviso solo de lo que escribió una persona, reciente y sin leer en el webmail.
    if (!x.seen && age < 48 * H && !x.automated) {
      await raiseAlert({
        kind: "new_inbox_message", severity: orderId ? "warn" : "info", storeId, ref: id, at: x.row.date, link,
        title: x.who, body: x.row.text.replace(/\s+/g, " ").slice(0, 220),
      });
      res.alerts++;
      // El push no sale acá: lo manda el piloto de la IA (cron) con lo que pide y la opción recomendada, uno por mail (pushMailOnce).
    }
  }
}

/** Lo que se leyó o respondió en el webmail también cuenta acá (marcas \Seen / \Answered de los últimos 14 días). */
async function refreshFlags(client: ImapFlow, storeId: string, box: string) {
  const { data: rows } = await db.from("inbox_messages").select("id,uid,read_at,replied_at")
    .eq("store_id", storeId).eq("mailbox", box).eq("direction", "in").not("uid", "is", null)
    .or("read_at.is.null,replied_at.is.null").gte("date", new Date(Date.now() - 14 * 24 * H).toISOString()).limit(300);
  if (!rows?.length) return 0;
  const byUid = new Map(rows.map((r) => [Number(r.uid), r]));
  const seen: string[] = [], answered: string[] = [];
  for await (const m of client.fetch([...byUid.keys()].join(","), { uid: true, flags: true }, { uid: true })) {
    const r = byUid.get(m.uid);
    if (!r || !m.flags) continue;
    if (!r.read_at && m.flags.has("\\Seen")) seen.push(r.id);
    if (!r.replied_at && m.flags.has("\\Answered")) answered.push(r.id);
  }
  const now = new Date().toISOString();
  if (seen.length) await db.from("inbox_messages").update({ read_at: now }).in("id", seen);
  if (answered.length) await db.from("inbox_messages").update({ replied_at: now }).in("id", answered);
  await resolveAlerts("new_inbox_message", seen);
  // Respondido desde el webmail: se cierran todos sus avisos (también «Decidí: reembolso»).
  await resolveMailAlerts(answered);
  return seen.length + answered.length;
}

// ------------------------------------------------------------------ responder

const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (s: string) => escH(s).replace(/\r?\n/g, "<br>");

/**
 * Responde un mail del buzón por el SMTP de la tienda: mismo hilo (In-Reply-To
 * y References), «Re:» en el asunto, el original citado abajo. Se guarda una
 * copia en Enviados del buzón (IMAP APPEND) y la respuesta queda en el panel.
 */
export async function replyToMessage(id: string, body: string, opts: { ai?: boolean; locale?: string | null } = {}) {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("La respuesta está vacía.");
  if (text.length > 20_000) throw new Error("La respuesta es demasiado larga.");
  const { data: msg } = await db.from("inbox_messages")
    .select("id,store_id,direction,message_id,refs,from_email,from_name,reply_to,subject,date,text,order_id")
    .eq("id", id).maybeSingle();
  if (!msg) throw new Error("No existe ese mensaje.");
  if (msg.direction !== "in") throw new Error("Solo se responde un mail recibido.");
  const to = msg.reply_to || msg.from_email;
  if (!to) throw new Error("El mensaje no tiene remitente.");
  // Pruebas locales: MAIL_TEST_ONLY_TO limita las respuestas a esa casilla.
  const only = process.env.MAIL_TEST_ONLY_TO?.trim().toLowerCase();
  if (only && to.toLowerCase() !== only) throw new Error(`Modo prueba: solo se responde a ${only}.`);
  if (/mailer-daemon|postmaster|^no-?reply|^do-?not-?reply/i.test(to)) throw new Error(`${to} es una casilla automática: no recibe respuestas.`);
  const smtp = await smtpFor(msg.store_id);
  if (!smtp) throw new Error("La tienda no tiene casilla SMTP conectada.");
  const { data: store } = await db.from("stores").select("name,display_name,brand").eq("id", msg.store_id).single();
  // Remitente con la marca del idioma de la respuesta (p. ej. otro nombre en francés); sin idioma, el del pedido.
  let locale = opts.locale ?? null;
  if (!locale && msg.order_id) {
    const { data: o } = await db.from("orders").select("locale").eq("id", msg.order_id).maybeSingle();
    locale = o?.locale ?? null;
  }
  const branded = store ? withBrand(store, locale) : null;
  const name = (branded?.display_name || branded?.name || "").replace(/"/g, "");

  // El asunto del comprador con «Re:». «IA» es solo una marca del panel: nunca va al asunto que ve el comprador.
  const base = (msg.subject ?? "").replace(/^(\s*re\s*:\s*)?(?:\[ia\]|ia\s*:)\s*/i, "$1");
  const subject = /^\s*(re|r|aw|sv|vs|antw|rif)\s*:/i.test(base) ? base : `Re: ${base}`.trim();
  const refs = [...(msg.refs ?? "").split(/\s+/).filter(Boolean), msg.message_id].slice(-20).join(" ");
  const messageId = `<${randomUUID()}@${smtp.username.split("@")[1]}>`;
  const when = msg.date ? new Date(msg.date).toISOString().slice(0, 16).replace("T", " ") : "";
  const head = `${msg.from_name ? `${msg.from_name} <${msg.from_email}>` : msg.from_email} · ${when} UTC`;
  const orig = (msg.text ?? "").slice(0, 6000).trim();
  const plain = `${text}\n\n${head}:\n${orig.split("\n").map((l: string) => `> ${l}`).join("\n")}`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">${paras(text)}</div>
<br><div style="font-family:Arial,sans-serif;font-size:12px;color:#777">${escH(head)}:</div>
<blockquote style="margin:6px 0 0;padding:0 0 0 12px;border-left:3px solid #ddd;font-family:Arial,sans-serif;font-size:13px;color:#555">${paras(orig)}</blockquote>`;

  const MailComposer = (await import("nodemailer/lib/mail-composer")).default;
  const raw: Buffer = await new Promise((ok, ko) => new MailComposer({
    from: `"${name}" <${smtp.username}>`, to, subject, text: plain, html, messageId,
    inReplyTo: msg.message_id, references: refs, date: new Date(),
  }).compile().build((e, b) => (e ? ko(e) : ok(b))));

  const nodemailer = await import("nodemailer");
  const tx = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: { user: smtp.username, pass: smtp.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const logId = randomUUID();
  try {
    await tx.sendMail({ envelope: { from: smtp.username, to: [to] }, raw });
  } catch (e) {
    await db.from("email_log").insert({
      id: logId, store_id: msg.store_id, order_id: msg.order_id, kind: "reply", to_email: to, subject: subject.slice(0, 300),
      provider: "smtp", status: "failed", error: (e as Error).message.slice(0, 500), ai: !!opts.ai, body_html: html,
    });
    throw new Error(`No se pudo mandar: ${(e as Error).message}`);
  }
  await db.from("email_log").insert({
    id: logId, store_id: msg.store_id, order_id: msg.order_id, kind: "reply", to_email: to, subject: subject.slice(0, 300),
    provider: "smtp", provider_id: messageId, status: "sent", ai: !!opts.ai, body_html: html,
  });

  // Copia en Enviados: que se vea en el webmail como cualquier respuesta.
  let saved: { path: string; uid: number | null } | null = null;
  try {
    const c = await connect(smtp);
    try {
      const boxes = await c.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent")
        ?? boxes.find((b) => /^(inbox[./])?(sent|sent items|sent messages|enviados|posta inviata|inviata)$/i.test(b.path));
      if (sent) {
        const r = await c.append(sent.path, raw, ["\\Seen"]);
        if (r) saved = { path: sent.path, uid: r.uid ?? null };
      }
    } finally {
      await c.logout().catch(() => {});
    }
  } catch (e) {
    console.warn("[inbox] no se guardó en Enviados:", (e as Error).message);
  }

  const now = new Date().toISOString();
  await db.from("inbox_messages").insert({
    store_id: msg.store_id, mailbox: saved?.path ?? "Sent", uid: saved?.uid ?? null, direction: "out",
    message_id: messageId, in_reply_to: msg.message_id, refs, from_email: smtp.username.toLowerCase(), from_name: name,
    to_email: to.toLowerCase(), subject, date: now, text, html: sanitizeHtml(html), order_id: msg.order_id, read_at: now, ai: !!opts.ai,
  });
  await db.from("inbox_messages").update({ replied_at: now, read_at: now }).eq("id", msg.id);
  // Una respuesta contesta la conversación: los mails anteriores de esa persona tampoco quedan
  // pendientes ni con aviso (si escribió 3 veces y se le contesta el último, se cierran los 3).
  const who = (msg.reply_to || msg.from_email || "").toLowerCase().replace(/"/g, "");
  const { data: older } = who
    ? await db.from("inbox_messages").update({ replied_at: now }).eq("store_id", msg.store_id).eq("direction", "in")
      .is("replied_at", null).lte("date", msg.date ?? now).or(`from_email.eq."${who}",reply_to.eq."${who}"`).select("id")
    : { data: [] as { id: string }[] };
  if (older?.length) await db.from("inbox_messages").update({ read_at: now }).in("id", older.map((r) => r.id)).is("read_at", null);
  await resolveMailAlerts([msg.id, ...(older ?? []).map((r) => r.id)]);
  return { sent_to: to, subject, message_id: messageId, saved_to_sent: saved?.path ?? null, sent_uid: saved?.uid ?? null, email_log_id: logId };
}

/**
 * Un mail nuevo a alguien que no escribió.
 * Sale de la casilla de la tienda como las respuestas, con la marca del idioma elegido, queda en
 * Enviados y en «Respuestas», y se ata a su último pedido de esa tienda si tiene uno.
 */
export async function sendNewMail(storeId: string, toRaw: string, subjectRaw: string, body: string, opts: { locale?: string | null } = {}) {
  const to = toRaw.trim().toLowerCase();
  const subject = subjectRaw.replace(/\s+/g, " ").trim();
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(to)) throw new Error("El mail del destinatario no es válido.");
  if (!subject) throw new Error("Falta el asunto.");
  if (!text) throw new Error("El mensaje está vacío.");
  if (text.length > 20_000) throw new Error("El mensaje es demasiado largo.");
  const only = process.env.MAIL_TEST_ONLY_TO?.trim().toLowerCase();
  if (only && to !== only) throw new Error(`Modo prueba: solo se escribe a ${only}.`);
  const smtp = await smtpFor(storeId);
  if (!smtp) throw new Error("La tienda no tiene casilla SMTP conectada.");
  const [{ data: store }, { data: lastOrder }] = await Promise.all([
    db.from("stores").select("name,display_name,brand").eq("id", storeId).single(),
    db.from("orders").select("id,locale").eq("store_id", storeId).ilike("email", to).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const branded = store ? withBrand(store, opts.locale ?? lastOrder?.locale ?? null) : null;
  const name = (branded?.display_name || branded?.name || "").replace(/"/g, "");
  const messageId = `<${randomUUID()}@${smtp.username.split("@")[1]}>`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">${paras(text)}</div>`;

  const MailComposer = (await import("nodemailer/lib/mail-composer")).default;
  const raw: Buffer = await new Promise((ok, ko) => new MailComposer({
    from: `"${name}" <${smtp.username}>`, to, subject, text, html, messageId, date: new Date(),
  }).compile().build((e, b) => (e ? ko(e) : ok(b))));
  const nodemailer = await import("nodemailer");
  const tx = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: { user: smtp.username, pass: smtp.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const logId = randomUUID();
  const log = { id: logId, store_id: storeId, order_id: lastOrder?.id ?? null, kind: "reply", to_email: to, subject: subject.slice(0, 300), provider: "smtp", ai: false, body_html: html };
  try {
    await tx.sendMail({ envelope: { from: smtp.username, to: [to] }, raw });
  } catch (e) {
    await db.from("email_log").insert({ ...log, status: "failed", error: (e as Error).message.slice(0, 500) });
    throw new Error(`No se pudo mandar: ${(e as Error).message}`);
  }
  await db.from("email_log").insert({ ...log, provider_id: messageId, status: "sent" });

  let saved: { path: string; uid: number | null } | null = null;
  try {
    const c = await connect(smtp);
    try {
      const boxes = await c.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent")
        ?? boxes.find((b) => /^(inbox[./])?(sent|sent items|sent messages|enviados|posta inviata|inviata)$/i.test(b.path));
      if (sent) {
        const r = await c.append(sent.path, raw, ["\\Seen"]);
        if (r) saved = { path: sent.path, uid: r.uid ?? null };
      }
    } finally {
      await c.logout().catch(() => {});
    }
  } catch (e) {
    console.warn("[inbox] no se guardó en Enviados:", (e as Error).message);
  }
  const now = new Date().toISOString();
  await db.from("inbox_messages").insert({
    store_id: storeId, mailbox: saved?.path ?? "Sent", uid: saved?.uid ?? null, direction: "out",
    message_id: messageId, from_email: smtp.username.toLowerCase(), from_name: name,
    to_email: to, subject, date: now, text, html: sanitizeHtml(html), order_id: lastOrder?.id ?? null, read_at: now, ai: false,
  });
  return { sent_to: to, subject, saved_to_sent: saved?.path ?? null, email_log_id: logId, from: smtp.username, brand: name };
}
