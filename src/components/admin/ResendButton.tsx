"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { resendDeliveryAction } from "@/lib/admin/actions";

/** «Reenviar» al lado de una entrega con problemas: el mismo mail de entrega, con lo que tiene el pedido hoy. */
export default function ResendButton({ store, orderId }: { store: string; orderId: string }) {
  // Sin useTransition: con una transición async en curso Next no termina ninguna navegación hasta que la acción vuelve.
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" disabled={pending}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (pending) return;
          setPending(true);
          resendDeliveryAction(store, orderId)
            .then((r) => setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Reenviado ✓" }))
            .catch((err) => setMsg({ ok: false, text: (err as Error).message || "No se pudo" }))
            .finally(() => setPending(false));
        }}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-1.5 py-[1px] text-[10.5px] font-bold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-500/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/10">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Reenviar
      </button>
      {msg && <span className={`text-[10.5px] font-bold ${msg.ok ? "text-emerald-600" : "text-red-600"}`} title={msg.text}>{msg.ok ? msg.text : "No se pudo"}</span>}
    </span>
  );
}
