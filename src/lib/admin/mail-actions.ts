"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { replyToMessage, sendNewMail, syncInbox } from "@/lib/inbox";
import type { ActionResult } from "./types";
import { AI_MISSING, aiConfigured, autoSendable, draftReply, sendAiReply, type Decision } from "@/lib/ai-reply";
import { refundOrder } from "@/lib/refund";

/**
 * Server actions de Mails y Avisos. Todas empiezan con requireAdmin(): una
 * server action se puede llamar por POST directo, sin pasar por el layout.
 */

export async function syncInboxAction(storeSlug: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: s } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
    if (!s) return { error: "No existe esa tienda." };
    const r = await syncInbox(s.id);
    if (r.skipped) return { error: `No se sincronizó: ${r.skipped}.` };
    if (r.error) return { error: `El buzón no respondió: ${r.error}` };
    revalidatePath("/admin/mails");
    return { ok: r.inserted ? `${r.inserted} mail${r.inserted === 1 ? "" : "s"} nuevo${r.inserted === 1 ? "" : "s"}${r.bounces ? ` (${r.bounces} rebote${r.bounces === 1 ? "" : "s"})` : ""}` : "Sin mails nuevos" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function replyAction(messageId: string, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await replyToMessage(messageId, String(fd.get("text") ?? ""));
    revalidatePath("/admin/mails");
    return { ok: `Respuesta enviada a ${r.sent_to}${r.saved_to_sent ? "" : " (no se pudo guardar en Enviados)"}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Mail nuevo a alguien que no escribió, desde la casilla de la tienda. */
export async function composeAction(storeSlug: string, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: st } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
    if (!st) return { error: "No existe esa tienda." };
    const loc = String(fd.get("locale") ?? "").trim();
    const r = await sendNewMail(st.id as string, String(fd.get("to") ?? ""), String(fd.get("subject") ?? ""), String(fd.get("text") ?? ""), { locale: loc || null });
    revalidatePath("/admin/mails");
    return { ok: `Mail enviado a ${r.sent_to} como «${r.brand}»${r.saved_to_sent ? "" : " (no se pudo guardar en Enviados)"}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resolveAlertAction(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("id", id).is("resolved_at", null);
    revalidatePath("/admin/avisos");
    return { ok: "Resuelto" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Resolver todos los abiertos (de un tipo, o todos). */
export async function resolveAllAction(kind: string | null): Promise<ActionResult> {
  try {
    await requireAdmin();
    let q = db.from("alerts").update({ resolved_at: new Date().toISOString() }).is("resolved_at", null);
    if (kind) q = q.eq("kind", kind);
    const { error } = await q;
    if (error) return { error: error.message };
    revalidatePath("/admin/avisos");
    return { ok: "Listo" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function markUnreadAction(messageId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.from("inbox_messages").update({ read_at: null }).eq("id", messageId);
    revalidatePath("/admin/mails");
    return { ok: "Marcado como no leído" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type BellItem = { id: string; kind: string; severity: string; title: string; link: string | null; created_at: string };

/** Para la campanita del encabezado: cuántos avisos abiertos hay y los últimos 10. */
export async function alertsBellAction(): Promise<{ count: number; items: BellItem[] }> {
  await requireAdmin();
  const [{ count }, { data }] = await Promise.all([
    db.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    db.from("alerts").select("id,kind,severity,title,link,created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(10),
  ]);
  return { count: count ?? 0, items: (data ?? []) as BellItem[] };
}

// ------------------------------------------------------------------ IA

/** Borrador + clasificación de la IA (el guardado, o uno nuevo con `force`). */
export async function aiDraftAction(messageId: string, decision: Decision, force: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!aiConfigured()) return { error: AI_MISSING };
    const d = await draftReply(messageId, { decision, force });
    return { ok: "Borrador listo", data: { draft: d } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * «Que responda la IA» (clic derecho en un mail): arma la respuesta (o usa la guardada si sigue al día)
 * y la manda si es de las que la IA puede responder sola (las mismas reglas que el piloto: entrega de un pedido
 * pagado, preguntas que salen del contexto, primer pedido de reembolso con retención). Si no, no manda nada y dice
 * por qué: la respuesta sugerida queda lista al abrir el mail.
 */
export async function aiAnswerNowAction(messageId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!aiConfigured()) return { error: AI_MISSING };
    const d = await draftReply(messageId, { decision: "auto" });
    const can = autoSendable(d);
    if (!can.ok) return { error: `La IA no lo manda sola (${can.why}). Abrí el mail: la respuesta sugerida está lista para revisar.` };
    const resend = d.actions.includes("resend_delivery") && !!d.order_id && d.order_status === "paid";
    const r = await sendAiReply(messageId, d.reply, { resendOrderId: resend ? d.order_id : null, locale: d.language.slice(0, 2).toLowerCase() });
    revalidatePath("/admin/mails");
    return { ok: `La IA respondió a ${r.sent_to}${r.resent_delivery_to ? " y reenvió la entrega" : ""}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Manda el texto (de la IA, editado o no). Con `resendOrderId` antes reenvía la entrega de ese pedido. */
export async function aiSendAction(messageId: string, resendOrderId: string | null, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await sendAiReply(messageId, String(fd.get("text") ?? ""), { resendOrderId });
    revalidatePath("/admin/mails");
    return { ok: `${r.resent_delivery_to ? `Entrega reenviada y r` : "R"}espuesta enviada a ${r.sent_to}${r.saved_to_sent ? "" : " (no se pudo guardar en Enviados)"}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Decisión del dueño: reembolsar. Hace el reembolso en Stripe y arma el borrador que lo confirma. */
export async function aiRefundAction(messageId: string, orderId: string, amount: number | null): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await refundOrder(orderId, { amount: amount ?? undefined, source: "checkout-propio-panel-ia" });
    const details = [
      ...r.refunds.map((x) => `${x.payment}: ${x.amount} ${r.currency} · ${x.status}`),
      ...r.skipped, ...r.failed,
      ...(r.needs_approval ? ["Stripe dejó el reembolso pendiente: aprobalo en el dashboard (" + r.dashboard.join(" · ") + ")"] : []),
      ...(r.failed.length && r.dashboard.length ? ["Dashboard: " + r.dashboard.join(" · ")] : []),
    ];
    if (!r.refunds.length) return { error: `No se pudo reembolsar: ${[...r.failed, ...r.skipped].join(" · ") || "sin pagos"}`, details };
    revalidatePath("/admin/mails");
    if (!aiConfigured()) return { ok: "Reembolso hecho", details: [...details, AI_MISSING], data: { refund: r } };
    const d = await draftReply(messageId, { decision: "refund", refundDone: r });
    return { ok: r.needs_approval ? "Reembolso creado, falta aprobarlo en Stripe" : "Reembolso hecho", details, data: { draft: d, refund: r } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Piloto automático de la tienda (apagado por defecto). */
export async function setAutopilotAction(storeSlug: string, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: s } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
    if (!s) return { error: "No existe esa tienda." };
    const on = fd.get("autopilot") === "on";
    const { error } = await db.from("store_ai").upsert({ store_id: s.id, autopilot: on, updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    revalidatePath("/admin/mails");
    return { ok: on ? "Piloto automático encendido" : "Piloto automático apagado", details: on && !aiConfigured() ? [AI_MISSING] : undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Mails de compradores sin leer (todas las tiendas): la burbuja de «Mails» y el «(3) Panel» de la pestaña. */
export async function unreadMailsAction(): Promise<number> {
  await requireAdmin();
  const { count } = await db.from("inbox_messages").select("id", { count: "exact", head: true })
    .eq("direction", "in").eq("is_bounce", false).eq("automated", false).is("read_at", null);
  return count ?? 0;
}

/** «Marcar todo como leído» de una tienda (solo en el panel; en el servidor de correo no se toca nada). */
export async function markAllReadAction(storeSlug: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: s } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
    if (!s) return { error: "No existe esa tienda." };
    const { data, error } = await db.from("inbox_messages").update({ read_at: new Date().toISOString() })
      .eq("store_id", s.id).eq("direction", "in").is("read_at", null).select("id");
    if (error) return { error: error.message };
    await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("kind", "new_inbox_message").in("ref_id", (data ?? []).map((r) => r.id)).is("resolved_at", null);
    revalidatePath("/admin/mails");
    return { ok: data?.length ? `${data.length} marcados como leídos` : "No había sin leer" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
