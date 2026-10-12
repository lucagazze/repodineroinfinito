import { Suspense } from "react";
import { Repeat } from "lucide-react";
import { SkCard } from "@/components/admin/Skeleton";
import { scopeFor, idsOrNone, type Scope } from "@/lib/admin/offers";
import { db } from "@/lib/db";
import { simulate } from "@/lib/postpurchase";
import { pct } from "@/lib/metrics";
import { Card, PageHead, Badge, Empty, Stat } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { PostcompraFlow } from "@/components/admin/PostcompraFlow";
import { PostcompraLevels } from "@/components/admin/PostcompraLevels";
import { postcompraFlow } from "@/lib/admin/postcompra-flow";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

/**
 * Post-pago, solo para mirar: qué cadena de ofertas de 1 clic ve cada
 * comprador según lo que compró, y cómo rinde cada una (90 días). El
 * simulador es un filtro: no cambia nada.
 */
export default async function PosPago({
  params, searchParams,
}: { params: Promise<{ offer: string }>; searchParams: Promise<{ sim?: string; bumps?: string | string[]; pp?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const sp = await searchParams;
  // El encabezado al instante (el checkout del link de prueba sale de la oferta, sin consultar);
  // los números, el flujo y el detalle llegan después, cada uno con su esqueleto.
  const first = sc.funnels.find((f) => f.id === sp.sim) ?? sc.funnels[0];
  const pp = sp.pp && /^[0-9a-f-]{36}$/i.test(sp.pp) ? `&pp=${sp.pp}` : "";
  return (
    <>
      <PageHead title="Post-pago" icon={<Repeat className="h-[18px] w-[18px]" />} color="#10b981"
        actions={<a className="ad-btn" href={`${sc.base}/compra-prueba${first ? `?f=${first.id}${pp}` : ""}`}>Compra de prueba</a>}
        sub="Qué se le ofrece a cada comprador con 1 clic después de pagar, según los bumps que tomó." />
      <Suspense fallback={<div data-skeleton className="grid gap-4"><div className="ad-grid g-kpi">{[0, 1, 2].map((i) => <SkCard key={i} rows={1} title={false} />)}</div><SkCard rows={5} h={220} /><SkCard rows={6} h={260} /></div>}>
        <PosPagoBody sc={sc} sp={sp} />
      </Suspense>
    </>
  );
}

async function PosPagoBody({ sc, sp }: { sc: Scope; sp: { sim?: string; bumps?: string | string[]; pp?: string } }) {
  const store = sc.store;

  const [{ data: funnels }, { data: products }, { data: pps }, { data: events }] = await Promise.all([
    db.from("funnels").select("id,name,market_label,main_product_id,funnel_items(role,product_id)").in("id", idsOrNone(sc.funnelIds)).order("sort_order"),
    db.from("products").select("id,short_name,kind").eq("store_id", store.id),
    db.from("pp_funnels")
      .select("id,name,active,auto_generated,reserve_minutes,trigger_product_ids,checkout_funnel_id,sort_order,pp_steps(sort_order,product_id)")
      .in("checkout_funnel_id", idsOrNone(sc.funnelIds)).order("checkout_funnel_id").order("sort_order"),
    db.from("orders").select("pp_funnel_id,upsell_events(event)").in("funnel_id", idsOrNone(sc.funnelIds)).not("pp_funnel_id", "is", null)
      .gte("created_at", new Date(Date.now() - 90 * 864e5).toISOString()),
  ]);
  const pName = new Map((products ?? []).map((p) => [p.id, p.short_name]));
  const fName = new Map((funnels ?? []).map((f) => [f.id, f.market_label || f.name]));

  const perf = new Map<string, { orders: number; views: number; accepts: number }>();
  let views = 0, accepts = 0;
  for (const o of events ?? []) {
    const r = perf.get(o.pp_funnel_id!) ?? { orders: 0, views: 0, accepts: 0 };
    r.orders++;
    for (const e of (o.upsell_events ?? []) as { event: string }[]) {
      if (e.event === "view") { r.views++; views++; }
      if (e.event === "accept") { r.accepts++; accepts++; }
    }
    perf.set(o.pp_funnel_id!, r);
  }

  const simFunnel = (funnels ?? []).find((f) => f.id === sp.sim) ?? funnels?.[0];
  const simBumps = [...new Set((simFunnel?.funnel_items ?? []).filter((i) => i.role === "bump").map((i) => i.product_id as string))];
  const picked = ([] as string[]).concat(sp.bumps ?? []).filter((id) => simBumps.includes(id));
  // Cadenas de este checkout: por defecto la que se dispara; se puede mirar otra (p. ej. una pausada, para probarla).
  const simChains = (pps ?? []).filter((p) => simFunnel && p.checkout_funnel_id === simFunnel.id);
  const ppView = simChains.find((p) => p.id === sp.pp)?.id ?? null;
  // La simulación y el flujo hacen decenas de consultas (la página tardaba 7–10 s en un celular): ahora
  // la página sale enseguida y esas dos partes llegan después, cada una con su esqueleto.
  const ppQ = ppView ? `&pp=${ppView}` : "";
  const active = (pps ?? []).filter((p) => p.active).length;

  return (
    <>
      <div className="ad-grid g-kpi">
        <Card><Stat size="md" label="Cadenas" value={pps?.length ?? 0} hint={`${active} activas`} /></Card>
        <Card><Stat size="md" label="Ofertas vistas (90 días)" value={views} /></Card>
        <Card><Stat size="md" label="Aceptadas" value={accepts} hint={views ? `${pct(accepts / views)} de las vistas` : undefined} /></Card>
      </div>

      {simFunnel && (
        <Suspense fallback={<div data-skeleton className="mt grid gap-4"><SkCard rows={5} h={220} /><SkCard rows={6} h={260} /></div>}>
          <FlowCards store={store} simFunnel={simFunnel} picked={picked} ppView={ppView} ppQ={ppQ}
            funnels={funnels ?? []} simChains={simChains} />
        </Suspense>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-bold text-zinc-500">Detalle técnico</summary>
      <div className="ad-grid g-21 mt">
        <Card title="Cadenas" sub="Si el pedido tiene exactamente estos productos, ofrece estos, en orden." pad={false}>
          {pps?.length ? (
            <div className="ad-scroll">
              <table className="ad-table">
                <thead><tr><th>Si compró</th><th>Le ofrece</th><th className="num hide-m">Pedidos</th><th className="num hide-m">Aceptan</th><th>Estado</th></tr></thead>
                <tbody>
                  {pps.map((pp) => {
                    const r = perf.get(pp.id);
                    const steps = [...pp.pp_steps].sort((a, b) => a.sort_order - b.sort_order);
                    return (
                      <tr key={pp.id}>
                        <td style={{ maxWidth: 320 }}>
                          <div className="flex flex-wrap gap-1">{pp.trigger_product_ids.map((id: string) => <Badge key={id}><Pv as={productAlias(id)}>{pName.get(id) ?? "—"}</Pv></Badge>)}</div>
                          <span className="sub">{pp.auto_generated ? "automática" : "manual"}{pp.checkout_funnel_id ? <> · <Pv as="Checkout">{fName.get(pp.checkout_funnel_id)}</Pv></> : ""} · reserva {pp.reserve_minutes} min</span>
                        </td>
                        <td><ol className="m-0 list-decimal pl-4 leading-relaxed">{steps.map((s) => <li key={s.product_id}><Pv as={productAlias(s.product_id)}>{pName.get(s.product_id) ?? "—"}</Pv></li>)}</ol></td>
                        <td className="num hide-m">{r?.orders ?? 0}</td>
                        <td className="num hide-m">{r?.views ? pct(r.accepts / r.views) : "—"}</td>
                        <td>{pp.active ? <Badge tone="ok" dot>Activa</Badge> : <Badge>Pausada</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Todavía no hay cadenas" icon={<Repeat className="h-5 w-5" />}>
              Mientras tanto se usa la cadena simple de upsells de cada checkout. Las cadenas las arma Claude.
            </Empty>
          )}
        </Card>

        <Card title="¿Qué ve este comprador?" sub="Elegí un checkout y los bumps que tomó.">
          <form method="get" className="ad-form">
            <div className="ad-field">
              <span className="lbl">Checkout</span>
              <select data-pv-blur className="ad-in" name="sim" defaultValue={simFunnel?.id}>
                {(funnels ?? []).map((f) => <option key={f.id} value={f.id}>{f.market_label ? `${f.market_label} · ${f.name}` : f.name}</option>)}
              </select>
            </div>
            {simBumps.length > 0 ? (
              <div className="ad-field">
                <span className="lbl">Bumps que tomó</span>
                <div className="grid gap-1.5">
                  {simBumps.map((id) => (
                    <label key={id} className="ad-check"><input type="checkbox" name="bumps" value={id} defaultChecked={picked.includes(id)} /> <Pv as={productAlias(id)}>{pName.get(id)}</Pv></label>
                  ))}
                </div>
              </div>
            ) : <p className="ad-note">Este checkout no tiene order bumps.</p>}
            <div><button className="ad-btn">Ver</button></div>
          </form>
          {simFunnel && (
            <Suspense fallback={<div data-skeleton className="mt-4"><span className="sk block h-[90px] w-full rounded-xl" /></div>}>
              <SimBox storeId={store.id} funnelId={simFunnel.id} picked={picked} ppView={ppView} />
            </Suspense>
          )}
          {simFunnel && (
            <a className="ad-btn mt-3" target="_blank" rel="noreferrer"
              href={`/oferta/simulacion?store=${encodeURIComponent(store.slug)}&funnel=${simFunnel.id}${picked.length ? `&bumps=${picked.join(",")}` : ""}${ppQ}`}>
              Ver simulación
            </a>
          )}
        </Card>
      </div>
      </details>
    </>
  );
}

type F = { id: string; name: string; market_label: string | null };

/** Lo que se ofrece después de pagar y el flujo completo (pesado: llega después). */
async function FlowCards({ store, simFunnel, picked, ppView, ppQ, funnels, simChains }: {
  store: { id: string; slug: string; default_locale?: string | null }; simFunnel: F; picked: string[]; ppView: string | null; ppQ: string;
  funnels: F[]; simChains: { id: string; name: string; active: boolean }[];
}) {
  const flow = await postcompraFlow(store, simFunnel.id, picked, 90, ppView);
  if (!flow) return null;
  return (
    <>
        <Card className="mt" title="Lo que se ofrece después de pagar"
          sub={<>OTO 1, OTO 2 y OTO 3, cada uno con su downsell. Checkout: <Pv as="Checkout">{simFunnel.market_label ? `${simFunnel.name} · ${simFunnel.market_label}` : simFunnel.name}</Pv></>}
          action={funnels.length > 1 || simChains.length > 1 ? (
            <form method="get" className="flex flex-wrap gap-1.5">
              {funnels.length > 1 && (
                <select data-pv-blur className="ad-in" name="sim" defaultValue={simFunnel.id}>
                  {funnels.map((f) => <option key={f.id} value={f.id}>{f.market_label ? `${f.market_label} · ${f.name}` : f.name}</option>)}
                </select>
              )}
              {simChains.length > 1 && (
                <select data-pv-blur className="ad-in" name="pp" defaultValue={ppView ?? ""}>
                  <option value="">La que ve un comprador real</option>
                  {simChains.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (pausada)"}</option>)}
                </select>
              )}
              <button className="ad-btn sm">Ver</button>
            </form>
          ) : undefined}>
          <PostcompraLevels flow={flow} simUrl={`/oferta/simulacion?store=${encodeURIComponent(store.slug)}&funnel=${simFunnel.id}${ppQ}`} />
        </Card>

        <Card className="mt" title={flow.chainName ? `Flujo post-compra · ${flow.chainName}` : "Flujo post-compra"} sub="Cada «Compra» y cada «No, gracias», para cada comprador, hasta las descargas.">
          <PostcompraFlow flow={flow} />
        </Card>

    </>
  );
}

/** «Se dispara»: qué cadena ve este comprador. */
async function SimBox({ storeId, funnelId, picked, ppView }: { storeId: string; funnelId: string; picked: string[]; ppView: string | null }) {
  const sim = await simulate(storeId, funnelId, picked, { includePaused: true, ppFunnelId: ppView });
  return (
    <>
            <div className="mt-4 rounded-xl bg-zinc-50 p-4 dark:bg-white/[0.03]">
              <div className="text-[11.5px] font-bold text-zinc-400">Se dispara</div>
              <div className="mb-2 mt-1 font-bold" data-pv-blur>{sim.name ?? (sim.steps.length ? "La cadena simple del checkout" : "Nada: va directo a las descargas")}</div>
              {sim.steps.length > 0 && <ol className="m-0 list-decimal pl-5 leading-relaxed">{sim.steps.map((p) => <li key={p.id}><Pv as={productAlias(p.id)}>{p.short_name}</Pv></li>)}</ol>}
            </div>
    </>
  );
}
