import Link from "next/link";
import { Sparkles } from "lucide-react";
import { offerList } from "@/lib/admin/offers";
import { lastRun, runState, topRecs } from "@/lib/coach/read";
import { fmtShort } from "@/lib/admin/range";
import { Card } from "./ui";
import { SkCard } from "./Skeleton";
import { AnalyzeButton, RecList, type OfferName, type RecView } from "./Mejoras";

/**
 * Inicio › «Mejoras»: las 3–5 cosas más flojas según el último análisis (de la
 * base: nunca espera a la IA). Global: todas las ofertas y la cuenta; en una
 * oferta, solo las suyas. Abrir una muestra los números y «Copiar para Claude».
 */

export const pick = (r: RecView): RecView => ({
  id: r.id, kind: r.kind, offer_key: r.offer_key, severity: r.severity, area: r.area, title: r.title, weak: r.weak, why: r.why, change: r.change,
  prompt: r.prompt, impact_usd_week: r.impact_usd_week, evidence: r.evidence, checks: r.checks, status: r.status,
});

export async function offerNames(): Promise<Record<string, OfferName>> {
  const offers = await offerList();
  return Object.fromEntries(offers.map((o) => [o.key, { name: o.name, alias: o.alias }]));
}

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function MejorasCard({ offerKey, href }: { offerKey?: string; href: string }) {
  const [{ run, recs }, names, state] = await Promise.all([lastRun(), offerNames(), runState()]);
  const top = topRecs(recs, { kind: "mejora", offerKey, limit: 5 });
  const total = topRecs(recs, { kind: "mejora", offerKey }).length;
  const ideas = topRecs(recs, { kind: "postpago", offerKey }).length;
  if (offerKey && run && !top.length && !ideas) return null; // Oferta sin nada pendiente: no ocupa lugar.
  return (
    <Card pad={false} className="mt-4"
      title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-400" /> Mejoras</span>}
      sub={run ? `Lo más flojo según el análisis del ${when(run.created_at)} (${fmtShort(run.since)} – ${fmtShort(run.until)}).` : "La IA revisa todos los días a las 7:00 el embudo, el post-pago y los anuncios, y dice qué mejorar."}
      action={total > top.length || ideas ? <Link className="ad-link-a whitespace-nowrap text-[12px]" href={href}>Ver todo{total + ideas ? ` (${total + ideas})` : ""} →</Link> : <AnalyzeButton initial={state} />}>
      {run
        ? <RecList recs={top.map(pick)} offers={names} compact empty="Nada flojo pendiente. Lo marcado como hecho o descartado no vuelve a aparecer." />
        : <div className="flex flex-wrap items-center gap-3 px-4 py-5 text-[12.5px] text-zinc-500 sm:px-5"><span>Todavía no hay ningún análisis.</span><AnalyzeButton initial={state} /></div>}
    </Card>
  );
}

export const MejorasCardSkeleton = () => <div className="mt-4" data-skeleton><SkCard rows={4} h={220} /></div>;
