import { Suspense } from "react";
import { Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { offerList, scopeFor } from "@/lib/admin/offers";
import { adsConfigured } from "@/lib/admin/ads";
import { autoCampaigns, creativeStats, type CreativeStats } from "@/lib/admin/meta-links";
import { campaignIdsOf } from "@/components/admin/AdsBlock";
import { resolveRange } from "@/lib/admin/range";
import { PageHead } from "@/components/admin/ui";
import RangeBar from "@/components/admin/RangeBar";
import Shell from "@/components/admin/Shell";
import TopAds, { type Format, type TopAd, type TopOffer } from "@/components/admin/TopAds";

export const dynamic = "force-dynamic";

type Row = {
  id: string; offer_id: string; title: string; kind: "video" | "image" | "folder"; drive_file_id: string | null; url: string | null;
  thumbnail_url: string | null; angle: string | null; status: TopAd["status"]; meta_ad_ids: string[] | null; notes: string | null;
};

/** «tapa y páginas» → tapa, «problema y solución» → problema, «hojeo» → hojeo; el resto, otro. */
const formatOf = (angle: string | null): Format => {
  const a = (angle ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return a.startsWith("tapa") ? "tapa" : a.startsWith("problema") ? "problema" : a.startsWith("hojeo") ? "hojeo" : "otro";
};

async function Body({ since, until, label }: { since: string; until: string; label: string }) {
  const [{ data }, offers, auto, ok] = await Promise.all([
    db.from("ad_creatives").select("id,offer_id,title,kind,drive_file_id,url,thumbnail_url,angle,status,meta_ad_ids,notes").order("sort_order").order("created_at"),
    offerList(), autoCampaigns().catch(() => ({} as Record<string, string[]>)), adsConfigured(),
  ]);
  const rows = ((data ?? []) as Row[]).filter((r) => r.kind !== "folder");
  const byOffer = new Map<string, Row[]>();
  for (const r of rows) byOffer.set(r.offer_id, [...(byOffer.get(r.offer_id) ?? []), r]);
  const list = offers.filter((o) => byOffer.has(o.id));

  // Métricas de Meta de cada creativo (de lo guardado por la sincronización: no le pregunta a Meta).
  const stats: Record<string, CreativeStats> = {};
  if (ok) {
    await Promise.all(list.map(async (o) => {
      const sc = await scopeFor(o.key);
      const act = sc.store.meta_ad_account_id ? `act_${sc.store.meta_ad_account_id.replace(/^act_/, "")}` : null;
      if (!act) return;
      const r = await creativeStats(act, campaignIdsOf(sc, auto),
        byOffer.get(o.id)!.map((c) => ({ id: c.id, title: c.title, notes: c.notes ?? "", metaAdIds: c.meta_ad_ids ?? [] })), since, until).catch(() => ({}));
      Object.assign(stats, r);
    }));
  }
  let n = 0;
  const ads: TopAd[] = list.flatMap((o) => byOffer.get(o.id)!.map((r) => ({
    id: r.id, offerId: r.offer_id, alias: `Anuncio ${++n}`, title: r.title, kind: r.kind === "image" ? "image" : "video",
    driveId: r.drive_file_id, thumb: r.thumbnail_url, url: r.url, format: formatOf(r.angle), angle: r.angle, status: r.status,
    stats: stats[r.id] ?? null,
  })));
  const tops: TopOffer[] = list.map((o) => ({ id: o.id, key: o.key, name: o.name, alias: o.alias, store: o.store.display_name || o.store.name, active: o.active }));
  return <TopAds ads={ads} offers={tops} rangeLabel={label} />;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <span key={i} className="sk block h-[150px] rounded-2xl" />)}</div>
      <span className="sk block h-[320px] rounded-2xl" />
      <span className="sk block h-[260px] rounded-2xl" />
    </div>
  );
}

export default async function TopAdsPage({ searchParams }: { searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const R = resolveRange(await searchParams);
  return (
    <Shell>
      <PageHead title="Top Ads" icon={<Trophy className="h-[18px] w-[18px]" />} color="#f59e0b"
        sub="Los 3 anuncios de test de cada producto — tapa y páginas, problema / solución y hojeo — y cuál rinde más. Tocá un video para verlo." />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <Suspense key={`${R.since}|${R.until}`} fallback={<Skeleton />}>
        <Body since={R.since} until={R.until} label={R.label} />
      </Suspense>
    </Shell>
  );
}
