"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, LoaderCircle, Sparkles, Undo2, X } from "lucide-react";
import { AREA_LABEL, type Rec, type RecStatus } from "@/lib/coach/types";
import { Pv } from "./Priv";

/**
 * «Mejoras» en el navegador: la lista de recomendaciones (abrir para ver los
 * números, «Copiar para Claude», «Hecha», «Descartar» con deshacer) y el
 * botón «Analizar ahora». Con fetch común a /api/admin/mejoras (como Avisos).
 */

export type RecView = Pick<Rec, "id" | "kind" | "offer_key" | "severity" | "area" | "title" | "weak" | "why" | "change" | "prompt" | "impact_usd_week" | "evidence" | "checks" | "status">;
export type OfferName = { name: string; alias: string };

const SEV_CLS: Record<Rec["severity"], string> = {
  alta: "border-red-500/30 bg-red-500/10 text-red-400",
  media: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  baja: "border-white/10 bg-zinc-800 text-zinc-300",
};
const SEV_TXT: Record<Rec["severity"], string> = { alta: "Alta", media: "Media", baja: "Baja" };
const money = (n: number) => `${Math.round(n).toLocaleString("es-AR")} USD`;

async function setStatus(id: string, status: RecStatus) {
  const r = await fetch("/api/admin/mejoras", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
}

function CopyPrompt({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ad-btn sm primary"
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); } catch {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}>
      {done ? <><Check className="h-3.5 w-3.5" /> Copiado ✓</> : <><Copy className="h-3.5 w-3.5" /> Copiar para Claude</>}
    </button>
  );
}

function Row({ r, offer, compact, onGone }: { r: RecView; offer: OfferName | null; compact?: boolean; onGone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecStatus>(r.status);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const mark = async (s: RecStatus) => {
    const before = state;
    setState(s); setErr(null);
    if (timer.current) clearTimeout(timer.current);
    // Marcada: queda 6 s con «Deshacer» y después se va de la lista.
    if (s !== r.status) timer.current = setTimeout(() => onGone(r.id), 6000);
    try { await setStatus(r.id, s); } catch (e) { setState(before); setErr(`No se pudo guardar (${(e as Error).message}).`); if (timer.current) clearTimeout(timer.current); }
  };

  if (state !== r.status) {
    return (
      <li className="flex flex-wrap items-center gap-2 border-b border-white/[0.04] px-4 py-3 text-[12.5px] text-zinc-400 last:border-b-0 sm:px-5">
        <span className="min-w-0 flex-1 truncate" data-pv-blur>{state === "hecha" ? "Marcada como hecha" : state === "descartada" ? "Descartada" : "Vuelve a nuevas"}: {r.title}</span>
        <button type="button" className="ad-btn sm" onClick={() => mark(r.status)}><Undo2 className="h-3.5 w-3.5" /> Deshacer</button>
      </li>
    );
  }

  const ev = r.evidence;
  const idea = ev?.idea;
  return (
    <li id={`m-${r.id}`} className="border-b border-white/[0.04] last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02] sm:px-5">
        <span className={`mt-[1px] inline-flex w-[50px] shrink-0 items-center justify-center rounded-full border py-[2px] text-[10.5px] font-bold ${SEV_CLS[r.severity]}`}>
          {r.kind === "postpago" ? "Idea" : SEV_TXT[r.severity]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] font-bold leading-snug text-white" data-pv-blur>{r.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
            <span>{AREA_LABEL[r.area] ?? r.area}</span>
            {offer ? <span className="min-w-0 truncate font-semibold text-zinc-400"><Pv as={offer.alias}>{offer.name}</Pv></span> : r.kind === "mejora" ? <span className="font-semibold text-zinc-400">{r.area === "ads" ? "Cuenta de anuncios" : "Toda la tienda"}</span> : null}
            {!compact && !!r.checks?.length && <span className="text-amber-400">revisar números</span>}
          </span>
        </span>
        {r.impact_usd_week != null && r.impact_usd_week > 0 && (
          <span className="shrink-0 whitespace-nowrap text-right text-[12px] font-bold text-zinc-200" title="Plata por semana que se pierde (o se puede ganar), estimada con los números de la ventana">
            ≈ {money(r.impact_usd_week)}<span className="block text-[10px] font-semibold text-zinc-500">por semana</span>
          </span>
        )}
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="grid gap-3 px-4 pb-4 text-[12.5px] leading-relaxed text-zinc-300 sm:px-5 sm:pl-[74px]">
          {r.weak && <p data-pv-blur><b className="text-zinc-100">Qué está flojo.</b> {r.weak}</p>}
          {r.why && <p data-pv-blur><b className="text-zinc-100">{idea ? "Por qué." : "Por qué importa."}</b> {r.why}</p>}
          {r.change && <p data-pv-blur><b className="text-zinc-100">El cambio.</b> {r.change}</p>}
          {idea && (
            <ol className="m-0 grid list-none gap-1.5 p-0">
              {idea.steps.map((s, i) => (
                <li key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-zinc-100">{s.step}</b>
                    <span className="break-all font-mono text-[11.5px] text-violet-300" data-pv-blur>{s.productSlug ?? "producto nuevo a crear"}</span>
                    {s.price != null && <span className="ml-auto whitespace-nowrap font-bold text-zinc-200">{s.price.toFixed(2).replace(".", ",")} {s.currency}</span>}
                  </div>
                  {s.newProduct && <p className="mt-0.5 text-amber-300" data-pv-blur>Crear: {s.newProduct}</p>}
                  {s.why && <p className="mt-0.5 text-zinc-400" data-pv-blur>{s.why}</p>}
                </li>
              ))}
            </ol>
          )}
          {!!ev?.findings?.length && (
            <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">Los números</p>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {ev.findings.map((f) => (
                  <li key={f.id} className="break-words" data-pv-blur>
                    <span className="font-semibold text-zinc-100">{f.metric}</span>
                    {f.benchmark && <span className="text-zinc-500"> · referencia {f.benchmark}</span>}
                    {f.impactUsdWeek != null && f.impactHow && <span className="block text-[11px] text-zinc-500">≈ {money(f.impactUsdWeek)}/semana: {f.impactHow}.</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!r.checks?.length && (
            <p className="text-[11.5px] text-amber-300">Revisá estos números antes de usarlos: {r.checks.join(", ")} (no aparecen en los datos calculados).</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <CopyPrompt text={r.prompt} />
            {r.status === "nueva" ? (
              <>
                <button type="button" className="ad-btn sm" onClick={() => mark("hecha")}><Check className="h-3.5 w-3.5" /> Hecha</button>
                <button type="button" className="ad-btn sm" onClick={() => mark("descartada")} title="Descartar: no vuelve a aparecer mientras el problema sea el mismo"><X className="h-3.5 w-3.5" /> Descartar</button>
              </>
            ) : (
              <button type="button" className="ad-btn sm" onClick={() => mark("nueva")}><Undo2 className="h-3.5 w-3.5" /> Volver a nuevas</button>
            )}
          </div>
          {err && <p className="text-[11.5px] text-red-400">{err}</p>}
        </div>
      )}
    </li>
  );
}

/** La lista. `restore` = en Hechas/Descartadas, el botón vuelve a «nueva». */
export function RecList({ recs, offers, compact, empty }: { recs: RecView[]; offers: Record<string, OfferName>; compact?: boolean; empty?: string }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = recs.filter((r) => !gone.has(r.id));
  if (!shown.length) return <p className="px-4 py-5 text-[12.5px] text-zinc-500 sm:px-5">{empty ?? "Nada pendiente."}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {shown.map((r) => (
        <Row key={r.id} r={r} compact={compact} offer={r.offer_key ? offers[r.offer_key] ?? null : null} onGone={(id) => setGone((s) => new Set(s).add(id))} />
      ))}
    </ul>
  );
}

type RunInfo = { id: string; status: string; created_at: string; error: string | null } | null;

/** «Analizar ahora»: arranca la corrida y espera (consultando cada 4 s) a que termine; después recarga. */
export function AnalyzeButton({ initial, size = "sm" }: { initial: RunInfo; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(initial?.status === "running" && Date.now() - Date.parse(initial.created_at) < 10 * 60_000);
  const [since, setSince] = useState(initial?.status === "running" ? Date.parse(initial.created_at) : 0);
  const [now, setNow] = useState(() => Date.now());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/admin/mejoras", { cache: "no-store" });
        const j = (await r.json()) as { run?: RunInfo };
        if (j.run && j.run.status !== "running") {
          setBusy(false);
          setMsg(j.run.status === "ok" ? "Listo" : `No se pudo: ${j.run.error ?? "error"}`);
          router.refresh();
        }
      } catch { /* sigue intentando */ }
    }, 4000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [busy, router]);

  const start = async () => {
    setMsg(null);
    try {
      const r = await fetch("/api/admin/mejoras", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const j = (await r.json()) as { started?: string; skipped?: string; error?: string; run?: RunInfo };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSince(j.run?.status === "running" ? Date.parse(j.run.created_at) : Date.now());
      setBusy(true);
      if (j.skipped) setMsg(j.skipped);
    } catch (e) { setMsg(`No se pudo arrancar: ${(e as Error).message}`); }
  };

  const secs = Math.max(0, Math.round((now - since) / 1000));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={`ad-btn ${size === "sm" ? "sm" : ""}`} onClick={start} disabled={busy}>
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? `Analizando… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "Analizar ahora"}
      </button>
      {busy && <span className="text-[11px] text-zinc-500">tarda 1–3 min; podés seguir usando el panel</span>}
      {!busy && msg && <span className="text-[11px] text-zinc-400">{msg}</span>}
    </span>
  );
}
