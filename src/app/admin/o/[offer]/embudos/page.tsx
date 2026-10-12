import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { CreditCard } from "lucide-react";
import { usdFmt, pct } from "@/lib/metrics";
import { scopeFor, dot } from "@/lib/admin/offers";
import { metricsFor } from "@/lib/admin/links";
import { structuresFor } from "@/lib/admin/structure";
import { Card, PageHead, Badge, Empty } from "@/components/admin/ui";
import { Sk } from "@/components/admin/Skeleton";
import { HostChip, LandingBlock, MarketChip, ScopeName, StructureView } from "@/components/admin/OfferBlocks";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

/** Los números de 30 días de cada checkout tardan (recorren pedidos y visitas): llegan después. */
async function FunnelStats({ storeId, funnelId, all }: { storeId: string; funnelId: string; all: string }) {
  const m = await metricsFor(storeId, 30, all);
  const v = m.funnels.find(([id]) => id === funnelId)?.[1];
  const visits = m.visitsByFunnel.get(funnelId) ?? 0;
  return <Stats cells={[["Visitas", String(visits)], ["Pedidos", String(v?.count ?? 0)], ["Conv.", visits ? pct((v?.count ?? 0) / visits) : "—"], ["30 días", usdFmt(v?.value ?? 0, 0)]]} />;
}

function Stats({ cells }: { cells: [string, ReactNode][] }) {
  return (
    <div className="grid grid-cols-4 border-y border-zinc-100 dark:border-white/[0.05]">
      {cells.map(([l, v]) => (
        <div key={l} className="border-r border-zinc-100 px-3 py-2.5 last:border-r-0 dark:border-white/[0.05]">
          <div className="text-[11.5px] font-bold text-zinc-400">{l}</div>
          <div className="mt-1 text-[13px] font-bold text-zinc-900 dark:text-white">{v}</div>
        </div>
      ))}
    </div>
  );
}

async function Structure({ ids, id, base }: { ids: string; id: string; base: string }) {
  const s = (await structuresFor(ids)).get(id);
  return s ? <StructureView compact s={s} productHref={(p) => `${base}/productos/${p}`} /> : null;
}

export default async function Checkouts({ params }: { params: Promise<{ offer: string }> }) {
  const sc = await scopeFor((await params).offer);
  const base = `${sc.base}/embudos`;
  const all = sc.funnelIds.join(",");

  return (
    <>
      <PageHead title="Checkouts" icon={<CreditCard className="h-[18px] w-[18px]" />} color="#6366f1"
        sub={sc.market
          ? <>El checkout de <ScopeName sc={sc} />. El diseño se edita adentro.</>
          : <>Los checkouts de <ScopeName sc={sc} />, uno por mercado: cada uno con sus upsells, su post-pago y sus pixels. El diseño se edita adentro.</>} />

      {sc.funnels.length ? (
        <div className="ad-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(380px,100%),1fr))" }}>
          {sc.funnels.map((f) => (
            <section key={f.id} className="ad-card flex flex-col">
              <div className="grid gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5"><MarketChip f={f} /><HostChip f={f} /></span>
                  {f.active ? <Badge tone="ok" dot>Activo</Badge> : <Badge>Pausado</Badge>}
                </div>
                <Link href={`${base}/${f.id}`} className="truncate text-[15px] font-bold text-zinc-900 hover:underline dark:text-white"><Pv as={checkoutAlias(f.market_label)}>{f.name}</Pv></Link>
                <Suspense fallback={<div className="grid gap-1.5"><Sk h={12} /><Sk h={12} /><Sk h={12} /><Sk h={12} /></div>}>
                  <Structure ids={all} id={f.id} base={sc.base} />
                </Suspense>
              </div>
              <Suspense fallback={<Stats cells={[["Visitas", <Sk key="a" w={28} h={14} />], ["Pedidos", <Sk key="b" w={28} h={14} />], ["Conv.", <Sk key="c" w={28} h={14} />], ["30 días", <Sk key="d" w={44} h={14} />]]} />}>
                <FunnelStats storeId={sc.store.id} funnelId={f.id} all={all} />
              </Suspense>
              <div className="grid gap-3 p-5">
                <div className="text-[11.5px] font-semibold text-zinc-400">Landing</div>
                <LandingBlock f={f} store={sc.store} preview={false} />
              </div>
              <div className="mt-auto flex justify-end border-t border-zinc-100 px-5 py-3 dark:border-white/[0.05]">
                <Link className="ad-btn sm primary" href={`${base}/${f.id}`}>Ver y editar diseño</Link>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card><Empty title="Esta oferta no tiene checkouts" icon={<CreditCard className="h-5 w-5" />}>Los checkouts los arma Claude por el MCP.</Empty></Card>
      )}
    </>
  );
}
