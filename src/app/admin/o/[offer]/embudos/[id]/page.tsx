import { scopeFor, offerKeyOfFunnel } from "@/lib/admin/offers";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/checkout-settings";
import { usdFmt, pct } from "@/lib/metrics";
import { pixelList } from "@/lib/admin/store";
import { checkoutUrls, metricsFor } from "@/lib/admin/links";
import { Badge, Card, CopyField, EmptyState, PageHead, Stat } from "@/components/admin/ui";
import { HostChip, LandingBlock, MarketChip, StructureView } from "@/components/admin/OfferBlocks";
import { structuresFor } from "@/lib/admin/structure";
import { SkCard } from "@/components/admin/Skeleton";
import CheckoutEditor from "@/components/admin/CheckoutEditor";
import { saveCheckoutSettings } from "@/lib/admin/actions";
import { Sk } from "@/components/admin/Skeleton";
import { IExternal } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

const PAISES = ["IT", "ES", "US", "GB", "BR", "MX", "AR", "FR", "DE"];

async function FunnelNumbers({ storeId, funnelId }: { storeId: string; funnelId: string }) {
  const m = await metricsFor(storeId, 30, funnelId);
  const v = m.funnels.find(([id]) => id === funnelId)?.[1];
  const visits = m.visitsByFunnel.get(funnelId) ?? 0;
  return (
    <>
      <Card><Stat size="md" label="Visitas (30 días)" value={visits} /></Card>
      <Card><Stat size="md" label="Pedidos" value={v?.count ?? 0} /></Card>
      <Card><Stat size="md" label="Conversión" value={visits ? pct((v?.count ?? 0) / visits) : "—"} /></Card>
      <Card><Stat size="md" label="Facturado" value={usdFmt(v?.value ?? 0)} /></Card>
    </>
  );
}

async function StructureCard({ id, base }: { id: string; base: string }) {
  const s = (await structuresFor(id)).get(id);
  return (
    <Card title="Cómo está armado" sub="Principal → upsells en el checkout → post-pago → bonos.">
      {s ? <StructureView s={s} productHref={(p) => `${base}/productos/${p}`} /> : <p className="ad-note">Sin productos.</p>}
    </Card>
  );
}

/** Un checkout: cómo le va, cómo está armado, su landing y su diseño, que se edita acá con vista previa en vivo (la única edición del panel). */
export default async function Checkout({ params }: { params: Promise<{ offer: string; id: string }> }) {
  const { offer, id } = await params;
  const sc = await scopeFor(offer);
  const store = sc.store;
  const slug = store.slug;
  // Un checkout de otra oferta (o de otro mercado si se eligió uno): a su lugar.
  const of = sc.funnels.find((x) => x.id === id);
  if (!of) {
    const other = sc.offer.funnels.some((x) => x.id === id) ? sc.offer.key : await offerKeyOfFunnel(id);
    if (other) redirect(`/admin/o/${other}/embudos/${id}`);
    notFound();
  }

  const [{ data: f }, pixels] = await Promise.all([
    db.from("funnels").select("id,slug,name,active,pixel_ids,settings").eq("id", id).eq("store_id", store.id).maybeSingle(),
    pixelList(store.id),
  ]);
  if (!f) notFound();

  const st = resolveSettings(f.settings);
  const urls = checkoutUrls(store, { slug: f.slug, checkout_host: of.checkout_host, checkout_path: of.checkout_path });
  const own = new Set((f.pixel_ids ?? []) as string[]);
  const loaded = pixels.filter((p) => p.all_funnels || own.has(p.id));

  return (
    <>
      <PageHead crumb={[{ href: `${sc.base}/embudos`, label: "Checkouts" }]} title={<Pv as={checkoutAlias(of.market_label)}>{f.name}</Pv>}
        icon={<CreditCard className="h-[18px] w-[18px]" />} color="#6366f1"
        sub={<><code data-pv-blur>{f.slug}</code> · <Pv as={sc.offer.alias}>{sc.offer.name}</Pv></>}
        actions={<>
          <MarketChip f={of} />
          <HostChip f={of} />
          {f.active ? <Badge tone="ok" dot>Activo</Badge> : <Badge>Pausado</Badge>}
          <a className="ad-btn" href={urls.primary} target="_blank" rel="noreferrer"><IExternal size={14} /> Abrir</a>
        </>} />

      <div className="ad-grid g-kpi">
        <Suspense fallback={[0, 1, 2, 3].map((i) => <Card key={i}><Sk w="50%" h={11} /><Sk w="60%" h={26} style={{ marginTop: 12 }} /></Card>)}>
          <FunnelNumbers storeId={store.id} funnelId={f.id} />
        </Suspense>
      </div>

      <div className="mt">
        <CheckoutEditor
          saved={st}
          previewBase={`/c/${slug}/${f.slug}?preview=1`}
          liveUrl={urls.primary}
          countries={PAISES}
          storePayColor={typeof store.brand.payButton === "string" ? store.brand.payButton : ""}
          storeGuaranteeDays={store.guarantee_days}
          save={saveCheckoutSettings.bind(null, slug, f.id)}
        />
      </div>
      <div className="ad-grid g-2 mt">
        <Card title="Landing" sub="La página de la campaña que lleva a este checkout.">
          <Suspense fallback={<SkCard rows={6} h={420} title={false} />}>
            <LandingBlock f={of} store={store} />
          </Suspense>
        </Card>
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Suspense fallback={<SkCard rows={8} h={320} />}>
            <StructureCard id={f.id} base={sc.base} />
          </Suspense>
          <Card title="Links" sub="El que va como destino de los anuncios (con los parámetros de Configuración › Tracking).">
            <div className="ad-form" style={{ gap: 12 }}>
              <div className="ad-field"><span className="lbl">{urls.own ? `Link del checkout · ${urls.host}` : "Link del checkout"}</span><CopyField value={urls.primary} /></div>
              {urls.own && <div className="ad-field"><span className="lbl">También en la dirección de la app</span><CopyField value={urls.app} /></div>}
            </div>
          </Card>
          <Card title="Pixels que carga" sub="Los de la tienda marcados para todos los checkouts más los propios de este.">
            {loaded.length ? (
              <div className="flex flex-wrap gap-1.5">
                {/* El nombre primero; el número, chico al lado. */}
                {loaded.map((p) => <Badge key={p.id} tone={p.has_token ? "ok" : "warn"}><Pv as={`Pixel ${p.pixel_id.slice(-4)}`}>{p.name || "Pixel"}</Pv><code data-pv-blur className="text-[10px] font-normal opacity-60">{p.pixel_id}</code>{p.has_token ? " · CAPI ✓" : " · sin CAPI"}</Badge>)}
              </div>
            ) : <EmptyState title="Ningún pixel" />}
          </Card>
        </div>
      </div>

    </>
  );
}
