import { db } from "@/lib/db";
import { raiseAlert, type Severity } from "@/lib/alerts";

/**
 * Lo que hace solo el Piloto Meta Ads queda en UN lugar: una fila en
 * meta_auto_log (el historial de la página del piloto) y un aviso «Piloto Meta
 * Ads» en Avisos. El aviso es uno por cosa (ref): la misma campaña o el mismo
 * conjunto no llenan la lista, vuelve arriba con lo último. El push lo manda
 * quien llama (con su texto corto); acá solo los errores avisan por push.
 */
export type ActivityKind =
  | "bid_change" | "cbo_paused" | "cbo_over_limit" | "winner_proposed" | "winner_dismissed"
  | "bidcap_created" | "bidcap_failed" | "cpa_alert" | "ladder_paused" | "manual_status" | "manual_edit" | "error";

export async function logActivity(a: {
  kind: ActivityKind; title: string; body?: string | null; link?: string;
  accountId?: string | null; campaignId?: string | null; campaignName?: string | null; adId?: string | null;
  numbers?: Record<string, unknown>;
  /** El aviso: su gravedad y de qué es (para no duplicarlo). Sin esto, solo queda en el historial. */
  alert?: { severity: Severity; ref: string };
  at?: string;
}) {
  const at = a.at ?? new Date().toISOString();
  const link = a.link ?? "/admin/piloto?tab=historial";
  await Promise.all([
    db.from("meta_auto_log").insert({
      at, kind: a.kind, account_id: a.accountId ?? null, campaign_id: a.campaignId ?? null, campaign_name: a.campaignName ?? null,
      ad_id: a.adId ?? null, title: a.title.slice(0, 300), body: a.body?.slice(0, 1000) ?? null, link, numbers: a.numbers ?? {},
    }).then(({ error }) => { if (error) console.error("[piloto] log:", error.message); }),
    a.alert ? raiseAlert({ kind: "meta_auto", severity: a.alert.severity, title: a.title, body: a.body ?? null, link, ref: a.alert.ref, reopen: true, at }) : null,
  ]);
}

/** «BID CAP - USA - ABG» → «USA - ABG»; «Italia | CBO | ECG» → «Italia · ECG»: para el push y los avisos. */
export const short = (n: string) =>
  n.replace(/^\s*BID CAP\s*[-|·]\s*/i, "").replace(/\s*\|\s*CBO\s*\|\s*/i, " · ").trim() || n;
