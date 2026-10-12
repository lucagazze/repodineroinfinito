import { scopeFor } from "@/lib/admin/offers";
import MejorasView from "@/components/admin/MejorasView";

export const dynamic = "force-dynamic";

/** «Mejoras» de una oferta (todos sus mercados): lo del último análisis que es de esta oferta. */
export default async function MejorasOferta({ params, searchParams }: { params: Promise<{ offer: string }>; searchParams: Promise<{ estado?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const sp = await searchParams;
  const estado = sp.estado === "hechas" || sp.estado === "descartadas" ? sp.estado : "nuevas";
  return <MejorasView offerKey={sc.offer.key} scoped estado={estado} base={`${sc.base}/mejoras`} />;
}
