import Link from "next/link";
import { signCartDiscount } from "@/lib/cart-discount";
import { Suspense } from "react";
import { scopeFor, idsOrNone, type Scope } from "@/lib/admin/offers";
import { ShoppingCart } from "lucide-react";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { usdFmt } from "@/lib/metrics";
import { fmtDate, money } from "@/lib/admin-data";
import { Card, PageHead, Badge, Empty, Kpi, Flag, SaveForm, Toggle, Field, Input } from "@/components/admin/ui";
import { IExternal } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, BUYER, EMAIL } from "@/lib/admin/privacy";
import { checkoutUrls } from "@/lib/admin/links";
import { resolveRange, RANGE_TZ, type Range } from "@/lib/admin/range";
import { SkCard } from "@/components/admin/Skeleton";
import RangeBar from "@/components/admin/RangeBar";
import { addDays, startOfDay } from "@/lib/admin/tz";
import { resolveSettings } from "@/lib/checkout-settings";
import { saveRecoveryAction, sendCartNowAction } from "@/lib/admin/cart-actions";

export const dynamic = "force-dynamic";

type Cart = {
  id: string; created_at: string; email: string | null; name: string | null; country: string | null; currency: string | null; amount: number | null;
  bumps: string[] | null; funnel_id: string | null; status: string; recovery_sent_at: string | null; recovery_pct: number | null;
  recovery_expires_at: string | null; recovery_email_log_id: string | null; recovery_source: string | null; recovery_skip: string | null;
  recovered_order_id: string | null;
};

/**
 * Carritos abandonados: quién dejó el email y no pagó, qué tenía, el mail con
 * IA y descuento que le salió (abierto, clic) y si volvió a comprar con él
 * (lo recuperado). Abajo, los ajustes de la recuperación de cada checkout.
 */
export default async function Carritos({
  params, searchParams,
}: { params: Promise<{ offer: string }>; searchParams: Promise<{ ver?: string; r?: string; desde?: string; hasta?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const sp = await searchParams;
  const R = resolveRange(sp);
  // El encabezado y el filtro al instante; los carritos (dos tandas de consultas) llegan con su esqueleto.
  return (
    <>
      <PageHead
        title="Carritos abandonados"
        icon={<ShoppingCart className="h-[18px] w-[18px]" />} color="#f97316"
        sub="Dejaron el email en el checkout pero no pagaron. Les sale un mail escrito por la IA con un descuento sobre lo que tenían en el carrito."
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <Suspense key={`${R.since}-${R.until}-${sp.ver ?? ""}`} fallback={<div data-skeleton className="grid gap-4"><div className="ad-grid g-kpi">{[0, 1, 2, 3].map((i) => <SkCard key={i} rows={1} title={false} />)}</div><SkCard rows={8} h={360} /></div>}>
        <CartsBody sc={sc} R={R} ver={sp.ver ?? ""} />
      </Suspense>
    </>
  );
}

async function CartsBody({ sc, R, ver }: { sc: Scope; R: Range; ver: string }) {
  const store = sc.store;
  const here = `${sc.base}/carritos`;
  const since = startOfDay(R.since, RANGE_TZ).toISOString();
  const end = startOfDay(addDays(R.until, 1), RANGE_TZ).getTime();
  // Un carrito recién abierto todavía no es abandonado: 30 minutos de margen.
  const cutoff = new Date(Math.min(end, Date.now() - 30 * 60_000)).toISOString();

  const [{ data: cartRows }, { data: fsets }, rates] = await Promise.all([
    db.from("checkouts")
      .select("id,created_at,email,name,country,currency,amount,bumps,funnel_id,status,recovery_sent_at,recovery_pct,recovery_expires_at,recovery_email_log_id,recovery_source,recovery_skip,recovered_order_id")
      .eq("store_id", store.id).in("funnel_id", idsOrNone(sc.funnelIds)).not("email", "is", null)
      .or("status.eq.open,recovered_order_id.not.is.null")
      .gte("created_at", since).lte("created_at", cutoff)
      .order("created_at", { ascending: false }).limit(300),
    db.from("funnels").select("id,settings,main_product_id").in("id", idsOrNone(sc.funnelIds)),
    getRates(),
  ]);
  const carts = (cartRows ?? []) as Cart[];
  const fun = new Map(sc.funnels.map((f) => [f.id, f]));
  const settingsOf = new Map((fsets ?? []).map((f) => [f.id, resolveSettings(f.settings).recovery]));
  const usd = (n: number, c: string | null) => n / (rates[(c ?? "USD").toUpperCase()] ?? 1);

  // Qué tenía: el principal del checkout y los bumps, por nombre.
  const mainIds = [...new Set((fsets ?? []).map((f) => f.main_product_id).filter(Boolean) as string[])];
  const bumpSlugs = [...new Set(carts.flatMap((c) => c.bumps ?? []))];
  const logIds = carts.map((c) => c.recovery_email_log_id).filter(Boolean) as string[];
  const orderIds = carts.map((c) => c.recovered_order_id).filter(Boolean) as string[];
  const [{ data: prods }, { data: logs }, { data: orders }] = await Promise.all([
    db.from("products").select("id,slug,short_name").eq("store_id", store.id).or(
      [mainIds.length ? `id.in.(${mainIds.join(",")})` : "", bumpSlugs.length ? `slug.in.(${bumpSlugs.map((s) => `"${s}"`).join(",")})` : ""].filter(Boolean).join(",") || "id.is.null"),
    logIds.length ? db.from("email_log").select("id,opened_at,open_count,clicked_at,bounced_at,status").in("id", logIds) : Promise.resolve({ data: [] as { id: string; opened_at: string | null; open_count: number; clicked_at: string | null; bounced_at: string | null; status: string }[] }),
    orderIds.length ? db.from("orders").select("id,amount_total,currency,discount").in("id", orderIds) : Promise.resolve({ data: [] as { id: string; amount_total: number; currency: string; discount: unknown }[] }),
  ]);
  const prodById = new Map((prods ?? []).map((p) => [p.id, p]));
  const prodBySlug = new Map((prods ?? []).map((p) => [p.slug, p]));
  const mainOf = new Map((fsets ?? []).map((f) => [f.id, f.main_product_id ? prodById.get(f.main_product_id) : undefined]));
  const logOf = new Map((logs ?? []).map((l) => [l.id, l]));
  const orderOf = new Map((orders ?? []).map((o) => [o.id, o]));

  const pending = carts.filter((c) => c.status === "open" && !c.recovery_sent_at && !c.recovery_skip);
  const sent = carts.filter((c) => c.recovery_sent_at);
  const opened = sent.filter((c) => c.recovery_email_log_id && logOf.get(c.recovery_email_log_id)?.opened_at);
  const recovered = carts.filter((c) => c.recovered_order_id && orderOf.get(c.recovered_order_id));
  const recoveredValue = recovered.reduce((a, c) => { const o = orderOf.get(c.recovered_order_id!)!; return a + usd(Number(o.amount_total ?? 0), o.currency); }, 0);
  const pendingValue = pending.reduce((a, c) => a + usd(Number(c.amount ?? 0), c.currency), 0);

  const view = ver;
  const rows = carts.filter((c) => view === "enviados" ? c.recovery_sent_at : view === "recuperados" ? c.recovered_order_id : view === "omitidos" ? c.recovery_skip && !c.recovery_sent_at : view === "todos" ? true : c.status === "open" && !c.recovery_sent_at && !c.recovery_skip);
  const tabs = [["", "Sin contactar"], ["enviados", "Con mail"], ["recuperados", "Recuperados"], ["omitidos", "No se les manda"], ["todos", "Todos"]] as const;
  const markets = sc.markets.filter((f) => !f.solo);

  return (
    <>
      <div className="ad-grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Sin contactar" value={String(pending.length)} hint={`${usdFmt(pendingValue)} en juego`} />
        <Kpi label="Mails enviados" value={String(sent.length)} hint={sent.length ? `${opened.length} abiertos` : R.label.toLowerCase()} />
        <Kpi label="Recuperados" value={String(recovered.length)} hint={sent.length ? `${Math.round((recovered.length / sent.length) * 100)} % de los mails` : "pagaron con el descuento"} />
        <Kpi label="Recuperado" value={usdFmt(recoveredValue)} hint="cobrado con el descuento del mail" />
      </div>

      <div className="ad-seg" style={{ marginBottom: 12 }}>
        {tabs.map(([k, l]) => <Link key={k} href={k ? `${here}?ver=${k}` : here} className={view === k ? "on" : ""}>{l}</Link>)}
      </div>

      <Card pad={false}>
        {rows.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead><tr><th>Persona</th><th className="hide-m">Tenía en el carrito</th><th className="num">Carrito</th><th>Mail</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const f = fun.get(c.funnel_id ?? "");
                  // Si ya se le mandó el mail con descuento (vigente y sin usar), el botón abre ese mismo link,
                  // con el descuento aplicado; si no, su checkout con el email cargado.
                  const disc = c.recovery_pct && c.recovery_expires_at && !c.recovered_order_id && +new Date(c.recovery_expires_at) > Date.now()
                    ? signCartDiscount(c.id, c.recovery_pct, new Date(c.recovery_expires_at)) : null;
                  const link = f ? `${checkoutUrls(store, f).primary}?${disc ? `r=${encodeURIComponent(disc)}&` : ""}email=${encodeURIComponent(c.email!)}` : null;
                  const main = mainOf.get(c.funnel_id ?? "");
                  const log = c.recovery_email_log_id ? logOf.get(c.recovery_email_log_id) : null;
                  const o = c.recovered_order_id ? orderOf.get(c.recovered_order_id) : null;
                  const rec = settingsOf.get(c.funnel_id ?? "");
                  return (
                    <tr key={c.id}>
                      <td>
                        <b style={{ fontWeight: 550 }}><Flag cc={c.country} /><Pv as={BUYER}>{c.name || "Sin nombre"}</Pv></b>
                        <span className="sub"><Pv as={EMAIL}>{c.email}</Pv></span>
                        <span className="sub">{fmtDate(c.created_at)}</span>
                      </td>
                      <td className="hide-m">
                        {main ? <Pv as={productAlias(main.id)}>{main.short_name}</Pv> : (f?.name ?? "—")}
                        {(c.bumps ?? []).map((b) => { const p = prodBySlug.get(b); return <span key={b} className="sub">+ {p ? <Pv as={productAlias(p.id)}>{p.short_name}</Pv> : b}</span>; })}
                        <span className="sub">{f ? (f.market_label || f.name) : ""}</span>
                      </td>
                      <td className="num"><b style={{ fontWeight: 600 }}>{money(c.amount, c.currency)}</b></td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {o ? <Badge tone="ok" dot>Recuperado · {money(o.amount_total, o.currency)}</Badge> : null}
                          {c.recovery_sent_at ? (
                            <>
                              {c.recovery_pct != null
                                ? <Badge tone="brand">{c.recovery_pct ? `−${c.recovery_pct}%` : "Recordatorio"} · {c.recovery_source === "ai" ? "IA" : "respaldo"}</Badge>
                                : <Badge>Mail anterior, sin descuento</Badge>}
                              {log?.status === "failed" ? <Badge tone="bad">Falló</Badge> : log?.bounced_at ? <Badge tone="bad">Rebotó</Badge> : <Badge>Enviado</Badge>}
                              {log?.opened_at && <Badge tone="ok">Abierto{log.open_count > 1 ? ` (${log.open_count})` : ""}</Badge>}
                              {log?.clicked_at && <Badge tone="ok">Clic</Badge>}
                            </>
                          ) : c.recovery_skip ? (
                            <Badge>{c.recovery_skip}</Badge>
                          ) : rec && !rec.enabled ? (
                            <Badge>Recuperación apagada</Badge>
                          ) : (
                            <Badge tone="warn">Sin contactar</Badge>
                          )}
                        </div>
                        {c.recovery_sent_at && <span className="sub">{fmtDate(c.recovery_sent_at)}{c.recovery_expires_at && !o ? ` · vence ${fmtDate(c.recovery_expires_at)}` : ""}</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {!c.recovery_sent_at && (!c.recovery_skip || c.recovery_skip.startsWith("no salió")) && c.status === "open" && rec?.enabled && (
                          <SaveForm action={sendCartNowAction.bind(null, c.id)} submit="Mandar ya" pendingText="…" variant="secondary" size="sm"
                            className="inline-flex items-center gap-2" confirm={`¿Mandarle ya el mail con −${rec.discountPercent}% a ${c.email}?`} />
                        )}
                        {link && <a className="ad-btn sm ghost" href={link} target="_blank" rel="noreferrer" title={disc ? `Abrir su checkout con el −${c.recovery_pct}% del mail` : "Abrir su checkout"}><IExternal size={13} /></a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={view ? "Nada en esta vista" : "No hay carritos para recuperar"}>
            Aparecen acá cuando alguien escribe su email en el checkout y no termina de pagar.
          </Empty>
        )}
      </Card>

      <div className="ad-sec"><h2>Ajustes de la recuperación</h2></div>
      <div className="ad-grid g-2">
        {markets.map((f) => {
          const r = settingsOf.get(f.id) ?? resolveSettings(null).recovery;
          return (
            <Card key={f.id} title={f.market_label || f.name}
              sub={r.enabled ? `Prendida: −${r.discountPercent}% por ${r.validHours} h, a los ${r.delayMinutes} min sin pagar.` : "Apagada: no se manda nada a los carritos de este checkout."}>
              <SaveForm action={saveRecoveryAction.bind(null, f.id)} submit="Guardar" pendingText="Guardando…" size="md" variant="secondary">
                <Toggle name="enabled" defaultChecked={r.enabled} label="Mandar el mail de carrito abandonado"
                  hint="En Alemania y Austria se necesita consentimiento previo: a esos compradores no se les manda nunca, aunque esté prendido." />
                <div className="ad-row">
                  <Field label="Descuento (%)"><Input name="discountPercent" type="number" min={1} max={90} defaultValue={r.discountPercent} /></Field>
                  <Field label="Espera (minutos)"><Input name="delayMinutes" type="number" min={15} max={2880} defaultValue={r.delayMinutes} /></Field>
                  <Field label="Vale (horas)"><Input name="validHours" type="number" min={1} max={168} defaultValue={r.validHours} /></Field>
                </div>
              </SaveForm>
            </Card>
          );
        })}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "12px 0 0" }}>
        Sale solo, cada 10 minutos. No le llega a quien ya compró, se dio de baja, rebotó, es una dirección de prueba o un robot, ni más de uno por persona y checkout cada 7 días.
        El descuento vale para lo que tenía en el carrito; un bump que agregue después va a precio normal.
      </p>
    </>
  );
}
