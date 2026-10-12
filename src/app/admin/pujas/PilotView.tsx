"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, FlaskConical, Loader2, Minus, Pencil, X } from "lucide-react";
import type { PilotRun } from "@/lib/bid-pilot/run";
import { PANEL_TZ } from "@/lib/admin/range";

/**
 * La página del piloto de pujas: el interruptor general, cada campaña con su
 * interruptor, su objetivo y su tope (editables; el tope es el precio del front
 * de su oferta salvo que se ponga a mano), el aviso de «CPA caro», cada conjunto con su puja,
 * gasto, compras, CPA de 3 días y en qué estado está; «Ver qué haría ahora»
 * (simulación, no cambia nada) y el historial de cambios. Guarda con fetch
 * común (no server actions).
 */

export type AdsetView = {
  /** Escalón de una escalera (puja fija, a ese % del precio del front). */
  ladder: boolean; ladderPct: number | null;
  id: string; name: string | null; status: string | null; bid: number | null;
  spend24h: number; purchases24h: number; spend72h: number; purchases72h: number;
  state: string | null; reason: string | null; lastChangeAt: string | null; lastChangeReason: string | null; manualUntil: string | null; updatedAt: string;
};
export type CampaignView = {
  id: string; name: string; enabled: boolean; target: number; max: number; floor: number; dailyBudget: number | null; status: string | null; adsets: AdsetView[];
  /** Tope a mano; si no, el precio del front (frontLabel, «USD 27») o, sin oferta vinculada, 1,5 × objetivo. */
  maxManual: boolean; frontUsd: number | null; frontLabel: string | null; frontVia: string | null;
  /** «CPA caro» de la última pasada (null: por debajo del precio del front). */
  cpaAlert: string | null; cpaAlertAt: string | null;
  /** Estado de la campaña en Meta (ACTIVE, PAUSED…). */
  metaStatus?: string | null;
  /** Según Meta: gasto, compras y valor de compra de los últimos 3 y 7 días (ticket promedio y retorno). */
  d1?: { spend: number; purchases: number; value: number };
  d3?: { spend: number; purchases: number; value: number };
  d7?: { spend: number; purchases: number; value: number };
};
export type RunView = { at: string; ok: boolean; skipped: string | null; error: string | null; changes: number };
export type ChangeView = { at: string; campaignId: string; campaign: string; action: string; before: number | null; after: number | null; applied: boolean; confirmed: number | null; reason: string };

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "");
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const STATE: Record<string, [string, string]> = {
  sin_gastar: ["Sin gastar", "bg-amber-500/15 text-amber-300 ring-amber-500/25"],
  en_objetivo: ["En objetivo", "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"],
  barato: ["Barato", "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"],
  caro: ["Caro", "bg-red-500/15 text-red-300 ring-red-500/25"],
  pocas_compras: ["Pocas compras", "bg-white/5 text-zinc-300 ring-white/10"],
  a_mano: ["Cambiada a mano", "bg-violet-500/15 text-violet-300 ring-violet-500/25"],
  pausado: ["Pausada", "bg-white/5 text-zinc-400 ring-white/10"],
  en_tope: ["En el tope", "bg-amber-500/15 text-amber-300 ring-amber-500/25"],
  en_piso: ["En el piso", "bg-white/5 text-zinc-300 ring-white/10"],
  arranque: ["Arranca en el tope", "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"],
  escalera: ["Escalón fijo", "bg-sky-500/15 text-sky-300 ring-sky-500/25"],
};
function StateChip({ s }: { s: string | null }) {
  const [label, cls] = STATE[s ?? ""] ?? ["Sin datos", "bg-white/5 text-zinc-400 ring-white/10"];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[11.5px] font-semibold ring-1 ring-inset ${cls}`}>{label}</span>;
}
export function Switch({ on, busy, onChange, label }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-emerald-500" : "bg-zinc-700"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

async function post(body: unknown) {
  const r = await fetch("/api/admin/pujas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/**
 * Una campaña en UNA fila: interruptor del
 * piloto, nombre, puja (las de cada escalón si es escalera), tope, gasto y compras de 24 h y 3 días,
 * CPA de 3 días y estado. Tocando la fila se ve el motivo de cada conjunto y se edita.
 */
type SortKey = "name" | "bid" | "max" | "s1" | "b1" | "r1" | "s3" | "b3" | "cpa" | "aov" | "roas" | "state";
/** Los números de la fila de una campaña: los mismos para mostrar y para ordenar. */
function rowNums(c: CampaignView) {
  const d1 = c.d1 ?? { spend: 0, purchases: 0, value: 0 }, d3 = c.d3 ?? { spend: 0, purchases: 0, value: 0 };
  const bids = c.adsets.map((s) => s.bid).filter((x): x is number => x != null);
  return {
    name: c.name.toLowerCase(), bid: bids.length ? Math.max(...bids) : null, max: c.max,
    s1: d1.spend, b1: d1.purchases, r1: d1.spend ? d1.value / d1.spend : null,
    s3: d3.spend, b3: d3.purchases, cpa: d3.purchases ? d3.spend / d3.purchases : null,
    aov: d3.purchases ? d3.value / d3.purchases : null, roas: d3.spend ? d3.value / d3.spend : null,
    state: c.adsets[0]?.state ?? "",
  };
}
const SORT_LS = "ad-pilot-sort";

function CampaignRow({ c, pct, onSaved, next }: { c: CampaignView; pct: number; onSaved: (msg: string) => void; next?: React.ReactNode }) {
  const [on, setOn] = useState(c.enabled);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(c.target));
  const [max, setMax] = useState(String(c.max));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(",", "."));
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { await post({ action: "campaign", campaignId: c.id, ...patch }); onSaved(patch.auto ? "El tope vuelve a ser el precio del libro" : "Guardado"); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const n = rowNums(c);
  const roasCls = (r: number | null) => r == null ? "text-zinc-500" : r >= 1.5 ? "text-emerald-400" : r >= 1 ? "text-amber-300" : "text-red-400";
  const bids = c.adsets.map((s) => s.bid).filter((x): x is number => x != null);
  const states = [...new Set(c.adsets.map((s) => s.state))];
  const td = "whitespace-nowrap px-1.5 py-2 text-right tabular-nums text-[12.5px]";
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.03]">
        <td className="py-2 pl-3 pr-1" onClick={(e) => e.stopPropagation()}>
          <Switch on={on} busy={busy} label={`Piloto en ${c.name}`} onChange={(v) => { setOn(v); void save({ enabled: v }).catch(() => setOn(!v)); }} />
        </td>
        <td className="max-w-[180px] px-1.5 py-2">
          <span className="flex items-center gap-1.5">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="truncate text-[12.5px] font-semibold text-white" title={c.name}>{c.name}</span>
            {c.cpaAlert && <span title={c.cpaAlert} className="shrink-0 text-[12px]">⚠️</span>}
          </span>
        </td>
        <td className={`${td} font-semibold text-white`} title={bids.map((b) => usd(b)).join(" / ")}>
          {!bids.length ? "—" : (() => {
            const u = [...new Set(bids)].sort((x, y) => x - y);
            return u.length === 1 ? <>{usd(u[0])}{bids.length > 1 && <span className="ml-1 font-normal text-zinc-500">×{bids.length}</span>}</> : <>{usd(u[0])}–{usd(u[u.length - 1])}</>;
          })()}
        </td>
        <td className={`${td} text-zinc-300`} title={c.maxManual ? "Tope a mano" : c.frontLabel ? `${pct} % de ${c.frontLabel}` : "Sin oferta vinculada: el piloto no sabe el precio del libro"}>
          {usd(c.max)}{!c.maxManual && !c.frontLabel && <span className="text-amber-300"> *</span>}
        </td>
        <td className={`${td} border-l border-white/[0.06] text-zinc-300`}>{usd(n.s1)}</td>
        <td className={`${td} text-zinc-300`}>{Math.round(n.b1)}</td>
        <td className={`${td} font-semibold ${roasCls(n.r1)}`}>{n.r1 == null ? "—" : n.r1.toFixed(2)}</td>
        <td className={`${td} border-l border-white/[0.06] text-zinc-300`}>{usd(n.s3)}</td>
        <td className={`${td} text-zinc-300`}>{Math.round(n.b3)}</td>
        <td className={`${td} font-semibold ${n.cpa == null ? "text-zinc-500" : n.cpa > c.target * 1.1 ? "text-red-400" : n.cpa <= c.target ? "text-emerald-400" : "text-amber-300"}`}>{usd(n.cpa)}</td>
        <td className={`${td} text-zinc-300`}>{usd(n.aov)}</td>
        <td className={`${td} font-semibold ${roasCls(n.roas)}`}>{n.roas == null ? "—" : n.roas.toFixed(2)}</td>
        <td className="px-1.5 py-2"><span className="flex flex-wrap gap-1">{states.map((st) => <StateChip key={st ?? "x"} s={st} />)}</span></td>
        <td className="min-w-[180px] max-w-[240px] px-1.5 py-2 text-[12px] leading-snug">{next ?? <span className="text-zinc-600">…</span>}</td>
      </tr>
      {open && (
        <tr className="bg-white/[0.02]">
          <td />
          <td colSpan={14} className="px-2 pb-3 pt-1 text-[12px] text-zinc-400">
            <form className="mb-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save({ target: num(target), ...(num(max) !== c.max ? { max: num(max) } : {}) }); }}>
              <label className="text-[11.5px] text-zinc-400">Objetivo CPA<input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="ad-in mt-1 h-8 w-20 text-[13px]" /></label>
              <label className="text-[11.5px] text-zinc-400">Tope de puja<input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} className="ad-in mt-1 h-8 w-20 text-[13px]" /></label>
              <button className="ad-btn sm primary" disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar</button>
              {c.maxManual && c.frontLabel && <button type="button" className="ad-btn sm" disabled={busy} onClick={() => void save({ auto: true })}>Tope = {pct} % de {c.frontLabel}</button>}
              <span className="text-[11.5px] text-zinc-500">Piso {usd(c.floor)}{c.dailyBudget != null ? ` · presupuesto ${usd(c.dailyBudget)}/día` : ""} · tope {c.maxManual ? "a mano" : c.frontLabel ? `${pct} % de ${c.frontLabel}` : "sin oferta vinculada (1,5 × objetivo): no se sabe el precio del libro"}</span>
            </form>
            {err && <p className="mb-1 text-red-400">{err}</p>}
            {c.cpaAlert && <p className="mb-1 font-medium text-red-300">⚠️ CPA caro: {c.cpaAlert}{c.cpaAlertAt ? ` · ${ago(c.cpaAlertAt)}` : ""}</p>}
            {c.adsets.map((s) => (
              <p key={s.id} className="leading-snug">
                <b className="font-semibold text-zinc-300">{s.ladder ? `Escalón ${s.ladderPct != null ? `${Math.round(s.ladderPct * 100)} %` : ""}` : s.name ?? s.id}</b> · {usd(s.bid)} · {s.reason ?? "sin datos"}
                {s.lastChangeAt && <span className="text-zinc-500"> · último cambio {ago(s.lastChangeAt)}</span>}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

export default function PilotView({ enabled, ceilingPct, pressurePct, run, campaigns, changes }: {
  enabled: boolean; ceilingPct: number; pressurePct: number; run: RunView | null; campaigns: CampaignView[]; changes: ChangeView[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sim, setSim] = useState<PilotRun | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);
  // Orden de la tabla (tocando el título); se recuerda en este navegador.
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" } | null>(null);
  useEffect(() => { try { setSort(JSON.parse(localStorage.getItem(SORT_LS) ?? "null")); } catch { /* sin almacenamiento */ } }, []);
  const clickSort = (k: SortKey) => {
    const next = sort && sort.k === k ? { k, dir: sort.dir === "desc" ? "asc" as const : "desc" as const } : { k, dir: k === "name" || k === "state" || k === "cpa" ? "asc" as const : "desc" as const };
    setSort(next);
    try { localStorage.setItem(SORT_LS, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  };
  // Filtro por estado de la campaña en Meta (se recuerda) y la simulación que da el «próximo movimiento».
  const [show, setShow] = useState<"activas" | "pausadas" | "todas">("activas");
  useEffect(() => { try { const v = localStorage.getItem(SORT_LS + "-show"); if (v === "activas" || v === "pausadas" || v === "todas") setShow(v); } catch { /* sin almacenamiento */ } }, []);
  const pickShow = (v: "activas" | "pausadas" | "todas") => { setShow(v); try { localStorage.setItem(SORT_LS + "-show", v); } catch { /* sin almacenamiento */ } };
  const isOn = (c: CampaignView) => (c.metaStatus ?? c.status) === "ACTIVE";
  const counts = { activas: campaigns.filter(isOn).length, pausadas: campaigns.filter((c) => !isOn(c)).length, todas: campaigns.length };
  const [auto, setAuto] = useState<PilotRun | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/admin/pujas?simular=1", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (off) return;
      if (!r.ok) setAutoErr(j.error ?? `HTTP ${r.status}`); else setAuto(j as PilotRun);
    }).catch((e) => { if (!off) setAutoErr((e as Error).message); });
    return () => { off = true; };
  }, []);
  const nextOf = (c: CampaignView) => {
    if (!c.enabled) return <span className="text-zinc-500">No la toca (piloto apagado en esta)</span>;
    if (autoErr) return <span className="text-zinc-600" title={autoErr}>—</span>;
    if (!auto) return null;
    if (auto.skipped) return <span className="text-zinc-500">{auto.skipped}</span>;
    if (auto.error) return <span className="text-amber-300/90" title={auto.error}>Sin datos de Meta ahora{/limitó/.test(auto.error) ? " (límite de consultas)" : ""}: se reintenta solo</span>;
    const rows = auto.rows.filter((r) => r.campaignId === c.id);
    if (!rows.length) return <span className="text-zinc-500">Sin conjuntos activos</span>;
    const move = rows.find((r) => r.decision.action !== "hold") ?? rows[0];
    const d = move.decision;
    const txt = d.action === "raise" ? <span className="font-semibold text-emerald-400">↑ {usd(move.bid)} → {usd(d.newBid)}</span>
      : d.action === "lower" ? <span className="font-semibold text-red-400">↓ {usd(move.bid)} → {usd(d.newBid)}</span>
      : d.action === "pause" ? <span className="font-semibold text-amber-300">⚠️ Te avisa para apagar un escalón</span>
      : <span className="text-zinc-300">= Se queda en {usd(move.bid)}</span>;
    return <span className="block"><span className="block">{txt}</span><span className="block text-[11.5px] text-zinc-500">{d.reason}</span></span>;
  };
  const sorted0 = campaigns.filter((c) => show === "todas" || (show === "activas" ? isOn(c) : !isOn(c)));
  const sorted = !sort ? sorted0 : [...sorted0].sort((x, y) => {
    const a = rowNums(x)[sort.k], b = rowNums(y)[sort.k];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const r = typeof a === "string" ? a.localeCompare(b as string) : (a as number) - (b as number);
    return sort.dir === "asc" ? r : -r;
  });
  // El tope de puja como % del precio del libro: un solo número para todas las campañas.
  const [pct, setPct] = useState(String(ceilingPct));
  const [pctEdit, setPctEdit] = useState(false);
  const savePct = async () => {
    const n = Math.round(Number(pct.replace(",", ".")));
    if (!(n >= 30 && n <= 100)) { setMsg("El tope tiene que estar entre 30 y 100 % del precio."); return; }
    setBusy(true);
    try { const j = await post({ action: "ceiling", pct: n }); setMsg(j.ok); setPctEdit(false); router.refresh(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const toggle = async (v: boolean) => {
    if (!v && !window.confirm("¿Apagar el piloto? No va a cambiar ninguna puja hasta que lo vuelvas a encender.")) return;
    setBusy(true); setOn(v);
    try { const j = await post({ action: "global", enabled: v }); setMsg(j.ok); router.refresh(); }
    catch (e) { setOn(!v); setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const simulate = async () => {
    setSimBusy(true); setSimErr(null);
    try {
      const r = await fetch("/api/admin/pujas?simular=1", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSim(j as PilotRun);
    } catch (e) { setSimErr((e as Error).message); } finally { setSimBusy(false); }
  };

  return (
    <div className="grid gap-4">
      <section className="ad-card flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <Switch on={on} busy={busy} label="Piloto de pujas" onChange={toggle} />
        <div className="min-w-[200px] flex-1">
          <p className="text-[14px] font-semibold text-white">{on ? "Piloto encendido" : "Piloto apagado"}</p>
          <p className="text-[12.5px] text-zinc-400">
            {!run ? "Todavía no corrió: corre solo cada hora, a los 7 minutos." : run.skipped ? `Última pasada ${ago(run.at)}: no corrió (${run.skipped}).`
              : run.error ? `Última pasada ${ago(run.at)}: ${run.error}` : `Última pasada ${ago(run.at)} · ${run.changes} ${run.changes === 1 ? "cambio" : "cambios"}.`}
            {" "}Meta al {pressurePct} % del límite.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-zinc-300">
            {pctEdit ? (
              <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void savePct(); }}>
                Tope de puja =
                <input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Tope de puja en % del precio del libro" className="ad-in h-8 w-16 text-[13px]" />
                % del precio del libro
                <button className="ad-btn sm primary" disabled={busy}><Check className="h-3.5 w-3.5" /></button>
                <button type="button" className="ad-btn sm" onClick={() => { setPct(String(ceilingPct)); setPctEdit(false); }}><X className="h-3.5 w-3.5" /></button>
              </form>
            ) : (
              <>
                <span>Tope de puja = <b className="font-semibold text-white">{ceilingPct} % del precio del libro</b></span>
                <button type="button" onClick={() => setPctEdit(true)} className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"><Pencil className="h-3 w-3" /> Cambiar</button>
              </>
            )}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500">Arranca en el tope · sube 10 % cada 3 h si no gasta (menos de 3 USD en 3 h, sin ventas en 24 h) · una vez que vende, baja 10 % cada 3–4 días si va caro · escalera {Math.max(0, ceilingPct - 20)}/{ceilingPct - 10}/{ceilingPct} % para los ganadores · aviso si el CPA pasa el precio del libro.</p>
          {msg && <p className="mt-1 text-[12px] text-emerald-400">{msg}</p>}
        </div>
        <button type="button" className="ad-btn sm" onClick={simulate} disabled={simBusy}>
          {simBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Ver qué haría ahora
        </button>
      </section>

      {(sim || simErr) && (
        <section className="ad-card">
          <div className="ad-card-h"><div><h3>Simulación · ahora</h3><p>Lo que haría el piloto con los números de este momento. No cambia nada en Meta.</p></div>
            <button type="button" className="ad-btn sm ghost" onClick={() => { setSim(null); setSimErr(null); }}><X className="h-3.5 w-3.5" /></button></div>
          {simErr && <p className="px-5 pb-4 text-[12.5px] text-red-400">{simErr}</p>}
          {sim?.skipped && <p className="px-5 pb-4 text-[12.5px] text-amber-300">{sim.skipped}</p>}
          {sim?.error && <p className="px-5 pb-4 text-[12.5px] text-red-400">{sim.error}</p>}
          {sim && sim.alerts.length > 0 && (
            <ul className="m-0 grid list-none gap-1.5 px-4 pb-3 sm:px-5">
              {sim.alerts.map((a) => <li key={a.campaignId} className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">⚠️ CPA caro · <b className="font-semibold">{a.campaign}</b>: {a.body}</li>)}
            </ul>
          )}
          {sim && sim.rows.length > 0 && (
            <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
              {sim.rows.map((r) => (
                <li key={r.adsetId} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${r.decision.action === "raise" ? "bg-emerald-500/15 text-emerald-300" : r.decision.action === "lower" || r.decision.action === "pause" ? "bg-red-500/15 text-red-300" : "bg-white/5 text-zinc-500"}`}>
                    {r.decision.action === "raise" ? <ArrowUp className="h-3.5 w-3.5" /> : r.decision.action === "lower" ? <ArrowDown className="h-3.5 w-3.5" /> : r.decision.action === "pause" ? <X className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] font-semibold text-white">{r.campaign}</span>
                    <span className="block text-[12.5px] tabular-nums text-zinc-300">{r.decision.action === "pause" ? `Se apaga el escalón (puja ${usd(r.bid)})` : r.decision.newBid != null ? `${usd(r.bid)} → ${usd(r.decision.newBid)}` : `Se queda en ${usd(r.bid)}`}{!r.campaignEnabled ? " · campaña apagada en el piloto" : ""}</span>
                    <span className="block text-[11.5px] tabular-nums text-zinc-500">{r.ladder ? "Escalón (puja fija)" : `Tope ${usd(r.max)} ${r.maxManual ? "(a mano)" : r.frontLabel ? `(${ceilingPct} % de ${r.frontLabel})` : "(sin oferta vinculada)"}`} · 3 h {usd(r.spend3h)} · 24 h {usd(r.spend24h)} / {Math.round(r.purchases24h)} compras · 7 días {Math.round(r.purchases7d)} compras</span>
                    <span className="block text-[12px] leading-snug text-zinc-400">{r.decision.reason}</span>
                  </span>
                  <StateChip s={r.decision.state} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>Campañas con límite de puja · {campaigns.length}</h3><p>Tocá una fila para ver el motivo y editar objetivo o tope. <span className="text-amber-300">*</span> = sin oferta vinculada: el piloto no sabe el precio del libro.</p></div></div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
          <div role="group" aria-label="Estado" className="inline-flex rounded-full border border-zinc-700 p-0.5">
            {(["activas", "pausadas", "todas"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => pickShow(k)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${show === k ? "bg-white text-zinc-900" : "text-zinc-400 hover:text-white"}`}>
                {k === "activas" ? "Activas" : k === "pausadas" ? "Pausadas" : "Todas"} <span className="tabular-nums opacity-60">{counts[k]}</span>
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-zinc-500">{auto ? "Números según Meta (hoy desde las 0 h, hora de Argentina). «Próximo movimiento» = lo que haría el piloto si pasara ahora (pasa cada hora, a los :07)." : autoErr ? `No se pudo simular: ${autoErr}` : "Calculando el próximo movimiento…"}</span>
        </div>
        {campaigns.length ? (
          <div className="ad-scroll border-t border-white/[0.05]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                  <th colSpan={4} />
                  <th colSpan={3} className="border-l border-white/[0.06] px-2 pt-2 text-center font-semibold">Hoy</th>
                  <th colSpan={5} className="border-l border-white/[0.06] px-2 pt-2 text-center font-semibold">Últimos 3 días</th>
                  <th colSpan={2} />
                </tr>
                <tr className="text-[11.5px] text-zinc-500">
                  <th className="py-2 pl-3 pr-1 font-medium">Piloto</th>
                  {([["name", "Campaña"], ["bid", "Puja"], ["max", "Tope"], ["s1", "Gasto"], ["b1", "Compras"], ["r1", "ROAS"], ["s3", "Gasto"], ["b3", "Compras"], ["cpa", "CPA"], ["aov", "Ticket"], ["roas", "ROAS"], ["state", "Estado"]] as [SortKey, string][]).map(([k, l]) => (
                    <th key={k} className={`whitespace-nowrap px-1.5 py-2 font-medium ${k === "name" || k === "state" ? "" : "text-right"} ${k === "s1" || k === "s3" ? "border-l border-white/[0.06]" : ""}`}>
                      <button type="button" onClick={() => clickSort(k)} className={`inline-flex items-center gap-0.5 hover:text-white ${sort?.k === k ? "font-semibold text-white" : ""}`}>
                        {l}{sort?.k === k && (sort.dir === "desc" ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                      </button>
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium" title="Lo que haría el piloto si pasara ahora (simulación, no cambia nada)">Próximo movimiento</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => <CampaignRow key={c.id} c={c} pct={ceilingPct} next={nextOf(c)} onSaved={(m) => { setMsg(m); router.refresh(); }} />)}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 pb-5 text-[12.5px] text-zinc-400">Todavía no hay campañas: aparecen después de la primera pasada (o tocá «Ver qué haría ahora»).</p>}
      </section>

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>Historial de cambios</h3><p>Cada puja que cambió el piloto (y los errores), lo más nuevo arriba. Hora de Argentina.</p></div></div>
        {changes.length ? (
          <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
            {changes.map((h, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${h.action === "error" ? "bg-red-500/15 text-red-300" : h.action === "raise" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {h.action === "error" ? <X className="h-3.5 w-3.5" /> : h.action === "raise" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] font-semibold text-white">{h.campaign}</span>
                  <span className="block text-[12.5px] tabular-nums text-zinc-300">{usd(h.before)} → {usd(h.confirmed ?? h.after)}{h.applied && h.confirmed == null ? " (sin confirmar)" : ""}</span>
                  <span className="block text-[12px] leading-snug text-zinc-400">{h.reason}</span>
                </span>
                <span className="shrink-0 text-[11.5px] text-zinc-500">{when(h.at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 pb-5 text-[12.5px] text-zinc-400">Todavía no cambió ninguna puja.</p>}
      </section>
    </div>
  );
}
