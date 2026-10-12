"use client";

import { Suspense, use, useMemo, useState } from "react";
import { Check, Clapperboard, Copy, Download, ExternalLink, FolderOpen, Image as ImageIcon, Play } from "lucide-react";
import type { CreativeStats } from "@/lib/admin/meta-links";
import { Pv } from "./Priv";

/**
 * Sección «Ads» de una oferta: los creativos (en Google Drive) en tarjetas.
 * La grilla carga al instante: cada tarjeta muestra la miniatura de Drive
 * (diferida) y el reproductor de Drive se monta recién al tocar «play». El
 * gasto de Meta llega aparte (promesa del servidor) y no frena nada.
 */

export type AdCard = {
  id: string; alias: string; title: string; kind: "video" | "image" | "folder";
  driveId: string | null; url: string | null; thumb: string | null;
  language: string; angle: string | null; status: "activo" | "pausado" | "borrador";
  metaAdIds: string[]; notes: string; market: { label: string; flags: string[] } | null;
};

const STATUS: Record<AdCard["status"], [string, string]> = {
  activo: ["Activo", "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25"],
  pausado: ["Pausado", "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25"],
  borrador: ["Borrador", "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"],
};
const chip = "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-black ring-1 ring-inset";
const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

function CopyLink({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="ad-btn sm flex-1 justify-center"
      onClick={async () => { try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1400); } catch { /* sin permiso */ } }}>
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} {ok ? "Copiado" : "Copiar link"}
    </button>
  );
}

const pctF = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
const roasCls = (r: number) => (r >= 2 ? "text-emerald-600 dark:text-emerald-400" : r >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400");
const MATCH = { ids: "anuncios cargados a mano", video: "por el video subido a Meta", nombre: "por el nombre del anuncio" };

/**
 * Métricas de Meta del creativo en el período: gasto, impresiones, CTR, CPC,
 * hook rate (3 s / impresiones), hold rate (ThruPlays / impresiones), compras,
 * CPA y ROAS (según Meta).
 */
function Metrics({ stats, id, label }: { stats: Promise<Record<string, CreativeStats>>; id: string; label: string }) {
  const s = use(stats)[id];
  if (!s) return <p className="text-[11px] font-semibold text-zinc-400">Sin anuncios en Meta para este creativo.</p>;
  const roas = s.spend ? s.value / s.spend : null;
  const cells: [string, React.ReactNode][] = [
    ["Gasto", usd(s.spend)],
    ["Impresiones", s.impressions.toLocaleString("es-AR")],
    ["CTR", s.impressions ? pctF(s.clicks / s.impressions) : "—"],
    ["CPC", s.clicks ? usd(s.spend / s.clicks) : "—"],
    ["Hook", s.impressions ? pctF(s.plays3s / s.impressions) : "—"],
    ["Hold", s.impressions ? pctF(s.thruplays / s.impressions) : "—"],
    ["Compras", String(Math.round(s.purchases))],
    ["CPA", s.purchases ? usd(s.spend / s.purchases) : "—"],
    ["ROAS", roas == null ? "—" : <span className={roasCls(roas)}>{roas.toFixed(2)}x</span>],
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 rounded-xl bg-zinc-50 p-2.5 dark:bg-white/[0.03]">
        {cells.map(([l, v]) => (
          <div key={l} className="min-w-0">
            <span className="block text-[11.5px] font-semibold text-zinc-400">{l}</span>
            <b className="block truncate text-[12px] tabular-nums text-zinc-900 dark:text-white">{v}</b>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10.5px] font-medium text-zinc-400" title="Hook = reproducciones de 3 s / impresiones · Hold = ThruPlays / impresiones · Compras y ROAS según Meta">
        {label} · {s.ads} {s.ads === 1 ? "anuncio" : "anuncios"} ({MATCH[s.matchedBy]})
      </p>
    </div>
  );
}

function Preview({ c }: { c: AdCard }) {
  const [play, setPlay] = useState(false);
  const [broken, setBroken] = useState(false);
  const thumb = c.thumb || (c.driveId ? `https://drive.google.com/thumbnail?id=${c.driveId}&sz=w480` : null);
  const ratio = c.kind === "video" ? "9 / 16" : "1 / 1";
  if (c.kind === "folder") {
    return (
      <a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="flex aspect-square items-center justify-center bg-zinc-50 text-zinc-400 transition-colors hover:text-zinc-700 dark:bg-white/[0.02]">
        <FolderOpen className="h-10 w-10" />
      </a>
    );
  }
  return (
    <div className="relative w-full overflow-hidden bg-zinc-900" style={{ aspectRatio: ratio }}>
      {play && c.driveId ? (
        <iframe src={`https://drive.google.com/file/d/${c.driveId}/preview`} title={c.title} allow="autoplay; fullscreen" allowFullScreen
          className="absolute inset-0 h-full w-full border-0" />
      ) : (
        <button type="button" onClick={() => c.driveId && setPlay(true)} aria-label={`Ver ${c.kind === "video" ? "el video" : "la imagen"}`}
          className="group/p absolute inset-0 flex items-center justify-center">
          {thumb && !broken
            // eslint-disable-next-line @next/next/no-img-element
            ? <img data-pv-img src={thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)}
              className="absolute inset-0 h-full w-full object-cover" />
            : <span className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-950" />}
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-xl transition-transform group-hover/p:scale-110">
            {c.kind === "video" ? <Play className="ml-0.5 h-6 w-6 fill-current" /> : <ImageIcon className="h-6 w-6" />}
          </span>
        </button>
      )}
    </div>
  );
}

export default function AdsGrid({ cards, stats, rangeLabel }: { cards: AdCard[]; stats: Promise<Record<string, CreativeStats>> | null; rangeLabel: string }) {
  const [status, setStatus] = useState<string>("todos");
  const [angle, setAngle] = useState<string>("todos");
  const angles = useMemo(() => [...new Set(cards.map((c) => c.angle).filter((a): a is string => !!a))], [cards]);
  const list = cards.filter((c) => (status === "todos" || c.status === status) && (angle === "todos" || c.angle === angle));
  const count = (k: string, by: "status" | "angle") => cards.filter((c) => (by === "status" ? c.status : c.angle) === k).length;

  const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors ${on
        ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300"}`}>
      {children}
    </button>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Pill on={status === "todos"} onClick={() => setStatus("todos")}>Todos <span className="opacity-60">{cards.length}</span></Pill>
        {(Object.keys(STATUS) as AdCard["status"][]).filter((k) => count(k, "status")).map((k) => (
          <Pill key={k} on={status === k} onClick={() => setStatus(k)}>{STATUS[k][0]} <span className="opacity-60">{count(k, "status")}</span></Pill>
        ))}
        {angles.length > 1 && <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />}
        {angles.length > 1 && <Pill on={angle === "todos"} onClick={() => setAngle("todos")}>Todos los ángulos</Pill>}
        {angles.length > 1 && angles.map((a) => (
          <Pill key={a} on={angle === a} onClick={() => setAngle(a)}><span className="capitalize">{a}</span> <span className="opacity-60">{count(a, "angle")}</span></Pill>
        ))}
      </div>

      {list.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.map((c) => (
            <article key={c.id} className="ad-card flex min-w-0 flex-col overflow-hidden">
              <Preview c={c} />
              <div className="flex flex-1 flex-col gap-2.5 p-4">
                <div className="min-w-0">
                  <h3 className="truncate text-[13.5px] font-bold text-zinc-900 dark:text-white" title={c.title}><Pv as={c.alias}>{c.title}</Pv></h3>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className={`${chip} ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
                    {c.angle && <span className={`${chip} bg-violet-50 capitalize text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25`}>{c.angle}</span>}
                    {c.language && <span className={`${chip} bg-sky-50 uppercase text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25`}>{c.language}</span>}
                    {c.market && <span className={`${chip} bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10`}>{c.market.label}</span>}
                  </div>
                </div>
                {stats && (
                  <Suspense fallback={<span className="sk block h-[92px] w-full rounded-xl" />}>
                    <Metrics stats={stats} id={c.id} label={rangeLabel} />
                  </Suspense>
                )}
                {c.notes && <p data-pv-blur className="line-clamp-2 text-[11.5px] text-zinc-400" title={c.notes}>{c.notes}</p>}
                {c.driveId && c.kind !== "folder" && (
                  // El archivo original desde Drive (si pesa más de 100 MB, Drive pide confirmar: está bien).
                  <a href={`https://drive.google.com/uc?export=download&id=${c.driveId}`} target="_blank" rel="noreferrer"
                    className="ad-btn sm primary mt-auto justify-center"><Download className="h-3.5 w-3.5" /> Descargar</a>
                )}
                <div className={`flex gap-1.5 ${c.driveId && c.kind !== "folder" ? "" : "mt-auto pt-1"}`}>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" className="ad-btn sm flex-1 justify-center">
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir en Drive
                    </a>
                  )}
                  {c.url && <CopyLink url={c.url} />}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="ad-card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Clapperboard className="h-6 w-6 text-zinc-300" />
          <b className="text-[14px]">{cards.length ? "Ningún anuncio con ese filtro." : "Todavía no hay anuncios cargados."}</b>
          {!cards.length && <p className="ad-note">Pedile a Claude que los cargue desde la carpeta de Drive de la oferta.</p>}
        </div>
      )}
    </>
  );
}
