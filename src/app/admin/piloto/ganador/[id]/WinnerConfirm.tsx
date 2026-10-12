"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ExternalLink, Loader2, Rocket, Search, X } from "lucide-react";
import type { BidCapPlan } from "@/lib/bid-pilot/bidcap";
import { PANEL_TZ } from "@/lib/admin/range";

/** Los números del ganador, lo que se va a crear y los dos botones. Fetch común a /api/admin/piloto. */

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "");
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "") : "—");

const STATUS: Record<string, string> = {
  created: "Ya se pasó a BID CAP.", dismissed: "La descartaste: no se vuelve a proponer.", expired: "La propuesta venció (48 h): no se creó nada.",
  failed: "Falló al crearla: lo que se llegó a crear quedó pausado.", creating: "Se está creando…",
};

export default function WinnerConfirm({ adId, act, status, numbers: n, plan, proposedAt, expiresAt, error, created, adsManager }: {
  adId: string; act: string; status: string;
  numbers: { spend: number; purchases: number; cpa: number | null; target: number; daysRun: number; since: string | null; until: string | null };
  /** rungs: los 3 escalones (% del precio del libro y puja fija); vacío si la CBO no está vinculada a un checkout de acá. */
  plan: { name: string; market: string; offer: string; budget: number; frontLabel: string | null; rungs: { pct: number; bid: number }[] };
  proposedAt: string; expiresAt: string; error: string | null;
  created: { name: string; url: string } | null; adsManager: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [plan2, setPlan2] = useState<BidCapPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  // «Ver exactamente qué se crea»: lee Meta (no crea nada) y muestra lo que se mandaría.
  const loadPlan = async () => {
    setPlanBusy(true); setPlanErr(null);
    try {
      const r = await fetch(`/api/admin/piloto?plan=${adId}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPlan2(j as BidCapPlan);
    } catch (e) { setPlanErr((e as Error).message); } finally { setPlanBusy(false); }
  };
  const tg = (() => { try { return plan2 ? JSON.parse(plan2.adset.targeting ?? "{}") as Record<string, unknown> : null; } catch { return null; } })();
  const pending = status === "proposed" && !msg?.ok;

  const decide = async (decision: "accept" | "dismiss") => {
    if (decision === "accept" && !window.confirm(`¿Crear «${plan.name}» en escalera (${plan.rungs.map((r) => usd(r.bid)).join(" / ")}) con ${usd(plan.budget)} por día y prenderla?`)) return;
    setBusy(decision); setMsg(null);
    try {
      const r = await fetch("/api/admin/piloto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "winner", adId, decision }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMsg(decision === "accept"
        ? { ok: true, text: `Listo: «${j.name}» creada y prendida. El piloto de pujas la maneja desde la próxima hora.`, url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${j.campaignId}` }
        : { ok: true, text: "Descartado: no se vuelve a proponer." });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 border-t border-white/[0.05] px-4 py-2.5 first:border-t-0 sm:px-5">
      <span className="text-[12.5px] text-zinc-400">{k}</span><span className="min-w-0 break-words text-right text-[13px] font-medium text-zinc-100">{v}</span>
    </div>
  );

  return (
    <div className="grid gap-4">
      <section className="ad-card p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <span><span className="block text-[11.5px] text-zinc-500">CPA</span><b className="text-[22px] font-semibold tabular-nums text-emerald-400">{usd(n.cpa)}</b><span className="block text-[11.5px] text-zinc-500">objetivo {usd(n.target)}</span></span>
          <span><span className="block text-[11.5px] text-zinc-500">Compras</span><b className="text-[22px] font-semibold tabular-nums text-white">{Math.round(n.purchases)}</b><span className="block text-[11.5px] text-zinc-500">según Meta</span></span>
          <span><span className="block text-[11.5px] text-zinc-500">Gasto</span><b className="text-[22px] font-semibold tabular-nums text-white">{usd(n.spend)}</b><span className="block text-[11.5px] text-zinc-500">en {n.daysRun} días</span></span>
          <span><span className="block text-[11.5px] text-zinc-500">Ventana</span><b className="text-[15px] font-semibold text-white">{day(n.since)} – {day(n.until)}</b><span className="block text-[11.5px] text-zinc-500">días completos</span></span>
        </div>
        <p className="mt-3 text-[12px] text-zinc-500">Propuesto {when(proposedAt)}{status === "proposed" ? ` · vence ${when(expiresAt)}` : ""} · <a href={adsManager} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300">ver el anuncio en Meta <ExternalLink className="h-3 w-3" /></a></p>
      </section>

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>Lo que se crea</h3><p>Todo pausado primero; se revisa y recién ahí se prende. Si algo falla, queda pausado y te avisa.</p></div></div>
        <div className="border-t border-white/[0.05]">
          <Row k="Campaña" v={plan.name} />
          <Row k="Mercado · oferta" v={`${plan.market} · ${plan.offer}`} />
          <Row k="Estrategia" v={plan.rungs.length
            ? `Ventas · escalera de 3 conjuntos con puja fija: ${plan.rungs.map((r) => `${Math.round(r.pct * 100)} % ${usd(r.bid)}`).join(" · ")} (libro ${plan.frontLabel})`
            : <span className="text-amber-300">Sin el precio del libro: la CBO no está vinculada a un checkout de acá, así que no se puede armar la escalera.</span>} />
          <Row k="Presupuesto" v={`${usd(plan.budget)} por día`} />
          <Row k="Anuncio" v="El mismo posteo del ganador (suma sus me gusta y comentarios)" />
          <Row k="Público" v="El del conjunto ganador, sin Advantage+, excluyendo a los compradores" />
          <Row k="Ubicaciones" v="Facebook + Instagram (manual)" />
          <Row k="Mejoras de Meta" v="Solo comentarios relevantes y mejorar la CTA" />
          <Row k="Después" v="El piloto no mueve esas pujas: apaga el escalón cuyo CPA de 3 días pase el precio del libro, y te avisa" />
        </div>
        <div className="border-t border-white/[0.05] px-4 py-3 sm:px-5">
          {!plan2 && (
            <button type="button" className="ad-btn sm" onClick={() => void loadPlan()} disabled={planBusy}>
              {planBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Ver exactamente qué se crea
            </button>
          )}
          {planErr && <p className="mt-2 text-[12.5px] text-red-400">{planErr}</p>}
          {plan2 && (
            <div className="grid gap-1.5 text-[12.5px] text-zinc-300">
              {plan2.dupCampaign && <p className="text-amber-300">Su posteo ya corre en una BID CAP (campaña {plan2.dupCampaign}): no se crearía otra.</p>}
              {plan2.problems.map((p) => <p key={p} className="text-red-400">No se puede: {p}.</p>)}
              <p><span className="text-zinc-500">Excluye:</span> {plan2.exclude.map((a) => a.name ?? a.id).join(", ") || "—"}</p>
              {plan2.rungs.length > 0 && <p><span className="text-zinc-500">Escalera:</span> {plan2.rungs.map((r) => `${r.name} → ${usd(r.bid)}`).join(" · ")} <span className="text-zinc-500">(libro {plan2.frontLabel})</span></p>}
              <p><span className="text-zinc-500">Pixel:</span> {plan2.pixel ?? "—"} · <span className="text-zinc-500">optimiza:</span> {plan2.adset.optimization_goal}</p>
              <p><span className="text-zinc-500">Países:</span> {((tg?.geo_locations as { countries?: string[] } | undefined)?.countries ?? []).join(", ") || "—"} · <span className="text-zinc-500">edades:</span> {String(tg?.age_min ?? "—")}–{String(tg?.age_max ?? "—")}</p>
              <p><span className="text-zinc-500">Ubicaciones:</span> {((tg?.publisher_platforms as string[] | undefined) ?? []).join(" + ")} · <span className="text-zinc-500">Advantage+:</span> no</p>
              <p><span className="text-zinc-500">DSA:</span> {plan2.dsa ? `${plan2.dsa.b} / ${plan2.dsa.p}` : "no hace falta"}</p>
              <p><span className="text-zinc-500">Posteo:</span> {plan2.creative.object_story_id ?? "—"}</p>
              <details className="mt-1"><summary className="cursor-pointer text-zinc-500">Lo que se le manda a Meta</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 text-[11px] text-zinc-400">{JSON.stringify({ creative: plan2.creative, campaign: plan2.campaign, adset: { ...plan2.adset, targeting: tg } }, null, 1)}</pre>
              </details>
            </div>
          )}
        </div>
      </section>

      {msg && (
        <p className={`rounded-xl px-4 py-3 text-[13px] ${msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          {msg.text} {msg.url && <a href={msg.url} target="_blank" rel="noreferrer" className="underline">Abrir en Meta</a>}
        </p>
      )}
      {!pending && !msg && (
        <p className="rounded-xl bg-white/[0.04] px-4 py-3 text-[13px] text-zinc-300">
          {STATUS[status] ?? status}{status === "failed" && error ? ` ${error}` : ""}
          {created && <> · <a href={created.url} target="_blank" rel="noreferrer" className="text-violet-400 underline">«{created.name}» en Meta</a></>}
        </p>
      )}
      {pending && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ad-btn primary" disabled={!!busy} onClick={() => void decide("accept")}>
            {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Pasar a BID CAP
          </button>
          <button type="button" className="ad-btn" disabled={!!busy} onClick={() => void decide("dismiss")}>
            {busy === "dismiss" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Ahora no
          </button>
          {busy === "accept" && <span className="self-center text-[12px] text-zinc-400">Creando y revisando en Meta (puede tardar unos 20 s)…</span>}
        </div>
      )}
      <Link href="/admin/piloto?tab=ganadores" className="inline-flex items-center gap-1 text-[12.5px] text-zinc-400 hover:text-zinc-200"><Check className="h-3.5 w-3.5" /> Volver a los ganadores</Link>
    </div>
  );
}
