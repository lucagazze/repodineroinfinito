"use client";

import { useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { rotatePartnerToken } from "@/lib/admin/partner-actions";

/**
 * Socios › «Token para su IA»: genera el token del MCP del socio (se muestra una sola vez) y el texto para pasarle,
 * con cómo conectarlo en Claude Code y en Claude Desktop.
 */
export default function PartnerToken({ email, hint, endpoint }: { email: string; hint: string | null; endpoint: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    if (hint && !window.confirm("Ya tiene un token: si generás uno nuevo, el anterior deja de andar. ¿Seguir?")) return;
    setBusy(true);
    const r = await rotatePartnerToken(email);
    setBusy(false);
    if ("error" in r) return window.alert(r.error);
    setToken(r.token);
  };
  const text = token ? `Conectá tu IA (Claude) a tu oferta en la app del dueño:

1) Claude Code (terminal):
claude mcp add --transport http socio ${endpoint} --header "Authorization: Bearer ${token}"

2) Claude Desktop: Configuración › Desarrollador › Editar configuración, y agregá en "mcpServers":
"socio": { "command": "npx", "args": ["-y", "mcp-remote", "${endpoint}", "--header", "Authorization: Bearer ${token}"] }

Después pedile: «leé la guía con get_guide y mostrame mis ofertas con my_offers».
Este token es personal: no lo compartas.` : "";
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ad-btn sm" disabled={busy} onClick={make}><Bot className="h-3.5 w-3.5" /> {hint ? "Generar token nuevo para su IA" : "Token para su IA"}</button>
        {hint && !token && <span className="text-[11.5px] text-zinc-500">Token activo: <code>{hint}</code></span>}
      </div>
      {token && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] text-zinc-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-zinc-100">
          <p className="mb-2 font-semibold">Copialo ahora: no se vuelve a mostrar. Pasáselo a {email}:</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[11.5px] dark:bg-black/30">{text}</pre>
          <button type="button" className="ad-btn sm mt-2" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sin permiso */ } }}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copiado" : "Copiar todo"}
          </button>
        </div>
      )}
    </div>
  );
}
