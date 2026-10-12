"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** «Copiar todos los links» del pedido: el texto listo para pegarle al comprador que no encuentra su material. */
export default function CopyDeliveryLinks({ text, count }: { text: string; count: number }) {
  const [ok, setOk] = useState(false);
  if (!count) return null;
  return (
    <button type="button" className="ad-btn sm" title={text}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); } catch { /* sin permiso */ } }}>
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} {ok ? "Copiado" : `Copiar todos los links (${count})`}
    </button>
  );
}
