import { Fragment } from "react";
import { scopeFor, offerKeyOfFunnel } from "@/lib/admin/offers";
import Link from "next/link";
import { deliveryData, deliveryFact, payFact } from "@/lib/admin/order-facts";
import { FactChip } from "@/components/admin/OrderFacts";
import ResendButton from "@/components/admin/ResendButton";
import { notFound, redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { db, getProductById, type Product } from "@/lib/db";
import { stripeForStore, dashboardUrl } from "@/lib/stripe";
import { resendDeliveryAction } from "@/lib/admin/actions";
import { fmtDate, money, countryName } from "@/lib/admin-data";
import { Card, PageHead, Badge, Flash, Thumb, Flag, SaveForm } from "@/components/admin/ui";
import { IExternal } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";
import { orderRef } from "@/lib/order-ref";
import { stepTags } from "@/lib/postpurchase";
import { downloadHref } from "@/lib/downloads";
import CopyDeliveryLinks from "@/components/admin/CopyDeliveryLinks";

const NL = String.fromCharCode(10);
/** El saludo del texto para copiar, en el idioma del comprador. */
const HELLO: Record<string, (n: string) => string> = {
  it: (n) => `Ciao${n ? ` ${n}` : ""}! Ecco tutti i tuoi materiali:`,
  en: (n) => `Hi${n ? ` ${n}` : ""}! Here are all your materials:`,
  es: (n) => `¡Hola${n ? ` ${n}` : ""}! Acá tenés todo tu material:`,
  fr: (n) => `Bonjour${n ? ` ${n}` : ""} ! Voici tous vos contenus :`,
  de: (n) => `Hallo${n ? ` ${n}` : ""}! Hier sind alle deine Materialien:`,
  pt: (n) => `Olá${n ? ` ${n}` : ""}! Aqui está todo o seu material:`,
};

export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; tone?: "ok" | "brand" | "warn" }> = {
  main: { label: "Principal" }, bump: { label: "Bump", tone: "brand" },
  upsell: { label: "Upsell", tone: "ok" }, bonus: { label: "Bono" }, included: { label: "Incluido" },
};

/** Un pedido. La única acción es reenviar el mail de entrega; reembolsos, por Claude o desde Stripe. */
export default async function Pedido({ params }: { params: Promise<{ offer: string; id: string }> }) {
  const { offer, id } = await params;
  const sc = await scopeFor(offer);
  const store = sc.store;
  const slug = store.slug;

  const { data: order } = await db.from("orders").select("*").eq("id", id).eq("store_id", store.id).maybeSingle();
  if (!order) notFound();
  // Un pedido de otra oferta de la misma tienda: a su oferta.
  if (!order.funnel_id || !sc.funnelIds.includes(order.funnel_id)) {
    const other = order.funnel_id ? await offerKeyOfFunnel(order.funnel_id) : null;
    if (other && other !== sc.key) redirect(`/admin/o/${other}/ventas/${id}`);
  }

  const funnel = sc.funnels.find((f) => f.id === order.funnel_id) ?? null;
  const [{ data: items }, { data: events }, { data: checkout }, { data: mails }, conn, tags] = await Promise.all([
    db.from("order_items").select("id,kind,amount,currency,product_id,stripe_payment_intent,refunded_amount,created_at").eq("order_id", id).order("created_at"),
    db.from("upsell_events").select("event,product_id,created_at").eq("order_id", id).order("created_at"),
    db.from("checkouts").select("created_at,utm").eq("order_id", id).maybeSingle(),
    db.from("email_log").select("kind,status,error,to_email,created_at").eq("order_id", id).order("created_at"),
    stripeForStore(store.id).catch(() => null),
    // «OTO 1», «DS 2»: el mismo nombre que en el push.
    stepTags(order.pp_funnel_id),
  ]);
  const facts = await deliveryData([id]);
  const pay = payFact(order);
  const del = deliveryFact(order, facts.logs.get(id) ?? [], facts.downloads.get(id) ?? []);
  const ids = [...new Set((items ?? []).map((i) => i.product_id).filter(Boolean) as string[])];
  const products = new Map((await Promise.all(ids.map((pid) => getProductById(pid)))).filter((p): p is Product => !!p).map((p) => [p.id, p]));

  const total = (items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(order.amount_total ?? 0);
  // «Copiar todos los links»: cada producto con sus links de entrega (sin los reembolsados), listo para
  // pegarle al comprador que no encuentra su material. Si un producto no tiene link propio, el de su libro base.
  const baseIds = [...new Set([...products.values()].map((p) => p.variant_of).filter((x): x is string => !!x && !products.has(x)))];
  const bases = new Map((await Promise.all(baseIds.map((pid) => getProductById(pid)))).filter((p): p is Product => !!p).map((p) => [p.id, p]));
  const seenLinks = new Set<string>();
  const deliveryLines = (items ?? []).flatMap((it) => {
    const p = products.get(it.product_id ?? "");
    if (!p || (Number(it.amount) > 0 && Number(it.refunded_amount) >= Number(it.amount))) return [];
    const src = (downloadHref(p, id) || (p.delivery_links ?? []).length) ? p : bases.get(p.variant_of ?? "") ?? p;
    const links = [downloadHref(src, id), ...(src.delivery_links ?? []).map((l) => l.url)].filter((u): u is string => !!u && !seenLinks.has(u));
    links.forEach((u) => seenLinks.add(u));
    if (!links.length) return [];
    const name = p.short_name || p.name;
    return [links.length === 1 ? `• ${name}: ${links[0]}` : [`• ${name}:`, ...links.map((u) => `   ${u}`)].join(NL)];
  });
  const firstName = String(order.name ?? "").trim().split(/\s+/)[0] ?? "";
  const lang = String(order.locale ?? "en").slice(0, 2);
  const deliveryText = [(HELLO[lang] ?? HELLO.en)(firstName), "", ...deliveryLines].join(NL);
  const payments = [...new Set([order.stripe_payment_intent, ...(items ?? []).map((i) => i.stripe_payment_intent)].filter(Boolean) as string[])];

  // Orden por etapa y después por hora: el reloj del servidor y el de la base
  // pueden diferir unos segundos, y "email enviado" aparecía antes de "pagó".
  const timeline = ([
    checkout && { rank: 0, at: checkout.created_at, text: "Abrió el checkout" },
    { rank: 1, at: order.created_at, text: order.status === "pending" ? "Pago iniciado, esperando acreditación" : "Pagó" },
    ...(mails ?? []).map((m) => ({
      rank: 2, at: m.created_at,
      text: `${m.kind === "delivery" ? "Mail de entrega" : m.kind === "upsell" ? "Mail del upsell" : m.kind === "recovery" ? "Mail de recuperación" : "Mail"} ${m.status === "sent" ? "enviado" : `falló: ${m.error ?? ""}`}`,
    })),
    !(mails ?? []).length && order.delivered_at && { rank: 2, at: order.delivered_at, text: "Mail de entrega enviado" },
    ...(events ?? []).map((e) => ({
      rank: 3,
      at: e.created_at,
      text: `${{ view: "Vio", accept: "Compró", decline: "Rechazó", fail: "Falló el cobro de" }[e.event as "view"]} ${tags.has(e.product_id ?? "") ? `${tags.get(e.product_id ?? "")} · ` : ""}${products.get(e.product_id ?? "")?.short_name ?? "un upsell"}`,
    })),
    order.refunded_at && { rank: 4, at: order.refunded_at, text: "Reembolsado" },
    ...(facts.logs.get(id) ?? []).flatMap((l) => [
      l.opened_at && { rank: 2, at: l.opened_at, text: `Abrió el mail${l.open_count && l.open_count > 1 ? ` (${l.open_count} veces)` : ""}` },
      l.clicked_at && { rank: 2, at: l.clicked_at, text: "Hizo clic en el mail" },
      l.bounced_at && { rank: 2, at: l.bounced_at, text: `El mail rebotó${l.bounce_reason ? `: ${l.bounce_reason}` : ""}` },
    ]),
    ...(facts.downloads.get(id) ?? []).map((d) => ({ rank: 2, at: d.at, text: "Descargó" })),
  ].filter(Boolean) as { rank: number; at: string; text: string }[])
    .sort((a, b) => a.rank - b.rank || +new Date(a.at) - +new Date(b.at));

  const utm = { ...(checkout?.utm ?? {}), ...(order.utm ?? {}) } as Record<string, string>;
  // Dos hechos en castellano: el pago y la entrega (con el motivo real si algo falló).
  const status = (
    <div className="flex flex-wrap items-center gap-1.5">
      <FactChip f={pay} time={false} />
      {order.status === "paid" && <FactChip f={del} />}
      {del.problem && <><ResendButton store={slug} orderId={id} /><Link href="/admin/avisos" className="text-[11px] font-bold text-red-600 hover:underline dark:text-red-400">Avisos</Link></>}
    </div>
  );

  return (
    <>
      <PageHead
        crumb={[{ href: `${sc.base}/ventas`, label: "Pedidos" }]}
        icon={<Receipt className="h-[18px] w-[18px]" />} color="#ec4899"
        title={<>{money(total, order.currency)} · <Pv as={BUYER}>{order.name || order.email || "Pedido"}</Pv></>}
        sub={<>{orderRef(order)} · {fmtDate(order.created_at)} · {funnel ? <Link className="ad-link-a" href={`${sc.base}/embudos/${funnel.id}`}>{funnel.market_label || funnel.name}</Link> : "—"}</>}
        actions={<>{status}<Link className="ad-btn sm" href={`/admin/en-vivo/recorrido?pedido=${id}`}>Ver recorrido del comprador</Link><Link className="ad-btn sm" href={`/admin/informe/${id}`} title="Informe de actividad en inglés (IP, dispositivo, mails, descargas, OTOs, otras compras) para adjuntar a una disputa">Informe de actividad (PDF)</Link>{order.email && <a className="ad-btn sm" href={`/api/admin/biblioteca?store=${store.id}&email=${encodeURIComponent(order.email)}`} target="_blank" rel="noreferrer" title="Su «Mi biblioteca» tal cual la ve (sin poder comprar)">Ver su biblioteca</a>}</>}
      />
      {order.delivery_error && !order.delivered_at && <Flash bad={`La entrega falló: ${order.delivery_error}`} />}

      <div className="ad-grid g-21">
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="Productos" pad={false} action={<CopyDeliveryLinks text={deliveryText} count={deliveryLines.length} />}>
            <div className="ad-scroll">
              <table className="ad-table">
                <tbody>
                  {(items ?? []).map((it) => {
                    const p = products.get(it.product_id ?? "");
                    const k = it.kind === "upsell" ? { label: tags.get(it.product_id ?? "") ?? "OTO", tone: "ok" as const } : KIND[it.kind] ?? { label: it.kind };
                    return (
                      <tr key={it.id}>
                        <td>
                          <div className="ad-prod">
                            <Thumb src={p?.email_image_url ?? p?.image_url ?? null} />
                            <span className="min-w-0">
                              {p ? <Link href={`${sc.base}/productos/${p.id}`} className="block truncate font-bold hover:underline"><Pv as={productAlias(p.id)}>{p.short_name}</Pv></Link> : <b>Producto borrado</b>}
                              <span className="sub"><Badge tone={k.tone}>{k.label}</Badge>{Number(it.refunded_amount) > 0 && <> <Badge tone="bad">reembolsado {money(it.refunded_amount, it.currency ?? order.currency)}</Badge></>}</span>
                            </span>
                          </div>
                        </td>
                        <td className="num">{Number(it.amount) > 0 ? money(it.amount, it.currency ?? order.currency) : <span className="text-zinc-400">gratis</span>}</td>
                        <td className="hide-m num">{p?.delivery_url && <a className="ad-btn sm ghost" href={p.delivery_url} target="_blank" rel="noreferrer">Entrega <IExternal size={13} /></a>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between border-t border-zinc-100 px-5 py-3 font-bold dark:border-white/[0.05]">
              <span>Total cobrado</span><span>{money(total, order.currency)}</span>
            </div>
            {Number(order.amount_refunded) > 0 && (
              <div className="flex justify-between px-5 pb-3 text-[12.5px] font-semibold text-red-600 dark:text-red-400">
                <span>Reembolsado</span><span>{money(order.amount_refunded, order.currency)}</span>
              </div>
            )}
          </Card>

          <Card title="Historial"><div data-pv-blur>
            <ul className="ad-timeline">
              {timeline.map((t, i) => <li key={i}>{t.text}<small>{fmtDate(t.at)}</small></li>)}
            </ul></div>
          </Card>
        </div>

        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="Comprador">
            <dl className="ad-dl">
              <dt>Nombre</dt><dd><Pv as={BUYER}>{order.name ?? "—"}</Pv></dd>
              <dt>Email</dt><dd>{order.email ? <a className="ad-link-a" href={`mailto:${order.email}`}><Pv as={EMAIL}>{order.email}</Pv></a> : "—"}</dd>
              <dt>Teléfono</dt><dd><Pv as={HIDDEN}>{order.phone ?? "—"}</Pv></dd>
              <dt>País</dt><dd><Flag cc={order.country} />{countryName(order.country)}</dd>
              <dt>Idioma</dt><dd>{order.locale ?? "—"}</dd>
            </dl>
          </Card>

          <Card title="Entrega" sub={order.delivered_at ? `Enviada ${fmtDate(order.delivered_at)}` : "Todavía no se envió el mail de entrega."}>
            <SaveForm action={resendDeliveryAction.bind(null, slug, id)} submit="Reenviar mail de entrega" pendingText="Enviando…"
              variant="secondary" size="md" className="grid gap-2"
              confirm={order.email ? `¿Reenviar el mail de entrega a ${order.email}?` : undefined}>
              {(!order.email || order.status !== "paid") && <p className="ad-note">Solo se puede reenviar en un pedido pagado con email.</p>}
            </SaveForm>
          </Card>

          {payments.length > 0 && (
            <Card title="Pagos en Stripe" sub="Para reembolsar, pedíselo a Claude o hacelo desde Stripe.">
              <div className="grid gap-1.5">
                {payments.map((pi) => (
                  conn
                    ? <a key={pi} className="ad-btn justify-between" href={dashboardUrl(conn, pi)} target="_blank" rel="noreferrer"><span className="truncate font-mono text-[11.5px]">{pi}</span><IExternal size={14} /></a>
                    : <code key={pi}>{pi}</code>
                ))}
              </div>
            </Card>
          )}

          {Object.keys(utm).length > 0 && (
            <Card title="Origen">
              <dl data-pv-blur className="ad-dl">{Object.entries(utm).map(([k, v]) => <Fragment key={k}><dt>{k.replace("utm_", "")}</dt><dd>{v}</dd></Fragment>)}</dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
