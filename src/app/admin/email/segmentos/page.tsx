import Shell from "@/components/admin/Shell";
import { EmptyState } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { storeCatalog } from "@/lib/mkt/catalog";
import { listSegments } from "@/lib/mkt/segments";
import { MktHead, mktStores, pickStore, StoreTabs } from "../shared";
import Segments from "./Segments";

export const dynamic = "force-dynamic";

/** Segmentos guardados de una tienda, con el armador y el número en vivo. */
export default async function Segmentos({ searchParams }: { searchParams: Promise<{ tienda?: string }> }) {
  const sp = await searchParams;
  const stores = await mktStores();
  const store = pickStore(stores, sp.tienda);
  if (!store) return <Shell><MktHead tab="segmentos" /><EmptyState title="No hay tiendas" /></Shell>;
  const [catalog, segments, { data: past }] = await Promise.all([
    storeCatalog(store.id), listSegments(store.id),
    db.from("mkt_campaigns").select("id,name").eq("store_id", store.id).in("status", ["sent", "sending", "paused"]).order("created_at", { ascending: false }).limit(30),
  ]);
  const offers = new Map<string, { id: string; name: string; category: string | null; market: string | null }>();
  for (const it of catalog) if (it.offerId && !offers.has(it.offerId)) offers.set(it.offerId, { id: it.offerId, name: it.offerName ?? it.name, category: it.category, market: it.market });
  const opts = {
    offers: [...offers.values()],
    categories: [...new Set(catalog.map((i) => i.category).filter((x): x is string => !!x))].sort(),
    markets: [...new Set(catalog.map((i) => i.market).filter((x): x is string => !!x))].sort(),
    campaigns: (past ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
  return (
    <Shell>
      <MktHead tab="segmentos" sub="Grupos de compradores para reusar en las campañas. El número es el de hoy: se vuelve a contar al enviar." />
      <StoreTabs stores={stores} current={store.id} base="/admin/email/segmentos" />
      <Segments key={store.id} store={store.id} opts={opts} saved={segments.map((s) => ({ id: s.id, name: s.name, filters: s.filters }))} />
    </Shell>
  );
}
