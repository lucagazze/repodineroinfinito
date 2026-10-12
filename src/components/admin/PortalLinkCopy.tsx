"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

/** El link del portal de una tienda, con «Copiar» y «Abrir». */
export default function PortalLinkCopy({ name, url }: { name: string; url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 dark:border-white/10">
      <div className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-zinc-500">{name}</span>
        <span className="block truncate font-mono text-[12.5px] font-semibold text-zinc-900 dark:text-white">{url.replace(/^https:\/\//, "")}</span>
      </div>
      <button type="button" className="ad-btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin permiso */ } }}>
        {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} {ok ? "Copiado" : "Copiar"}
      </button>
      <a className="ad-btn sm" href={url} target="_blank" rel="noreferrer" aria-label={`Abrir ${url}`}><ExternalLink className="h-3.5 w-3.5" /></a>
    </div>
  );
}
