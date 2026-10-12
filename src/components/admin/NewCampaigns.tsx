import { db } from "@/lib/db";
import { offerOfCampaign } from "@/lib/admin/campaign-detail";
import NewCampaignsClient, { type NewCampaign } from "./NewCampaignsClient";

/**
 * Campañas por salir y recién lanzadas: las que arrancan más adelante (programadas), las nuevas que
 * todavía no gastaron nada (pausadas esperando el OK) y las creadas en las últimas 24 h. Al abrir una se
 * ve cómo está armada (conjuntos, segmentación, anuncios con la vista previa de Meta) y los creativos que
 * se subieron a su oferta.
 */
export default async function NewCampaigns() {
  const now = Date.now();
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const { data } = await db.from("meta_objects").select("id,name,status,effective_status,daily_budget,start_time,created_time")
    .eq("level", "campaign").not("effective_status", "in", "(ARCHIVED,DELETED)").gte("created_time", since7).order("created_time", { ascending: false }).limit(60);
  const camps = (data ?? []) as { id: string; name: string; status: string | null; effective_status: string | null; daily_budget: number | null; start_time: string | null; created_time: string | null }[];
  if (!camps.length) return null;
  const ids = camps.map((c) => c.id);
  const [{ data: sp }, { data: sets }, { data: ads }] = await Promise.all([
    db.from("meta_insights_daily").select("campaign_id,spend").eq("level", "campaign").in("campaign_id", ids),
    db.from("meta_objects").select("campaign_id,start_time,effective_status").eq("level", "adset").in("campaign_id", ids),
    db.from("meta_objects").select("campaign_id").eq("level", "ad").in("campaign_id", ids).not("effective_status", "in", "(ARCHIVED,DELETED)"),
  ]);
  const spend = new Map<string, number>();
  for (const r of sp ?? []) spend.set(r.campaign_id as string, (spend.get(r.campaign_id as string) ?? 0) + Number(r.spend ?? 0));
  const setStart = new Map<string, string>();
  for (const s of sets ?? []) {
    // Un conjunto archivado no cuenta: al reprogramar una campaña el viejo queda archivado con la hora en que nació.
    if (/ARCHIVED|DELETED/.test((s.effective_status as string | null) ?? "")) continue;
    const t = s.start_time as string | null;
    if (t && (!setStart.has(s.campaign_id as string) || t < setStart.get(s.campaign_id as string)!)) setStart.set(s.campaign_id as string, t);
  }
  const nAds = new Map<string, number>();
  for (const a of ads ?? []) nAds.set(a.campaign_id as string, (nAds.get(a.campaign_id as string) ?? 0) + 1);

  const rows: NewCampaign[] = [];
  for (const c of camps) {
    const start = [c.start_time, setStart.get(c.id)].filter(Boolean).sort().at(-1) ?? null;
    const spent = spend.get(c.id) ?? 0;
    const future = !!start && Date.parse(start) > now;
    const fresh = !!c.created_time && now - Date.parse(c.created_time) < 24 * 3600_000;
    if (!future && spent > 0 && !fresh) continue; // ya está andando: va en la tabla de campañas
    const paused = /PAUSED/.test(c.effective_status ?? "") || c.status === "PAUSED";
    const kind: NewCampaign["kind"] = future ? (paused ? "pausada_programada" : "programada") : paused ? "pausada" : spent > 0 ? "lanzada" : "sin_gastar";
    const m = await offerOfCampaign(c.id, c.name);
    rows.push({ id: c.id, name: c.name, kind, start, created: c.created_time, budget: c.daily_budget, spent, ads: nAds.get(c.id) ?? null, offer: m ? m.o.name : null, linked: !!m?.linked });
  }
  if (!rows.length) return null;
  const rank: Record<NewCampaign["kind"], number> = { programada: 0, pausada_programada: 1, sin_gastar: 2, pausada: 3, lanzada: 4 };
  rows.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.start ?? "").localeCompare(b.start ?? ""));
  return <NewCampaignsClient rows={rows} />;
}
