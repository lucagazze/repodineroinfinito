import { Megaphone } from "lucide-react";
import { adAccounts } from "@/lib/admin/meta-report";
import { metaConfigured } from "@/lib/admin/meta-conn";
import { campaignPerf, type Perf } from "@/lib/admin/meta-perf";
import { offerList } from "@/lib/admin/offers";
import { fmtDay } from "@/lib/admin/tz";
import { Card } from "./ui";
import { Pv } from "./Priv";
import CampaignTable from "./CampaignTable";

/**
 * Inicio › las campañas de cada cuenta publicitaria de las tiendas (toda la
 * cuenta): campañas → conjuntos → anuncios, en el período del filtro y con la
 * fuente del interruptor (Meta Ads o lo cobrado en Stripe). Solo lectura.
 *
 * Una sola tarjeta por cuenta: los números de la cuenta ya están arriba (la
 * tira de Meta, o los de Stripe con «Real») y la frescura la dice la tabla.
 * Antes acá se repetían gasto, ROAS, ticket, CPA y un gráfico de gasto.
 */
export default async function MetaReport({ since, until, label, source = "real" }: { since: string; until: string; label: string; source?: "meta" | "real" }) {
  const accounts = await adAccounts();
  if (!accounts.length) {
    return (
      <Card title={<><Megaphone className="h-4 w-4 text-orange-500" /> Meta Ads</>}>
        <p className="ad-note">Ninguna tienda tiene cuenta publicitaria cargada: pedile a Claude que complete meta_ad_account_id.</p>
      </Card>
    );
  }
  if (!(await metaConfigured())) return <Card title="Meta Ads"><p className="ad-note">No hay conexión con Meta: cargá el token en Configuración › Conexión con Meta.</p></Card>;
  const offers = await offerList();
  const blocks = await Promise.all(accounts.map(async (a) => {
    const fs = offers.filter((o) => a.storeIds.includes(o.store.id)).flatMap((o) => o.funnels.map((f) => ({ o, f })));
    const perf = await campaignPerf({
      act: a.id, storeIds: a.storeIds, campaigns: null, funnelIds: null,
      funnelCampaigns: Object.fromEntries(fs.map(({ f }) => [f.id, f.meta_campaign_ids])),
      funnelLabels: Object.fromEntries(fs.map(({ o, f }) => [f.id, f.market_label ? `${o.name} · ${f.market_label}` : o.name])),
      period: { since, until, label },
    });
    return { a, perf };
  }));
  return <div className="grid gap-4">{blocks.map((b) => <AccountBlock key={b.a.id} perf={b.perf} since={since} source={source} />)}</div>;
}

function AccountBlock({ perf, since, source }: { perf: Perf; since: string; source: "meta" | "real" }) {
  const act = perf.account.id.replace(/^act_/, "");
  const manager = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}`;
  const partial = perf.coverageFrom && since < perf.coverageFrom ? fmtDay(perf.coverageFrom, { day: "numeric", month: "short" }) : null;
  return (
    <section className="grid gap-4">
      {!perf.fetchedAt && <p className="ad-flash warn mb-0">{perf.error ? `Meta: ${perf.error}. ` : ""}Todavía no hay datos de Meta guardados: se sincronizan solos cada 15 minutos.</p>}
      <Card title={<>Campañas <span className="font-normal text-zinc-400">· <Pv as="Cuenta publicitaria">{perf.account.name}</Pv></span></>}
        sub={<>Tocá una campaña para ver sus conjuntos y anuncios.{partial ? <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">Meta guardado desde el {partial}.</span> : null}</>}
        action={<a className="ad-btn sm" href={manager} target="_blank" rel="noreferrer"><Megaphone className="h-3.5 w-3.5" /> Ads Manager</a>} pad={false}>
        <CampaignTable perf={perf} pageKey="inicio" source={source} />
      </Card>
    </section>
  );
}
