"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FolderOpen, Loader2, RefreshCw, Send } from "lucide-react";
import { dueText, type PresaleRow, type PresaleState } from "@/lib/admin/presale-shared";

const STATE: Record<PresaleState, { label: string; cls: string }> = {
  atrasado: { label: "Atrasado", cls: "bg-red-500/15 text-red-600 dark:text-red-300" },
  vence_pronto: { label: "Vence en menos de 24 h", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  a_tiempo: { label: "A tiempo", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  sin_ventas: { label: "Sin ventas todavía", cls: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400" },
  listo_sin_avisar: { label: "Listo · falta avisar", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  entregado: { label: "✓ Listo y avisado", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};
const mb = (b: number | null) => (b == null ? "grande" : b >= 1e6 ? `${(b / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB` : `${Math.round(b / 1000)} KB`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "—");

async function post(body: unknown) {
  const r = await fetch("/api/admin/preventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export default function PresaleList({ rows, done }: { rows: PresaleRow[]; done?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  const ready = async (r: PresaleRow) => {
    if (!window.confirm(`¿Ya está el contenido de «${r.name}» en su carpeta?\n\nDeja de venderse como preventa: el comprador nuevo ya no ve «te llega en ${r.days} días».`)) return;
    setBusy(r.id);
    try { await post({ action: "ready", productId: r.id }); router.refresh(); }
    catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };
  const notify = async (r: PresaleRow) => {
    const files = r.readyFiles.map((f) => `• ${f.title} (${mb(f.bytes)})`).join("\n");
    if (!window.confirm(`¿Reenviar la entrega a ${r.pendingNotice} ${r.pendingNotice === 1 ? "comprador" : "compradores"} de «${r.name}»?\n\nEn la carpeta está:\n${files || "(se vuelve a verificar al mandar)"}\n\nLes llega el mail de entrega de su pedido con el link a la carpeta.`)) return;
    setBusy(r.id);
    try {
      const j = await post({ action: "notify", productId: r.id });
      setMsg((m) => ({ ...m, [r.id]: `Avisados: ${j.sent}${j.failed?.length ? ` · fallaron ${j.failed.length}: ${j.failed.join("; ")}` : ""}` }));
      router.refresh();
    } catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const scan = async () => {
    setBusy("scan");
    try {
      const j = await post({ action: "scan" });
      setMsg((m) => ({ ...m, scan: j.ready?.length ? `Ya están: ${j.ready.join(", ")}` : `Revisé ${j.checked} carpetas: todavía no hay PDF nuevo.` }));
      router.refresh();
    } catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <>
    {!done && <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-[12px] text-zinc-500 sm:px-5 dark:border-white/[0.05]">
      <span>Las carpetas se revisan solas cada 15 min. Pasa a «Listo» solo cuando hay un PDF de verdad y con peso de libro (no el aviso de Word); al avisar a todos, baja a «Listos y avisados».</span>
      <button type="button" onClick={scan} disabled={busy === "scan"} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 px-3 font-semibold text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200">
        {busy === "scan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Revisar carpetas ahora
      </button>
      {msg.scan && <span className="w-full font-semibold text-emerald-600 dark:text-emerald-400">{msg.scan}</span>}
    </div>}
    <ul className="m-0 list-none divide-y divide-zinc-100 p-0 dark:divide-white/[0.05]">
      {rows.map((r) => {
        const st = STATE[r.state];
        const n = r.orders.length;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap sm:px-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {r.image ? <img src={r.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[13.5px] text-zinc-900 dark:text-white">{r.name}</b>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
              </div>
              {/* De qué oferta es: dónde se vende y cómo. */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {r.offers.length ? r.offers.map((o) => (
                  <span key={o.name} className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25">
                    {o.name}<span className="font-normal text-violet-500 dark:text-violet-400">· {o.role}</span>
                  </span>
                )) : <span className="text-[11.5px] text-amber-600 dark:text-amber-400">No se vende en ningún checkout activo</span>}
              </div>
              <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                {r.storeName} · prometido en {r.days} {r.days === 1 ? "día" : "días"}
                {n > 0 && <> · <b className="text-zinc-800 dark:text-zinc-200">{n} {n === 1 ? "comprador" : "compradores"}</b> · primera compra {day(r.firstSale)}</>}
                {r.state !== "listo_sin_avisar" && n > 0 && <> · <b className={r.state === "atrasado" ? "text-red-600 dark:text-red-400" : ""}>{dueText(r)}</b> ({day(r.due)})</>}
                {r.state === "listo_sin_avisar" && <> · listo {day(r.readyAt)} · falta avisar a {r.pendingNotice}</>}
                {r.state === "entregado" && <> · listo {day(r.readyAt)}{r.noticedAt ? <> · avisado {day(r.noticedAt)}</> : n === 0 ? <> · nadie lo esperaba</> : null}</>}
              </p>
              {/* El PDF que se verificó: para ver que es el libro antes de avisar. */}
              {r.readyFiles.length > 0 && (r.state === "listo_sin_avisar" || r.state === "entregado") && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                  {r.readyFiles.map((f) => (
                    <a key={f.id} href={`https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                      📄 {f.title} · {mb(f.bytes)}
                    </a>
                  ))}
                </p>
              )}
              {r.leftoverNotices.length > 0 && (
                <p className="mt-1 text-[12px] font-semibold text-red-600 dark:text-red-400">
                  🧹 Sigue el aviso de preventa en la carpeta: {r.leftoverNotices.map((n) => (
                    <a key={n.id} href={`https://drive.google.com/file/d/${n.id}/view`} target="_blank" rel="noreferrer" className="underline">«{n.title}»</a>
                  ))}. Borralo antes de avisar (si no, el comprador ve el libro y «todavía no llegó»).
                </p>
              )}
              {/* Lo que se prometió: páginas e índice (para quien lo escriba, persona o IA). */}
              {r.state !== "entregado" && (r.plannedPages || r.plannedOutline) ? (
                <details className="mt-1 text-[12px] text-zinc-600 dark:text-zinc-300">
                  <summary className="cursor-pointer font-semibold text-violet-700 dark:text-violet-300">
                    📐 Plan: {r.plannedPages ? `${r.plannedPages} páginas` : "páginas sin definir"}{r.plannedOutline ? " · ver índice" : ""}
                  </summary>
                  {r.plannedOutline && <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 font-sans text-[12px] leading-relaxed dark:bg-white/[0.04]">{r.plannedOutline}</pre>}
                </details>
              ) : r.state !== "entregado" && r.state !== "listo_sin_avisar" ? (
                <p className="mt-1 text-[11.5px] text-amber-600 dark:text-amber-400">Sin plan cargado: faltan las páginas y el índice que se prometieron.</p>
              ) : null}
              {msg[r.id] && <p className="mt-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">{msg[r.id]}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {r.deliveryUrl && (
                <a href={r.deliveryUrl} target="_blank" rel="noreferrer" title="La carpeta de entrega: el PDF va acá"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-white/5">
                  <FolderOpen className="h-3.5 w-3.5" /> Carpeta
                </a>
              )}
              {r.state === "entregado" ? null : r.state === "listo_sin_avisar" && r.leftoverNotices.length ? (
                <span className="text-[12px] font-semibold text-red-600 dark:text-red-400">Falta borrar el aviso</span>
              ) : r.state === "listo_sin_avisar" ? (
                <button type="button" disabled={busy === r.id} onClick={() => notify(r)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-[12px] font-bold text-white disabled:opacity-60">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Avisar a {r.pendingNotice}
                </button>
              ) : (
                <button type="button" disabled={busy === r.id} onClick={() => ready(r)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[12px] font-bold text-white disabled:opacity-60">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Ya está el contenido
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}
