"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, PencilLine, Send, Sparkles, Star, Truck, UserRound } from "lucide-react";
import type { AiDraft, AiOption } from "@/lib/ai-reply";
import { aiSendAction } from "@/lib/admin/mail-actions";

export type QuickDraft = Pick<AiDraft, "intent" | "summary_es" | "notes_es" | "warnings" | "escalate" | "escalate_reason_es" | "order_id" | "order_status"> & {
  want_es: string; message_es: string; options: AiOption[];
};

const toQuick = (d: AiDraft): QuickDraft => ({
  intent: d.intent, want_es: d.want_es ?? "", summary_es: d.summary_es, message_es: d.message_es ?? "", notes_es: d.notes_es,
  warnings: d.warnings ?? [], escalate: d.escalate, escalate_reason_es: d.escalate_reason_es,
  order_id: d.order_id, order_status: d.order_status, options: d.options ?? [],
});

/**
 * Las respuestas de la IA para mandar desde el celular: «Enviar» y después
 * «Confirmar enviar a …» (dos toques, nunca uno). Desde un botón del aviso
 * llega con esa opción ya elegida esperando la confirmación. Nada va en una
 * transición de React (no traba la navegación mientras manda o mientras la
 * IA escribe).
 */
export default function QuickReply({ messageId, to, configured, missing, initial, original, pick, armed: armedFirst, answered, editHrefs, mailsHref }: {
  messageId: string; to: string; configured: boolean; missing: string; initial: QuickDraft | null; original: string;
  pick: number | null; armed: boolean; answered: boolean; editHrefs: string[]; mailsHref: string;
}) {
  const [draft, setDraft] = useState<QuickDraft | null>(initial?.options.length ? initial : null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState<number | null>(armedFirst && pick != null ? pick : null);
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<{ i: number; msg: string } | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const picked = useRef<HTMLDivElement>(null);

  // Sin opciones todavía (llegó antes que la IA): se piden acá, sin trabar nada.
  const load = () => {
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setLoading(true);
    setErr(null);
    fetch("/api/admin/mails/draft", {
      method: "POST", headers: { "content-type": "application/json" }, signal: c.signal,
      body: JSON.stringify({ id: messageId, decision: "auto", force: false }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j: { data?: { draft?: AiDraft }; error?: string } | null) => {
        if (j?.data?.draft) setDraft(toQuick(j.data.draft));
        else setErr(j?.error || "No se pudo leer el mail. Probá de nuevo.");
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErr("No se pudo leer el mail. Probá de nuevo."); })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
  };
  useEffect(() => {
    if (!draft && configured) load();
    return () => ctl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Desde el botón del aviso: la opción elegida, a la vista.
  useEffect(() => { if (draft && pick != null) picked.current?.scrollIntoView({ block: "center" }); }, [draft, pick]);

  const send = async (i: number, o: AiOption) => {
    if (sending != null || sent) return;
    setSending(i);
    setSendErr(null);
    try {
      const fd = new FormData();
      fd.set("text", o.reply);
      const resend = o.action === "resend_delivery" && draft?.order_id && draft.order_status === "paid" ? draft.order_id : null;
      const r = await aiSendAction(messageId, resend, fd);
      if (r.error) setSendErr(r.error);
      else setSent({ i, msg: r.ok ?? "Enviado" });
    } catch (e) {
      setSendErr((e as Error).message || "No se pudo mandar. Probá de nuevo.");
    } finally {
      setSending(null);
      setArmed(null);
    }
  };

  if (!configured) return <p className="ad-flash warn" style={{ marginBottom: 0 }}><Sparkles className="h-4 w-4 shrink-0" /> {missing}</p>;
  if (!draft) {
    return (
      <section className="rounded-2xl border border-white/[0.06] bg-zinc-900 p-4" aria-busy={loading}>
        {err ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <p className="text-[13px] font-semibold text-red-400">{err}</p>
            <button type="button" className="ad-btn primary w-fit" onClick={load}><Sparkles className="h-3.5 w-3.5" /> Probar de nuevo</button>
          </div>
        ) : (
          <div className="grid gap-2.5">
            <p className="flex items-center gap-2 text-[13px] font-bold text-violet-300"><Sparkles className="h-4 w-4" /> Leyendo el mail y armando respuestas… <span className="font-semibold text-zinc-500">10–20 s</span></p>
            <span className="sk" style={{ width: "90%", height: 12 }} />
            <span className="sk" style={{ width: "75%", height: 12 }} />
            <span className="sk" style={{ width: "100%", height: 90, borderRadius: 14 }} />
          </div>
        )}
        {original && <Original text={original} />}
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-white/[0.06] bg-zinc-900 p-4">
        <p className="text-[11px] font-black uppercase tracking-wider text-zinc-500">Qué quiere</p>
        <p data-pv-blur className="mt-1 break-words text-[15px] font-bold leading-snug text-white">{draft.want_es || draft.summary_es}</p>
        {draft.want_es && draft.summary_es && <p data-pv-blur className="mt-1 break-words text-[12.5px] leading-relaxed text-zinc-400">{draft.summary_es}</p>}
        {draft.escalate && draft.escalate_reason_es && <p className="mt-2 break-words text-[12.5px] font-semibold text-amber-400">Decidís vos: {draft.escalate_reason_es}</p>}
        {(draft.notes_es || draft.warnings.length > 0) && (
          <div data-pv-blur className="mt-2 grid gap-1 break-words text-[12px] text-amber-300/90">
            {draft.notes_es && <p>{draft.notes_es}</p>}
            {draft.warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}
        <p className="mt-4 text-[11px] font-black uppercase tracking-wider text-zinc-500">Lo que escribió (en castellano)</p>
        <div data-pv-blur className="mt-1 max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl bg-white/[0.03] p-3 text-[13px] leading-relaxed text-zinc-200">
          {draft.message_es || original || "(vacío)"}
        </div>
        {original && <Original text={original} />}
      </section>

      {answered && !sent && <p className="px-1 text-[12px] font-semibold text-zinc-400">Ya le respondiste: si mandás otra, sale como una respuesta más en el mismo hilo.</p>}
      {sendErr && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12.5px] font-semibold text-red-300" role="alert">{sendErr}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {draft.options.map((o, i) => {
          const isSent = sent?.i === i;
          const isArmed = armed === i;
          return (
            <div key={i} ref={pick === i ? picked : undefined}
              className={`rounded-2xl border p-4 ${isSent ? "border-emerald-500/40 bg-emerald-500/[0.06]" : isArmed ? "border-violet-500/60 bg-violet-500/[0.07]" : o.recommended ? "border-violet-500/25 bg-zinc-900" : "border-white/[0.06] bg-zinc-900"}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="break-words text-[15px] font-bold text-white">{o.label_es}</span>
                {o.recommended && <span className="ad-badge brand"><Star className="h-2.5 w-2.5" /> Recomendada</span>}
              </div>
              <p className="mt-1 break-words text-[12.5px] leading-relaxed text-zinc-400">{o.gloss_es}</p>
              {o.action === "resend_delivery" && <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-sky-300"><Truck className="h-3.5 w-3.5" /> Además le reenvía el mail de entrega.</p>}
              {o.action === "owner_review" && <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-300"><UserRound className="h-3.5 w-3.5" /> Le dice que lo estás revisando: la plata la decidís en Mails (acá no se reembolsa nada).</p>}
              <details className="group mt-2" open={pick === i}>
                <summary className="cursor-pointer select-none text-[12px] font-bold text-violet-300">Ver el mail que sale</summary>
                <div data-pv-blur className="mt-2 max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl bg-white/[0.03] p-3 text-[13px] leading-relaxed text-zinc-200">{o.reply}</div>
              </details>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isSent ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-300"><Check className="h-4 w-4" /> {sent.msg}</span>
                    <Link href={mailsHref} prefetch={false} className="ad-btn sm no-underline">Volver a Mails</Link>
                  </>
                ) : isArmed ? (
                  <>
                    <button type="button" className="ad-btn primary min-w-0 max-w-full" disabled={sending != null} onClick={() => send(i, o)}>
                      <Send className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{sending === i ? "Enviando…" : `Confirmar: enviar a ${to}`}</span>
                    </button>
                    <button type="button" className="ad-btn ghost" disabled={sending != null} onClick={() => setArmed(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`ad-btn ${o.recommended ? "primary" : ""}`} disabled={sending != null || !!sent} onClick={() => { setSendErr(null); setArmed(i); }}>
                      <Send className="h-3.5 w-3.5" /> Enviar
                    </button>
                    <Link href={editHrefs[i]} prefetch={false} className="ad-btn ghost no-underline" aria-disabled={!!sent}><PencilLine className="h-3.5 w-3.5" /> Editar</Link>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Original({ text }: { text: string }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer select-none text-[12px] font-bold text-zinc-400">Ver el original</summary>
      <div data-pv-blur className="mt-2 max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl bg-white/[0.03] p-3 text-[12.5px] leading-relaxed text-zinc-300">{text}</div>
    </details>
  );
}
