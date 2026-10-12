"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Send, Sparkles, Truck, Undo2, XCircle } from "lucide-react";
import type { ActionResult } from "@/lib/admin/types";
import type { AiDraft, Decision } from "@/lib/ai-reply";
import { aiRefundAction, aiSendAction } from "@/lib/admin/mail-actions";

const INTENT: Record<string, { label: string; tone: string }> = {
  delivery_problem: { label: "No le llegó la entrega", tone: "warn" },
  access_issue: { label: "No puede abrir o descargar", tone: "warn" },
  refund_request: { label: "Pide reembolso", tone: "bad" },
  product_question: { label: "Pregunta del producto", tone: "brand" },
  chargeback_threat: { label: "Amenaza de contracargo", tone: "bad" },
  other: { label: "Otro", tone: "" },
};
const ACTION: Record<string, string> = { resend_delivery: "Reenviar entrega", refund_full: "Reembolso total", refund_partial: "Reembolso parcial", none: "Sin acción" };
const MONEY = ["refund_request", "chargeback_threat"];
const fmt = (n: number, cur: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(n);

/**
 * «Responder con IA»: clasificación + borrador editable. Si el mail está
 * pendiente y no hay borrador, lo pide solo al abrirlo (un toque: Enviar).
 * Pedidos de reembolso: la IA primero intenta resolver y retener (se puede
 * mandar); si insiste, corresponde según la política o es un contracargo,
 * decide el dueño: «Reembolsar» hace el reembolso y rearma el borrador; «No
 * reembolsar» lo rearma según la política. Hasta elegir, «Enviar» espera.
 *
 * Nada de esto va en una transición de React: con una transición async en
 * curso (la IA tarda 7–20 s) Next no termina ninguna navegación hasta que
 * vuelve, y en el celular la página quedaba congelada. El borrador se pide
 * por fetch (/api/admin/mails/draft) y se corta si se sale del mail; el
 * servidor lo termina igual y queda guardado.
 */
export default function AiReply({ messageId, configured, missing, initial, to, autoDraft, pick }: {
  messageId: string; configured: boolean; missing: string; initial: AiDraft | null; to: string; autoDraft?: boolean;
  /** Opción elegida en la pantalla rápida («Editar»): su texto en el editor. */
  pick?: number | null;
}) {
  const [draft, setDraft] = useState<AiDraft | null>(initial);
  const [text, setText] = useState((pick != null ? initial?.options?.[pick]?.reply : null) ?? initial?.reply ?? "");
  const [res, setRes] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = busy !== null;
  const router = useRouter();
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const run = async (key: string, fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setBusy(key);
    setRes(null);
    try {
      const r = await fn();
      setRes(r);
      const d = r.data?.draft as AiDraft | undefined;
      if (d) { setDraft(d); setText(d.reply); }
      after?.(r);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRes({ error: (e as Error).message || "No se pudo. Probá de nuevo." });
    } finally {
      setBusy(null);
    }
  };
  const draftFor = (decision: Decision, force: boolean) => run(decision + force, async () => {
    ctl.current?.abort();
    ctl.current = new AbortController();
    const r = await fetch("/api/admin/mails/draft", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal,
      body: JSON.stringify({ id: messageId, decision, force }),
    });
    const j = (await r.json().catch(() => null)) as ActionResult | null;
    return j ?? { error: `No se pudo armar el borrador (${r.status}). Probá de nuevo.` };
  });
  const asked = useRef(false);
  useEffect(() => {
    if (configured && autoDraft && !initial && !asked.current) { asked.current = true; void draftFor("auto", false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const send = (resendOrderId: string | null) => {
    const fd = new FormData();
    fd.set("text", text);
    void run(resendOrderId ? "resend" : "send", () => aiSendAction(messageId, resendOrderId, fd), (r) => r.ok && router.refresh());
  };

  if (!configured) {
    return <div className="ad-flash warn" style={{ marginBottom: 0 }}><Sparkles className="h-4 w-4 shrink-0" /> {missing}</div>;
  }
  if (!draft) {
    if (busy) {
      // Mientras la IA escribe: el lugar del borrador, sin trabar nada (se puede volver a la lista o abrir otro mail).
      return (
        <div className="grid gap-3" aria-busy="true" aria-live="polite">
          <p className="flex items-center gap-2 text-[12.5px] font-bold text-violet-600 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" /> Generando borrador… <span className="font-semibold text-zinc-400">lee sus pedidos, los mails de entrega y el hilo (10–20 s)</span>
          </p>
          <div className="grid gap-2 rounded-xl border border-zinc-100 p-3 dark:border-white/[0.05]">
            <span className="sk" style={{ width: "92%", height: 12 }} />
            <span className="sk" style={{ width: "86%", height: 12 }} />
            <span className="sk" style={{ width: "60%", height: 12 }} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="ad-btn primary" onClick={() => draftFor("auto", false)}>
          <Sparkles className="h-3.5 w-3.5" /> Responder con IA
        </button>
        <span className="ad-note">Lee sus pedidos, qué pasó con los mails de entrega, la política y el hilo. Vos revisás y mandás.</span>
        <Res res={res} />
      </div>
    );
  }

  const intent = INTENT[draft.intent] ?? INTENT.other;
  const money = MONEY.includes(draft.intent);
  // Borradores guardados antes de la retención no traen «escalate»: se tratan como que decide el dueño.
  const escalate = money && (draft.escalate ?? true);
  const decided = !escalate || draft.decision !== "auto";
  const delivery = (draft.intent === "delivery_problem" || draft.intent === "access_issue") && !!draft.order_id && draft.order_status === "paid";
  const partial = draft.refundable && draft.refund_amount > 0 && draft.refund_amount < draft.refundable.total ? draft.refund_amount : null;
  const refundLabel = draft.refundable ? (partial ? fmt(partial, draft.refundable.currency) : draft.refundable.label) : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`ad-badge ${intent.tone}`}>{intent.label}</span>
        {draft.order_ref ? <span className="ad-badge brand">Pedido #{draft.order_ref}</span> : <span className="ad-badge warn">Pedido no encontrado</span>}
        {money && (
          <span className={`ad-badge ${draft.refund_eligible === "yes" ? "ok" : draft.refund_eligible === "no" ? "bad" : "warn"}`}>
            {draft.refund_eligible === "yes" ? "Reembolsable según política" : draft.refund_eligible === "no" ? "No reembolsable según política" : "Reembolso: sin datos"}
          </span>
        )}
        {draft.actions.filter((a) => a !== "none").map((a) => <span key={a} className="ad-badge">{ACTION[a] ?? a}</span>)}
        {draft.order_refunded > 0 && <span className="ad-badge bad">Ya reembolsado {draft.refundable ? fmt(draft.order_refunded, draft.refundable.currency) : draft.order_refunded}</span>}
        <span className="text-[11px] font-semibold text-zinc-400">confianza {Math.round(draft.confidence * 100)}%</span>
      </div>

      <p data-pv-blur className="ad-note"><b>Qué pasa:</b> {draft.summary_es}</p>
      {money && draft.refund_reason_es && <p data-pv-blur className="ad-note"><b>Política:</b> {draft.refund_reason_es}</p>}
      {(draft.notes_es || draft.warnings.length > 0) && (
        <div className="ad-flash warn" style={{ marginBottom: 0 }}>
          <span data-pv-blur>
            {draft.notes_es && <>{draft.notes_es} </>}
            {draft.warnings.map((w, i) => <span key={i} className="block">{w}</span>)}
          </span>
        </div>
      )}

      {money && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <span className="text-[12px] font-bold text-zinc-700 dark:text-zinc-200">
            {draft.decision === "refund" ? "Decidiste reembolsar."
              : draft.decision === "no_refund" ? "Decidiste no reembolsar."
              : escalate ? <>Te toca decidir{draft.escalate_reason_es ? `: ${draft.escalate_reason_es}` : "."} La IA recomienda {draft.recommended_decision === "refund" ? "reembolsar" : "no reembolsar"}.</>
              : "La IA responde para resolverlo sin reembolso (primer pedido). Si insiste, decidís vos."}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="ad-btn sm" disabled={pending || draft.decision === "refund"} title="La IA escribe el mail aceptando el reembolso: «te lo devolvemos y en unos 5 días hábiles tenés la plata». El reembolso lo hacés con el botón rojo."
              onClick={() => draftFor("refund", true)}>
              ✍️ {busy?.startsWith("refund") && busy !== "refund" ? "Escribiendo…" : "Mail aceptando el reembolso"}
            </button>
            <button type="button" className="ad-btn sm danger" disabled={pending || !draft.order_id || !draft.refundable}
              title={!draft.order_id ? "No hay un pedido verificado de esta persona para reembolsar" : !draft.refundable ? "No queda nada por devolver" : undefined}
              onClick={() => {
                if (!draft.order_id || !refundLabel) return;
                if (!window.confirm(`¿Reembolsar ${refundLabel} del pedido #${draft.order_ref} en Stripe? Es plata real.`)) return;
                void run("refund", () => aiRefundAction(messageId, draft.order_id!, partial));
              }}>
              <Undo2 className="h-3.5 w-3.5" /> {busy === "refund" ? "Reembolsando…" : `Reembolsar${refundLabel ? ` (${refundLabel})` : ""}`}
            </button>
            <button type="button" className="ad-btn sm" disabled={pending || draft.decision === "no_refund"} onClick={() => draftFor("no_refund", false)}>
              <XCircle className="h-3.5 w-3.5" /> {busy?.startsWith("no_refund") ? "Escribiendo…" : "No reembolsar (respuesta según política)"}
            </button>
          </div>
        </div>
      )}

      {(draft.options?.length ?? 0) > 1 && (
        // Las respuestas que propone la IA: tocar una la pone en el editor.
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-zinc-400">Opciones:</span>
          {draft.options.map((o, i) => (
            <button key={i} type="button" title={o.gloss_es} onClick={() => setText(o.reply)}
              className={`ad-badge ${text === o.reply ? "brand" : ""} cursor-pointer`}>{o.recommended ? "★ " : ""}{o.label_es}</button>
          ))}
        </div>
      )}
      <textarea data-pv-blur className="ad-in" rows={9} value={text} onChange={(e) => setText(e.target.value)} aria-label="Borrador de la respuesta" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ad-btn primary" disabled={pending || !decided || !text.trim()}
          title={!decided ? "Primero elegí reembolsar o no" : undefined}
          onClick={() => window.confirm(`¿Mandar la respuesta a ${to}?`) && send(null)}>
          <Send className="h-3.5 w-3.5" /> {busy === "send" ? "Enviando…" : "Enviar"}
        </button>
        {delivery && (
          <button type="button" className="ad-btn" disabled={pending || !text.trim()}
            onClick={() => window.confirm(`¿Reenviar la entrega del pedido #${draft.order_ref} y mandar la respuesta a ${to}?`) && send(draft.order_id)}>
            <Truck className="h-3.5 w-3.5" /> {busy === "resend" ? "Enviando…" : "Reenviar entrega + responder"}
          </button>
        )}
        <button type="button" className="ad-btn ghost sm" disabled={pending} onClick={() => draftFor(draft.decision, true)}>
          <RefreshCw className="h-3.5 w-3.5" /> {busy?.endsWith("true") ? "Escribiendo…" : "Regenerar"}
        </button>
        <Res res={res} />
      </div>
    </div>
  );
}

function Res({ res }: { res: ActionResult | null }) {
  if (!res || (!res.ok && !res.error)) return null;
  return (
    <div className={`ad-res ${res.error ? "bad" : "ok"}`} role="status">
      {res.error ?? <>✓ {res.ok}</>}
      {!!res.details?.length && <ul>{res.details.map((d, i) => <li key={i} className="break-all">{d}</li>)}</ul>}
    </div>
  );
}
