import { db } from "./db";
import type { DiagCheck } from "./admin/diagnostico";

/**
 * Lo que vio el monitor de la base (public.uptime_tick, cada 2 min) en las
 * últimas 24 h, como renglones del Diagnóstico: si cada checkout y el
 * post-pago responden ahora, el % de disponibilidad y la última caída.
 */
export async function uptimeChecks(storeId?: string): Promise<DiagCheck[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  // Con tienda: solo sus checkouts y landings (los objetivos automáticos, migración 040) y los generales (gracias, salud).
  let tq = db.from("uptime_targets").select("id,label,url,active").eq("active", true).order("sort_order");
  if (storeId) tq = tq.or(`store_id.is.null,store_id.eq.${storeId}`);
  const [{ data: targets }, { data: states }] = await Promise.all([
    tq,
    db.from("uptime_state").select("target_id,down,down_since,last_ok_at,last_check_at,last_error"),
  ]);
  // Por objetivo, contado en la base: con decenas de URLs cada 2 min, traer las filas de 24 h pasa el tope de PostgREST.
  const counts = new Map(await Promise.all((targets ?? []).map(async (t) => {
    const base = () => db.from("uptime_checks").select("id", { count: "exact", head: true }).eq("target_id", t.id).gte("at", since);
    const [all, bad, last] = await Promise.all([
      base().not("ok", "is", null),
      base().eq("ok", false),
      db.from("uptime_checks").select("at,error").eq("target_id", t.id).eq("ok", false).gte("at", since).order("at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return [t.id, { n: all.count ?? 0, fails: bad.count ?? 0, lastFail: last.data as { at: string; error: string | null } | null }] as const;
  })));
  if (!targets?.length) {
    return [{ id: "uptime", status: "warn", title: "Monitor de disponibilidad sin configurar", detail: "No hay URLs en uptime_targets." }];
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const lastCheck = (states ?? []).map((s) => s.last_check_at).filter(Boolean).sort().pop();
  const stale = !lastCheck || Date.now() - new Date(lastCheck).getTime() > 10 * 60_000;
  const out: DiagCheck[] = [];
  if (stale) {
    out.push({ id: "uptime-monitor", status: "bad", title: "El monitor de disponibilidad no está corriendo", detail: lastCheck ? `Último control: ${fmt(lastCheck)}` : "Nunca corrió (pg_cron «monitor-checkout»)." });
  }
  for (const t of targets) {
    const st = (states ?? []).find((s) => s.target_id === t.id);
    const c = counts.get(t.id) ?? { n: 0, fails: 0, lastFail: null };
    const pct = c.n ? Math.round(((c.n - c.fails) / c.n) * 1000) / 10 : null;
    const lastFail = c.lastFail;
    const detail = [
      pct == null ? "sin controles en 24 h" : `${pct}% en 24 h (${c.n} controles)`,
      st?.down ? `caído desde ${fmt(st.down_since!)}: ${st.last_error ?? ""}` : lastFail ? `última falla ${fmt(lastFail.at)}: ${lastFail.error ?? ""}` : "sin fallas",
    ].join(" · ");
    out.push({
      id: `uptime-${t.id}`,
      status: st?.down ? "bad" : c.fails ? "warn" : "ok",
      title: st?.down ? `CAÍDO: ${t.label}` : `${t.label}: en línea`,
      detail,
    });
  }
  return out;
}
