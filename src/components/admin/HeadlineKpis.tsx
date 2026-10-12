import { moneyFor } from "@/lib/admin/money";
import { rangeQuery, todayIn, type Range } from "@/lib/admin/range";
import { MoneyRow, MoneyRowSkeleton } from "./KpiRow";

/**
 * La plata del período del filtro (fila de arriba de Inicio): facturado,
 * comisiones, reembolsos, neto, gasto en anuncios y beneficio. Plata real
 * siempre: no sigue al interruptor «Meta Ads | Real», que es para «Resultados».
 */
export default async function HeadlineKpis({ R }: { R: Range }) {
  const m = await moneyFor(R.since, R.until);
  const q = rangeQuery(new URLSearchParams(R.preset ? { r: R.preset } : { desde: R.since, hasta: R.until }));
  return <MoneyRow initial={m} label={R.label} query={q} live={R.until >= todayIn()} />;
}

export const HeadlineSkeleton = MoneyRowSkeleton;
