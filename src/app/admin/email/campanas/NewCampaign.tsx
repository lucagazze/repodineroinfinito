"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../client";
import type { StoreOpt } from "../shared";

/** «Nueva campaña»: tienda + nombre → abre el editor. */
export default function NewCampaign({ stores }: { stores: StoreOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState(stores[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="ad-btn primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Nueva campaña</button>;
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ id: string }>({ action: "campaign_create", store, name: name.trim() || "Campaña sin nombre" });
      router.push(`/admin/email/campanas/${r.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      {stores.length > 1 && (
        <select className="ad-in sm:w-44" value={store} onChange={(e) => setStore(e.target.value)} aria-label="Tienda">
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <input className="ad-in sm:w-64" autoFocus placeholder="Nombre (solo lo ves vos)" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()} maxLength={120} />
      <div className="flex gap-2">
        <button className="ad-btn primary" disabled={busy} onClick={create}>{busy ? "Creando…" : "Crear"}</button>
        <button className="ad-btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      {err && <p className="text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
