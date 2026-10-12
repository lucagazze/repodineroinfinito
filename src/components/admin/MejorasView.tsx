import Link from "next/link";
import { Sparkles } from "lucide-react";
import { lastRun, runFactsOf, runState, topRecs } from "@/lib/coach/read";
import { fmtShort } from "@/lib/admin/range";
import type { Rec } from "@/lib/coach/types";
import { Card, PageHead } from "./ui";
import { Pv } from "./Priv";
import { AnalyzeButton, RecList } from "./Mejoras";
import { offerNames, pick } from "./MejorasCard";

/**
 * Página «Mejoras» (global en /admin/mejoras, o de una oferta en
 * /admin/o/{oferta}/mejoras): todo lo del último análisis, filtrable por
 * oferta y estado, con las ideas de post-pago y lo que todavía no se puede
 * decir (pocos datos) o no se puede medir.
 */

type Props = {
  /** Oferta fija (página de una oferta) o elegida con ?o= (global). «cuenta» = lo que no es de una oferta. */
  offerKey: string | null;
  scoped: boolean;
  estado: "nuevas" | "hechas" | "descartadas";
  base: string;
};

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<Props["estado"], Rec["status"]> = { nuevas: "nueva", hechas: "hecha", descartadas: "descartada" };

export default async function MejorasView({ offerKey, scoped, estado, base }: Props) {
  const [{ run, recs }, names, state] = await Promise.all([lastRun(), offerNames(), runState()]);
  const facts = run ? await runFactsOf(run.id) : null;
  const scope = offerKey === "cuenta" ? null : offerKey ?? undefined;
  const status = STATUS[estado];
  const mejoras = topRecs(recs, { kind: "mejora", offerKey: scope, status });
  const ideas = topRecs(recs, { kind: "postpago", offerKey: scope, status });
  const link = (q: { o?: string | null; e?: string | null }) => {
    const p = new URLSearchParams();
    const o = q.o === undefined ? (scoped ? null : offerKey) : q.o;
    const e = q.e === undefined ? (estado === "nuevas" ? null : estado) : q.e;
    if (o && !scoped) p.set("o", o);
    if (e) p.set("estado", e);
    return `${base}${p.size ? `?${p}` : ""}`;
  };
  // Ofertas con algo nuevo (para el filtro), en orden de gravedad.
  const withRecs = [...new Set(topRecs(recs).map((r) => r.offer_key ?? "cuenta"))];
  const counts = (s: Rec["status"]) => topRecs(recs, { offerKey: scope, status: s }).length;
  const fewData = (facts?.findings ?? []).filter((f) => !f.enough && (scope === undefined || f.offerKey === scope));
  const skipped = (facts?.offers ?? []).filter((o) => !o.analyzed && o.active && (scope === undefined || o.key === scope));
  const running = state?.status === "running";

  return (
    <>
      <PageHead title="Mejoras" icon={<Sparkles className="h-[18px] w-[18px]" />}
        sub="Lo que está flojo en tus ofertas, el post-pago y los anuncios, con los números y el texto para pedírselo a Claude. Se analiza solo todos los días a las 7:00."
        actions={<AnalyzeButton initial={state} />} />

      {run ? (
        <p className="-mt-2 mb-4 text-[12px] text-zinc-500">
          Análisis del {when(run.created_at)} · {fmtShort(run.since)} – {fmtShort(run.until)} contra {fmtShort(run.prev_since)} – {fmtShort(run.prev_until)}
          {run.ai_calls ? ` · ${run.ai_calls} consultas a la IA` : " · sin IA"}{run.ms ? ` · ${Math.round(run.ms / 1000)} s` : ""}
          {running ? " · hay un análisis nuevo en curso" : ""}
        </p>
      ) : (
        <p className="ad-flash warn">Todavía no hay ningún análisis terminado. Tocá «Analizar ahora» (tarda 1–3 minutos).</p>
      )}

      {run?.summary && !scoped && scope === undefined && (
        <Card className="mb-4" tone="brand"><p className="text-[13px] leading-relaxed text-zinc-200" data-pv-blur>{run.summary}</p></Card>
      )}

      <div className="mb-4 grid gap-2.5">
        {!scoped && withRecs.length > 1 && (
          <div className="ad-seg">
            <Link href={link({ o: null })} className={!offerKey ? "on" : ""}>Todas</Link>
            {withRecs.map((k) => (
              <Link key={k} href={link({ o: k })} className={offerKey === k ? "on" : ""}>
                {k === "cuenta" ? "Cuenta de anuncios y mails" : names[k] ? <Pv as={names[k].alias}>{names[k].name}</Pv> : k}
              </Link>
            ))}
          </div>
        )}
        <div className="ad-seg">
          {(["nuevas", "hechas", "descartadas"] as const).map((e) => (
            <Link key={e} href={link({ e: e === "nuevas" ? null : e })} className={estado === e ? "on" : ""}>
              {e === "nuevas" ? "Nuevas" : e === "hechas" ? "Hechas" : "Descartadas"}{counts(STATUS[e]) ? ` · ${counts(STATUS[e])}` : ""}
            </Link>
          ))}
        </div>
      </div>

      {run && (
        <>
          <Card pad={false} title="Para mejorar" sub="Ordenado por gravedad y plata por semana. Tocá una para ver los números y copiar el texto para Claude.">
            <RecList recs={mejoras.map(pick)} offers={names}
              empty={estado === "nuevas" ? "Nada flojo pendiente con datos suficientes." : estado === "hechas" ? "Nada marcado como hecho en este análisis." : "Nada descartado en este análisis."} />
          </Card>

          <Card pad={false} className="mt-4" title="Ideas de post-pago"
            sub="Cadenas para probar contra la actual, armadas solo con productos de la tienda (o marcadas «producto nuevo a crear»), con precios en la moneda del mercado.">
            <RecList recs={ideas.map(pick)} offers={names} empty="Sin ideas en este análisis (solo se proponen para ofertas con ventas, visitas o gasto)." />
          </Card>

          {(fewData.length > 0 || skipped.length > 0 || (facts?.notMeasurable.length ?? 0) > 0) && estado === "nuevas" && (
            <Card className="mt-4" title="Todavía no se puede decir" sub="Lo que el análisis vio pero no alcanza para recomendar nada, y lo que no se puede medir con lo que se registra hoy.">
              <div className="grid gap-4 text-[12.5px] leading-relaxed text-zinc-400">
                {fewData.length > 0 && (
                  <details>
                    <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-wide text-zinc-500">Pocos datos ({fewData.length}): puede estar flojo, todavía no alcanza para decirlo</summary>
                    <ul className="m-0 mt-2 grid list-disc gap-1 pl-4">
                      {fewData.slice(0, 30).map((f) => <li key={f.id} className="break-words" data-pv-blur>{f.title.replace(/: pocos datos.*$/, "")}: <span className="text-zinc-300">{f.metric}</span> <span className="text-zinc-500">· {f.title.match(/pocos datos.*$/)?.[0] ?? "pocos datos"}</span></li>)}
                    </ul>
                  </details>
                )}
                {skipped.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Ofertas sin analizar con IA ({skipped.length})</p>
                    <p className="break-words">{skipped.map((o, i) => <span key={o.key}>{i ? " · " : ""}<Pv as={o.alias}>{o.name}</Pv></span>)}: {skipped[0].why ?? "sin movimiento en la ventana"}.</p>
                  </div>
                )}
                {!!facts?.notMeasurable.length && !scoped && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">No medible hoy</p>
                    <ul className="m-0 grid list-disc gap-1 pl-4">{facts.notMeasurable.map((t) => <li key={t}>{t}</li>)}</ul>
                  </div>
                )}
                {!!facts?.errors.length && <p className="text-[11.5px] text-amber-300/80">Avisos del análisis: {facts.errors.join(" · ")}</p>}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
