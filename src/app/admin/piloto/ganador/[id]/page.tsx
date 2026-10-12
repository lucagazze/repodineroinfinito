import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { BIDCAP_BUDGET, bidCapName, ceilingFromFront, ladderPcts, marketOf, offerOf } from "@/lib/bid-pilot/rules";
import { frontCeilings, frontLabel } from "@/lib/bid-pilot/front";
import { pilotSettings } from "@/lib/bid-pilot/run";
import WinnerConfirm from "./WinnerConfirm";

export const dynamic = "force-dynamic";

/**
 * La pantalla del push «🏆 Ganador»: los números del anuncio, lo que se va a
 * crear y los botones «Pasar a BID CAP» / «Ahora no». Abrirla no le pregunta
 * nada a Meta (los números son los de la pasada que lo propuso).
 */
export default async function Ganador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{6,25}$/.test(id)) notFound();
  const { data: w } = await db.from("meta_auto_winners")
    .select("ad_id,account_id,campaign_id,campaign_name,adset_id,ad_name,status,proposed_at,expires_at,spend,purchases,cpa,target,days_run,window_since,window_until,new_name,new_campaign_id,error,decided_at")
    .eq("ad_id", id).maybeSingle();
  if (!w) notFound();
  const cbo = w.campaign_name ?? "";
  const ad = w.ad_name ?? w.ad_id;
  const name = w.new_name ?? bidCapName(cbo, ad);
  // La escalera: 50 / 60 / 70 % del precio del libro de la oferta de la CBO (de la base, sin preguntarle a Meta).
  const { ceilingPct } = await pilotSettings();
  const front = (await frontCeilings([w.campaign_id], ceilingPct / 100)).get(w.campaign_id) ?? null;
  const rungs = front ? ladderPcts(ceilingPct / 100).map((pct) => ({ pct, bid: ceilingFromFront(front.usd, pct) })) : [];
  const status = w.status === "proposed" && Date.parse(w.expires_at) <= Date.now() ? "expired" : w.status;
  const act = String(w.account_id).replace(/^act_/, "");

  return (
    <Shell>
      <PageHead
        title={`Ganador · ${ad}`}
        icon={<Trophy className="h-[18px] w-[18px]" />}
        color="#f59e0b"
        crumb={[{ href: "/admin/piloto?tab=ganadores", label: "Piloto Meta Ads" }]}
        sub={cbo}
      />
      <WinnerConfirm
        adId={w.ad_id}
        act={act}
        status={status}
        numbers={{
          spend: Number(w.spend ?? 0), purchases: Number(w.purchases ?? 0), cpa: w.cpa == null ? null : Number(w.cpa), target: Number(w.target ?? 0),
          daysRun: w.days_run ?? 0, since: w.window_since, until: w.window_until,
        }}
        plan={{ name, market: marketOf(cbo) || "—", offer: offerOf(cbo), budget: BIDCAP_BUDGET, frontLabel: front ? frontLabel(front) : null, rungs }}
        proposedAt={w.proposed_at}
        expiresAt={w.expires_at}
        error={w.error}
        created={w.new_campaign_id ? { name: w.new_name ?? name, url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${w.new_campaign_id}` } : null}
        adsManager={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${w.ad_id}`}
      />
    </Shell>
  );
}
