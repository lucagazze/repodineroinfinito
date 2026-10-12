import { notFound } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/admin/Shell";
import { Badge, Card, Progress } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { campaignAlias, storeAlias } from "@/lib/admin/privacy";
import { PANEL_TZ } from "@/lib/admin/range";
import { db } from "@/lib/db";
import { loadStore, storeCatalog } from "@/lib/mkt/catalog";
import { listSegments } from "@/lib/mkt/segments";
import { storeSender } from "@/lib/mkt/settings";
import { campaignStats, pct, revenueText } from "@/lib/mkt/stats";
import { loadCampaign } from "@/lib/mkt/send";
import { LOCALE_ES, STATUS_ES, TEST_TO, type Locale } from "@/lib/mkt/types";
import { MktHead, STATUS_TONE } from "../../shared";
import Editor, { type CatalogOpt } from "./Editor";
import Controls from "./Controls";

export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "") : "—");

export default async function Campaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await loadCampaign(id);
  if (!c) notFound();
  const [store, catalog, segments, { data: past }, stats] = await Promise.all([
    loadStore(c.store_id), storeCatalog(c.store_id), listSegments(c.store_id),
    db.from("mkt_campaigns").select("id,name").eq("store_id", c.store_id).in("status", ["sent", "sending", "paused"]).neq("id", c.id).order("created_at", { ascending: false }).limit(30),
    c.status === "draft" ? Promise.resolve(null) : campaignStats(c.id).catch(() => null),
  ]);
  if (!store) notFound();
  const sender = await storeSender(store);
  const money = stats ? await revenueText(stats.revenue) : null;

  const offers = new Map<string, { id: string; name: string; category: string | null; market: string | null }>();
  for (const it of catalog) if (it.offerId && !offers.has(it.offerId)) offers.set(it.offerId, { id: it.offerId, name: it.offerName ?? it.name, category: it.category, market: it.market });
  const opts = {
    offers: [...offers.values()],
    categories: [...new Set(catalog.map((i) => i.category).filter((x): x is string => !!x))].sort(),
    markets: [...new Set(catalog.map((i) => i.market).filter((x): x is string => !!x))].sort(),
    campaigns: (past ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
  const items: CatalogOpt[] = catalog.map((i) => ({
    funnelId: i.funnelId, label: `${i.shortName}${i.market ? ` · ${i.market}` : ""}`, locale: i.locale, active: i.active, solo: i.solo,
    category: i.category, image: i.image, price: i.price ? `${i.price.amount.toLocaleString("es-AR")} ${i.price.currency}` : null,
  }));

  return (
    <Shell>
      <MktHead tab="campanas" sub={<><Link href="/admin/email/campanas" className="hover:underline">Campañas</Link> · <Pv as={storeAlias(store.id)}>{store.display_name || store.name}</Pv></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 min-w-0 truncate text-[18px] font-bold text-white"><Pv as={campaignAlias(c.id)}>{c.name}</Pv></h2>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_ES[c.status]}</Badge>
        {c.status === "scheduled" && <span className="text-[12px] text-zinc-400">sale {when(c.scheduled_at)}</span>}
        {c.last_error && <Badge tone="bad">{c.last_error}</Badge>}
      </div>

      {stats && (
        <Card className="mb-5" title="Resultados" sub={`Ventas atribuidas: pedidos de un destinatario dentro de los 7 días, con el link de la campaña o después de hacer clic.${c.started_at ? ` · Salió ${when(c.started_at)}` : ""}`}
          action={<Controls id={c.id} status={c.status} hasDiscount={!!c.discount_pct && !c.discount_revoked_at} />}>
          {(c.status === "sending" || c.status === "paused" || c.status === "scheduled") && (
            <div className="mb-4">
              <div className="mb-1.5 flex justify-between text-[12px] text-zinc-400"><span>{stats.sent.toLocaleString("es-AR")} de {c.total.toLocaleString("es-AR")} enviados</span><span>{stats.queued.toLocaleString("es-AR")} en cola</span></div>
              <Progress value={stats.sent + stats.failed + stats.skipped} max={Math.max(1, c.total)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["Enviados", stats.sent.toLocaleString("es-AR"), stats.failed ? `${stats.failed} fallaron` : stats.skipped ? `${stats.skipped} salteados` : ""],
              ["Entregados", stats.delivered.toLocaleString("es-AR"), `${pct(stats.delivered, stats.sent)} %`],
              ["Abrieron", `${pct(stats.opened, stats.sent)} %`, stats.opened.toLocaleString("es-AR")],
              ["Clics", `${pct(stats.clicked, stats.sent)} %`, stats.clicked.toLocaleString("es-AR")],
              ["Ventas", String(stats.orders), money ?? "—"],
              ["Bajas", String(stats.unsubscribed), `${pct(stats.unsubscribed, stats.sent)} %`],
              ["Rebotes", String(stats.bounced), `${pct(stats.bounced, stats.sent)} %`],
              ["Spam", String(stats.complained), ""],
            ].map(([l, v, h]) => (
              <div key={l} className="ad-stat"><span>{l}</span><strong>{v}</strong>{h && <small>{h}</small>}</div>
            ))}
          </div>
          {Object.keys(stats.by_locale).length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.by_locale).map(([l, s]) => (
                <span key={l} className="rounded-lg bg-zinc-800/70 px-2.5 py-1.5 text-[11.5px] text-zinc-300">
                  <b className="text-white">{LOCALE_ES[l as Locale] ?? l}</b> · {s.sent} env. · {pct(s.opened, s.sent)} % abrió · {pct(s.clicked, s.sent)} % clic
                </span>
              ))}
            </div>
          )}
          {stats.order_ids.length > 0 && (
            <p className="mt-4 text-[12px] text-zinc-400">Pedidos: {stats.order_ids.slice(0, 12).map((o, i) => (
              <span key={o}>{i ? ", " : ""}<Link className="ad-link-a" href={`/admin/avisos/pedido/${o}`}>ver {i + 1}</Link></span>
            ))}</p>
          )}
        </Card>
      )}

      <Editor
        campaign={{
          id: c.id, storeId: c.store_id, status: c.status, name: c.name, segment: c.segment ?? {}, segmentId: c.segment_id,
          versions: c.versions ?? {}, fallback: c.fallback_locale, goal: c.goal ?? "", discountPct: c.discount_pct, discountHours: c.discount_hours,
          discountRevoked: !!c.discount_revoked_at,
        }}
        catalog={items} opts={opts} segments={segments.map((s) => ({ id: s.id, name: s.name, filters: s.filters }))}
        sender={sender.from} testTo={TEST_TO} brand={store.display_name || store.name}
      />
    </Shell>
  );
}
