import Link from "next/link";
import { Suspense } from "react";
import { dot, type Scope } from "@/lib/admin/offers";
import { structuresFor, mergeStructures } from "@/lib/admin/structure";
import { Badge, Card } from "./ui";
import { Flags } from "./OfferSwitcher";
import { HostChip, LandingBlock, MarketChip, StructureView } from "./OfferBlocks";
import { SkCard } from "./Skeleton";
import { Pv } from "./Priv";
import { checkoutAlias, storeAlias } from "@/lib/admin/privacy";

/**
 * Encabezado de una oferta: imagen, nombre, tienda y mercados (cada uno es un
 * link a ese mercado solo), la estructura (Principal → Upsells → Post compra
 * → Bonos) y la landing con su checkout.
 */
export default function OfferHero({ sc }: { sc: Scope }) {
  const o = sc.offer;
  return (
    <>
      <section className="ad-card mb-4 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
          {o.image_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img data-pv-img src={o.image_url} alt="" className="h-28 w-28 shrink-0 rounded-2xl border border-black/5 bg-zinc-50 object-cover dark:border-white/10" />
            : <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-[34px] font-black text-white dark:bg-white dark:text-zinc-900"><Pv as={o.alias.replace("Oferta ", "")}>{o.name.slice(0, 1)}</Pv></div>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-zinc-400">Oferta</span>
              {o.active ? <Badge tone="ok" dot>Activa</Badge> : <Badge>Inactiva</Badge>}
            </div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight text-zinc-900 sm:text-[28px] dark:text-white"><Pv as={o.alias}>{o.name}</Pv></h1>
            <p className="mt-1 text-[12.5px] font-medium text-zinc-500 dark:text-zinc-400">
              Cobra en <Link className="font-bold text-zinc-700 hover:underline dark:text-zinc-200" href={`${sc.base}/configuracion/pagos`}><Pv as={storeAlias(o.store.id)}>{o.store.display_name || o.store.name}</Pv></Link>
              {" · "}{o.markets.length} {o.markets.length === 1 ? "mercado" : "mercados"}
            </p>
            {o.markets.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {o.markets.length > 1 && (
                  <Link href={sc.offerBase} className={`rounded-full border px-2.5 py-[3px] text-[10.5px] font-bold ${!sc.market
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"}`}>
                    Todos los mercados
                  </Link>
                )}
                {o.markets.map((f) => (
                  <Link key={f.id} href={`/admin/o/${f.key}`} title={`Solo ${f.market_label || f.name}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10.5px] font-bold ${sc.market?.id === f.id
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                      : "border-violet-500/25 bg-violet-500/10 text-violet-700 hover:border-violet-500/50 dark:text-violet-300"}`}>
                    <Flags codes={f.flags} size={11} />{f.market_label || f.name}
                  </Link>
                ))}
              </div>
            )}
            {o.notes && <p data-pv-blur className="ad-note mt-2.5 whitespace-pre-line">{o.notes}</p>}
          </div>
        </div>
      </section>

      <div className="ad-grid g-2 mb-6">
        <Suspense fallback={<SkCard rows={8} h={320} />}>
          <StructureCard sc={sc} />
        </Suspense>
        <Card title="Landing y checkout" sub={sc.markets.length > 1 ? "Elegí un mercado para ver su landing en vivo." : "La página de la campaña y el checkout al que lleva."}>
          {sc.markets.length === 1 && <div className="mb-3 flex flex-wrap gap-2"><MarketChip f={sc.markets[0]} /><HostChip f={sc.markets[0]} /></div>}
          {sc.markets.length === 1
            ? <Suspense fallback={<SkCard rows={6} h={420} title={false} />}><LandingBlock f={sc.markets[0]} store={sc.store} /></Suspense>
            : sc.markets.length ? (
              <div className="grid gap-4">
                {sc.markets.map((f) => (
                  <div key={f.id} className="grid gap-2 border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-white/[0.05]">
                    <div className="flex flex-wrap items-center gap-2"><MarketChip f={f} /><HostChip f={f} /><Link className="truncate text-[12.5px] font-bold hover:underline" href={`/admin/o/${f.key}`}><Pv as={checkoutAlias(f.market_label)}>{f.name}</Pv></Link></div>
                    <LandingBlock f={f} store={sc.store} preview={false} />
                  </div>
                ))}
              </div>
            ) : <p className="ad-note">Esta oferta todavía no tiene checkouts.</p>}
        </Card>
      </div>
    </>
  );
}

async function StructureCard({ sc }: { sc: Scope }) {
  // Solo los mercados: los links de producto suelto no son parte de cómo está armada la oferta.
  const ids = sc.markets.map((f) => f.id);
  const map = await structuresFor(ids.join(","));
  const merged = mergeStructures(ids.map((id) => map.get(id)).filter((s): s is NonNullable<typeof s> => !!s));
  return (
    <Card title="Cómo está armada" sub={sc.market ? dot(`El checkout de ${sc.market.market_label || sc.market.name}`) : sc.markets.length > 1 ? "Todos sus mercados juntos." : "Lo que vive el comprador, en orden."}>
      <StructureView s={merged} mains={merged.mains} productHref={(id) => `${sc.base}/productos/${id}`} />
    </Card>
  );
}
