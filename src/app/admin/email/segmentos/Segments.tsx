"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Save, Trash } from "lucide-react";
import { api } from "../client";
import SegmentBuilder, { CountBadge, useLiveCount, type SegOpts } from "../SegmentBuilder";
import type { Segment } from "@/lib/mkt/types";

type Saved = { id: string; name: string; filters: Segment };

export default function Segments({ store, opts, saved }: { store: string; opts: SegOpts; saved: Saved[] }) {
  const router = useRouter();
  const [cur, setCur] = useState<Saved>(saved[0] ?? { id: "", name: "", filters: {} });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { count, busy: counting, err } = useLiveCount(store, cur.filters);
  const pick = (s: Saved) => { setCur(s); setMsg(null); };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ id: string }>({ action: "segment_save", ...(cur.id ? { id: cur.id } : {}), store, name: cur.name.trim() || "Segmento", filters: cur.filters });
      setCur({ ...cur, id: r.id }); setMsg("Guardado"); router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!cur.id || !confirm(`¿Borrar «${cur.name}»? Las campañas que lo usaron quedan como estaban.`)) return;
    setBusy(true);
    try { await api({ action: "segment_delete", id: cur.id }); setCur({ id: "", name: "", filters: {} }); router.refresh(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        <button className={`ad-btn sm shrink-0 justify-start ${!cur.id ? "primary" : ""}`} onClick={() => pick({ id: "", name: "", filters: {} })}><Plus className="h-3.5 w-3.5" /> Nuevo</button>
        {saved.map((s) => (
          <button key={s.id} className={`ad-btn sm shrink-0 justify-start ${cur.id === s.id ? "primary" : "ghost"}`} onClick={() => pick(s)}>
            <span className="max-w-[200px] truncate">{s.name}</span>
          </button>
        ))}
      </div>
      <section className="ad-card">
        <div className="ad-card-b pt-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input className="ad-in sm:max-w-sm" placeholder="Nombre del segmento (ej. «Uñas IT sin Física»)" value={cur.name} maxLength={80} onChange={(e) => setCur({ ...cur, name: e.target.value })} />
            <div className="flex gap-2 sm:ml-auto">
              {cur.id && <button className="ad-btn ghost text-red-400" disabled={busy} onClick={del}><Trash className="h-4 w-4" /> Borrar</button>}
              <button className="ad-btn primary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> {cur.id ? "Guardar cambios" : "Guardar"}</button>
            </div>
          </div>
          {msg && <p className="mb-3 text-[12px] text-zinc-400">{msg}</p>}
          <div className="mb-4"><CountBadge count={count} busy={counting} />{err && <p className="mt-1 text-[12px] text-red-400">{err}</p>}</div>
          <SegmentBuilder key={cur.id || "new"} value={cur.filters} onChange={(f) => setCur({ ...cur, filters: f })} opts={opts} />
        </div>
      </section>
    </div>
  );
}
