import { unstable_cache } from "next/cache";
import { Clapperboard, Download, FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import { scopeFor, OFFERS_TAG } from "@/lib/admin/offers";
import { adsConfigured } from "@/lib/admin/ads";
import { autoCampaigns, creativeStats } from "@/lib/admin/meta-links";
import { campaignIdsOf } from "@/components/admin/AdsBlock";
import { resolveRange } from "@/lib/admin/range";
import { PageHead } from "@/components/admin/ui";
import { ScopeName } from "@/components/admin/OfferBlocks";
import RangeBar from "@/components/admin/RangeBar";
import AdsGrid, { type AdCard } from "@/components/admin/AdsGrid";

export const dynamic = "force-dynamic";

type Row = {
  id: string; funnel_id: string | null; title: string; kind: AdCard["kind"]; drive_file_id: string | null; url: string | null;
  thumbnail_url: string | null; language: string; angle: string | null; status: AdCard["status"]; meta_ad_ids: string[]; notes: string;
};

/** Los creativos de una oferta y su carpeta de Drive. Cambian poco: caché con la etiqueta de ofertas (el MCP la invalida al cargar). */
const adsOf = (offerId: string) => unstable_cache(async () => {
  const [{ data: o }, { data, error }] = await Promise.all([
    db.from("offers").select("ads_folder_url").eq("id", offerId).maybeSingle(),
    db.from("ad_creatives").select("id,funnel_id,title,kind,drive_file_id,url,thumbnail_url,language,angle,status,meta_ad_ids,notes")
      .eq("offer_id", offerId).order("sort_order").order("created_at"),
  ]);
  // Sin la migración 022 la sección queda vacía en vez de romper el panel.
  return { folder: (o as { ads_folder_url?: string | null } | null)?.ads_folder_url ?? null, rows: error ? [] : (data ?? []) as Row[] };
}, ["admin-ads", offerId], { tags: [OFFERS_TAG], revalidate: 10 })();

export default async function Ads({ params, searchParams }: {
  params: Promise<{ offer: string }>; searchParams: Promise<{ r?: string; desde?: string; hasta?: string }>;
}) {
  const [sc, sp] = await Promise.all([scopeFor((await params).offer), searchParams]);
  const R = resolveRange(sp);
  const { folder, rows } = await adsOf(sc.offer.id);
  // Un mercado: lo suyo y lo que es para toda la oferta.
  const list = sc.market ? rows.filter((r) => !r.funnel_id || r.funnel_id === sc.market!.id) : rows;
  const fOf = new Map(sc.offer.funnels.map((f) => [f.id, f]));
  const cards: AdCard[] = list.map((r, i) => ({
    id: r.id, alias: `Anuncio ${i + 1}`, title: r.title, kind: r.kind, driveId: r.drive_file_id, url: r.url, thumb: r.thumbnail_url,
    language: r.language, angle: r.angle, status: r.status, metaAdIds: r.meta_ad_ids ?? [], notes: r.notes,
    market: r.funnel_id && fOf.get(r.funnel_id) ? { label: fOf.get(r.funnel_id)!.market_label || "Mercado", flags: fOf.get(r.funnel_id)!.flags } : null,
  }));
  // Las métricas de Meta no se esperan: van como promesa y cada tarjeta las muestra cuando llegan.
  const act = sc.store.meta_ad_account_id ? `act_${sc.store.meta_ad_account_id.replace(/^act_/, "")}` : null;
  const stats = act && (await adsConfigured()) && cards.length
    ? autoCampaigns().then((auto) => creativeStats(act, campaignIdsOf(sc, auto),
      cards.map((c) => ({ id: c.id, title: c.title, notes: c.notes, metaAdIds: c.metaAdIds })), R.since, R.until)).catch(() => ({}))
    : null;

  return (
    <>
      <PageHead title="Ads" icon={<Clapperboard className="h-[18px] w-[18px]" />} color="#f97316"
        sub={<>Los anuncios de <ScopeName sc={sc} />: tocá uno para verlo; los archivos están en Drive.</>}
        actions={<>
          {folder && <a className="ad-btn" href={folder} target="_blank" rel="noreferrer"><FolderOpen className="h-4 w-4" /> Abrir carpeta de Drive</a>}
          {/* Drive baja la carpeta entera como .zip desde ahí (botón «Descargar» arriba a la derecha). */}
          {folder && cards.length > 0 && <a className="ad-btn" href={folder} target="_blank" rel="noreferrer" title="Se abre la carpeta: «Descargar» en Drive la baja entera en un .zip"><Download className="h-4 w-4" /> Descargar todos</a>}
        </>} />
      {stats && <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />}
      <AdsGrid cards={cards} stats={stats} rangeLabel={R.label} />
    </>
  );
}
