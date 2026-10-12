"use client";

import { useState } from "react";
import { CalendarClock, ChevronRight, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import type { CampaignDetail, DetailCreative } from "@/lib/admin/campaign-detail";
import { Pv } from "./Priv";

export type NewCampaign = {
  id: string; name: string; kind: "programada" | "pausada_programada" | "sin_gastar" | "pausada" | "lanzada";
  start: string | null; created: string | null; budget: number | null; spent: number; ads: number | null; offer: string | null; linked: boolean;
};

const KIND: Record<NewCampaign["kind"], [string, string]> = {
  programada: ["Programada", "bg-sky-500/15 text-sky-300 ring-sky-500/25"],
  pausada_programada: ["Programada · pausada", "bg-amber-500/15 text-amber-300 ring-amber-500/25"],
  sin_gastar: ["Activa · sin gastar todavía", "bg-violet-500/15 text-violet-300 ring-violet-500/25"],
  pausada: ["Pausada · sin prender", "bg-amber-500/15 text-amber-300 ring-amber-500/25"],
  lanzada: ["Lanzada hoy", "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25"],
};
const OPT: Record<string, string> = { OFFSITE_CONVERSIONS: "Conversiones (compra en la web)", LINK_CLICKS: "Clics", LANDING_PAGE_VIEWS: "Visitas a la página", VALUE: "Valor de compra", REACH: "Alcance" };
const STRAT: Record<string, string> = { LOWEST_COST_WITHOUT_CAP: "Volumen más alto (sin tope)", LOWEST_COST_WITH_BID_CAP: "Límite de puja (BID CAP)", COST_CAP: "Límite de costo", LOWEST_COST_WITH_MIN_ROAS: "ROAS mínimo" };
const usd = (n: number | null | undefined) => (n == null ? "—" : `US$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`);
const fdate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function Creative({ c }: { c: DetailCreative }) {
  const [play, setPlay] = useState(false);
  const thumb = c.thumb || (c.driveId ? `https://drive.google.com/thumbnail?id=${c.driveId}&sz=w400` : null);
  return (
    <div className="w-[150px] shrink-0">
      <div className="relative overflow-hidden rounded-xl bg-zinc-900" style={{ aspectRatio: c.kind === "video" ? "9 / 16" : "1 / 1" }}>
        {play && c.driveId ? (
          <iframe src={`https://drive.google.com/file/d/${c.driveId}/preview`} title={c.title} allow="autoplay; fullscreen" allowFullScreen className="absolute inset-0 h-full w-full border-0" />
        ) : (
          <button type="button" onClick={() => setPlay(true)} className="group absolute inset-0 flex items-center justify-center" aria-label={`Ver ${c.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb && <img data-pv-img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition-transform group-hover:scale-110"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
          </button>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-zinc-300" title={c.title}>{c.title}</p>
      <p className="text-[10.5px] text-zinc-500">{[c.angle, c.status].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

function Detail({ d, onRefresh, busy }: { d: CampaignDetail; onRefresh: () => void; busy: boolean }) {
  const act = (process.env.NEXT_PUBLIC_META_AD_ACCOUNT ?? "").replace(/^act_/, "");
  return (
    <div className="grid gap-4 px-4 pb-4 pt-1 text-[12.5px] text-zinc-300 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-400">
        <span>Objetivo: <b className="text-zinc-200">{d.objective === "OUTCOME_SALES" ? "Ventas" : d.objective ?? "—"}</b></span>
        <span>Presupuesto: <b className="text-zinc-200">{d.budget ? `${usd(d.budget)}/día (CBO)` : "en los conjuntos"}</b></span>
        <span>Puja: <b className="text-zinc-200">{d.strategy ? STRAT[d.strategy] ?? d.strategy : "—"}</b></span>
        {d.offer && <span>Oferta: <b className="text-zinc-200"><Pv as="Oferta">{d.offer.name}</Pv></b>{!d.offer.linked && <span className="text-amber-300" title="No está vinculada al checkout: su gasto no cuenta en la oferta"> · sin vincular</span>}</span>}
        <span className="ml-auto flex items-center gap-2">
          <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_campaign_ids=${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-300 hover:underline">Abrir en Meta <ExternalLink className="h-3 w-3" /></a>
          <button type="button" onClick={onRefresh} disabled={busy} title={`Leído de Meta ${fdate(d.fetchedAt)}`} className="inline-flex items-center gap-1 text-zinc-400 hover:text-white disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Volver a leer</button>
        </span>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Conjuntos · {d.adsets.length}</p>
        <div className="grid gap-2">
          {d.adsets.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="font-semibold text-white"><Pv as="Conjunto">{s.name}</Pv> <span className="ml-1 text-[11px] font-normal text-zinc-500">{s.status}</span></p>
              <div className="mt-1 grid gap-x-4 gap-y-0.5 text-[12px] text-zinc-400 sm:grid-cols-2">
                <span>Arranca: <b className="text-zinc-200">{fdate(s.start)}</b>{s.end && <> · termina {fdate(s.end)}</>}</span>
                <span>Optimiza: <b className="text-zinc-200">{s.optimization ? OPT[s.optimization] ?? s.optimization : "—"}</b>{s.event && <> · {s.event === "PURCHASE" ? "Compra" : s.event}</>}</span>
                {(s.budget || s.bid) && <span>{s.budget && <>Presupuesto {usd(s.budget)}/día</>}{s.budget && s.bid && " · "}{s.bid && <>Puja máx. {usd(s.bid)}</>}</span>}
                <span>Países: <b className="text-zinc-200">{s.countries.join(", ") || "—"}</b>{s.ages && <> · {s.ages} años</>}{s.genders && <> · {s.genders}</>}{s.advantage && <> · Advantage+</>}</span>
                <span>Ubicaciones: {s.placements.join(", ")}</span>
                <span className={s.excluded.length ? "" : "text-amber-300"}>Excluye: {s.excluded.length ? s.excluded.join(", ") : "nadie (¿falta excluir compradores?)"}</span>
                {s.included.length > 0 && <span>Públicos: {s.included.join(", ")}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Anuncios · {d.ads.length} <span className="normal-case tracking-normal text-zinc-600">(la vista previa es la de Meta: tocá para reproducir)</span></p>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {d.ads.map((a) => (
            <div key={a.id} className="w-[290px] shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <p className="truncate text-[12px] font-semibold text-white" title={a.name}><Pv as="Anuncio">{a.name}</Pv></p>
              <p className="text-[10.5px] text-zinc-500">{a.effective}{a.issues && <span className="text-red-400"> · {a.issues}</span>}</p>
              {a.preview ? (
                <iframe src={a.preview} title={a.name} loading="lazy" className="mt-2 h-[460px] w-full rounded-lg border-0 bg-white" />
              ) : a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt="" referrerPolicy="no-referrer" className="mt-2 w-full rounded-lg" />
              ) : null}
              {a.bodies.length > 0 && <div className="mt-2"><p className="text-[10.5px] font-bold uppercase text-zinc-500">Textos principales · {a.bodies.length}</p>{a.bodies.map((b, i) => <p key={i} className="mt-1 whitespace-pre-line rounded-md bg-black/20 p-1.5 text-[11.5px] leading-snug text-zinc-300">{b}</p>)}</div>}
              {a.titles.length > 0 && <div className="mt-2"><p className="text-[10.5px] font-bold uppercase text-zinc-500">Títulos · {a.titles.length}</p>{a.titles.map((t, i) => <p key={i} className="text-[11.5px] text-zinc-300">• {t}</p>)}</div>}
              <p className="mt-2 break-all text-[11px] text-zinc-500">{a.cta && <b className="text-zinc-300">{a.cta.replace(/_/g, " ")}</b>}{a.link && <> → <a href={a.link} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">{a.link}</a></>}</p>
            </div>
          ))}
          {!d.ads.length && <p className="text-zinc-500">Todavía no tiene anuncios.</p>}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          Creativos subidos a la oferta · {d.creatives.length}
          {d.offer?.folder && <a href={d.offer.folder} target="_blank" rel="noreferrer" className="ml-2 normal-case tracking-normal text-violet-300 hover:underline">Abrir carpeta de Drive</a>}
          {d.offer && <a href={`/admin/o/${d.offer.key}/ads`} className="ml-2 normal-case tracking-normal text-violet-300 hover:underline">Ver en Ads</a>}
        </p>
        {d.creatives.length ? <div className="flex gap-3 overflow-x-auto pb-2">{d.creatives.map((c) => <Creative key={c.id} c={c} />)}</div>
          : <p className="text-zinc-500">{d.offer ? "Esta oferta todavía no tiene creativos cargados en Ads." : "No encontré la oferta de esta campaña (vinculala al checkout)."}</p>}
      </div>
    </div>
  );
}

function Row({ r }: { r: NewCampaign }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<CampaignDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (fresh = false) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/meta/campana?id=${r.id}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setD(j as CampaignDetail);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = () => { const o = !open; setOpen(o); if (o && !d && !busy) void load(); };
  const [label, cls] = KIND[r.kind];
  return (
    <li className="border-t border-white/[0.05]">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-white/[0.03] sm:px-5">
        <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
          <span className="block text-[13px] font-semibold text-white sm:truncate"><Pv as="Campaña">{r.name}</Pv></span>
          <span className="block text-[11.5px] text-zinc-500">
            {r.offer ? <><Pv as="Oferta">{r.offer}</Pv>{!r.linked && <span className="text-amber-300"> · sin vincular al checkout</span>}</> : "Oferta sin identificar"}
            {r.ads != null && <> · {r.ads} {r.ads === 1 ? "anuncio" : "anuncios"}</>}
          </span>
        </span>
        <span className={`ml-7 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset sm:ml-0 ${cls}`}>{label}</span>
        <span suppressHydrationWarning className="flex items-center gap-1 text-[12px] text-zinc-300"><CalendarClock className="h-3.5 w-3.5 text-zinc-500" />{r.start ? fdate(r.start) : "—"}</span>
        <span className="text-[12px] tabular-nums text-zinc-300 sm:w-[110px] sm:text-right">{r.budget ? `${usd(r.budget)}/día` : "—"}</span>
        <span className="text-[12px] tabular-nums text-zinc-400 sm:w-[90px] sm:text-right">{r.spent ? `gastó ${usd(r.spent)}` : "sin gasto"}</span>
      </button>
      {open && (busy && !d ? <p className="flex items-center gap-2 px-5 pb-4 text-[12.5px] text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo la campaña en Meta…</p>
        : err && !d ? <p className="px-5 pb-4 text-[12.5px] text-red-300">No se pudo leer de Meta: {err}</p>
        : d ? <Detail d={d} busy={busy} onRefresh={() => void load(true)} /> : null)}
    </li>
  );
}

export default function NewCampaignsClient({ rows }: { rows: NewCampaign[] }) {
  return (
    <section className="ad-card">
      <div className="ad-card-h">
        <div>
          <h3>Campañas nuevas y programadas · {rows.length}</h3>
          <p>Las que arrancan más adelante, las pausadas que todavía no se prendieron y las lanzadas hoy. Abrí una para ver cómo está armada, sus anuncios (con la vista previa de Meta) y los videos que se subieron a su oferta.</p>
        </div>
      </div>
      <ul className="m-0 list-none p-0">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
    </section>
  );
}
