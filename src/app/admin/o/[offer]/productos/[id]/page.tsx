import Link from "next/link";
import { scopeFor, idsOrNone } from "@/lib/admin/offers";
import { notFound } from "next/navigation";
import { Box } from "lucide-react";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { money, KIND_LABEL, fmtDate } from "@/lib/admin-data";
import { usd2 } from "@/lib/admin/inicio";
import { Badge, Card, Checks, EmptyState, PageHead, Stat, Table } from "@/components/admin/ui";
import { IExternal } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { included: "Incluido", bonus: "Bono", bump: "Order bump", upsell: "Upsell" };

/** Ficha de un producto, solo para mirar: precios por moneda, entrega y en qué checkouts está. */
export default async function Producto({ params }: { params: Promise<{ offer: string; id: string }> }) {
  const { offer, id } = await params;
  const sc = await scopeFor(offer);
  const store = sc.store;
  const slug = store.slug;

  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const [{ data: p }, { data: items }, { data: mains }, { data: steps }, { data: sold }, rates] = await Promise.all([
    db.from("products")
      .select("id,slug,name,short_name,description,kind,active,show_in_catalog,image_url,email_image_url,delivery_url,delivery_links,delivery_file,delivery_file_name,created_at,updated_at,product_prices(currency,amount,compare_at,display_value,stripe_price_id)")
      .eq("id", id).eq("store_id", store.id).maybeSingle(),
    db.from("funnel_items").select("role,funnels(id,name,slug,active)").eq("product_id", id),
    db.from("funnels").select("id,name,slug,active").eq("main_product_id", id),
    db.from("pp_steps").select("pp_funnels(id,name,active)").eq("product_id", id),
    db.from("order_items").select("amount,currency,created_at,orders!inner(funnel_id,status)").eq("product_id", id).in("orders.funnel_id", idsOrNone(sc.funnelIds)).neq("orders.status", "test")
      .gte("created_at", since).gt("amount", 0),
    getRates(),
  ]);
  if (!p) notFound();

  type F = { id: string; name: string; slug: string; active: boolean };
  const uses = new Map<string, { f: F; roles: Set<string> }>();
  for (const m of (mains ?? []) as F[]) uses.set(m.id, { f: m, roles: new Set(["Principal"]) });
  for (const it of (items ?? []) as unknown as { role: string; funnels: F | null }[]) {
    if (!it.funnels) continue;
    const u = uses.get(it.funnels.id) ?? { f: it.funnels, roles: new Set<string>() };
    u.roles.add(ROLE[it.role] ?? it.role);
    uses.set(it.funnels.id, u);
  }
  const chains = ((steps ?? []) as unknown as { pp_funnels: { id: string; name: string; active: boolean } | null }[])
    .map((s) => s.pp_funnels).filter((x): x is { id: string; name: string; active: boolean } => !!x);

  const revenue = (sold ?? []).reduce((a, s) => a + Number(s.amount) / (rates[(s.currency ?? "USD").toUpperCase()] ?? 1), 0);
  const links = [
    ...(p.delivery_url ? [{ label: "Link principal", url: p.delivery_url }] : []),
    ...((p.delivery_links ?? []) as { label?: string; url?: string }[]).map((l) => ({ label: l.label || "Link extra", url: l.url ?? "" })),
  ];
  const prices = [...p.product_prices].sort((a, b) => (a.currency === "USD" ? -1 : b.currency === "USD" ? 1 : a.currency.localeCompare(b.currency)));
  const img = p.image_url ?? p.email_image_url;

  return (
    <>
      <PageHead crumb={[{ href: `${sc.base}/productos`, label: "Productos" }]} title={<Pv as={productAlias(p.id)}>{p.short_name}</Pv>}
        icon={<Box className="h-[18px] w-[18px]" />} color="#ec4899"
        sub={<><Pv as={productAlias(p.id)}>{p.name}</Pv> · <code data-pv-blur>{p.slug}</code></>}
        actions={<>
          <Badge tone={p.kind === "main" ? "brand" : p.kind === "upsell" ? "ok" : undefined}>{KIND_LABEL[p.kind] ?? p.kind}</Badge>
          {p.active ? <Badge tone="ok" dot>Activo</Badge> : <Badge>Archivado</Badge>}
        </>} />

      <div className="ad-grid g-21">
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <div className="ad-grid g-kpi">
            <Card><Stat size="md" label="Ventas (90 días)" value={sold?.length ?? 0} hint="En esta oferta" /></Card>
            <Card><Stat size="md" label="Facturado (90 días)" value={usd2(revenue)} hint="En dólares, al tipo de hoy" /></Card>
            <Card><Stat size="md" label="Checkouts" value={uses.size} /></Card>
          </div>

          <Card title="Precios por moneda" sub="Las monedas sin precio propio pagan el de USD convertido al tipo del día." pad={false}>
            {prices.length ? (
              <Table head={["Moneda", { label: "Precio", num: true }, { label: "Tachado", num: true, hideM: true }, { label: "Valor que se muestra", num: true, hideM: true }, { label: "Stripe", hideM: true }]}>
                {prices.map((pr) => (
                  <tr key={pr.currency}>
                    <td><Badge tone="brand">{pr.currency}</Badge></td>
                    <td className="num"><b>{pr.amount == null ? "—" : Number(pr.amount) > 0 ? money(pr.amount, pr.currency) : "gratis"}</b></td>
                    <td className="num hide-m">{pr.compare_at != null ? <s className="text-zinc-400">{money(pr.compare_at, pr.currency)}</s> : "—"}</td>
                    <td className="num hide-m">{pr.display_value != null ? money(pr.display_value, pr.currency) : "—"}</td>
                    <td className="hide-m">{pr.stripe_price_id ? <code>{pr.stripe_price_id}</code> : <span className="text-zinc-400">—</span>}</td>
                  </tr>
                ))}
              </Table>
            ) : <EmptyState title="Sin precios cargados" />}
          </Card>

          <Card title="Entrega" sub="Lo que recibe el comprador en el mail y en la página de gracias."><div data-pv-blur>
            {links.length ? (
              <Checks items={links.map((l) => ({
                status: /^https:\/\//.test(l.url) ? "ok" : "bad",
                title: l.label,
                detail: <a className="ad-link-a break-all" style={{ whiteSpace: "normal" }} href={l.url} target="_blank" rel="noreferrer">{l.url}</a>,
              }))} />
            ) : p.kind === "bonus"
              ? <p className="ad-note">Sin link propio: va dentro de la carpeta del producto principal.</p>
              : p.delivery_file
              ? <Checks items={[{ status: "ok", title: "Archivo propio",
                  detail: <span className="break-all">{String(p.delivery_file_name || p.delivery_file)}<br /><span className="ad-note">Se entrega desde la app con un link firmado por compra. No hace falta carpeta.</span></span> }]} />
              : <Checks items={[{ status: "bad", title: "Sin link de entrega", detail: "Quien lo compre no recibe nada. Pedile a Claude que cargue el link." }]} />}
          </div></Card>

          {p.description && (
            <Card title="Descripción"><p data-pv-blur className="ad-note whitespace-pre-line">{p.description}</p></Card>
          )}
        </div>

        <div className="ad-grid" style={{ alignContent: "start" }}>
          {img && (
            <Card>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-pv-img src={img} alt="" className="mx-auto max-h-72 rounded-xl" />
            </Card>
          )}
          <Card title="En qué checkouts está" pad={false}>
            {uses.size ? (
              <ul className="m-0 list-none divide-y divide-zinc-100 p-0 dark:divide-white/[0.05]">
                {[...uses.values()].map(({ f, roles }) => (
                  <li key={f.id} className="flex items-center gap-2 px-5 py-3">
                    <Link href={`${sc.base}/embudos/${f.id}`} className="min-w-0 flex-1 truncate font-bold text-zinc-800 hover:underline dark:text-zinc-100"><Pv as="Checkout">{f.name}</Pv></Link>
                    {[...roles].map((r) => <Badge key={r} tone={r === "Principal" ? "brand" : undefined}>{r}</Badge>)}
                    {!f.active && <Badge>Pausado</Badge>}
                    {!sc.funnelIds.includes(f.id) && <Badge>Otra oferta</Badge>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No está en ningún checkout" />}
          </Card>
          {chains.length > 0 && (
            <Card title="Se ofrece en el post-pago">
              <div className="flex flex-wrap gap-1.5">{chains.map((c) => <Badge key={c.id} tone={c.active ? "ok" : undefined}><Pv as="Cadena">{c.name}</Pv></Badge>)}</div>
            </Card>
          )}
          <Card title="Datos">
            <dl className="ad-dl">
              <dt>En el catálogo</dt><dd>{p.show_in_catalog ? <Badge tone="ok" dot>Se muestra</Badge> : <Badge>Oculto</Badge>}</dd>
              <dt>Imagen</dt><dd>{img ? <a className="ad-link-a" href={img} target="_blank" rel="noreferrer">Abrir <IExternal size={12} /></a> : "—"}</dd>
              <dt>Imagen para mails</dt><dd>{p.email_image_url ? <Badge tone="ok">JPG cargado</Badge> : <Badge tone="warn">Sin JPG (Outlook no muestra WebP)</Badge>}</dd>
              <dt>Creado</dt><dd>{fmtDate(p.created_at)}</dd>
              <dt>Actualizado</dt><dd>{fmtDate(p.updated_at)}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
