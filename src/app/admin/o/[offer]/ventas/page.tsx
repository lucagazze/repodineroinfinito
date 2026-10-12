import Link from "next/link";
import { scopeFor, idsOrNone } from "@/lib/admin/offers";
import { Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { fmtDate, money } from "@/lib/admin-data";
import { Card, PageHead, Badge, Empty, Flag } from "@/components/admin/ui";
import { IDownload } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";
import { resolveRange, RANGE_TZ } from "@/lib/admin/range";
import RangeBar from "@/components/admin/RangeBar";
import { addDays, startOfDay } from "@/lib/admin/tz";
import { REAL_STATUSES, deliveryData, deliveryFact, payFact } from "@/lib/admin/order-facts";
import { FactChip } from "@/components/admin/OrderFacts";
import ResendButton from "@/components/admin/ResendButton";
import { orderRef, parseOrderNumber } from "@/lib/order-ref";
import { stepTags } from "@/lib/postpurchase";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function Pedidos({
  params, searchParams,
}: {
  params: Promise<{ offer: string }>;
  searchParams: Promise<{ q?: string; estado?: string; embudo?: string; p?: string; r?: string; desde?: string; hasta?: string }>;
}) {
  const sc = await scopeFor((await params).offer);
  const sp = await searchParams;
  const R = resolveRange(sp);
  const store = sc.store;
  const slug = store.slug;
  const page = Math.max(1, Number(sp.p ?? 1));
  const base = `${sc.base}/ventas`;

  // Una sola ida a la base: los items van embebidos en cada pedido.
  let q = db
    .from("orders")
    .select("id,number,pp_funnel_id,created_at,email,name,country,currency,amount_total,amount_refunded,status,delivered_at,fulfill_claimed_at,delivery_error,funnel_id,order_items(kind,amount,product_id,products(short_name))", { count: "exact" })
    .eq("store_id", store.id)
    .in("funnel_id", idsOrNone(sc.funnelIds))
    .neq("status", "test") // compras de prueba: solo en «Compra de prueba»
    .gte("created_at", startOfDay(R.since, RANGE_TZ).toISOString())
    .lt("created_at", startOfDay(addDays(R.until, 1), RANGE_TZ).toISOString())
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  // Solo compras de verdad: pagadas o reembolsadas. Las de prueba nunca; los
  // intentos sin pagar (pending) son carritos y se ven solo si se piden.
  q = sp.estado && ["paid", "pending", "refunded"].includes(sp.estado) ? q.eq("status", sp.estado) : q.in("status", [...REAL_STATUSES]);
  // Una venta tiene el pago en Stripe y monto: un «pagado» sin eso no se lista (queda en Avisos).
  if (sp.estado !== "pending") q = q.or(HAS_STRIPE).gt("amount_total", 0);
  if (sp.embudo) q = q.eq("funnel_id", sp.embudo);
  if (sp.q) {
    // Coma y paréntesis rompen el filtro "or" de PostgREST: se sacan.
    const term = sp.q.replace(/[,()]/g, " ").trim();
    // «1001» o «#1001»: también el número de pedido.
    const n = parseOrderNumber(term);
    if (term) q = q.or(`email.ilike.%${term}%,name.ilike.%${term}%${n ? `,number.eq.${n}` : ""}`);
  }
  const { data: orders, count } = await q;
  // «OTO 1», «DS 2» de cada cadena post-compra de la página (como en el push).
  const ppIds = [...new Set((orders ?? []).map((o) => o.pp_funnel_id).filter(Boolean) as string[])];
  const tagsByPp = new Map(await Promise.all(ppIds.map(async (pp) => [pp, await stepTags(pp)] as const)));
  const { logs, downloads } = await deliveryData((orders ?? []).map((o) => o.id));
  const funnels = sc.funnels;
  const fName = new Map(funnels.map((f) => [f.id, f.market_label || f.name]));

  type Item = { kind: string; amount: number; product_id: string | null; products: { short_name: string } | null };
  const extra = new Map<string, { items: Item[]; total: number }>();
  for (const o of orders ?? []) {
    const items = ((o.order_items ?? []) as unknown as Item[]).filter((it) => it.kind === "bump" || it.kind === "upsell");
    extra.set(o.id, { items, total: items.filter((it) => it.kind === "upsell").reduce((a, it) => a + Number(it.amount), 0) });
  }

  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, estado: sp.estado, embudo: sp.embudo, r: sp.r, desde: sp.desde, hasta: sp.hasta, ...over })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : "";
  };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHead
        title="Pedidos"
        icon={<Receipt className="h-[18px] w-[18px]" />} color="#ec4899"
        sub={`${count ?? 0} pedidos · ${R.label}`}
        actions={<>
          <a className="ad-btn" href={`/api/admin/export?store=${slug}&oferta=${sc.offer.id}${qs({}).replace("?", "&")}`}>
            <IDownload size={15} /> Exportar CSV
          </a>
        </>}
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />

      <form className="ad-card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {/* El rango de fechas sigue puesto al filtrar. */}
        {sp.r && <input type="hidden" name="r" value={sp.r} />}
        {sp.desde && <input type="hidden" name="desde" value={sp.desde} />}
        {sp.hasta && <input type="hidden" name="hasta" value={sp.hasta} />}
        <input className="ad-in" name="q" defaultValue={sp.q} placeholder="Buscar por email, nombre o #pedido" style={{ flex: "1 1 220px" }} />
        <select className="ad-in" name="estado" defaultValue={sp.estado ?? ""} style={{ flex: "0 1 170px" }}>
          <option value="">Pagados y reembolsados</option>
          <option value="paid">Solo pagados</option>
          <option value="refunded">Solo reembolsados</option>
          <option value="pending">Intentos sin pagar</option>
        </select>
        <select data-pv-blur className="ad-in" name="embudo" defaultValue={sp.embudo ?? ""} style={{ flex: "0 1 220px" }}>
          <option value="">Todos los checkouts</option>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.market_label ? `${f.market_label} · ${f.name}` : f.name}</option>)}
        </select>
        <button className="ad-btn primary">Filtrar</button>
        {(sp.q || sp.estado || sp.embudo) && <Link className="ad-btn ghost" href={`${base}${qs({ q: undefined, estado: undefined, embudo: undefined, p: undefined })}`}>Limpiar</Link>}
      </form>

      <Card pad={false}>
        {orders?.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Comprador</th><th className="hide-m">Checkout</th><th className="hide-m">Sumó</th>
                  <th className="num">Total</th><th>Pago y entrega</th><th className="hide-m">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const e = extra.get(o.id);
                  const total = Number(o.amount_total ?? 0) + (e?.total ?? 0);
                  const pay = payFact(o);
                  const del = deliveryFact(o, logs.get(o.id) ?? [], downloads.get(o.id) ?? []);
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link href={`${base}/${o.id}`} style={{ textDecoration: "none" }}>
                          <b style={{ fontWeight: 550 }}><Flag cc={o.country} /><Pv as={BUYER}>{o.name || "Sin nombre"}</Pv></b>
                          <span className="sub"><span className="font-mono">{orderRef(o)}</span> · <Pv as={EMAIL}>{o.email ?? "—"}</Pv></span>
                        </Link>
                      </td>
                      <td className="hide-m">{(() => { const f = funnels.find((x) => x.id === o.funnel_id); return f ? (f.market_label || <Pv as={checkoutAlias(null)}>{f.name}</Pv>) : "—"; })()}</td>
                      <td className="hide-m">
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {e?.items.map((it, i) => (
                            <span key={i} className={`inline-flex max-w-full items-center truncate rounded-md px-1.5 py-[1px] text-[10px] font-bold ring-1 ring-inset ${it.kind === "bump"
                              ? "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/25"
                              : "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25"}`}>
                              {it.kind === "bump" ? "+ Bump" : `+ ${tagsByPp.get(o.pp_funnel_id ?? "")?.get(it.product_id ?? "") ?? "OTO"}`} · <Pv as={it.product_id ? productAlias(it.product_id) : "Producto"}>{it.products?.short_name ?? "Producto"}</Pv>
                            </span>
                          ))}
                          {!e?.items.length && <span style={{ color: "var(--faint)" }}>—</span>}
                        </div>
                      </td>
                      <td className="num"><b style={{ fontWeight: 600 }}>{money(total, o.currency)}</b></td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <FactChip f={pay} time={false} />
                          {o.status === "paid" && <FactChip f={del} />}
                          {del.problem && <><ResendButton store={slug} orderId={o.id} /><Link href="/admin/avisos" className="text-[10.5px] font-bold text-red-600 hover:underline dark:text-red-400">Avisos</Link></>}
                        </div>
                      </td>
                      <td className="hide-m" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(o.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={sp.q || sp.estado || sp.embudo ? "No hay pedidos con ese filtro" : "Todavía no hay pedidos"}>
            Cuando alguien pague en tu checkout, aparece acá al instante.
          </Empty>
        )}
      </Card>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>Página {page} de {pages}</span>
          <div className="ad-actions">
            {page > 1 && <Link className="ad-btn sm" href={`${base}${qs({ p: String(page - 1) })}`}>Anterior</Link>}
            {page < pages && <Link className="ad-btn sm" href={`${base}${qs({ p: String(page + 1) })}`}>Siguiente</Link>}
          </div>
        </div>
      )}
    </>
  );
}
