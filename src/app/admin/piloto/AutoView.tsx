"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ChevronRight, CircleAlert, CirclePause, FlaskConical, Loader2, Power, Rocket, Trophy, X } from "lucide-react";
import type { AutoRun } from "@/lib/bid-pilot/autopilot";
import { PANEL_TZ } from "@/lib/admin/range";
import { Switch } from "../pujas/PilotView";

/**
 * Las secciones CBO, Ganadores e Historial del Piloto Meta Ads: los
 * interruptores, «Ver qué haría ahora» (simulación: lee Meta y no cambia
 * nada) y lo que guardó la última pasada. Guarda con fetch común.
 */

export type AutoRunView = { at: string; ok: boolean; skipped: string | null; error: string | null; paused: number; proposed: number };
export type CboView = {
  id: string; accountId: string; name: string; guard: boolean; status: string | null; dailyBudget: number | null;
  evalAt: string | null; spend: number | null; revenue: number | null; roas: number | null; source: string | null; daysRun: number | null;
  verdict: string | null; reason: string | null; autoPausedAt: string | null;
};
export type WinnerView = {
  adId: string; accountId: string; campaignId: string; campaign: string; ad: string; status: string;
  proposedAt: string; expiresAt: string; spend: number; purchases: number; cpa: number | null; target: number; daysRun: number;
  newName: string | null; newCampaignId: string | null; error: string | null;
};
export type LogView = { id: number; at: string; kind: string; title: string; body: string | null; link: string | null };

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const x2 = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "");
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

function Chip({ tone, children }: { tone: "red" | "amber" | "green" | "violet" | "zinc" | "sky"; children: React.ReactNode }) {
  const cls = {
    red: "bg-red-500/15 text-red-300 ring-red-500/25", amber: "bg-amber-500/15 text-amber-300 ring-amber-500/25",
    green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25", violet: "bg-violet-500/15 text-violet-300 ring-violet-500/25",
    sky: "bg-sky-500/15 text-sky-300 ring-sky-500/25", zinc: "bg-white/5 text-zinc-300 ring-white/10",
  }[tone];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[11.5px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}
function Num({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <span><span className="block text-[11px] text-zinc-500">{label}</span><b className={`text-[13px] font-semibold tabular-nums ${tone ?? "text-zinc-200"}`}>{value}</b></span>;
}

async function post(body: unknown) {
  const r = await fetch("/api/admin/piloto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

function runText(run: AutoRunView | null) {
  if (!run) return "Todavía no corrió: corre solo todos los días a las 09:17.";
  if (run.skipped) return `Última pasada ${ago(run.at)}: no corrió (${run.skipped}).`;
  if (run.error) return `Última pasada ${ago(run.at)}: ${run.error}`;
  return `Última pasada ${ago(run.at)} · ${run.paused} ${run.paused === 1 ? "CBO apagada" : "CBO apagadas"} · ${run.proposed} ${run.proposed === 1 ? "ganador propuesto" : "ganadores propuestos"}.`;
}

/** El encabezado de cada sección: su interruptor, la última pasada y «Ver qué haría ahora». */
function Head({ which, on: initial, title, run, pressurePct, onSim }: {
  which: "cboGuard" | "winners"; on: boolean; title: string; run: AutoRunView | null; pressurePct: number; onSim: (r: AutoRun | null, err: string | null) => void;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async (v: boolean) => {
    if (!v && !window.confirm(which === "cboGuard" ? "¿Apagar la guardia? No va a apagar ninguna CBO hasta que la vuelvas a encender." : "¿Dejar de proponer ganadores?")) return;
    setBusy(true); setOn(v);
    try { await post({ action: "settings", [which]: v }); setMsg(v ? "Encendido" : "Apagado"); router.refresh(); }
    catch (e) { setOn(!v); setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const simulate = async () => {
    setSimBusy(true);
    try {
      const r = await fetch("/api/admin/piloto?simular=1", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      onSim(j as AutoRun, null);
    } catch (e) { onSim(null, (e as Error).message); } finally { setSimBusy(false); }
  };
  return (
    <section className="ad-card flex flex-wrap items-center gap-4 p-4 sm:p-5">
      <Switch on={on} busy={busy} label={title} onChange={toggle} />
      <div className="min-w-[200px] flex-1">
        <p className="text-[14px] font-semibold text-white">{title} {on ? "encendida" : "apagada"}</p>
        <p className="text-[12.5px] text-zinc-400">{runText(run)} Meta al {pressurePct} % del límite.</p>
        {msg && <p className="mt-1 text-[12px] text-emerald-400">{msg}</p>}
      </div>
      <button type="button" className="ad-btn sm" onClick={simulate} disabled={simBusy}>
        {simBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Ver qué haría ahora
      </button>
    </section>
  );
}

function SimCard({ sim, err, onClose, children }: { sim: AutoRun | null; err: string | null; onClose: () => void; children?: React.ReactNode }) {
  return (
    <section className="ad-card">
      <div className="ad-card-h"><div><h3>Simulación · ahora</h3><p>Con los números de Meta de este momento. No cambia nada en Meta ni en el panel.</p></div>
        <button type="button" aria-label="Cerrar" className="ad-btn sm ghost" onClick={onClose}><X className="h-3.5 w-3.5" /></button></div>
      {err && <p className="px-5 pb-4 text-[12.5px] text-red-400">{err}</p>}
      {sim?.skipped && <p className="px-5 pb-4 text-[12.5px] text-amber-300">{sim.skipped}</p>}
      {sim?.error && <p className="px-5 pb-4 text-[12.5px] text-red-400">{sim.error}</p>}
      {children}
    </section>
  );
}

const VERDICT: Record<string, [string, "red" | "amber" | "green" | "violet" | "zinc" | "sky"]> = {
  paused: ["Apagada por la guardia", "red"], pause: ["Para apagar", "red"], over_limit: ["Para apagar (pasó el máximo)", "amber"],
  keep: ["Sigue", "green"], skip: ["No aplica", "zinc"],
};

// ------------------------------------------------------------------------ CBO

export function CboTab({ on, pressurePct, run, rows, log }: { on: boolean; pressurePct: number; run: AutoRunView | null; rows: CboView[]; log: LogView[] }) {
  const router = useRouter();
  const [sim, setSim] = useState<AutoRun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <Head which="cboGuard" on={on} title="Guardia de CBO" run={run} pressurePct={pressurePct} onSim={(r, e) => { setSim(r); setErr(e); }} />
      <p className="px-1 text-[12.5px] leading-relaxed text-zinc-400">
        Una vez por día (09:17) te avisa (con push) cada CBO activa que en los últimos 3 días completos corrió los 3, gastó 150 USD o más y tiene ROAS menor que 1. No la apaga: la apagás vos con su interruptor en Inicio.
        El ROAS es con las ventas reales de acá (con bumps y OTOs, menos reembolsos) si la campaña manda a un checkout de acá; si no, con el valor de Meta.
        Nunca toca las BID CAP.
      </p>

      {(sim || err) && (
        <SimCard sim={sim} err={err} onClose={() => { setSim(null); setErr(null); }}>
          {sim && sim.guardWindow && <p className="px-5 pb-3 text-[12px] text-zinc-500">Días completos: {day(sim.guardWindow.since)} al {day(sim.guardWindow.until)} · guardia {sim.settings.cbo_guard ? "encendida" : "apagada (no apagaría nada)"}.</p>}
          {sim && !sim.cbo.length && !sim.error && !sim.skipped && <p className="px-5 pb-4 text-[12.5px] text-zinc-400">No hay CBO activas.</p>}
          {sim && sim.cbo.length > 0 && (
            <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
              {sim.cbo.map((r) => {
                const [label, tone] = VERDICT[r.outcome] ?? VERDICT.skip;
                return (
                  <li key={r.campaignId} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 break-words text-[13px] font-semibold text-white">{r.name}</span>
                      <Chip tone={tone}>{label}</Chip>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <Num label="Gasto 3 días" value={usd(r.spend)} />
                      <Num label={r.source === "real" ? "Ventas reales" : "Valor de Meta"} value={usd(r.revenue)} />
                      <Num label="ROAS" value={x2(r.roas)} tone={r.roas == null ? "text-zinc-500" : r.roas < 1 ? "text-red-400" : "text-emerald-400"} />
                      <Num label="Días corridos" value={`${r.verdict.daysRun} de 3`} />
                      <Num label={r.source === "real" ? "Valor de Meta" : "Ventas reales"} value={r.source === "real" ? usd(r.metaRevenue) : usd(r.realRevenue)} tone="text-zinc-400" />
                    </div>
                    <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">{r.verdict.reason} <span className="text-zinc-500">{r.sourceNote}.</span></p>
                    <p className="mt-0.5 text-[11.5px] tabular-nums text-zinc-500">Por día: {r.days.map((d, i) => `${day(d)} ${usd(r.daySpend[i])}`).join(" · ")}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </SimCard>
      )}

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>CBO activas · {rows.length}</h3><p>Lo que vio la última pasada. El interruptor de cada una la saca de la guardia.</p></div></div>
        {rows.length ? (
          <ul className="m-0 list-none border-t border-white/[0.05] p-0">
            {rows.map((c) => <CboRow key={c.id} c={c} onSaved={() => router.refresh()} />)}
          </ul>
        ) : <p className="px-5 pb-5 text-[12.5px] text-zinc-400">Todavía no hay datos: aparecen después de la primera pasada (o tocá «Ver qué haría ahora»).</p>}
      </section>

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>CBO para apagar</h3><p>Cada aviso de la guardia (y las que apagó antes del 07/10, cuando apagaba sola). Hora de Argentina.</p></div></div>
        <LogItems rows={log} empty="Todavía no apagó ninguna CBO." />
      </section>
    </div>
  );
}

function CboRow({ c, onSaved }: { c: CboView; onSaved: () => void }) {
  const [guard, setGuard] = useState(c.guard);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [label, tone] = VERDICT[c.verdict ?? ""] ?? ["Sin evaluar", "zinc"];
  const save = async (v: boolean) => {
    setBusy(true); setErr(null); setGuard(v);
    try { await post({ action: "cbo", campaignId: c.id, guard: v }); onSaved(); }
    catch (e) { setGuard(!v); setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className="border-t border-white/[0.05] px-4 py-3.5 first:border-t-0 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-[13.5px] font-semibold text-white">{c.name}</span>
            <Chip tone={tone}>{label}</Chip>
            {c.status && c.status !== "ACTIVE" && c.verdict !== "paused" && <Chip tone="zinc">{c.status === "PAUSED" ? "Pausada" : c.status}</Chip>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Num label="Gasto 3 días" value={usd(c.spend)} />
            <Num label={c.source === "real" ? "Ventas reales" : "Valor de Meta"} value={usd(c.revenue)} />
            <Num label="ROAS" value={x2(c.roas)} tone={c.roas == null ? "text-zinc-500" : c.roas < 1 ? "text-red-400" : "text-emerald-400"} />
            <Num label="Presupuesto" value={c.dailyBudget == null ? "—" : `${usd(c.dailyBudget)}/día`} />
          </div>
          {c.reason && <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">{c.reason}</p>}
          {c.evalAt && <p className="mt-0.5 text-[11.5px] text-zinc-500">Evaluada {ago(c.evalAt)}{c.autoPausedAt ? ` · la apagó la guardia el ${when(c.autoPausedAt)}` : ""}</p>}
          {err && <p className="mt-1 text-[12px] text-red-400">{err}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch on={guard} busy={busy} label={`Guardia en ${c.name}`} onChange={(v) => void save(v)} />
          <span className="text-[11px] text-zinc-500">{guard ? "La cuida" : "No la toca"}</span>
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ ganadores

const WSTATUS: Record<string, [string, "red" | "amber" | "green" | "violet" | "zinc" | "sky"]> = {
  proposed: ["Pendiente", "amber"], creating: ["Creando…", "sky"], created: ["BID CAP creada", "green"],
  dismissed: ["Descartado", "zinc"], expired: ["Venció", "zinc"], failed: ["Falló", "red"],
};

export function WinnersTab({ on, pressurePct, run, rows }: { on: boolean; pressurePct: number; run: AutoRunView | null; rows: WinnerView[] }) {
  const [sim, setSim] = useState<AutoRun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qualifying = sim?.winners.filter((w) => w.verdict.qualifies) ?? [];
  // Los que no llegan, con compras: primero los que ya están en BID CAP o propuestos, después los demás.
  const near = sim?.winners.filter((w) => !w.verdict.qualifies && w.verdict.purchases > 0)
    .sort((a, b) => Number(["in_bid_cap", "proposed"].includes(b.verdict.rule)) - Number(["in_bid_cap", "proposed"].includes(a.verdict.rule)) || b.verdict.purchases - a.verdict.purchases)
    .slice(0, 12) ?? [];
  return (
    <div className="grid gap-4">
      <Head which="winners" on={on} title="Propuesta de ganadores" run={run} pressurePct={pressurePct} onSim={(r, e) => { setSim(r); setErr(e); }} />
      <p className="px-1 text-[12.5px] leading-relaxed text-zinc-400">
        Una vez por día mira los anuncios activos de las CBO activas: el que en los últimos 7 días completos corrió 3 o más, tuvo 10 compras o más y un CPA en el objetivo
        (USA 15 USD, el resto 10) te llega una sola vez para pasarlo a BID CAP. Se arma en escalera: 3 conjuntos con el mismo posteo y pujas fijas al 50, 60 y 70 % del precio del libro. La propuesta vence a las 48 h. Nada se crea sin que toques «Pasar a BID CAP».
      </p>

      {(sim || err) && (
        <SimCard sim={sim} err={err} onClose={() => { setSim(null); setErr(null); }}>
          {sim && sim.winWindow && <p className="px-5 pb-3 text-[12px] text-zinc-500">Días completos: {day(sim.winWindow.since)} al {day(sim.winWindow.until)} · {qualifying.length} {qualifying.length === 1 ? "ganador" : "ganadores"}.</p>}
          {sim && !sim.error && !sim.skipped && !qualifying.length && <p className="px-5 pb-3 text-[12.5px] text-zinc-400">Hoy ningún anuncio cumple las tres condiciones.</p>}
          {[...qualifying, ...near].length > 0 && (
            <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
              {[...qualifying, ...near].map((w) => (
                <li key={w.adId} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-[13px] font-semibold text-white">{w.ad} <span className="font-normal text-zinc-500">· {w.campaign}</span></span>
                    <Chip tone={w.verdict.qualifies ? "green" : w.verdict.rule === "proposed" || w.verdict.rule === "in_bid_cap" ? "violet" : "zinc"}>{w.verdict.qualifies ? "Ganador" : w.verdict.rule === "proposed" ? "Ya propuesto" : w.verdict.rule === "in_bid_cap" ? "Ya en BID CAP" : "Todavía no"}</Chip>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Num label="Compras 7 días" value={String(Math.round(w.verdict.purchases))} />
                    <Num label="CPA" value={usd(w.verdict.cpa)} tone={w.verdict.cpa == null ? "text-zinc-500" : w.verdict.cpa <= w.target ? "text-emerald-400" : "text-red-400"} />
                    <Num label="Objetivo" value={usd(w.target)} />
                    <Num label="Gasto · días" value={`${usd(w.verdict.spend)} · ${w.verdict.daysRun}`} />
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">{w.verdict.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </SimCard>
      )}

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>Propuestas · {rows.length}</h3><p>Las pendientes arriba. Tocá una para ver los números y decidir.</p></div></div>
        {rows.length ? (
          <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
            {rows.map((w) => {
              const [label, tone] = WSTATUS[w.status] ?? [w.status, "zinc"];
              return (
                <li key={w.adId}>
                  <Link href={`/admin/piloto/ganador/${w.adId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] sm:px-5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300"><Trophy className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="break-words text-[13px] font-semibold text-white">{w.ad}</span><Chip tone={tone}>{label}</Chip></span>
                      <span className="block break-words text-[12px] text-zinc-500">{w.campaign}</span>
                      <span className="block text-[12.5px] tabular-nums text-zinc-300">CPA {usd(w.cpa)} (obj. {usd(w.target)}) · {Math.round(w.purchases)} compras · {usd(w.spend)} en {w.daysRun} días</span>
                      {w.newName && <span className="block break-words text-[12px] text-emerald-400">→ {w.newName}</span>}
                      {w.status === "failed" && w.error && <span className="block break-words text-[12px] text-red-400">{w.error}</span>}
                      <span className="block text-[11.5px] text-zinc-500">Propuesto {when(w.proposedAt)}{w.status === "proposed" ? ` · vence ${when(w.expiresAt)}` : ""}</span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-600" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-5 pb-5 text-[12.5px] text-zinc-400">Todavía no propuso ningún ganador.</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ historial

const KIND: Record<string, { icon: React.ReactNode; cls: string }> = {
  bid_change: { icon: <ArrowDown className="h-3.5 w-3.5 rotate-180" />, cls: "bg-emerald-500/15 text-emerald-300" },
  cbo_paused: { icon: <CirclePause className="h-3.5 w-3.5" />, cls: "bg-red-500/15 text-red-300" },
  cbo_over_limit: { icon: <CircleAlert className="h-3.5 w-3.5" />, cls: "bg-amber-500/15 text-amber-300" },
  winner_proposed: { icon: <Trophy className="h-3.5 w-3.5" />, cls: "bg-amber-500/15 text-amber-300" },
  winner_dismissed: { icon: <X className="h-3.5 w-3.5" />, cls: "bg-white/5 text-zinc-400" },
  bidcap_created: { icon: <Rocket className="h-3.5 w-3.5" />, cls: "bg-emerald-500/15 text-emerald-300" },
  bidcap_failed: { icon: <CircleAlert className="h-3.5 w-3.5" />, cls: "bg-red-500/15 text-red-300" },
  cpa_alert: { icon: <CircleAlert className="h-3.5 w-3.5" />, cls: "bg-red-500/15 text-red-300" },
  ladder_paused: { icon: <CirclePause className="h-3.5 w-3.5" />, cls: "bg-red-500/15 text-red-300" },
  manual_status: { icon: <Power className="h-3.5 w-3.5" />, cls: "bg-white/5 text-zinc-300" },
  manual_edit: { icon: <Power className="h-3.5 w-3.5" />, cls: "bg-white/5 text-zinc-300" },
  error: { icon: <CircleAlert className="h-3.5 w-3.5" />, cls: "bg-red-500/15 text-red-300" },
};

function LogItems({ rows, empty }: { rows: LogView[]; empty: string }) {
  if (!rows.length) return <p className="px-5 pb-5 text-[12.5px] text-zinc-400">{empty}</p>;
  return (
    <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0">
      {rows.map((h) => {
        const k = KIND[h.kind] ?? KIND.error;
        const down = h.kind === "bid_change" && h.title.startsWith("↓");
        const inner = (
          <>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${down ? "bg-amber-500/15 text-amber-300" : k.cls}`}>
              {down ? <ArrowDown className="h-3.5 w-3.5" /> : k.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[13px] font-semibold text-white">{h.title}</span>
              {h.body && <span className="block break-words text-[12px] leading-snug text-zinc-400">{h.body}</span>}
            </span>
            <span className="shrink-0 text-[11.5px] text-zinc-500">{when(h.at)}</span>
          </>
        );
        return (
          <li key={h.id}>
            {h.link ? <Link href={h.link} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] sm:px-5">{inner}</Link>
              : <div className="flex items-start gap-3 px-4 py-3 sm:px-5">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function HistoryList({ rows }: { rows: LogView[] }) {
  return (
    <section className="ad-card">
      <div className="ad-card-h"><div><h3>Historial</h3><p>Todo lo que hizo solo el piloto: cambios de puja, CBO apagadas, ganadores, BID CAP creadas y errores. Hora de Argentina.</p></div></div>
      <LogItems rows={rows} empty="Todavía no hizo nada." />
    </section>
  );
}
