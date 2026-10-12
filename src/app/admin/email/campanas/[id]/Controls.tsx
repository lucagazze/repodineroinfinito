"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Copy, Pause, Play, Scissors } from "lucide-react";
import { api } from "../../client";
import type { CampaignStatus } from "@/lib/mkt/consts";

/** Pausar / seguir / cancelar / cortar el descuento / duplicar. */
export default function Controls({ id, status, hasDiscount }: { id: string; status: CampaignStatus; hasDiscount: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (op: string, ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(op); setMsg(null);
    try {
      if (op === "duplicate") {
        const r = await api<{ id: string }>({ action: "campaign_duplicate", id });
        router.push(`/admin/email/campanas/${r.id}`);
        return;
      }
      const r = await api<{ message: string }>({ action: "state", id, op });
      setMsg(r.message);
      router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {(status === "sending" || status === "scheduled") && <button className="ad-btn sm" disabled={!!busy} onClick={() => run("pause")}><Pause className="h-3.5 w-3.5" /> Pausar</button>}
      {status === "paused" && <button className="ad-btn sm" disabled={!!busy} onClick={() => run("resume")}><Play className="h-3.5 w-3.5" /> Seguir</button>}
      {["sending", "scheduled", "paused"].includes(status) && (
        <button className="ad-btn sm danger" disabled={!!busy} onClick={() => run("cancel", "¿Cancelar la campaña? Los que están en cola no la reciben.")}><Ban className="h-3.5 w-3.5" /> Cancelar</button>
      )}
      {hasDiscount && <button className="ad-btn sm" disabled={!!busy} onClick={() => run("revoke_discount", "¿Cortar el descuento? Los links del mail dejan de aplicarlo ya mismo.")}><Scissors className="h-3.5 w-3.5" /> Cortar descuento</button>}
      <button className="ad-btn sm ghost" disabled={!!busy} onClick={() => run("duplicate")}><Copy className="h-3.5 w-3.5" /> Duplicar</button>
      {msg && <span className="w-full text-right text-[12px] text-zinc-400">{msg}</span>}
    </div>
  );
}
