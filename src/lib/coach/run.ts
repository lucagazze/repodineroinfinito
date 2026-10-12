import { db } from "@/lib/db";
import { computeFacts, runFacts, windowFor } from "./facts";
import { adviseGlobal, adviseOffer, coachModel, fallbackRecs, type DraftRec } from "./ai";

/**
 * Una corrida de «Mejoras» (migración 045): calcula los hallazgos (sin IA),
 * pide a la IA una lista corta por oferta con actividad (una llamada por
 * oferta, como mucho) y un resumen global (una llamada más), y lo guarda en
 * coach_runs / coach_recs. Escribe SOLO en esas dos tablas.
 *
 * Lo que el dueño marcó «Hecha» (7 días) o «Descartada» (30 días) no vuelve a
 * aparecer como nuevo mientras el hallazgo sea el mismo (mismo fingerprint).
 * Si la IA falla o no hay clave, los hallazgos más fuertes salen igual, con un
 * texto para Claude armado sin IA.
 */

const LOCK_MIN = 10;
const AI_CONCURRENCY = 3;

export type RunResult = { runId: string | null; status: "ok" | "error" | "skipped"; recs: number; aiCalls: number; ms: number; error?: string; skipped?: string };

/** ¿Hay una corrida en curso? (las colgadas de más de 10 min se dan por cortadas). */
export async function runningRun() {
  const since = new Date(Date.now() - LOCK_MIN * 60_000).toISOString();
  await db.from("coach_runs").update({ status: "error", error: "Se cortó (más de 10 minutos sin terminar).", finished_at: new Date().toISOString() })
    .eq("status", "running").lt("created_at", since);
  const { data } = await db.from("coach_runs").select("id,created_at").eq("status", "running").gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  return (data?.[0] as { id: string; created_at: string } | undefined) ?? null;
}

/** Crea la fila de la corrida (para que el panel la vea «analizando…») y devuelve su id. */
export async function startRun(trigger: "cron" | "manual", days = 7): Promise<{ id: string } | { skipped: string }> {
  const busy = await runningRun();
  if (busy) return { skipped: `Ya hay un análisis en curso (empezó ${new Date(busy.created_at).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}).` };
  const W = windowFor(days);
  const { data, error } = await db.from("coach_runs").insert({ trigger, status: "running", since: W.since, until: W.until, prev_since: W.prevSince, prev_until: W.prevUntil })
    .select("id").single();
  if (error || !data) throw new Error(`coach_runs: ${error?.message ?? "sin fila"}`);
  return { id: data.id as string };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (; i < items.length;) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** Hace la corrida `runId` (creada con startRun) de punta a punta. Nunca tira: deja el error en la fila. */
export async function executeRun(runId: string, opts: { days?: number; onlyOffer?: string | null; log?: (s: string) => void } = {}): Promise<RunResult> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  let aiCalls = 0;
  try {
    const F = await computeFacts({ days: opts.days ?? 7, onlyOffer: opts.onlyOffer ?? null });
    log(`hechos: ${F.markets.length} mercados, ${F.campaigns.length} campañas, ${F.findings.length} hallazgos (${Date.now() - t0} ms)`);
    const model = coachModel();

    // Ofertas con algo que analizar: ventas, visitas o gasto en la ventana (o ventas en la anterior).
    const analyzed = new Map<string, string | null>();
    const todo: string[] = [];
    for (const o of F.offers) {
      const ms = F.markets.filter((m) => m.offerKey === o.key);
      const orders = ms.reduce((a, m) => a + m.cur.orders + m.prev.orders, 0);
      const visitors = ms.reduce((a, m) => a + m.cur.landingVisitors + m.cur.checkoutVisitors, 0);
      const spend = ms.reduce((a, m) => a + (m.ads?.cur.spend ?? 0), 0);
      if (!ms.length) analyzed.set(o.key, "sin mercados activos");
      else if (!orders && visitors < 20 && !spend) analyzed.set(o.key, "sin ventas, visitas ni gasto en la ventana");
      else { analyzed.set(o.key, null); todo.push(o.key); }
    }

    const drafts: DraftRec[] = [];
    const offerRes = await pool(todo, AI_CONCURRENCY, async (key) => {
      if (!model) return fallbackRecs(F, key);
      aiCalls++;
      try { return await adviseOffer(F, key); }
      catch (e) { F.errors.push(`IA (${key}): ${(e as Error).message}`); return fallbackRecs(F, key); }
    });
    for (const r of offerRes) drafts.push(...r);
    log(`ofertas: ${todo.length} con IA, ${drafts.length} recomendaciones (${Date.now() - t0} ms)`);

    let summary: string | null = null;
    if (model) {
      aiCalls++;
      try {
        const g = await adviseGlobal(F, drafts);
        summary = g.summary;
        drafts.push(...g.recs);
      } catch (e) { F.errors.push(`IA (resumen): ${(e as Error).message}`); drafts.push(...fallbackRecs(F, null)); }
    } else drafts.push(...fallbackRecs(F, null));

    // Sin repetidos (mismo hallazgo principal en la misma oferta): queda el primero.
    const seen = new Set<string>();
    const uniq = drafts.filter((d) => (seen.has(d.fingerprint) ? false : (seen.add(d.fingerprint), true)));

    // Lo que el dueño ya marcó sigue marcado mientras el hallazgo sea el mismo.
    const fps = uniq.map((d) => d.fingerprint);
    const carry = new Map<string, { status: string; at: string }>();
    if (fps.length) {
      const { data: prev } = await db.from("coach_recs").select("fingerprint,status,status_at").in("fingerprint", fps).neq("status", "nueva")
        .gte("status_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("status_at", { ascending: false });
      for (const p of prev ?? []) {
        if (carry.has(p.fingerprint as string)) continue;
        const age = Date.now() - new Date(p.status_at as string).getTime();
        if (p.status === "descartada" || (p.status === "hecha" && age < 7 * 864e5)) carry.set(p.fingerprint as string, { status: p.status as string, at: p.status_at as string });
      }
    }

    const rank = { alta: 0, media: 1, baja: 2 } as const;
    const ordered = [...uniq].sort((a, b) => Number(a.kind === "postpago") - Number(b.kind === "postpago") || rank[a.severity] - rank[b.severity] || (b.impactUsdWeek ?? 0) - (a.impactUsdWeek ?? 0));
    const rows = ordered.map((d, i) => ({
      run_id: runId, kind: d.kind, offer_key: d.offerKey, store_slug: d.storeSlug, fingerprint: d.fingerprint, area: d.area, severity: d.severity,
      title: d.title, weak: d.weak, why: d.why, change: d.change, prompt: d.prompt, impact_usd_week: d.impactUsdWeek,
      evidence: {
        findings: d.findings.map((f) => ({ id: f.id, title: f.title, metric: f.metric, benchmark: f.benchmark, sample: f.sample, enough: f.enough, impactUsdWeek: f.impactUsdWeek, impactHow: f.impactHow ?? null })),
        ...(d.idea ? { idea: d.idea } : {}),
      },
      checks: d.checks.length ? d.checks : null, sort: i,
      status: carry.get(d.fingerprint)?.status ?? "nueva", status_at: carry.get(d.fingerprint)?.at ?? null,
    }));
    if (rows.length) {
      const { error } = await db.from("coach_recs").insert(rows);
      if (error) throw new Error(`coach_recs: ${error.message}`);
    }
    const ms = Date.now() - t0;
    await db.from("coach_runs").update({
      status: "ok", finished_at: new Date().toISOString(), facts: runFacts(F, analyzed), summary, model, ai_calls: aiCalls, ms,
      error: F.errors.length ? F.errors.join(" · ").slice(0, 2000) : null,
    }).eq("id", runId);
    // Las corridas viejas (más de 60 días) se borran con sus recomendaciones.
    await db.from("coach_runs").delete().lt("created_at", new Date(Date.now() - 60 * 864e5).toISOString());
    return { runId, status: "ok", recs: rows.length, aiCalls, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = (e as Error).message || "error";
    await db.from("coach_runs").update({ status: "error", error: msg.slice(0, 2000), finished_at: new Date().toISOString(), ai_calls: aiCalls, ms }).eq("id", runId);
    return { runId, status: "error", recs: 0, aiCalls, ms, error: msg };
  }
}

/** startRun + executeRun (para el cron y los scripts). */
export async function runCoach(trigger: "cron" | "manual", opts: { days?: number; onlyOffer?: string | null; log?: (s: string) => void } = {}): Promise<RunResult> {
  const s = await startRun(trigger, opts.days ?? 7);
  if ("skipped" in s) return { runId: null, status: "skipped", recs: 0, aiCalls: 0, ms: 0, skipped: s.skipped };
  return executeRun(s.id, opts);
}
