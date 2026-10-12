import { Suspense } from "react";
import { LayoutGrid } from "lucide-react";
import { resolveRange } from "@/lib/admin/range";
import KeepHeight from "@/components/admin/KeepHeight";
import RangeBar from "@/components/admin/RangeBar";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { CommandCenter, PulseProvider } from "@/components/admin/Pulse";
import HeadlineKpis, { HeadlineSkeleton } from "@/components/admin/HeadlineKpis";
import OfferAuditActive from "@/components/admin/OfferAuditActive";
import { SkCard } from "@/components/admin/Skeleton";
import MetaReport from "@/components/admin/MetaReport";
import MetaOffersBoard from "@/components/admin/MetaOffersBoard";
import GoalBar from "@/components/admin/GoalBar";
import NewCampaigns from "@/components/admin/NewCampaigns";
import BooksToWrite from "@/components/admin/BooksToWrite";
import CustomerPortalCard from "@/components/admin/CustomerPortalCard";
import CatalogRefresh from "@/components/admin/CatalogRefresh";

export const dynamic = "force-dynamic";

/**
 * Inicio de todas las ofertas: la plata del período, lo que pasa ahora y el diagnóstico.
 * Las campañas y las ofertas activas (siempre según Meta) siguen acá; los números de la cuenta
 * («lo que te queda») están en /admin/metricas.
 */
export default async function TodasLasOfertas({ searchParams }: { searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const R = resolveRange(await searchParams);
  return (
    <Shell>
      {/* El buscador está una sola vez, en el menú (y con ⌘K o «/»): no se repite acá. */}
      <PageHead
        title="Todas las ofertas"
        icon={<LayoutGrid className="h-[18px] w-[18px]" />}
        sub="Lo que pasa ahora y la plata del período de todas tus ofertas, en dólares al tipo de cambio del día."
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <PulseProvider>
        {/* Pantallas anchas: a la derecha, un panel fijo con lo que hay que hacer (libros por escribir, catálogos y
            Stripe). En pantallas chicas, apilado. */}
        <div className="home-split grid gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_400px] min-[1500px]:items-start">
        <div className="grid min-w-0 gap-4">
          {/* La plata del período del filtro (siempre real: Stripe + gasto en Meta). Con key por
              período: al cambiarlo, esqueleto en vez de los números viejos. «Ahora» (en vivo, con los
              4 pasos) está en la tarjeta del mapa, debajo. */}
          {/* La barra del mes (siempre el mes en curso, sin importar el filtro). */}
          <Suspense fallback={<div data-skeleton><SkCard rows={1} h={110} /></div>}><GoalBar /></Suspense>
          <KeepHeight>
            <Suspense key={`plata-${R.since}-${R.until}`} fallback={<HeadlineSkeleton />}><HeadlineKpis R={R} /></Suspense>
          </KeepHeight>
          {/* Mapa, últimos pagos y lo que va haciendo cada persona. */}
          <CommandCenter />
        </div>
        {/* Catálogos y Stripe se revisan solos al entrar (sin tarjeta: el aviso es la burbujita del menú «Catálogos»). */}
        <Suspense fallback={null}><CatalogRefresh /></Suspense>
        <aside className="order-first grid min-w-0 gap-4 min-[1500px]:order-none min-[1500px]:sticky min-[1500px]:top-4 min-[1500px]:max-h-[calc(100vh-2rem)] min-[1500px]:overflow-y-auto min-[1500px]:pb-2">
          {/* El link del portal de clientes, para copiar y mandárselo a los compradores. */}
          <Suspense fallback={null}><CustomerPortalCard /></Suspense>
          {/* Libros vendidos en preventa que todavía hay que escribir (y los listos para avisar). */}
          <Suspense fallback={null}><BooksToWrite /></Suspense>
        </aside>
        </div>
        {/* Campañas (siempre según Meta) y, debajo, las ofertas activas. Cada una llega por su lado
            (Suspense con el alto de antes): no frenan nada de lo de arriba. */}
        {/* Campañas por salir (programadas, pausadas sin prender, lanzadas hoy): cómo están armadas y sus videos. */}
        <div className="mt-4"><Suspense fallback={null}><NewCampaigns /></Suspense></div>
        <div className="mt-4">
          <KeepHeight>
            <Suspense key={`meta-${R.since}-${R.until}`} fallback={<div data-skeleton><SkCard rows={8} h={320} /></div>}>
              <MetaReport since={R.since} until={R.until} label={R.label} source="meta" />
            </Suspense>
          </KeepHeight>
        </div>
        {/* Ofertas en Meta y el anotador, abajo de las campañas. */}
        <div className="mt-4">
          <Suspense fallback={<div data-skeleton><SkCard rows={6} h={280} /></div>}><MetaOffersBoard /></Suspense>
        </div>
        {/* Al final (es de mantenimiento, no del día): cada oferta activa por mercado, con landing,
            checkout, pixel, eventos, bumps, post-pago y entrega. Se revisa sola en el navegador. */}
        <div className="mt-6"><Suspense fallback={<div data-skeleton><SkCard rows={6} h={280} /></div>}><OfferAuditActive /></Suspense></div>
      </PulseProvider>
    </Shell>
  );
}
