import Link from "next/link";
import Form from "next/form";
import { after } from "next/server";
import { Suspense } from "react";
import { ArrowLeft, Inbox, Paperclip, Send } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Badge, Card, EmptyState, Flash, Input, PageHead, SaveForm, Textarea, Toggle } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { db } from "@/lib/db";
import { fmtDate, money } from "@/lib/admin-data";
import { BUYER, EMAIL, storeAlias } from "@/lib/admin/privacy";
import { resendDeliveryAction } from "@/lib/admin/actions";
import { composeAction, markAllReadAction, markUnreadAction, replyAction, setAutopilotAction, syncInboxAction } from "@/lib/admin/mail-actions";
import { resolveAlerts, resolveMailAlerts } from "@/lib/alerts";
import { AI_MISSING, aiConfigured, asksRefund, type AiDraft } from "@/lib/ai-reply";
import { deliveryHtmlFor } from "@/lib/resend-delivery";
import AiReply from "./AiReply";
import { StoreUnread } from "./MailsUnread";
import { unreadByStore } from "@/lib/admin/mail-unread";
import MailsPane, { DetailSkeleton } from "./MailsPane";
import MailMenu from "./MailMenu";
import { orderRef, parseOrderNumber } from "@/lib/order-ref";
import { escHtml, srcDoc } from "@/lib/admin/mail-view";
import ConvTimeline, { type ConvItem } from "./ConvTimeline";

export const dynamic = "force-dynamic";

type Msg = {
  id: string; from_email: string | null; from_name: string | null; to_email: string | null; reply_to: string | null; subject: string | null;
  date: string | null; text: string | null; html: string | null; is_bounce: boolean; automated: boolean; order_id: string | null; email_log_id: string | null;
  read_at: string | null; replied_at: string | null; message_id: string; attachments: { name: string | null; type: string; size: number }[];
  ai_draft: Record<string, AiDraft> | null;
};
type Sp = { s?: string; m?: string; e?: string; tab?: string; q?: string; n?: string; f?: string; o?: string; opt?: string; c?: string; to?: string };
/** Respuestas: lo que le escribimos a alguien (a mano o con la IA). Entregas: los automáticos (entrega, upsell, carrito/descuento, reenvíos). */
const TABS = ["pendientes", "recibidos", "respuestas", "entregas", "rebotes"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { pendientes: "Pendientes", recibidos: "Todos", respuestas: "Respuestas", entregas: "Entregas", rebotes: "Rebotes" };
/** Filtro de Entregas. */
const FILTERS = [["all", "Todas"], ["delivery", "Entregas"], ["upsell", "Upsells"], ["recovery", "Descuentos / carritos"], ["resend", "Reenvíos"]] as const;
type Filter = (typeof FILTERS)[number][0];

const KIND: Record<string, string> = { delivery: "Entrega", upsell: "Upsell", recovery: "Recuperación", test: "Prueba", reply: "Respuesta" };
const INTENT: Record<string, string> = {
  delivery_problem: "No le llegó", access_issue: "No puede abrir", refund_request: "Pide reembolso",
  product_question: "Pregunta", chargeback_threat: "Contracargo", other: "Otro",
};

/** El HTML va en un iframe con sandbox y sin nuestro píxel ni links con seguimiento (lib/admin/mail-view). */
const esc = escHtml;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const who = (m: { reply_to: string | null; from_email: string | null }) => (m.reply_to || m.from_email || "").toLowerCase();
const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = 30;
const MAX_ROWS = 300;

/**
 * Pendientes de responder: por persona, su último mail (de los últimos 14
 * días: lo que el buzón vuelve a mirar por si se respondió en el webmail) si
 * no está respondido (ni en el webmail ni desde acá) y no le escribimos
 * después. Los automáticos y los rebotes no cuentan.
 */
async function pendingIds(storeId: string, own: string) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const [{ data: ins }, { data: outs }] = await Promise.all([
    db.from("inbox_messages").select("id,from_email,reply_to,date,read_at,replied_at,automated,is_bounce")
      .eq("store_id", storeId).eq("direction", "in").gte("date", since).order("date", { ascending: false }).limit(1500),
    db.from("inbox_messages").select("to_email,date").eq("store_id", storeId).eq("direction", "out").gte("date", since).limit(1500),
  ]);
  const lastOut = new Map<string, string>();
  for (const o of outs ?? []) {
    const k = (o.to_email ?? "").toLowerCase();
    if (o.date && (!lastOut.has(k) || o.date > lastOut.get(k)!)) lastOut.set(k, o.date);
  }
  const seen = new Set<string>();
  const out: { id: string; unread: boolean }[] = [];
  for (const m of ins ?? []) {
    const k = who(m);
    if (m.is_bounce || m.automated || !k || k === own || seen.has(k)) continue;
    seen.add(k);
    if (m.replied_at) continue;
    const lo = lastOut.get(k);
    if (lo && m.date && lo > m.date) continue;
    out.push({ id: m.id, unread: !m.read_at });
  }
  return out;
}

export default async function Mails({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const { data: boxes } = await db.from("store_mail").select("username,stores(id,slug,name,display_name)");
  const stores = (boxes ?? []).map((b) => ({ ...(b.stores as unknown as { id: string; slug: string; name: string; display_name: string | null }), box: b.username }))
    .filter((s) => s.id);
  // Link a un mail sin tienda (avisos, campanita): la tienda sale del mail.
  let wanted = sp.s;
  if (!wanted && sp.m && UUID.test(sp.m)) {
    const { data: mm } = await db.from("inbox_messages").select("store_id").eq("id", sp.m).maybeSingle();
    wanted = stores.find((s) => s.id === mm?.store_id)?.slug;
  }
  // Un mail que salió (?e=): su tienda y su pestaña (respuesta o automático) salen de él.
  const eId = sp.e && UUID.test(sp.e) ? sp.e : null;
  const { data: eRow } = eId ? await db.from("email_log").select("store_id,kind").eq("id", eId).maybeSingle() : { data: null };
  if (!wanted && eRow) wanted = stores.find((s) => s.id === eRow.store_id)?.slug;
  const store = stores.find((s) => s.slug === wanted) ?? stores[0];

  if (!store) {
    return (
      <Shell>
        <PageHead title="Mails" icon={<Inbox className="h-[18px] w-[18px]" />} color="#0ea5e9" />
        <Card><EmptyState title="Ninguna tienda tiene casilla conectada">Conectala con Claude (set_store_smtp): el buzón usa el mismo usuario y clave.</EmptyState></Card>
      </Shell>
    );
  }

  // «enviados» era la pestaña de antes (links ya guardados en avisos y notificaciones).
  const tab: Tab = TABS.find((t) => t === sp.tab)
    ?? (eRow ? (eRow.kind === "reply" ? "respuestas" : "entregas") : sp.tab === "enviados" ? "entregas" : "recibidos");
  const sentTab = tab === "respuestas" || tab === "entregas";
  const filter: Filter = tab === "entregas" ? FILTERS.find(([k]) => k === sp.f)?.[0] ?? "all" : "all";
  // Por fecha del último mensaje (de ellos o nuestro), como un chat. «No leídos primero» es opcional.
  const unreadOpt = sp.o === "unread";
  const newest = !unreadOpt;
  const unreadFirst = (tab === "pendientes" || tab === "recibidos") && unreadOpt;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const qv = q.replace(/[,()"*%\\]/g, " ");
  // De a 30 (con «Ver más»): en el celular, cientos de filas de una trababan el primer toque.
  const limit = Math.min(MAX_ROWS, Math.max(PAGE, Math.round((Number(sp.n) || PAGE) / PAGE) * PAGE));
  const href = (extra: Partial<Sp>) => {
    const p = new URLSearchParams();
    const base = { s: store.slug, tab, q: q || undefined, n: limit > PAGE ? String(limit) : undefined, f: filter !== "all" ? filter : undefined, o: unreadOpt ? "unread" : undefined };
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) p.set(k, v);
    return `/admin/mails?${p}`;
  };
  const ai = aiConfigured();
  const mId = sp.m && !sentTab && UUID.test(sp.m) ? sp.m : null;
  const sentId = sentTab && eId ? eId : null;
  // «#1001» en el buscador: los mails de ese pedido.
  const qNum = q ? parseOrderNumber(q) : null;
  const qOrders = qNum ? ((await db.from("orders").select("id").eq("number", qNum).limit(20)).data ?? []).map((o) => o.id as string) : [];
  const orderOr = qOrders.length ? `,order_id.in.(${qOrders.join(",")})` : "";

  // ------------------------------------------------------------ lista (todo lo que no depende de otra cosa, a la vez)
  const IN_COLS = "id,from_email,from_name,reply_to,subject,date,text,is_bounce,order_id,read_at,replied_at,attachments,ai_intent:ai_draft->auto->>intent,ai_escalate:ai_draft->auto->>escalate";
  type InRow = { id: string; from_email: string | null; from_name: string | null; reply_to: string | null; subject: string | null; date: string | null; text: string | null;
    is_bounce: boolean; order_id: string | null; read_at: string | null; replied_at: string | null; attachments: unknown[] | null; ai_intent: string | null; ai_escalate: string | null };
  type SentRow = { id: string; kind: string; to_email: string; subject: string | null; status: string; created_at: string; opened_at: string | null; open_count: number;
    clicked_at: string | null; click_count: number; downloaded_at: string | null; bounced_at: string | null; ai: boolean; order_id: string | null; error: string | null; tracked: boolean };
  const inList = async (ids?: string[]) => {
    if (ids && !ids.length) return [] as InRow[];
    const query = () => {
      let l = db.from("inbox_messages").select(IN_COLS).eq("store_id", store.id).eq("direction", "in").order("date", { ascending: false }).limit(tab === "recibidos" && !ids ? limit * 3 + 1 : limit + 1);
      if (ids) l = l.in("id", ids);
      if (tab === "recibidos") l = l.eq("is_bounce", false);
      if (tab === "rebotes") l = l.eq("is_bounce", true);
      if (qv) l = l.or(`subject.ilike.*${qv}*,from_email.ilike.*${qv}*,from_name.ilike.*${qv}*${orderOr}`);
      return l;
    };
    // Recibidos con «no leídos primero»: los sin leer (de los más nuevos) y después el resto.
    if (tab === "recibidos" && unreadFirst) {
      const [{ data: un }, { data: rd }] = await Promise.all([query().is("read_at", null), query().not("read_at", "is", null)]);
      return [...(un ?? []), ...(rd ?? [])].slice(0, limit + 1) as unknown as InRow[];
    }
    return ((await query()).data ?? []) as unknown as InRow[];
  };
  // Entregas: los reenvíos son las entregas de un pedido que ya tenía una antes.
  const resendIdsP = tab === "entregas"
    ? db.from("email_log").select("id,order_id,kind").eq("store_id", store.id).in("kind", ["delivery", "upsell"]).not("order_id", "is", null)
      .order("created_at", { ascending: true }).limit(3000).then(({ data }) => {
        const first = new Set<string>(); const out = new Set<string>();
        for (const r of data ?? []) { const k = `${r.kind}:${r.order_id}`; if (first.has(k)) out.add(r.id); else first.add(k); }
        return out;
      })
    : Promise.resolve(new Set<string>());
  const sentList = async () => {
    let l = db.from("email_log").select("id,kind,to_email,subject,status,created_at,opened_at,open_count,clicked_at,click_count,downloaded_at,bounced_at,ai,order_id,error,tracked")
      .eq("store_id", store.id).order("created_at", { ascending: false }).limit(limit + 1);
    l = tab === "respuestas" ? l.eq("kind", "reply") : l.neq("kind", "reply");
    if (filter === "delivery" || filter === "upsell" || filter === "recovery") l = l.eq("kind", filter);
    if (filter === "resend") { const ids = [...(await resendIdsP)]; l = l.in("id", ids.length ? ids.slice(-300) : ["00000000-0000-0000-0000-000000000000"]); }
    if (qv) l = l.or(`to_email.ilike.*${qv}*,subject.ilike.*${qv}*${orderOr}`);
    return ((await l).data ?? []) as SentRow[];
  };
  const pendP = pendingIds(store.id, store.box.toLowerCase())
    // No leídos primero (si no se pidió lo contrario); dentro de cada grupo, el más nuevo arriba.
    .then((p) => (unreadFirst ? [...p.filter((x) => x.unread), ...p.filter((x) => !x.unread)] : p));
  const [pendAll, inAll, sentAll, resendIds, { data: sync }, { data: pilot }, sel, unreadMap] = await Promise.all([
    pendP,
    sentTab ? Promise.resolve([] as InRow[])
      // Pendientes: las de más arriba; con búsqueda, entre todas.
      : tab === "pendientes" ? pendP.then((p) => inList(p.slice(0, qv ? 300 : limit + 1).map((x) => x.id))) : inList(),
    sentTab ? sentList() : Promise.resolve([] as SentRow[]),
    resendIdsP,
    db.from("inbox_sync_state").select("synced_at,error").eq("store_id", store.id).eq("mailbox", "INBOX").maybeSingle(),
    db.from("store_ai").select("autopilot").eq("store_id", store.id).maybeSingle(),
    mId
      ? db.from("inbox_messages").select("id,from_email,from_name,to_email,reply_to,subject,date,text,html,is_bounce,automated,order_id,email_log_id,read_at,replied_at,message_id,attachments,ai_draft")
        .eq("id", mId).eq("store_id", store.id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Sin leer de todas las tiendas en una consulta (pestañas de tienda y «sin leer» de esta).
    unreadByStore().catch(() => ({} as Record<string, number>)),
  ]);
  const unread = unreadMap[store.id] ?? 0;
  const pend = pendAll.map((x) => x.id);
  const pendUnread = pendAll.filter((x) => x.unread).length;
  // Pendientes: en el orden de la lista (no leídos primero), no en el de la consulta.
  if (tab === "pendientes") { const pos = new Map(pend.map((id, i) => [id, i])); inAll.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)); }
  const pendSet = new Set(pend);
  // «Todos»: una fila por conversación (el último mail de cada persona): se ve de un vistazo a quién falta responder.
  if (tab === "recibidos") {
    const seenWho = new Set<string>();
    const keyOf = (r: InRow) => (r.is_bounce ? `b:${r.id}` : (r.reply_to || r.from_email || r.id).trim().toLowerCase());
    const one = inAll.filter((r) => { const k = keyOf(r); if (seenWho.has(k)) return false; seenWho.add(k); return true; });
    // Orden de chat: la conversación con el mensaje más reciente (suyo o nuestro) arriba; responder no la hunde.
    if (!unreadFirst && one.length) {
      const emails = [...new Set(one.filter((r) => !r.is_bounce).map(keyOf))];
      const { data: outs } = emails.length
        ? await db.from("inbox_messages").select("to_email,date").eq("store_id", store.id).eq("direction", "out").in("to_email", emails).order("date", { ascending: false }).limit(3000)
        : { data: [] as { to_email: string | null; date: string | null }[] };
      const lastOut = new Map<string, string>();
      for (const o of outs ?? []) { const k = (o.to_email ?? "").toLowerCase(); if (o.date && !lastOut.has(k)) lastOut.set(k, o.date); }
      const act = (r: InRow) => { const o = r.is_bounce ? "" : lastOut.get(keyOf(r)) ?? ""; const d = r.date ?? ""; return o > d ? o : d; };
      one.sort((a, b) => act(b).localeCompare(act(a)));
    }
    inAll.splice(0, inAll.length, ...one);
  }
  const more = inAll.length > limit || sentAll.length > limit;
  const inRows = inAll.slice(0, limit);
  const sentRows = sentAll.slice(0, limit);
  const msg = sel.data as Msg | null;
  // Abrirlo acá es leerlo (solo en el panel: en el servidor de correo no se marca nada). Después de responder: no frena la página.
  if (msg && !msg.read_at) {
    const id = msg.id;
    after(async () => {
      await db.from("inbox_messages").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
      await resolveAlerts("new_inbox_message", [id]).catch(() => {});
    });
    msg.read_at = new Date().toISOString();
  }
  // Ya respondido (desde acá, el celular o el webmail): sus avisos se cierran al abrirlo.
  if (msg?.replied_at) { const id = msg.id; after(() => resolveMailAlerts([id]).catch(() => {})); }
  const orderIds = [...new Set([...inRows.map((r) => r.order_id), msg?.order_id].filter(Boolean) as string[])];
  const ordersP = orderIds.length
    ? db.from("orders").select("id,number,status,amount_total,currency,delivered_at,email").in("id", orderIds)
    : Promise.resolve({ data: [] as { id: string; number: number | null; status: string; amount_total: number; currency: string; delivered_at: string | null; email: string | null }[] });

  // Quién mandó el último mensaje de cada conversación: lo último que le escribimos a esa persona contra lo último que escribió ella.
  const who = (r: { reply_to: string | null; from_email: string | null }) => (r.reply_to || r.from_email || "").trim().toLowerCase();
  const persons = [...new Set(inRows.filter((r) => !r.is_bounce).map(who).filter(Boolean))];
  const variants = [...new Set(inRows.flatMap((r) => [r.reply_to, r.from_email]).filter((x): x is string => !!x).flatMap((x) => [x, x.trim().toLowerCase()]))];
  const [{ data: orders }, { data: outs }, { data: ins }] = persons.length
    ? await Promise.all([ordersP,
        db.from("inbox_messages").select("to_email,date,ai,text").eq("store_id", store.id).eq("direction", "out").in("to_email", variants).order("date", { ascending: false }).limit(800),
        db.from("inbox_messages").select("from_email,reply_to,date,replied_at,text,summary:ai_draft->auto->>summary_es").eq("store_id", store.id).eq("direction", "in").or(`from_email.in.(${variants.map((v) => `"${v}"`).join(",")}),reply_to.in.(${variants.map((v) => `"${v}"`).join(",")})`).order("date", { ascending: false }).limit(800),
      ])
    : [await ordersP, { data: [] as { to_email: string | null; date: string | null; ai: boolean | null; text: string | null }[] }, { data: [] as { from_email: string | null; reply_to: string | null; date: string | null; replied_at: string | null; text: string | null; summary: string | null }[] }];
  const orderMap = new Map((orders ?? []).map((o) => [o.id, o]));
  // Lo primero que dice un mail (sin saludo ni citas), para «Le dijimos: …».
  const gist = (t: string | null | undefined) => (t ?? "").split(/\n(?:>|On .{0,200}wrote:|El .{0,200}escribi)/)[0].replace(/^(hi|hello|dear|ciao|buongiorno|salve|bonjour|hola|hallo|guten tag)[^\n,.!]*[,.!]?\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 110);
  const lastOutOf = new Map<string, { date: string; ai: boolean; text: string }>();
  for (const o of outs ?? []) { const k = (o.to_email ?? "").trim().toLowerCase(); if (o.date && !lastOutOf.has(k)) lastOutOf.set(k, { date: o.date, ai: !!o.ai, text: gist(o.text) }); }
  // Su último mensaje (y si está marcado como respondido: desde el webmail o el celular no queda el mail que salió).
  const lastInOf = new Map<string, { date: string; replied: string | null; why: string }>();
  for (const m of ins ?? []) { const k = who(m); if (m.date && (!lastInOf.has(k) || m.date > lastInOf.get(k)!.date)) lastInOf.set(k, { date: m.date, replied: m.replied_at, why: (m.summary ?? "").trim() || gist(m.text) }); }
  /** Quién habló último y de qué: el motivo de su mail (resumen de la IA) o lo que le dijimos nosotros. */
  const lastWord = (r: InRow): { us: boolean; at: string; ai: boolean; why: string } | null => {
    if (r.is_bounce) return null;
    const k = who(r);
    const o = lastOutOf.get(k);
    const last = lastInOf.get(k) ?? { date: r.date ?? "", replied: r.replied_at, why: gist(r.text) };
    if (o && o.date > last.date) return { us: true, at: o.date, ai: o.ai, why: o.text };
    if (last.replied) return { us: true, at: last.replied, ai: false, why: "" };
    return { us: false, at: last.date, ai: false, why: last.why };
  };

  // El mail abierto llega aparte (Suspense): la lista no lo espera.
  const detail = sp.c === "1" ? <Compose store={store} href={href} to={sp.to ?? ""} />
    : sentId ? <SentDetail storeId={store.id} slug={store.slug} id={sentId} href={href} />
    : msg ? <MessageDetail msg={msg} store={store} order={msg.order_id ? orderMap.get(msg.order_id) ?? null : null} pending={pendSet.has(msg.id)} ai={ai} href={href} pick={/^[0-2]$/.test(sp.opt ?? "") ? Number(sp.opt) : null} />
    : null;

  return (
    <Shell>
      <PageHead
        title="Mails"
        icon={<Inbox className="h-[18px] w-[18px]" />}
        color="#0ea5e9"
        sub={<>Buzón de <Pv as={EMAIL}>{store.box}</Pv>. Se sincroniza cada 5 minutos{sync?.synced_at ? ` (última: ${fmtDate(sync.synced_at)})` : ""}.</>}
        actions={
          <>
            <Link href={href({ c: "1", m: undefined, e: undefined })} prefetch={false} scroll={false} className="ad-btn">
              <Send className="h-3.5 w-3.5" /> Escribir mail
            </Link>
            <Link href={href({ tab: "pendientes", m: undefined, e: undefined, q: undefined, n: undefined })} prefetch={false} className={`ad-btn ${pend.length ? "primary" : ""}`}>
              {pend.length ? `${pend.length} pendiente${pend.length === 1 ? "" : "s"} de responder` : "Nada pendiente"}
            </Link>
            {!!unread && <SaveForm action={markAllReadAction.bind(null, store.slug)} submit="Marcar todo como leído" pendingText="…" variant="secondary" size="md" className="flex flex-wrap items-center gap-2" />}
            <SaveForm action={syncInboxAction.bind(null, store.slug)} submit="Sincronizar ahora" pendingText="Sincronizando…" variant="secondary" size="md" className="flex flex-wrap items-center gap-2" />
          </>
        }
      />
      {sync?.error && <Flash bad={`La última sincronización falló: ${sync.error}`} />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-4 py-3 dark:border-white/[0.06] dark:bg-zinc-900">
        <SaveForm action={setAutopilotAction.bind(null, store.slug)} submit="Guardar" pendingText="…" variant="secondary" size="sm" className="flex flex-wrap items-center gap-3">
          <Toggle name="autopilot" defaultChecked={!!pilot?.autopilot} label="Piloto automático de la IA"
            hint="Responde sola lo seguro: entregas que no llegaron (reenvía), preguntas de producto y el primer intento de resolver un pedido de reembolso sin ofrecer plata. Si insiste, hay contracargo o no encuentra la compra, te avisa y espera." />
        </SaveForm>
        <span className={`ad-badge ${ai ? "ok" : "warn"}`}>{ai ? "IA lista" : "Falta la clave de la IA"}</span>
      </div>

      <MailsPane
        hasDetail={!!detail}
        head={
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {stores.length > 1 && (
              <div className="ad-seg">
                {stores.map((s) => (
                  <Link key={s.id} href={`/admin/mails?s=${s.slug}`} prefetch={false} scroll={false} data-mail="list" className={s.id === store.id ? "on" : ""}>
                    <Pv as={storeAlias(s.id)}>{s.display_name || s.name}</Pv>
                    <StoreUnread storeId={s.id} initial={unreadMap[s.id] ?? 0} />
                  </Link>
                ))}
              </div>
            )}
            <div className="ad-seg">
              {TABS.map((t) => (
                <Link key={t} href={href({ tab: t, m: undefined, e: undefined, n: undefined, f: undefined })} prefetch={false} scroll={false} data-mail="list" className={tab === t ? "on" : ""}>
                  {TAB_LABEL[t]}{t === "pendientes" && pend.length ? ` · ${pend.length}${pendUnread ? ` · ${pendUnread} sin leer` : ""}` : ""}{t === "recibidos" && unread ? ` · ${unread} sin leer` : ""}
                </Link>
              ))}
            </div>
          </div>
        }
        list={
          <MailMenu><Card pad={false}>
            <Form action="/admin/mails" className="border-b border-zinc-100 p-3 dark:border-white/[0.05]">
              <input type="hidden" name="s" value={store.slug} />
              <input type="hidden" name="tab" value={tab} />
              {filter !== "all" && <input type="hidden" name="f" value={filter} />}
              {unreadOpt && <input type="hidden" name="o" value="unread" />}
              <Input name="q" defaultValue={q} placeholder={sentTab ? "Buscar por destinatario, asunto o #pedido" : "Buscar por asunto, remitente o #pedido"} aria-label="Buscar" />
            </Form>
            {tab === "entregas" && (
              <div className="ad-seg border-b border-zinc-100 px-3 py-2.5 dark:border-white/[0.05]">
                {FILTERS.map(([k, label]) => (
                  <Link key={k} href={href({ f: k === "all" ? undefined : k, e: undefined, n: undefined })} prefetch={false} scroll={false} data-mail="list" className={filter === k ? "on" : ""}>{label}</Link>
                ))}
              </div>
            )}
            {(tab === "pendientes" || tab === "recibidos") && (
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-white/[0.05]">
                <span className="text-[11px] font-semibold text-zinc-400">Hora de Argentina</span>
                <Link href={href({ o: unreadOpt ? undefined : "unread", m: undefined, n: undefined })} prefetch={false} scroll={false} data-mail="list"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 no-underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white" aria-pressed={unreadOpt}>
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${newest ? "border-zinc-300 dark:border-zinc-600" : "border-violet-500 bg-violet-500 text-white"}`}>{unreadOpt && "✓"}</span>
                  No leídos primero
                </Link>
              </div>
            )}
            {sentTab ? (
              !sentRows.length ? (
                <EmptyState title={q || filter !== "all" ? "Nada con ese filtro" : tab === "respuestas" ? "Todavía no respondiste ningún mail desde acá" : "Todavía no salió ningún mail automático"} icon={<Send className="h-5 w-5" />} />
              ) : (
                <ul className="m-0 max-h-[calc(100dvh-300px)] list-none overflow-y-auto p-0">
                  {sentRows.map((r) => (
                    <li key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-white/[0.04]">
                      <Link href={href({ e: r.id })} prefetch={false} scroll={false} data-mail="open" className={`block px-4 py-3 no-underline transition-colors ${r.id === sentId ? "bg-violet-500/[0.07]" : "hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-white/[0.02] dark:active:bg-white/[0.05]"}`}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-900 dark:text-white"><Pv as={EMAIL}>{r.to_email}</Pv></span>
                          <span className="shrink-0 text-[11px] text-zinc-400">{fmtDate(r.created_at)}</span>
                        </div>
                        <p data-pv-blur className="mt-0.5 truncate text-[12.5px] text-zinc-600 dark:text-zinc-300">{r.subject || "—"}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1"><SentChips r={r} />{resendIds.has(r.id) && <Badge tone="brand">Reenvío</Badge>}</div>
                      </Link>
                    </li>
                  ))}
                  {more && <MoreRow href={href({ n: String(limit + PAGE), e: undefined })} shown={limit} />}
                </ul>
              )
            ) : !inRows.length ? (
              <EmptyState title={tab === "pendientes" && !q ? "Nada pendiente de responder" : q ? "Nada con esa búsqueda" : "Todavía no hay mails"} icon={<Inbox className="h-5 w-5" />}>
                {tab === "pendientes" && !q ? "Todo lo que escribieron los compradores en los últimos 14 días ya tiene respuesta." : null}
              </EmptyState>
            ) : (
              <ul className="m-0 max-h-[calc(100dvh-300px)] list-none overflow-y-auto p-0">
                {inRows.map((r) => {
                  const o = r.order_id ? orderMap.get(r.order_id) : null;
                  const read = !!r.read_at || r.id === msg?.id;
                  return (
                    <li key={r.id} className="border-b border-zinc-100 last:border-b-0 dark:border-white/[0.04]">
                      <Link href={href({ m: r.id })} prefetch={false} scroll={false} data-mail="open" data-mid={r.id}
                        className={`relative block px-4 py-3 no-underline transition-colors ${r.id === msg?.id ? "bg-violet-500/[0.07]" : !read ? "bg-violet-500/[0.035] hover:bg-violet-500/[0.06] active:bg-violet-500/[0.09]" : "hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-white/[0.02] dark:active:bg-white/[0.05]"}`}>
                        {/* Sin leer (ni acá ni en el webmail): barra y punto violeta, en negrita. */}
                        {!read && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-violet-500" aria-hidden="true" />}
                        <div className="flex items-center gap-2">
                          {!read && <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-label="Sin leer" />}
                          <span className={`min-w-0 flex-1 truncate text-[13px] ${read ? "font-medium text-zinc-600 dark:text-zinc-300" : "font-bold text-zinc-900 dark:text-white"}`}>
                            <Pv as={r.is_bounce ? "Servidor de correo" : BUYER}>{r.from_name || r.from_email || "Sin remitente"}</Pv>
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-400">{r.date ? fmtDate(r.date) : ""}</span>
                        </div>
                        <p data-pv-blur className={`mt-0.5 truncate text-[12.5px] ${read ? "text-zinc-500 dark:text-zinc-400" : "font-semibold text-zinc-800 dark:text-zinc-100"}`}>{r.subject || "(sin asunto)"}</p>
                        <p data-pv-blur className="mt-0.5 truncate text-[11.5px] text-zinc-400">{(r.text ?? "").slice(0, 400).replace(/\s+/g, " ").slice(0, 110)}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1 empty:hidden">
                          {r.is_bounce && <Badge tone="bad">Rebote</Badge>}
                          {/* Plata a la vista antes de abrirlo: pide reembolso / contracargo, y si ya te toca decidir. */}
                          {!r.is_bounce && (r.ai_intent === "chargeback_threat"
                            ? <Badge tone="bad">🚨 Contracargo · decidís vos</Badge>
                            : r.ai_intent === "refund_request" || asksRefund(r.text)
                              ? <Badge tone="bad">💸 Pide reembolso{r.ai_escalate === "true" ? " · decidís vos" : ""}</Badge>
                              : null)}
                          {(() => {
                            const lw = lastWord(r);
                            if (!lw) return r.replied_at ? <Badge tone="ok">Respondido</Badge> : null;
                            return (
                              <span className="flex w-full flex-col gap-1">
                                <span>{lw.us
                                  ? <Badge tone="ok">↩ Último: nosotros{lw.ai ? " (IA)" : ""} · {fmtDate(lw.at)}</Badge>
                                  : <Badge tone="warn">✉ Último: el cliente · {fmtDate(lw.at)}</Badge>}</span>
                                {lw.why && <span data-pv-blur className="truncate text-[11.5px] text-zinc-500 dark:text-zinc-400"><b className="font-semibold">{lw.us ? "Le dijimos:" : "Motivo:"}</b> {lw.why}</span>}
                              </span>
                            );
                          })()}
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {more && <MoreRow href={href({ n: String(limit + PAGE), m: undefined })} shown={limit} />}
              </ul>
            )}
          </Card></MailMenu>
        }
        detail={detail ? <Suspense key={mId ?? sentId} fallback={<DetailSkeleton />}>{detail}</Suspense> : (
          <Card><EmptyState title={sentTab ? "Elegí un mail que salió" : "Elegí un mail"} icon={<Inbox className="h-5 w-5" />}>
            {sentTab ? "Ves el mail tal como salió, si lo abrió, qué link tocó y toda la conversación con esa persona." : <>Al abrir uno pendiente la IA prepara la respuesta: revisás y tocás Enviar. Sale desde <Pv as={EMAIL}>{store.box}</Pv>.</>}
          </EmptyState></Card>
        )}
      />
    </Shell>
  );
}

// ------------------------------------------------------------------ piezas

/** «Ver más»: 30 filas más (la lista queda donde estaba). */
function MoreRow({ href, shown }: { href: string; shown: number }) {
  return (
    <li className="p-3">
      <Link href={href} prefetch={false} scroll={false} data-mail="list" className="ad-btn sm w-full justify-center">Ver más <span className="font-semibold text-zinc-400">· mostrando {shown}</span></Link>
    </li>
  );
}

function SentChips({ r }: { r: { kind: string; status: string; opened_at: string | null; open_count: number; clicked_at: string | null; click_count: number; downloaded_at: string | null; bounced_at: string | null; ai: boolean; error: string | null; tracked: boolean } }) {
  return (
    <>
      <Badge>{KIND[r.kind] ?? r.kind}</Badge>
      {r.ai && <Badge tone="brand">IA</Badge>}
      {r.status === "failed" ? <Badge tone="bad" dot>Falló</Badge> : r.bounced_at ? <Badge tone="bad" dot>Rebotó</Badge> : <Badge tone="ok">Enviado</Badge>}
      {r.opened_at && <Badge tone="ok">Abierto{r.open_count ? ` (${r.open_count})` : ""}</Badge>}
      {r.downloaded_at ? <Badge tone="ok" dot>Descargó</Badge> : r.clicked_at ? <Badge tone="brand">Clic ({r.click_count})</Badge> : null}
      {(r.error ?? "").startsWith("link roto") && <Badge tone="bad">Link roto</Badge>}
      {r.status === "sent" && r.tracked && !r.opened_at && !r.bounced_at && <Badge tone="warn">Sin abrir</Badge>}
    </>
  );
}

/** Todo lo que pasó con una persona en esta tienda: lo que escribió y cada mail que le salió. */
async function Conversation({ storeId, email, href, current }: { storeId: string; email: string; href: (e: Partial<Sp>) => string; current?: string }) {
  const e = email.toLowerCase();
  if (!/^[^\s",()]+@[^\s",()]+$/.test(e)) return null;
  const [{ data: ins }, { data: sent }] = await Promise.all([
    db.from("inbox_messages").select("id,date,subject,text").eq("store_id", storeId).eq("direction", "in").or(`from_email.eq."${e}",reply_to.eq."${e}"`).order("date", { ascending: false }).limit(20),
    db.from("email_log").select("id,created_at,kind,subject,status,tracked,opened_at,downloaded_at,bounced_at,ai").eq("store_id", storeId).ilike("to_email", e.replace(/[\\%_]/g, "\\$&")).order("created_at", { ascending: false }).limit(20),
  ]);
  const items: ConvItem[] = [
    ...(ins ?? []).map((m) => ({
      id: m.id, in: true, at: m.date ?? "", when: m.date ? fmtDate(m.date) : "", kind: null, ai: false, html: false,
      subject: m.subject || "(sin asunto)", sub: (m.text ?? "").slice(0, 300).replace(/\s+/g, " ").slice(0, 90), link: href({ tab: "recibidos", m: m.id, e: undefined, f: undefined }),
    })),
    ...(sent ?? []).map((l) => ({
      id: l.id, in: false, at: l.created_at, when: fmtDate(l.created_at), kind: KIND[l.kind] ?? l.kind, ai: !!l.ai, html: l.kind !== "reply",
      subject: l.subject || "—",
      // «Sin abrir» solo si salió con seguimiento (las respuestas y los mails viejos no lo traen).
      sub: l.status === "failed" ? "falló" : l.bounced_at ? "rebotó" : [l.opened_at ? "abierto" : l.tracked ? "sin abrir" : "", l.downloaded_at ? "descargó" : ""].filter(Boolean).join(" · "),
      link: href({ tab: l.kind === "reply" ? "respuestas" : "entregas", e: l.id, m: undefined, f: undefined, o: undefined }),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (items.length < 2) return null;
  return (
    <Card title="Conversación" sub={<>Todo con <Pv as={EMAIL}>{email}</Pv> en esta tienda, lo más nuevo arriba. Tocá una fila para leerla.</>}>
      <ConvTimeline items={items} current={current} />
    </Card>
  );
}

/** Mail nuevo a alguien que no escribió: sale de la casilla de la tienda, como las respuestas. */
function Compose({ store, href, to }: { store: { id: string; slug: string; box: string; name: string; display_name: string | null }; href: (e: Partial<Sp>) => string; to: string }) {
  const LANGS = [["", "Automático (el de su último pedido)"], ["it", "Italiano"], ["en", "Inglés"], ["fr", "Francés"], ["de", "Alemán"], ["es", "Español"]];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="m-0 text-[16px] font-bold text-zinc-900 dark:text-white">Mail nuevo</h2>
        <Link href={href({ c: undefined })} prefetch={false} scroll={false} className="text-[12.5px] font-semibold text-zinc-500 no-underline hover:text-zinc-900 dark:hover:text-white">Cerrar</Link>
      </div>
      <p className="ad-note mb-3">Sale desde <Pv as={EMAIL}>{store.box}</Pv> con la marca de <Pv as={storeAlias(store.id)}>{store.display_name || store.name}</Pv>. Queda en Enviados del webmail y en la pestaña Respuestas; si esa persona ya compró, se ata a su último pedido.</p>
      <SaveForm action={composeAction.bind(null, store.slug)} submit="Enviar mail" pendingText="Enviando…" resetOnOk size="md" confirm="¿Mandar este mail?">
        <div className="grid gap-3">
          <label className="grid gap-1 text-[12.5px] font-semibold text-zinc-600 dark:text-zinc-300">Para
            <Input id="compose-to" name="to" type="email" required defaultValue={to} placeholder="nombre@ejemplo.com" autoComplete="off" />
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-zinc-600 dark:text-zinc-300">Asunto
            <Input id="compose-subject" name="subject" required maxLength={200} placeholder="Asunto" />
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-zinc-600 dark:text-zinc-300">Idioma de la firma
            <select id="compose-locale" name="locale" className="ad-in" defaultValue="">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-zinc-600 dark:text-zinc-300">Mensaje
            <Textarea id="compose-text" name="text" required rows={9} placeholder="Escribí el mail…" />
          </label>
        </div>
      </SaveForm>
    </Card>
  );
}

async function SentDetail({ storeId, slug, id, href }: { storeId: string; slug: string; id: string; href: (e: Partial<Sp>) => string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: l } = await db.from("email_log")
    .select("id,kind,to_email,subject,status,provider,provider_id,error,created_at,order_id,tracked,opened_at,open_count,clicked_at,click_count,downloaded_at,bounced_at,bounce_reason,ai,body_html")
    .eq("id", id).eq("store_id", storeId).maybeSingle();
  if (!l) return <Card><EmptyState title="No encontré ese mail" /></Card>;
  const [{ data: events }, { data: order }] = await Promise.all([
    db.from("email_events").select("kind,url,at").eq("email_log_id", l.id).order("at"),
    l.order_id ? db.from("orders").select("id,number,status,amount_total,currency,email").eq("id", l.order_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // El cuerpo: el guardado; si es viejo, la respuesta guardada en el buzón o el mail de entrega armado con el pedido de hoy.
  let html: string | null = l.body_html;
  let note: string | null = null;
  if (!html && l.kind === "reply" && l.provider_id) {
    const { data: out } = await db.from("inbox_messages").select("html,text").eq("store_id", storeId).eq("message_id", l.provider_id).maybeSingle();
    html = out?.html ?? (out?.text ? `<div style="white-space:pre-wrap">${esc(out.text)}</div>` : null);
  }
  if (!html && l.order_id && (l.kind === "delivery" || l.kind === "upsell")) {
    html = await deliveryHtmlFor(l.order_id).catch(() => null);
    if (html) note = "Este mail salió antes de que se guardaran los cuerpos: lo ves armado con el pedido de hoy (mismos productos y links).";
  }
  const clicks = (events ?? []).filter((e) => e.kind === "click");

  return (
    <div className="grid gap-4">
      <Card
        title={<span data-pv-blur className="break-words">{l.subject || KIND[l.kind] || "Mail"}</span>}
        sub={<>a <Pv as={EMAIL}>{l.to_email}</Pv> · {fmtDate(l.created_at)} · {KIND[l.kind] ?? l.kind} · {l.provider}</>}
        action={<Link href={href({ e: undefined })} prefetch={false} scroll={false} data-mail="list" className="ad-btn sm ghost lg:!hidden" aria-label="Volver a la lista"><ArrowLeft className="h-3.5 w-3.5" /> Lista</Link>}
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <SentChips r={l} />
            {order && (
              <Link href={`/admin/avisos/pedido/${order.id}`} prefetch={false} className="no-underline">
                <Badge tone="brand">Pedido {orderRef(order)} · {money(order.amount_total, order.currency)}</Badge>
              </Link>
            )}
          </div>
          <dl className="ad-dl" data-pv-blur>
            {l.opened_at && <><dt>Abierto</dt><dd>{fmtDate(l.opened_at)}{l.open_count > 1 ? ` · ${l.open_count} veces` : ""}</dd></>}
            {clicks.length > 0 && <><dt>Clics</dt><dd>{clicks.map((c, i) => <span key={i} className="block break-all">{fmtDate(c.at)} · {c.url}</span>)}</dd></>}
            {l.bounced_at && <><dt>Rebotó</dt><dd>{fmtDate(l.bounced_at)} · {l.bounce_reason}</dd></>}
            {l.error && <><dt>Error</dt><dd className="break-all">{l.error}</dd></>}
            {!l.tracked && l.status === "sent" && l.kind !== "reply" && <><dt>Seguimiento</dt><dd>Salió sin píxel ni links con seguimiento: no se sabe si lo abrió.</dd></>}
          </dl>
          {note && <p className="ad-note">{note}</p>}
          {html ? (
            <iframe title="Mail enviado" srcDoc={srcDoc(html)} sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="ad-frame h-[min(70dvh,760px)] w-full border border-zinc-100 bg-white dark:border-white/[0.05]" referrerPolicy="no-referrer" loading="lazy" />
          ) : <p className="ad-note">El cuerpo de este mail no se guardó.</p>}
          {order && order.status === "paid" && (l.kind === "delivery" || l.kind === "upsell") && (
            <SaveForm action={resendDeliveryAction.bind(null, slug, order.id)} submit="Reenviar entrega" pendingText="Enviando…" variant="secondary" size="sm"
              className="flex flex-wrap items-center gap-2" confirm={`¿Reenviar el mail de entrega a ${order.email ?? l.to_email}?`} />
          )}
        </div>
      </Card>
      <Suspense fallback={null}><Conversation storeId={storeId} email={l.to_email} href={href} current={l.id} /></Suspense>
    </div>
  );
}

async function MessageDetail({ msg, store, order, pending, ai, href, pick }: {
  /** «Editar» desde la pantalla rápida: esa opción de la IA en el editor. */
  pick?: number | null;
  msg: Msg; store: { id: string; slug: string; box: string }; pending: boolean; ai: boolean; href: (e: Partial<Sp>) => string;
  order: { id: string; number: number | null; status: string; amount_total: number; currency: string; delivered_at: string | null; email: string | null } | null;
}) {
  const [replies, bounced] = await Promise.all([
    db.from("inbox_messages").select("id,date,text,to_email,ai").eq("store_id", store.id).eq("direction", "out").eq("in_reply_to", msg.message_id).order("date"),
    msg.email_log_id ? db.from("email_log").select("kind,to_email,subject,created_at,bounce_reason").eq("id", msg.email_log_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // El borrador más nuevo (recomendación o la decisión que ya tomó el dueño).
  const lastDraft = Object.values(msg.ai_draft ?? {}).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const to = msg.reply_to || msg.from_email || "";
  return (
    <div className="grid gap-4">
      <Card
        title={<span data-pv-blur className="break-words">{msg.subject || "(sin asunto)"}</span>}
        sub={<>
          <Pv as={msg.is_bounce ? "Servidor de correo" : BUYER}>{msg.from_name ? `${msg.from_name} · ` : ""}{msg.from_email}</Pv>
          {msg.reply_to && <> · responder a <Pv as={EMAIL}>{msg.reply_to}</Pv></>}
          {msg.date && <> · {fmtDate(msg.date)}</>}
        </>}
        action={
          <div className="flex shrink-0 items-center gap-1.5">
            <Link href={href({ m: undefined })} prefetch={false} scroll={false} data-mail="list" className="ad-btn sm ghost lg:!hidden" aria-label="Volver a la lista"><ArrowLeft className="h-3.5 w-3.5" /> Lista</Link>
            <SaveForm action={markUnreadAction.bind(null, msg.id)} submit="No leído" pendingText="…" variant="secondary" size="sm" className="hidden lg:block" />
          </div>
        }
      >
        <div className="grid gap-3">
          {(msg.is_bounce || order || msg.replied_at || pending) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pending && <Badge tone="warn" dot>Pendiente de responder</Badge>}
              {msg.is_bounce && <Badge tone="bad" dot>Rebote</Badge>}
              {msg.replied_at && <Badge tone="ok">Respondido</Badge>}
              {order && (
                <Link href={`/admin/avisos/pedido/${order.id}`} prefetch={false} className="no-underline">
                  <Badge tone="brand">Pedido {orderRef(order)} · {money(order.amount_total, order.currency)} · {order.status === "paid" ? (order.delivered_at ? "entregado" : "sin entregar") : order.status}</Badge>
                </Link>
              )}
            </div>
          )}
          {msg.is_bounce && (
            <div className="ad-flash bad" style={{ marginBottom: 0 }}>
              <span data-pv-blur>
                {bounced.data
                  ? <>No llegó el mail {bounced.data.kind === "delivery" ? "de entrega" : bounced.data.kind === "recovery" ? "de recuperación" : ""} a <b>{bounced.data.to_email}</b> ({fmtDate(bounced.data.created_at)}). {bounced.data.bounce_reason}</>
                  : "Aviso de rebote del servidor de correo: no se encontró el mail nuestro al que corresponde."}
              </span>
            </div>
          )}
          {msg.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11.5px] text-zinc-500">
              {msg.attachments.map((a, i) => (
                <span key={i} data-pv-blur className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                  <Paperclip className="h-3 w-3" />{a.name || a.type} · {kb(a.size)}
                </span>
              ))}
              <span className="self-center">Los adjuntos se abren en el webmail.</span>
            </div>
          )}
          {msg.html ? (
            <iframe title="Contenido del mail" srcDoc={srcDoc(msg.html)} sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="ad-frame h-[min(52dvh,560px)] w-full border border-zinc-100 bg-white dark:border-white/[0.05]" referrerPolicy="no-referrer" loading="lazy" />
          ) : (
            <div data-pv-blur className="max-h-[52dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 text-[13px] leading-relaxed text-zinc-800 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-zinc-200">{msg.text || "(vacío)"}</div>
          )}
        </div>
      </Card>

      {(replies.data ?? []).map((r) => (
        <Card key={r.id} title={<>Tu respuesta{r.ai && <Badge tone="brand">IA</Badge>}</>} sub={<>a <Pv as={EMAIL}>{r.to_email}</Pv> · {fmtDate(r.date)}</>} tone="brand">
          <div data-pv-blur className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">{r.text}</div>
        </Card>
      ))}

      {!msg.is_bounce && to && (
        <Card title="Responder con IA" sub="Lee sus pedidos, todos sus links, qué pasó con cada mail y la política. Intenta resolver sin reembolso; la plata la decidís vos.">
          <AiReply key={msg.id} messageId={msg.id} configured={ai} missing={AI_MISSING} initial={lastDraft} to={to} autoDraft={pending && !msg.automated} pick={pick ?? null} />
        </Card>
      )}

      {!msg.is_bounce && to && <Suspense fallback={null}><Conversation storeId={store.id} email={to} href={href} current={msg.id} /></Suspense>}

      {!msg.is_bounce && to && (
        <details className="ad-card">
          <summary className="cursor-pointer select-none px-5 py-4 text-[13px] font-bold text-zinc-700 dark:text-zinc-200">Responder a mano</summary>
          <div className="ad-card-b">
            <p className="ad-note mb-3">Sale desde <Pv as={EMAIL}>{store.box}</Pv> a <Pv as={EMAIL}>{to}</Pv>, en el mismo hilo y con el mail original citado abajo.</p>
            <SaveForm action={replyAction.bind(null, msg.id)} submit="Enviar respuesta" pendingText="Enviando…" resetOnOk size="md" confirm={`¿Mandar la respuesta a ${to}?`}>
              <Textarea name="text" required rows={7} placeholder="Escribí la respuesta…" aria-label="Respuesta" />
            </SaveForm>
          </div>
        </details>
      )}
    </div>
  );
}
