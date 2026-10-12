"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";

/** El texto a pegar en Stripe, con «Copiar». */
export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* sin portapapeles */ }
  };
  return (
    <div className="mt-1.5 flex items-start gap-2">
      <pre className="max-h-28 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2 font-sans text-[11.5px] leading-snug text-zinc-700 dark:bg-white/[0.05] dark:text-zinc-200">{text}</pre>
      <button type="button" onClick={copy} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-violet-600 px-2.5 text-[11.5px] font-semibold text-white hover:bg-violet-700">
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

/** Revisar ya (tarda unos segundos: prueba cada link de compra y lee Stripe). */
export function RecheckNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await fetch("/api/admin/catalogos/revisar", { method: "POST" }); router.refresh(); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={run} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 px-3 font-semibold text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {busy ? "Revisando…" : "Revisar ahora"}
    </button>
  );
}
