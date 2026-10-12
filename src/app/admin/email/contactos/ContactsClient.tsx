"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RefreshCw, Upload, X } from "lucide-react";
import { api, nf } from "../client";

export function SyncButton({ store }: { store: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[12px] text-zinc-400">{msg}</span>}
      <button className="ad-btn" disabled={busy} title="Vuelve a leer los pedidos de la app, las bajas y los rebotes"
        onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await api<{ nuevos: number; leads_nuevos: number }>({ action: "sync", store });
            setMsg(`${r.nuevos} nuevos`); router.refresh();
          } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
        }}>
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Actualizar
      </button>
    </span>
  );
}

export function ContactActions({ id, kind, status, ok }: { id: string; kind: string; status: string; ok: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, ask: string) => {
    if (!confirm(ask)) return;
    setBusy(true);
    try { await api(body); router.refresh(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  if (kind === "lead") {
    return (
      <button className="ad-btn sm ghost shrink-0" disabled={busy}
        onClick={() => run({ action: "contact_ok", id, marketing_ok: !ok }, ok
          ? "¿Sacarle el permiso? No va a recibir campañas."
          : "¿Te dio su consentimiento para recibir emails comerciales? Solo así se le puede mandar (RGPD).")}>
        {ok ? "Quitar permiso" : "Dar permiso"}
      </button>
    );
  }
  if (status !== "subscribed") return null;
  return (
    <button className="ad-btn sm ghost shrink-0" disabled={busy}
      onClick={() => run({ action: "contact_unsub", id }, "¿Darlo de baja? No recibe más campañas ni el mail de carrito.")}>
      Dar de baja
    </button>
  );
}

type Preview = {
  fileRows: number; headers: string[]; mapping: Record<string, string>; orders: number; invalid: number; notPaid: number; refunded: number;
  contacts: number; existing: number; newOnes: number;
  products: { name: string; count: number; suggestion: string | null }[];
  sample: { email: string; name: string | null; country: string | null; date: string | null; products: string[] }[];
};
const FIELDS: [string, string][] = [
  ["email", "Email *"], ["name", "Nombre"], ["products", "Productos"], ["country", "País"], ["date", "Fecha"],
  ["total", "Total"], ["currency", "Moneda"], ["status", "Estado del pago"], ["order", "N.º de orden"], ["locale", "Idioma"],
];

/** Importar el Excel de referencia (o un CSV): vista previa, columnas, productos y recién ahí importar. */
export function ImportBox({ store, products }: { store: string; products: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [prodMap, setProdMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const send = async (mode: "preview" | "commit", f = file, m = map) => {
    if (!f) return null;
    const fd = new FormData();
    fd.set("file", f); fd.set("store", store); fd.set("mode", mode);
    if (Object.keys(m).length) fd.set("mapping", JSON.stringify(m));
    if (mode === "commit") fd.set("products", JSON.stringify(prodMap));
    const r = await fetch("/api/admin/mkt/import", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    return j;
  };
  const preview = async (f = file, m = map) => {
    setBusy("preview"); setErr(null); setDone(null);
    try {
      const p = (await send("preview", f, m)) as Preview;
      setPv(p); setMap(p.mapping);
      setProdMap((cur) => Object.fromEntries(p.products.map((x) => [x.name, cur[x.name] ?? x.suggestion ?? ""])));
    } catch (e) { setErr((e as Error).message); setPv(null); } finally { setBusy(null); }
  };
  const commit = async () => {
    setBusy("commit"); setErr(null);
    try {
      const r = (await send("commit")) as { pedidos: number; nuevos: number; actualizados: number; salteados: number };
      setDone(`Listo: ${nf(r.pedidos)} pedidos · ${nf(r.nuevos)} contactos nuevos${r.salteados ? ` · ${nf(r.salteados)} filas salteadas` : ""}`);
      setPv(null); setFile(null); if (ref.current) ref.current.value = "";
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  if (!open) return <button className="ad-btn primary" onClick={() => setOpen(true)}><Upload className="h-4 w-4" /> Importar</button>;
  return (
    <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Importar compradores">
      <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-zinc-900 p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center">
          <h3 className="text-[16px] font-bold text-white">Importar compradores</h3>
          <button className="ad-btn sm ghost ml-auto" onClick={() => setOpen(false)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <p className="ad-note mb-3">la plataforma anterior: <b>Ventas realizadas → Exportar XLSX</b> con todo el rango de fechas. También sirve un CSV con una columna de email. Reimportar el mismo archivo no duplica (se usa el número de orden). Solo entran las ventas aprobadas; los reembolsos quedan fuera de las campañas.</p>
        <input ref={ref} type="file" accept=".xlsx,.csv,text/csv" className="ad-in"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPv(null); setMap({}); if (f) preview(f, {}); }} />
        {busy === "preview" && <p className="mt-3 text-[12.5px] text-zinc-400">Leyendo el archivo…</p>}
        {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">{err}</p>}
        {done && <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-300">{done}</p>}
        {pv && (
          <div className="mt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              <div className="ad-stat"><span>Filas</span><strong>{nf(pv.fileRows)}</strong><small>{nf(pv.orders)} ventas válidas</small></div>
              <div className="ad-stat"><span>Personas</span><strong>{nf(pv.contacts)}</strong><small>{nf(pv.newOnes)} nuevas · {nf(pv.existing)} ya estaban</small></div>
              <div className="ad-stat"><span>Salteadas</span><strong>{nf(pv.invalid + pv.notPaid)}</strong><small>{pv.invalid} sin email válido · {pv.notPaid} no pagadas</small></div>
              <div className="ad-stat"><span>Reembolsos</span><strong>{nf(pv.refunded)}</strong><small>quedan fuera</small></div>
            </div>
            <details className="rounded-xl border border-white/[0.06] p-3" open={!pv.mapping.email}>
              <summary className="cursor-pointer text-[12.5px] font-semibold text-zinc-200">Columnas</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {FIELDS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-[12px] text-zinc-400">
                    <span className="w-28 shrink-0">{l}</span>
                    <select className="ad-in h-9" value={map[k] ?? ""} onChange={(e) => { const m = { ...map }; if (e.target.value) m[k] = e.target.value; else delete m[k]; setMap(m); preview(file, m); }}>
                      <option value="">—</option>
                      {pv.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </details>
            {pv.products.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] p-3">
                <p className="mb-1 text-[12.5px] font-semibold text-zinc-200">Productos</p>
                <p className="mb-2 text-[11.5px] text-zinc-500">Cada nombre del archivo con su producto en la app: así «no compró X» sabe quién ya lo tiene. Sin elegir, solo se guarda el nombre.</p>
                <ul className="grid gap-1.5">
                  {pv.products.map((p) => (
                    <li key={p.name} className="grid gap-1 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-3">
                      <span className="truncate text-[12px] text-zinc-300">{p.name} <span className="text-zinc-500">×{p.count}</span></span>
                      <select className="ad-in h-9" value={prodMap[p.name] ?? ""} onChange={(e) => setProdMap({ ...prodMap, [p.name]: e.target.value })}>
                        <option value="">— sin producto —</option>
                        {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-xl border border-white/[0.06] p-3 text-[12px]">
              <p className="mb-2 font-semibold text-zinc-200">Así quedan (primeros)</p>
              <ul className="grid gap-1 text-zinc-400">
                {pv.sample.map((s) => <li key={s.email} className="truncate"><b className="text-zinc-200">{s.email}</b> · {s.name ?? "—"} · {s.country ?? "—"} · {s.date ? s.date.slice(0, 10) : "—"} · {s.products.join(", ") || "—"}</li>)}
              </ul>
            </div>
            <button className="ad-btn primary block" disabled={busy === "commit" || !pv.contacts} onClick={commit}>
              {busy === "commit" ? "Importando…" : `Importar ${nf(pv.contacts)} personas`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
