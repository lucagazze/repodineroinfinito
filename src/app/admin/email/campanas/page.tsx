import Link from "next/link";
import Shell from "@/components/admin/Shell";
import { Badge, Card, EmptyState } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { campaignAlias, storeAlias } from "@/lib/admin/privacy";
import { PANEL_TZ } from "@/lib/admin/range";
import { db } from "@/lib/db";
import { campaignStats, pct, revenueText } from "@/lib/mkt/stats";
import { STATUS_ES, type CampaignStatus } from "@/lib/mkt/types";
import { MktHead, mktStores, STATUS_TONE } from "../shared";
import NewCampaign from "./NewCampaign";

export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "") : "—");

/** Todas las campañas: estado y resultados (enviados, aperturas, clics, ventas atribuidas). */
export default async function Campanas() {
  const [stores, { data: rows }] = await Promise.all([
    mktStores(),
    db.from("mkt_campaigns").select("id,store_id,name,status,total,created_at,started_at,finished_at,scheduled_at,discount_pct,last_error")
      .eq("kind", "broadcast").order("created_at", { ascending: false }).limit(100),
  ]);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const list = rows ?? [];
  const stats = await Promise.all(list.map((c) => (c.status === "draft" ? Promise.resolve(null) : campaignStats(c.id).catch(() => null))));
  const money = await Promise.all(stats.map((s) => (s ? revenueText(s.revenue) : Promise.resolve(null))));

  return (
    <Shell>
      <MktHead tab="campanas" actions={<NewCampaign stores={stores} />} />
      {!list.length ? (
        <Card>
          <EmptyState title="Todavía no hay campañas">
            <p className="ad-note mt-1">Creá una, elegí a quién va (por ejemplo: compraron Uñas y no tienen Física), y la IA la escribe en cada idioma con tus productos reales.</p>
          </EmptyState>
        </Card>
      ) : (
        <Card pad={false}>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            {list.map((c, i) => {
              const s = stats[i];
              return (
                <li key={c.id}>
                  <Link href={`/admin/email/campanas/${c.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="truncate text-[13.5px] text-white"><Pv as={campaignAlias(c.id)}>{c.name}</Pv></b>
                        <Badge tone={STATUS_TONE[c.status]}>{STATUS_ES[c.status as CampaignStatus]}</Badge>
                        {c.discount_pct ? <Badge tone="brand">−{c.discount_pct}%</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-zinc-500">
                        <Pv as={storeAlias(c.store_id)}>{storeName.get(c.store_id) ?? "—"}</Pv>
                        {" · "}{c.status === "scheduled" ? `programada ${when(c.scheduled_at)}` : c.started_at ? `salió ${when(c.started_at)}` : `creada ${when(c.created_at)}`}
                        {c.last_error ? <span className="text-red-400"> · {c.last_error}</span> : null}
                      </p>
                    </div>
                    {s && (
                      <div className="grid grid-cols-4 gap-3 text-right text-[12px] tabular-nums sm:w-[360px]">
                        <span><b className="block text-[13.5px] text-white">{s.sent.toLocaleString("es-AR")}</b><small className="text-zinc-500">de {c.total.toLocaleString("es-AR")}</small></span>
                        <span><b className="block text-[13.5px] text-white">{pct(s.opened, s.sent)} %</b><small className="text-zinc-500">abrió</small></span>
                        <span><b className="block text-[13.5px] text-white">{pct(s.clicked, s.sent)} %</b><small className="text-zinc-500">clic</small></span>
                        <span><b className="block text-[13.5px] text-white">{s.orders}</b><small className="truncate text-zinc-500">{money[i] ?? "ventas"}</small></span>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
