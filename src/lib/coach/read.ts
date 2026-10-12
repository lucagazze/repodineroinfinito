import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { Rec, RunFacts, RunRow } from "./types";

/**
 * Lecturas de «Mejoras» para el panel: la última corrida terminada y sus
 * recomendaciones. El Inicio nunca espera a la IA: muestra lo último que
 * quedó guardado. La última corrida se busca sin caché (una fila); sus
 * recomendaciones y hechos, con caché por corrida (etiqueta COACH_TAG, se
 * invalida al marcar Hecha / Descartar).
 */

export const COACH_TAG = "coach";

const RUN_COLS = "id,created_at,finished_at,status,trigger,since,until,prev_since,prev_until,summary,model,ai_calls,error,ms";
const REC_COLS = "id,run_id,created_at,kind,offer_key,store_slug,fingerprint,area,severity,title,weak,why,change,prompt,impact_usd_week,evidence,checks,sort,status,status_at";

const num = (r: Rec) => ({ ...r, impact_usd_week: r.impact_usd_week == null ? null : Number(r.impact_usd_week) });

const recsOfRun = unstable_cache(
  async (runId: string): Promise<Rec[]> => {
    const { data } = await db.from("coach_recs").select(REC_COLS).eq("run_id", runId).order("sort");
    return ((data ?? []) as Rec[]).map(num);
  },
  ["coach-recs-v1"],
  { tags: [COACH_TAG], revalidate: 3600 },
);

/** La última corrida que terminó bien, con sus recomendaciones (todas, cualquier estado). */
export async function lastRun(): Promise<{ run: RunRow | null; recs: Rec[] }> {
  const { data, error } = await db.from("coach_runs").select(RUN_COLS).eq("status", "ok").order("created_at", { ascending: false }).limit(1);
  // Sin la migración 045: el panel sigue igual, sin «Mejoras».
  if (error || !data?.length) return { run: null, recs: [] };
  const run = data[0] as RunRow;
  return { run, recs: await recsOfRun(run.id) };
}

/** Los hechos de una corrida (hallazgos, «pocos datos», qué no se puede medir): solo para la página completa. */
export const runFactsOf = unstable_cache(
  async (runId: string): Promise<RunFacts | null> => {
    const { data } = await db.from("coach_runs").select("facts").eq("id", runId).maybeSingle();
    return (data?.facts as RunFacts | null) ?? null;
  },
  ["coach-facts-v1"],
  { revalidate: 86_400 },
);

export type RunState = { id: string; created_at: string; finished_at: string | null; status: string; error: string | null; trigger: string } | null;

/** La corrida más nueva, termine como termine (para «Analizar ahora»; sin caché). */
export async function runState(): Promise<RunState> {
  const { data } = await db.from("coach_runs").select("id,created_at,finished_at,status,error,trigger").order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as RunState) ?? null;
}

const SEV = { alta: 0, media: 1, baja: 2 } as const;
/** Las nuevas, primero las graves y las de más plata. offerKey: undefined = todas · null = las de la cuenta. */
export function topRecs(recs: Rec[], opts: { offerKey?: string | null; kind?: Rec["kind"]; limit?: number; status?: Rec["status"] } = {}) {
  return recs
    .filter((r) => r.status === (opts.status ?? "nueva") && (!opts.kind || r.kind === opts.kind) && (opts.offerKey === undefined || r.offer_key === opts.offerKey))
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || (b.impact_usd_week ?? 0) - (a.impact_usd_week ?? 0) || a.sort - b.sort)
    .slice(0, opts.limit ?? 999);
}
