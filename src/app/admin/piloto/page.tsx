import { Gauge } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead, Tabs } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { pilotSettings } from "@/lib/bid-pilot/run";
import { autopilotSettings } from "@/lib/bid-pilot/autopilot";
import { metaPressure } from "@/lib/admin/meta-conn";
import { todayIn } from "@/lib/admin/range";
import { addDays } from "@/lib/admin/tz";
import PilotView, { type CampaignView, type ChangeView, type RunView } from "../pujas/PilotView";
import { CboTab, HistoryList, WinnersTab, type AutoRunView, type CboView, type LogView, type WinnerView } from "./AutoView";

export const dynamic = "force-dynamic";

type Sp = { tab?: string };
const TABS = ["pujas", "cbo", "ganadores", "historial"] as const;
type Tab = (typeof TABS)[number];

/**
 * Piloto Meta Ads: todo lo que hace solo con las campañas de Meta, en una página.
 *  · Pujas: el piloto que mueve el límite de puja de las BID CAP cada hora.
 *  · CBO: la guardia que avisa qué CBO pierden plata para que las apague el dueño (una vez por día).
 *  · Ganadores: los anuncios de las CBO para pasar a BID CAP (con un toque).
 *  · Historial: cada cosa que hizo, lo más nuevo arriba.
 * Todo sale de la base (lo que guardaron las pasadas): abrir la página no le pregunta nada a Meta.
 */
export default async function Piloto({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "pujas";
  const [pressure, settings, pendingWinners] = await Promise.all([
    metaPressure(),
    autopilotSettings(),
    db.from("meta_auto_winners").select("ad_id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", new Date().toISOString()),
  ]);
  const pending = pendingWinners.count ?? 0;

  return (
    <Shell>
      <PageHead
        title="Piloto Meta Ads"
        icon={<Gauge className="h-[18px] w-[18px]" />}
        color="#f59e0b"
        sub="Mueve las pujas de las BID CAP cada hora (tope = un % del precio del libro), te avisa qué CBO o escalones pierden plata (no apaga nada solo: lo apagás vos con el interruptor) y te propone los anuncios ganadores para pasarlos a BID CAP en escalera. Cada cosa que hace te llega como aviso."
      />
      {/* Las secciones, debajo del título (en el encabezado se partían en dos renglones). */}
      <div className="mb-4">
        <Tabs current={tab} items={[
          { href: "/admin/piloto", label: "Pujas", key: "pujas" },
          { href: "/admin/piloto?tab=cbo", label: "CBO", key: "cbo" },
          { href: "/admin/piloto?tab=ganadores", label: pending ? `Ganadores · ${pending}` : "Ganadores", key: "ganadores" },
          { href: "/admin/piloto?tab=historial", label: "Historial", key: "historial" },
        ]} />
      </div>
      {tab === "pujas" ? <PujasTab pressurePct={Math.round(pressure.pct)} />
        : tab === "cbo" ? <CboData on={settings.cbo_guard} pressurePct={Math.round(pressure.pct)} />
          : tab === "ganadores" ? <WinnersData on={settings.winners} pressurePct={Math.round(pressure.pct)} />
            : <HistoryData />}
    </Shell>
  );
}

async function PujasTab({ pressurePct }: { pressurePct: number }) {
  const [{ enabled, ceilingPct }, camps, sets, runs, log] = await Promise.all([
    pilotSettings(),
    db.from("bid_pilot_campaigns").select("campaign_id,name,enabled,target_cpa,max_bid,floor_bid,daily_budget,status,max_manual,front_usd,front_label,front_via,cpa_alert,cpa_alert_at").order("name"),
    db.from("bid_pilot_adsets").select("adset_id,campaign_id,name,status,bid,last_change_at,last_change_reason,manual_until,spend_12h,spend_24h,purchases_24h,spend_72h,purchases_72h,state,reason,updated_at,ladder,ladder_pct"),
    db.from("bid_pilot_runs").select("at,ok,skipped,error,changes").eq("dry_run", false).order("at", { ascending: false }).limit(1),
    db.from("bid_pilot_log").select("at,campaign_id,adset_id,campaign_name,action,bid_before,bid_after,applied,confirmed_bid,reason")
      .or("applied.eq.true,action.eq.error").order("at", { ascending: false }).limit(60),
  ]);
  // Estado de cada campaña en Meta y sus números de 3 y 7 días según Meta (compras y valor: ticket promedio y retorno).
  const ids = (camps.data ?? []).map((c) => c.campaign_id);
  const today = todayIn();
  const [{ data: objs }, { data: ins }] = await Promise.all([
    ids.length ? db.from("meta_objects").select("id,effective_status").eq("level", "campaign").in("id", ids) : Promise.resolve({ data: [] as { id: string; effective_status: string | null }[] }),
    ids.length ? db.from("meta_insights_daily").select("campaign_id,date,spend,purchases,purchase_value").eq("level", "campaign").in("campaign_id", ids).gte("date", addDays(today, -6)) : Promise.resolve({ data: [] as { campaign_id: string; date: string; spend: number; purchases: number; purchase_value: number }[] }),
  ]);
  const metaStatus = new Map((objs ?? []).map((o) => [o.id, o.effective_status]));
  type W = { spend: number; purchases: number; value: number };
  const nums = new Map<string, { d1: W; d3: W; d7: W }>();
  for (const r of ins ?? []) {
    const n = nums.get(r.campaign_id) ?? { d1: { spend: 0, purchases: 0, value: 0 }, d3: { spend: 0, purchases: 0, value: 0 }, d7: { spend: 0, purchases: 0, value: 0 } };
    const add = (w: { spend: number; purchases: number; value: number }) => { w.spend += Number(r.spend ?? 0); w.purchases += Number(r.purchases ?? 0); w.value += Number(r.purchase_value ?? 0); };
    add(n.d7);
    if (r.date >= addDays(today, -2)) add(n.d3);
    if (r.date === today) add(n.d1);
    nums.set(r.campaign_id, n);
  }
  const setsOf = new Map<string, NonNullable<typeof sets.data>>();
  for (const s of sets.data ?? []) setsOf.set(s.campaign_id, [...(setsOf.get(s.campaign_id) ?? []), s]);
  const campaigns: CampaignView[] = (camps.data ?? []).map((c) => ({
    id: c.campaign_id, name: c.name, enabled: c.enabled, target: Number(c.target_cpa), max: Number(c.max_bid), floor: Number(c.floor_bid),
    dailyBudget: c.daily_budget == null ? null : Number(c.daily_budget), status: c.status,
    maxManual: !!c.max_manual, frontUsd: c.front_usd == null ? null : Number(c.front_usd), frontLabel: c.front_label, frontVia: c.front_via,
    cpaAlert: c.cpa_alert, cpaAlertAt: c.cpa_alert_at,
    metaStatus: metaStatus.get(c.campaign_id) ?? null,
    d1: nums.get(c.campaign_id)?.d1 ?? { spend: 0, purchases: 0, value: 0 },
    d3: nums.get(c.campaign_id)?.d3 ?? { spend: 0, purchases: 0, value: 0 },
    d7: nums.get(c.campaign_id)?.d7 ?? { spend: 0, purchases: 0, value: 0 },
    adsets: (setsOf.get(c.campaign_id) ?? []).map((s) => ({
      id: s.adset_id, name: s.name, status: s.status, bid: s.bid == null ? null : Number(s.bid), ladder: !!s.ladder, ladderPct: s.ladder_pct == null ? null : Number(s.ladder_pct),
      spend24h: Number(s.spend_24h ?? 0), purchases24h: Number(s.purchases_24h ?? 0), spend72h: Number(s.spend_72h ?? 0), purchases72h: Number(s.purchases_72h ?? 0),
      state: s.state, reason: s.reason, lastChangeAt: s.last_change_at, lastChangeReason: s.last_change_reason, manualUntil: s.manual_until, updatedAt: s.updated_at,
    })),
  }))
    // Primero las que están entregando; adentro, por nombre.
    .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || a.name.localeCompare(b.name));
  const last = runs.data?.[0];
  const run: RunView | null = last ? { at: last.at, ok: last.ok, skipped: last.skipped, error: last.error, changes: last.changes } : null;
  const changes: ChangeView[] = (log.data ?? []).map((l) => ({
    at: l.at, campaignId: l.campaign_id, campaign: l.campaign_name ?? "", action: l.action, before: l.bid_before == null ? null : Number(l.bid_before),
    after: l.bid_after == null ? null : Number(l.bid_after), applied: l.applied, confirmed: l.confirmed_bid == null ? null : Number(l.confirmed_bid), reason: l.reason ?? "",
  }));
  return <PilotView enabled={enabled} ceilingPct={ceilingPct} pressurePct={pressurePct} run={run} campaigns={campaigns} changes={changes} />;
}

async function lastRun(): Promise<AutoRunView | null> {
  const { data } = await db.from("meta_auto_runs").select("at,ok,skipped,error,paused,proposed").order("at", { ascending: false }).limit(1).maybeSingle();
  return data ? { at: data.at, ok: data.ok, skipped: data.skipped, error: data.error, paused: data.paused, proposed: data.proposed } : null;
}

async function CboData({ on, pressurePct }: { on: boolean; pressurePct: number }) {
  const [run, { data }, { data: log }] = await Promise.all([
    lastRun(),
    db.from("meta_auto_campaigns").select("campaign_id,account_id,name,cbo_guard,status,daily_budget,last_eval_at,last_spend,last_revenue,last_roas,last_source,last_days_run,last_verdict,last_reason,last_auto_pause_at"),
    db.from("meta_auto_log").select("id,at,kind,title,body,link").in("kind", ["cbo_paused", "cbo_over_limit"]).order("at", { ascending: false }).limit(30),
  ]);
  const rank = (v: string | null) => (v === "paused" ? 0 : v === "pause" || v === "over_limit" ? 1 : v === "keep" ? 2 : 3);
  const rows: CboView[] = (data ?? []).map((c) => ({
    id: c.campaign_id, accountId: c.account_id, name: c.name, guard: c.cbo_guard, status: c.status, dailyBudget: c.daily_budget == null ? null : Number(c.daily_budget),
    evalAt: c.last_eval_at, spend: c.last_spend == null ? null : Number(c.last_spend), revenue: c.last_revenue == null ? null : Number(c.last_revenue),
    roas: c.last_roas == null ? null : Number(c.last_roas), source: c.last_source, daysRun: c.last_days_run, verdict: c.last_verdict, reason: c.last_reason, autoPausedAt: c.last_auto_pause_at,
  })).sort((a, b) => rank(a.verdict) - rank(b.verdict) || Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || (a.roas ?? 99) - (b.roas ?? 99));
  return <CboTab on={on} pressurePct={pressurePct} run={run} rows={rows} log={(log ?? []) as LogView[]} />;
}

async function WinnersData({ on, pressurePct }: { on: boolean; pressurePct: number }) {
  const [run, { data }] = await Promise.all([
    lastRun(),
    db.from("meta_auto_winners").select("ad_id,account_id,campaign_id,campaign_name,ad_name,status,proposed_at,expires_at,spend,purchases,cpa,target,days_run,new_name,new_campaign_id,error,decided_at")
      .order("proposed_at", { ascending: false }).limit(100),
  ]);
  const now = Date.now();
  const rows: WinnerView[] = (data ?? []).map((w) => ({
    adId: w.ad_id, accountId: w.account_id, campaignId: w.campaign_id, campaign: w.campaign_name ?? "", ad: w.ad_name ?? w.ad_id,
    // Una propuesta vencida que la pasada todavía no marcó, se muestra vencida.
    status: w.status === "proposed" && Date.parse(w.expires_at) <= now ? "expired" : w.status,
    proposedAt: w.proposed_at, expiresAt: w.expires_at, spend: Number(w.spend ?? 0), purchases: Number(w.purchases ?? 0),
    cpa: w.cpa == null ? null : Number(w.cpa), target: Number(w.target ?? 0), daysRun: w.days_run ?? 0,
    newName: w.new_name, newCampaignId: w.new_campaign_id, error: w.error,
  })).sort((a, b) => Number(b.status === "proposed") - Number(a.status === "proposed"));
  return <WinnersTab on={on} pressurePct={pressurePct} run={run} rows={rows} />;
}

async function HistoryData() {
  const { data } = await db.from("meta_auto_log").select("id,at,kind,title,body,link").order("at", { ascending: false }).limit(150);
  return <HistoryList rows={(data ?? []) as LogView[]} />;
}
