import { Suspense } from "react";
import { BarChart2 } from "lucide-react";
import { previousOf, resolveRange, PANEL_TZ, type Range } from "@/lib/admin/range";
import { moneyDetail } from "@/lib/admin/money";
import { metaKpis } from "@/lib/admin/meta-kpis";
import { freshness } from "@/lib/admin/meta-fresh";
import KeepHeight from "@/components/admin/KeepHeight";
import RangeBar from "@/components/admin/RangeBar";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { SkCard } from "@/components/admin/Skeleton";
import MoneyStrip from "@/components/admin/MoneyStrip";
import MetaStrip from "@/components/admin/MetaStrip";

export const dynamic = "force-dynamic";

/**
 * Métricas de todas las ofertas y centradas en lo que te queda de
 * verdad: cobrado en Stripe (con bumps y OTOs) − comisiones reales − reembolsos − gasto en Meta.
 * Abajo, lo que informa Meta de toda la cuenta (inversión, compras, ROAS, valor y beneficio).
 * Las campañas y las ofertas activas están en el Inicio.
 */
export default async function Metricas({ searchParams }: { searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const R = resolveRange(await searchParams);
  const k = `${R.since}-${R.until}`;
  return (
    <Shell>
      <PageHead
        title="Métricas"
        icon={<BarChart2 className="h-[18px] w-[18px]" />}
        color="#8b5cf6"
        sub="Lo que te queda de verdad: lo cobrado menos comisiones, reembolsos y lo gastado en Meta. En dólares al tipo de cambio del día, contra el período anterior del mismo largo."
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <KeepHeight>
        <Suspense key={`plata-${k}`} fallback={<div data-skeleton className="grid gap-3"><SkCard rows={2} h={150} /><SkCard rows={1} h={100} /><SkCard rows={6} h={300} /></div>}>
          <Money R={R} />
        </Suspense>
      </KeepHeight>
      <div className="ad-sec2"><h2>Meta Ads · {R.label}</h2><p>Lo que informa Meta de toda la cuenta publicitaria (también lo que vende por otros lados).</p></div>
      <KeepHeight>
        <Suspense key={`meta-${k}`} fallback={<div data-skeleton className="grid gap-3"><SkCard rows={2} h={130} /><SkCard rows={6} h={300} /></div>}>
          <Meta R={R} />
        </Suspense>
      </KeepHeight>
    </Shell>
  );
}

async function Money({ R }: { R: Range }) {
  const P = previousOf(R);
  const [cur, prev] = await Promise.all([moneyDetail(R.since, R.until), moneyDetail(P.since, P.until)]);
  return <MoneyStrip cur={cur.money} prev={prev.money} days={cur.days} prevDays={prev.days} label={R.label} />;
}

async function Meta({ R }: { R: Range }) {
  const mk = await metaKpis(R.since, R.until);
  if (!mk.accounts) return <p className="ad-flash warn">Ninguna tienda tiene cuenta publicitaria de Meta cargada.</p>;
  const city = mk.tz ? mk.tz.split("/").pop()!.replace(/_/g, " ") : null;
  return (
    <MetaStrip cur={mk.cur} prev={mk.prev} days={mk.days} prevDays={mk.prevDays}
      caption={<>Toda la cuenta publicitaria{city && mk.tz !== PANEL_TZ ? ` · días de Meta en hora de ${city}` : ""} · {freshness(mk).text}</>} />
  );
}
