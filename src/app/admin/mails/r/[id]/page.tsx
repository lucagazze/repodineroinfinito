import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Pv } from "@/components/admin/Priv";
import { db } from "@/lib/db";
import { fmtDate, money } from "@/lib/admin-data";
import { BUYER, EMAIL } from "@/lib/admin/privacy";
import { resolveAlerts, resolveMailAlerts } from "@/lib/alerts";
import { orderRef } from "@/lib/order-ref";
import { AI_MISSING, aiConfigured, mailWhere, type AiDraft } from "@/lib/ai-reply";
import QuickReply, { type QuickDraft } from "./QuickReply";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { paid: "Pagado", refunded: "Reembolsado", test: "Compra de prueba", open: "Sin pagar", pending: "Sin pagar", failed: "Pago fallido", disputed: "En disputa" };

/**
 * Pantalla rápida de un mail (la abre el push): quién es, de qué oferta, cómo
 * está su pedido, qué escribió (en castellano, con el original a mano) y las
 * 2-3 respuestas de la IA para mandar con dos toques. Pensada para el celular:
 * liviana (sin la lista de Mails) y sin nada que se quede trabado.
 */
export default async function QuickMail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ o?: string; confirm?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: m } = await db.from("inbox_messages")
    .select("id,store_id,direction,from_email,from_name,reply_to,subject,date,text,order_id,read_at,replied_at,is_bounce,automated,message_id,ai_draft,stores(slug,name,display_name)")
    .eq("id", id).maybeSingle();
  if (!m || m.direction !== "in") notFound();
  const store = m.stores as unknown as { slug: string; name: string; display_name: string | null } | null;
  const draft = ((m.ai_draft ?? null) as Record<string, AiDraft> | null)?.auto ?? null;
  const orderId = draft?.order_id ?? m.order_id;
  const to = m.reply_to || m.from_email || "";

  const [where, { data: order }, { data: logs }, { count: dls }, { data: sent }] = await Promise.all([
    mailWhere(m.store_id, orderId),
    orderId ? db.from("orders").select("id,number,status,amount_total,currency,created_at,delivered_at,amount_refunded").eq("id", orderId).maybeSingle() : Promise.resolve({ data: null }),
    orderId ? db.from("email_log").select("kind,opened_at,clicked_at,downloaded_at,bounced_at,created_at").eq("order_id", orderId).in("kind", ["delivery", "upsell"]).order("created_at") : Promise.resolve({ data: [] as never[] }),
    orderId ? db.from("downloads").select("order_id", { count: "exact", head: true }).eq("order_id", orderId) : Promise.resolve({ count: 0 }),
    db.from("inbox_messages").select("date,ai").eq("store_id", m.store_id).eq("direction", "out").eq("in_reply_to", m.message_id).order("date", { ascending: false }).limit(1),
  ]);
  // Ya respondido: sus avisos se cierran al abrirlo.
  if (m.replied_at) after(() => resolveMailAlerts([id]).catch(() => {}));
  // Abrirlo es leerlo (solo en el panel). Después de responder: no frena la pantalla.
  if (!m.read_at) {
    after(async () => {
      await db.from("inbox_messages").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
      await resolveAlerts("new_inbox_message", [id]).catch(() => {});
    });
  }

  const delivery = (logs ?? []).filter((l) => l.kind === "delivery");
  const opened = (logs ?? []).some((l) => l.opened_at);
  const downloaded = (logs ?? []).some((l) => l.downloaded_at || l.clicked_at) || (dls ?? 0) > 0;
  const bounced = delivery.some((l) => l.bounced_at);
  const facts: { label: string; tone: "ok" | "warn" | "bad" | "" }[] = order ? [
    { label: STATUS[order.status] ?? order.status, tone: order.status === "paid" ? "ok" : order.status === "refunded" || order.status === "disputed" ? "bad" : "warn" },
    bounced ? { label: "La entrega rebotó", tone: "bad" } : order.delivered_at || delivery.length ? { label: "Entrega enviada", tone: "ok" } : { label: "Sin entrega", tone: "bad" },
    ...(delivery.length && !bounced ? [opened ? { label: "Abrió la entrega", tone: "ok" as const } : { label: "No abrió la entrega", tone: "warn" as const }] : []),
    ...(downloaded ? [{ label: "Descargó", tone: "ok" as const }] : []),
    ...(Number(order.amount_refunded ?? 0) > 0 ? [{ label: `Reembolsado ${money(order.amount_refunded, order.currency)}`, tone: "bad" as const }] : []),
  ] : [];
  const pick = /^[0-2]$/.test(sp.o ?? "") ? Number(sp.o) : null;
  const editHref = (i: number) => `/admin/mails?s=${store?.slug ?? ""}&m=${id}&opt=${i}`;
  const quick: QuickDraft | null = draft ? {
    intent: draft.intent, want_es: draft.want_es ?? "", summary_es: draft.summary_es, message_es: draft.message_es ?? "", notes_es: draft.notes_es,
    warnings: draft.warnings ?? [], escalate: draft.escalate, escalate_reason_es: draft.escalate_reason_es,
    order_id: draft.order_id, order_status: draft.order_status, options: draft.options ?? [],
  } : null;

  return (
    <Shell>
      <div className="mx-auto grid w-full max-w-[680px] grid-cols-[minmax(0,1fr)] gap-3 pb-10">
        <Link href={`/admin/mails?s=${store?.slug ?? ""}&m=${id}`} prefetch={false} className="inline-flex w-fit items-center gap-1.5 text-[12px] font-bold text-zinc-400 no-underline hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Abrir en Mails
        </Link>

        <section className="rounded-2xl border border-white/[0.06] bg-zinc-900 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-violet-400">{where || "Mail"}</p>
          <h1 data-pv-blur className="mt-1 break-words text-[17px] font-bold leading-snug text-white">{m.subject || "(sin asunto)"}</h1>
          <p className="mt-1 break-words text-[12.5px] text-zinc-400">
            <Pv as={BUYER}>{m.from_name || m.from_email}</Pv>
            {m.from_name && <> · <Pv as={EMAIL}>{to}</Pv></>}
            {m.date && <> · {fmtDate(m.date)}</>}
          </p>
          {order ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Link href={`/admin/avisos/pedido/${order.id}`} prefetch={false} className="ad-badge brand no-underline">Pedido {orderRef(order)} · {money(order.amount_total, order.currency)}</Link>
              {facts.map((f, i) => <span key={i} className={`ad-badge ${f.tone}`}>{f.label}</span>)}
            </div>
          ) : (
            <p className="mt-3 text-[12px] font-semibold text-amber-400">No encontré una compra con este email en la tienda.</p>
          )}
          {m.replied_at && (
            <p className="mt-3 text-[12px] font-bold text-emerald-400">Ya respondido{sent?.[0]?.date ? ` · ${fmtDate(sent[0].date)}` : ""}{sent?.[0]?.ai ? " (IA)" : ""}</p>
          )}
        </section>

        <QuickReply
          messageId={id} to={to} configured={aiConfigured()} missing={AI_MISSING} initial={quick}
          original={(m.text ?? "").trim()} pick={pick} armed={sp.confirm === "1"} answered={!!m.replied_at}
          editHrefs={[0, 1, 2].map(editHref)} mailsHref={`/admin/mails?s=${store?.slug ?? ""}`}
        />
      </div>
    </Shell>
  );
}
