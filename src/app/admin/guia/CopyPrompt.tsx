"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Link2 } from "lucide-react";
import { buildPrompt, shareUrl } from "@/lib/guia-prompt";

/**
 * Pasarle la app a otra IA: copiar el prompt (sin clave o con una clave nueva) o crear un
 * link para compartir que cualquier chat puede abrir y leer entero (con la clave adentro).
 */
export default function CopyPrompt() {
  const [done, setDone] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setDone(what); setTimeout(() => setDone(null), 5000); }
    catch { window.prompt("Copiá el texto:", text); }
  };
  const newKey = async (name: string) => {
    if (!window.confirm("Se crea una clave nueva con acceso total a la app (se puede revocar después). Compartila solo con un chat o una computadora de confianza. ¿Seguir?")) return null;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/claves", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error(j.error || "No se pudo crear la clave");
      return j as { token: string; name: string };
    } catch (e) { window.alert((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-60";
  return (
    <div className="mb-4 rounded-2xl border border-violet-300/50 bg-violet-50/60 p-3 sm:p-4 dark:border-violet-500/25 dark:bg-violet-500/[0.06]">
      <p className="text-[12.5px] text-zinc-700 dark:text-zinc-300">
        <b className="text-zinc-900 dark:text-white">Pasarle la app a otra IA o computadora</b> · el prompt trae cómo conectarse (el código con la clave), las reglas y esta guía entera. Pegalo como primer mensaje en cualquier chat, o pasale el link para que lo abra.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={async () => { const k = await newKey("Link compartido"); if (k) { const u = shareUrl(k.token); setLink(u); await copy(u, `el link (clave «${k.name}»)`); } }}
          className={`${btn} bg-[#6d35e8] text-white hover:bg-[#5b2bc9]`}><Link2 className="h-3.5 w-3.5" /> Crear link para compartir</button>
        <button type="button" disabled={busy} onClick={async () => { const k = await newKey("Prompt copiado"); if (k) await copy(buildPrompt(k.token), `el prompt con clave nueva «${k.name}»`); }}
          className={`${btn} border border-violet-300 bg-white text-violet-800 hover:bg-violet-50 dark:border-violet-500/40 dark:bg-white/5 dark:text-violet-200`}><KeyRound className="h-3.5 w-3.5" /> Copiar con clave nueva</button>
        <button type="button" onClick={() => void copy(buildPrompt(null), "el prompt sin clave")}
          className={`${btn} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-white/15 dark:bg-white/5 dark:text-zinc-100`}><Copy className="h-3.5 w-3.5" /> Copiar sin clave</button>
        {done && <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Copiado {done}</span>}
      </div>
      {link && <p className="mt-2 break-all rounded-lg bg-white/80 px-2.5 py-1.5 font-mono text-[11px] text-zinc-700 dark:bg-white/5 dark:text-zinc-300">{link}</p>}
    </div>
  );
}
