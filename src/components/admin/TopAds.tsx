"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Crown, Image as ImageIcon, Play, Trophy, X } from "lucide-react";
import type { CreativeStats } from "@/lib/admin/meta-links";
import { Pv } from "./Priv";

/**
 * «Top Ads»: los 3 anuncios con los que se testea cada producto, que muestran
 * el contenido — tapa y páginas, problema / solución y hojeo — con lo que rindió cada uno en
 * el período. Arriba, qué formato rinde más sumando todos los productos; después el ranking de
 * anuncios y, producto por producto, sus 3 videos lado a lado con el ganador marcado.
 * Tocar un video lo abre grande (reproductor de Drive).
 */

export type Format = "tapa" | "problema" | "hojeo" | "otro";
export type TopAd = {
  id: string; offerId: string; alias: string; title: string; kind: "video" | "image";
  driveId: string | null; thumb: string | null; url: string | null;
  format: Format; angle: string | null; status: "activo" | "pausado" | "borrador"; stats: CreativeStats | null;
};
export type TopOffer = { id: string; key: string; name: string; alias: string; store: string; active: boolean };

const FORMATS: { k: Exclude<Format, "otro">; label: string; sub: string; tone: string; ring: string }[] = [
  { k: "tapa", label: "Tapa y páginas", sub: "La tapa y las páginas por dentro", tone: "text-violet-700 bg-violet-50 dark:bg-violet-500/10 dark:text-violet-300", ring: "ring-violet-200 dark:ring-violet-500/25" },
  { k: "problema", label: "Problema / solución", sub: "El dolor y cómo lo resuelve el libro", tone: "text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300", ring: "ring-rose-200 dark:ring-rose-500/25" },
  { k: "hojeo", label: "Hojeo", sub: "Pasando las páginas, sin cortes", tone: "text-sky-700 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300", ring: "ring-sky-200 dark:ring-sky-500/25" },
];
const FMT = Object.fromEntries(FORMATS.map((f) => [f.k, f])) as Record<string, (typeof FORMATS)[number]>;
/** Gasto mínimo (USD) para que el ROAS de un anuncio cuente como ganador o entre al ranking. */
const MIN = 10;

const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
const roasCls = (r: number | null) => r == null ? "text-zinc-400" : r >= 2 ? "text-emerald-600 dark:text-emerald-400" : r >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

type Sum = { spend: number; value: number; purchases: number; impressions: number; clicks: number; plays3s: number; ads: number };
const add = (list: (CreativeStats | null)[]): Sum => list.reduce<Sum>((a, s) => s ? {
  spend: a.spend + s.spend, value: a.value + s.value, purchases: a.purchases + s.purchases,
  impressions: a.impressions + s.impressions, clicks: a.clicks + s.clicks, plays3s: a.plays3s + s.plays3s, ads: a.ads + 1,
} : a, { spend: 0, value: 0, purchases: 0, impressions: 0, clicks: 0, plays3s: 0, ads: 0 });
const roasOf = (s: { spend: number; value: number } | null) => (s && s.spend ? s.value / s.spend : null);

function Thumb({ ad, onOpen, className = "" }: { ad: TopAd; onOpen: () => void; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = ad.thumb || (ad.driveId ? `https://drive.google.com/thumbnail?id=${ad.driveId}&sz=w400` : null);
  return (
    <button type="button" onClick={onOpen} disabled={!ad.driveId} aria-label={`Ver ${ad.kind === "video" ? "el video" : "la imagen"}`}
      className={`group/t relative block shrink-0 overflow-hidden rounded-xl bg-zinc-900 ${className}`} style={{ aspectRatio: ad.kind === "video" ? "9 / 16" : "1 / 1" }}>
      {src && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img data-pv-img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
        : <span className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-950" />}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/t:bg-black/25">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition-transform group-hover/t:scale-110">
          {ad.kind === "video" ? <Play className="ml-0.5 h-4 w-4 fill-current" /> : <ImageIcon className="h-4 w-4" />}
        </span>
      </span>
    </button>
  );
}

/** El video en grande, con el reproductor de Drive. Esc o tocar afuera lo cierra. */
function Player({ ad, offer, onClose }: { ad: TopAd; offer: TopOffer | undefined; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={ad.title} onClick={onClose} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="relative flex max-h-full flex-col items-center gap-3">
        <div className="overflow-hidden rounded-2xl bg-black shadow-2xl" style={{ height: ad.kind === "video" ? "min(78vh, 760px)" : "min(70vh, 640px)", aspectRatio: ad.kind === "video" ? "9 / 16" : "1 / 1", maxWidth: "calc(100vw - 32px)" }}>
          <iframe src={`https://drive.google.com/file/d/${ad.driveId}/preview`} title={ad.title} allow="autoplay; fullscreen" allowFullScreen className="h-full w-full border-0" />
        </div>
        <p className="max-w-[90vw] truncate text-center text-[12.5px] font-semibold text-white/85">
          {offer && <><Pv as={offer.alias}>{offer.name}</Pv> · </>}<Pv as={ad.alias}>{ad.title}</Pv>
        </p>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-900 shadow-lg">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const Chip = ({ f }: { f: Format }) => f === "otro" ? null : (
  <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-black ring-1 ring-inset ${FMT[f].tone} ${FMT[f].ring}`}>{FMT[f].label}</span>
);

function Nums({ s }: { s: CreativeStats | Sum | null }) {
  if (!s || !s.impressions) return <p className="text-[11.5px] font-semibold text-zinc-400">Sin gasto en el período.</p>;
  const r = roasOf(s);
  const cells: [string, React.ReactNode][] = [
    ["Gasto", usd(s.spend)],
    ["ROAS", <span key="r" className={roasCls(r)}>{r == null ? "—" : `${r.toFixed(2)}x`}</span>],
    ["Compras", String(Math.round(s.purchases))],
    ["CPA", s.purchases ? usd(s.spend / s.purchases) : "—"],
    ["Hook", pct(s.plays3s / s.impressions)],
    ["CTR", pct(s.clicks / s.impressions)],
  ];
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
      {cells.map(([l, v]) => (
        <div key={l} className="min-w-0">
          <span className="block text-[10.5px] font-semibold text-zinc-400">{l}</span>
          <b className="block truncate text-[12.5px] tabular-nums text-zinc-900 dark:text-white">{v}</b>
        </div>
      ))}
    </div>
  );
}

export default function TopAds({ ads, offers, rangeLabel }: { ads: TopAd[]; offers: TopOffer[]; rangeLabel: string }) {
  const [playing, setPlaying] = useState<TopAd | null>(null);
  const [onlySpend, setOnlySpend] = useState(true);
  const offerOf = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);

  // Qué formato rinde más, sumando todos los productos; y en cuántos productos ganó.
  const byFormat = useMemo(() => FORMATS.map((f) => {
    const list = ads.filter((a) => a.format === f.k);
    return { f, sum: add(list.map((a) => a.stats)), wins: 0 };
  }), [ads]);
  const groups = useMemo(() => {
    const out = offers.map((o) => {
      const list = ads.filter((a) => a.offerId === o.id)
        .sort((a, b) => ["tapa", "problema", "hojeo", "otro"].indexOf(a.format) - ["tapa", "problema", "hojeo", "otro"].indexOf(b.format));
      const sum = add(list.map((a) => a.stats));
      const eligible = list.filter((a) => a.stats && a.stats.spend >= MIN && a.stats.purchases > 0);
      const winner = eligible.sort((a, b) => (roasOf(b.stats) ?? 0) - (roasOf(a.stats) ?? 0))[0]?.id ?? null;
      return { o, list, sum, winner };
    });
    return out.sort((a, b) => b.sum.spend - a.sum.spend || Number(b.o.active) - Number(a.o.active));
  }, [ads, offers]);
  const wins = useMemo(() => {
    const w: Record<string, number> = {};
    for (const g of groups) { const a = g.list.find((x) => x.id === g.winner); if (a) w[a.format] = (w[a.format] ?? 0) + 1; }
    return w;
  }, [groups]);
  const bestFormat = byFormat.filter((x) => x.sum.spend >= MIN).sort((a, b) => (roasOf(b.sum) ?? 0) - (roasOf(a.sum) ?? 0))[0]?.f.k ?? null;
  const ranking = useMemo(() => ads.filter((a) => a.stats && a.stats.spend >= MIN)
    .sort((a, b) => (roasOf(b.stats) ?? 0) - (roasOf(a.stats) ?? 0) || b.stats!.spend - a.stats!.spend).slice(0, 10), [ads]);
  const shown = onlySpend ? groups.filter((g) => g.sum.spend > 0) : groups;

  return (
    <div className="flex flex-col gap-6">
      {/* 1 · Qué formato rinde más */}
      <section>
        <h2 className="mb-2.5 text-[13px] font-bold text-zinc-900 dark:text-white">Qué formato rinde más <span className="font-medium text-zinc-400">· todos los productos · {rangeLabel.toLowerCase()}</span></h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {byFormat.map(({ f, sum }) => {
            const best = bestFormat === f.k;
            return (
              <article key={f.k} className={`ad-card relative flex flex-col gap-3 p-4 ${best ? "ring-2 ring-emerald-400/70 dark:ring-emerald-500/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={`inline-flex rounded-md px-1.5 py-[2px] text-[11px] font-black ring-1 ring-inset ${f.tone} ${f.ring}`}>{f.label}</span>
                    <p className="mt-1.5 text-[11.5px] text-zinc-500">{f.sub}</p>
                  </div>
                  {best && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Trophy className="h-3 w-3" /> Mejor ROAS</span>}
                </div>
                <Nums s={sum} />
                <p className="text-[11px] font-medium text-zinc-400">
                  {sum.ads} {sum.ads === 1 ? "anuncio" : "anuncios"} con datos · ganó en {wins[f.k] ?? 0} {(wins[f.k] ?? 0) === 1 ? "producto" : "productos"}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* 2 · Ranking */}
      <section className="ad-card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
          <h2 className="text-[13px] font-bold text-zinc-900 dark:text-white">Los 10 mejores anuncios</h2>
          <span className="text-[11px] font-medium text-zinc-400">Por ROAS de Meta · con más de {usd(MIN)} de gasto</span>
        </div>
        {ranking.length ? (
          <ol className="m-0 list-none p-0">
            {ranking.map((a, i) => {
              const o = offerOf.get(a.offerId);
              const r = roasOf(a.stats);
              return (
                <li key={a.id} className="flex items-center gap-3 border-t border-zinc-100 px-4 py-2.5 sm:px-5 dark:border-white/[0.05]">
                  <span className={`w-5 shrink-0 text-center text-[13px] font-black tabular-nums ${i < 3 ? "text-amber-500" : "text-zinc-400"}`}>{i + 1}</span>
                  <Thumb ad={a} onOpen={() => setPlaying(a)} className="w-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-zinc-900 dark:text-white">{o ? <Pv as={o.alias}>{o.name}</Pv> : "—"}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <Chip f={a.format} />
                      <span className="truncate text-[11px] text-zinc-400"><Pv as={a.alias}>{a.title}</Pv></span>
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block text-[10.5px] font-semibold text-zinc-400">Gasto · Compras</span>
                    <b className="text-[12px] tabular-nums text-zinc-900 dark:text-white">{usd(a.stats!.spend)} · {Math.round(a.stats!.purchases)}</b>
                  </span>
                  <span className="w-14 shrink-0 text-right">
                    <span className="block text-[10.5px] font-semibold text-zinc-400">ROAS</span>
                    <b className={`text-[13px] tabular-nums ${roasCls(r)}`}>{r == null ? "—" : `${r.toFixed(2)}x`}</b>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : <p className="border-t border-zinc-100 px-5 py-6 text-center text-[12px] font-semibold text-zinc-400 dark:border-white/[0.05]">Ningún anuncio gastó más de {usd(MIN)} en el período.</p>}
      </section>

      {/* 3 · Producto por producto: sus 3 videos lado a lado */}
      <section>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold text-zinc-900 dark:text-white">Producto por producto</h2>
          <div role="group" aria-label="Qué productos" className="inline-flex rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700">
            {([[true, "Con gasto"], [false, "Todos"]] as const).map(([v, l]) => (
              <button key={l} type="button" aria-pressed={onlySpend === v} onClick={() => setOnlySpend(v)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${onlySpend === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>
                {l} <span className="tabular-nums opacity-60">{v ? groups.filter((g) => g.sum.spend > 0).length : groups.length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {shown.map(({ o, list, sum, winner }) => {
            const r = roasOf(sum);
            return (
              <article key={o.id} className="ad-card p-4">
                <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/admin/o/${o.key}/ads`} className="min-w-0 truncate text-[14px] font-bold text-zinc-900 hover:underline dark:text-white"><Pv as={o.alias}>{o.name}</Pv></Link>
                  <span className="text-[11.5px] text-zinc-400">{o.store}{o.active ? "" : " · oferta pausada"}</span>
                  <span className="ml-auto text-[12px] tabular-nums text-zinc-500">
                    {sum.spend ? <>{usd(sum.spend)} · <b className={roasCls(r)}>{r == null ? "—" : `${r.toFixed(2)}x`}</b> · {Math.round(sum.purchases)} {Math.round(sum.purchases) === 1 ? "compra" : "compras"}</> : "Sin gasto en el período"}
                  </span>
                </header>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((a) => (
                    <div key={a.id} className={`flex min-w-0 gap-3 rounded-xl border p-2.5 ${a.id === winner ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-500/40 dark:bg-emerald-500/[0.06]" : "border-zinc-100 dark:border-white/[0.06]"}`}>
                      <Thumb ad={a} onOpen={() => setPlaying(a)} className="w-[92px]" />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {a.format === "otro" ? <span className="text-[11px] font-bold capitalize text-zinc-500">{a.angle ?? "Otro"}</span> : <Chip f={a.format} />}
                          {a.id === winner && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"><Crown className="h-3 w-3" /> Ganador</span>}
                          {a.status !== "activo" && <span className="text-[10.5px] font-semibold text-zinc-400">{a.status === "pausado" ? "Pausado" : "Borrador"}</span>}
                        </div>
                        <Nums s={a.stats} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
          {!shown.length && <p className="ad-card px-5 py-8 text-center text-[12px] font-semibold text-zinc-400">Ningún producto gastó en el período.</p>}
        </div>
      </section>
      {playing && <Player ad={playing} offer={offerOf.get(playing.offerId)} onClose={() => setPlaying(null)} />}
    </div>
  );
}
