"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Power, Save } from "lucide-react";
import { api, nf } from "../client";

export function GeneralSettings({ enabled, dailyCap, batch, used }: { enabled: boolean; dailyCap: number; batch: number; used: number }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [cap, setCap] = useState(String(dailyCap));
  const [bt, setBt] = useState(String(batch));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    try { await api({ action: "settings", ...patch }); setMsg("Guardado"); router.refresh(); return true; }
    catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  };
  const toggle = async () => {
    const next = !on;
    if (next && !confirm("Con el interruptor prendido, las campañas que confirmes salen a clientes reales (de a lotes, hasta el tope diario). ¿Prenderlo?")) return;
    if (await save({ enabled: next })) setOn(next);
  };
  return (
    <section className={`ad-card ${on ? "" : "tone-warn"}`}>
      <div className="ad-card-b pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-white"><Power className={`h-4 w-4 ${on ? "text-emerald-400" : "text-amber-400"}`} /> Envíos {on ? "prendidos" : "apagados"}</p>
            <p className="mt-1 text-[12.5px] text-zinc-400">{on
              ? "Las campañas confirmadas salen solas, cada minuto un lote, sin pasar el tope diario."
              : "Interruptor general: con él apagado no sale ningún mail de campaña (las pruebas sí). Las confirmadas esperan en cola."}</p>
          </div>
          <button className={`ad-btn ${on ? "danger" : "primary"}`} disabled={busy} onClick={toggle}>{on ? "Apagar envíos" : "Prender envíos"}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="ad-field"><label htmlFor="cap">Tope de mails por día</label>
            <input id="cap" type="number" min={0} className="ad-in" value={cap} onChange={(e) => setCap(e.target.value)} />
            <small>Últimas 24 h: {nf(used)}. Dejalo por debajo del límite de tu plan de Brevo (que comparte con las entregas de respaldo).</small></div>
          <div className="ad-field"><label htmlFor="bt">Por minuto</label>
            <input id="bt" type="number" min={1} max={200} className="ad-in" value={bt} onChange={(e) => setBt(e.target.value)} />
            <small>Cuántos manda el cron en cada pasada.</small></div>
          <div className="flex items-end"><button className="ad-btn" disabled={busy} onClick={() => save({ daily_cap: Math.max(0, Math.round(Number(cap) || 0)), batch: Math.max(1, Math.min(200, Math.round(Number(bt) || 1))) })}><Save className="h-4 w-4" /> Guardar</button></div>
        </div>
        {msg && <p className="mt-2 text-[12px] text-zinc-400">{msg}</p>}
      </div>
    </section>
  );
}

export function SenderForm({ store, name, from, replyTo, suggested }: { store: string; name: string; from: string; replyTo: string; suggested: boolean }) {
  const [f, setF] = useState(from);
  const [r, setR] = useState(replyTo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(suggested ? "sugerido (sin guardar)" : null);
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end">
      <p className="text-[13px] font-semibold text-white">{name}</p>
      <div className="ad-field"><label>Remitente</label><input className="ad-in" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div className="ad-field"><label>Responder a</label><input className="ad-in" value={r} onChange={(e) => setR(e.target.value)} /></div>
      <button className="ad-btn" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        try { await api({ action: "sender", store, from: f, reply_to: r }); setMsg("Guardado"); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
      }}><Save className="h-4 w-4" /> Guardar</button>
      {msg && <p className="text-[11.5px] text-zinc-500 sm:col-span-4">{msg}</p>}
    </div>
  );
}

export function BrevoActions({ domain, webhook }: { domain?: string; webhook?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const j = await api<{ ok: boolean; message: string }>(webhook ? { action: "brevo_webhook" } : { action: "brevo_auth", domain });
      setMsg(j.ok ? "Listo" : j.message); if (j.ok) router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <span className="flex items-center gap-2">
      <button className="ad-btn sm" disabled={busy} onClick={run}>{busy ? "…" : webhook ? "Conectar" : "Verificar DNS"}</button>
      {msg && <span className="text-[11.5px] text-zinc-400">{msg}</span>}
    </span>
  );
}
