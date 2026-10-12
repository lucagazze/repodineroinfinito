import { FlaskConical } from "lucide-react";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, type Locale } from "@/lib/i18n";
import { scopeFor } from "@/lib/admin/offers";
import { Card, PageHead, Badge, Empty } from "@/components/admin/ui";
import {
  DEFAULT_TEST_EMAIL, TEST_COUNTRIES, defaultCountry, deleteTestOrder, recentTestOrders, sendTestMails,
} from "@/lib/test-purchase";

export const dynamic = "force-dynamic";

/**
 * Compra de prueba: recorre el checkout como un comprador real, sin cobrar.
 * Resumen del checkout → cadena post-compra real (sí/no, downsells,
 * condiciones) → pedido de prueba con el mail de entrega real → gracias.
 * Los pedidos de prueba (status 'test') solo aparecen acá.
 */

async function resend(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await sendTestMails(id).catch((e) => console.error("[prueba] reenviar:", (e as Error).message));
  revalidatePath(String(formData.get("back") ?? "/admin"));
}

async function remove(formData: FormData) {
  "use server";
  await requireAdmin();
  await deleteTestOrder(String(formData.get("id") ?? ""));
  revalidatePath(String(formData.get("back") ?? "/admin"));
}

export default async function CompraPrueba({
  params, searchParams,
}: { params: Promise<{ offer: string }>; searchParams: Promise<{ f?: string; pp?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const sp = await searchParams;
  const store = sc.store;
  const funnel = sc.markets.find((f) => f.id === sp.f) ?? sc.markets[0] ?? null;
  const back = `${sc.base}/compra-prueba`;

  const [{ data: items }, tests, { data: chains }] = await Promise.all([
    funnel
      ? db.from("funnel_items").select("role,sort_order,products(id,short_name)").eq("funnel_id", funnel.id).eq("role", "bump").order("sort_order")
      : Promise.resolve({ data: [] }),
    recentTestOrders(sc.funnelIds),
    funnel
      ? db.from("pp_funnels").select("id,name,active").eq("checkout_funnel_id", funnel.id).order("sort_order")
      : Promise.resolve({ data: [] as { id: string; name: string; active: boolean }[] }),
  ]);
  const bumps = ((items ?? []) as unknown as { products: { id: string; short_name: string } | null }[])
    .map((i) => i.products).filter((p): p is { id: string; short_name: string } => !!p);
  const country = funnel ? defaultCountry(funnel.market_label, store.default_locale) : "US";

  return (
    <>
      <PageHead title="Compra de prueba" icon={<FlaskConical className="h-[18px] w-[18px]" />} color="#f59e0b"
        sub="El recorrido completo de un comprador, sin cobrar: checkout, ofertas post-compra y el mail de entrega real." />

      <div className="ad-grid g-21">
        <Card title="Nueva prueba" sub="Se abre en otra pestaña. Nada pasa por Stripe ni por Meta.">
          {funnel ? (
            <>
              {sc.markets.length > 1 && (
                <form method="get" className="ad-form mb-4">
                  <div className="ad-field">
                    <span className="lbl">Checkout</span>
                    <select className="ad-in" name="f" defaultValue={funnel.id}>
                      {sc.markets.map((f) => <option key={f.id} value={f.id}>{f.market_label ? `${f.market_label} · ${f.name}` : f.name}</option>)}
                    </select>
                  </div>
                  <div><button className="ad-btn sm">Cambiar</button></div>
                </form>
              )}
              <form method="get" action="/oferta/prueba" target="_blank" className="ad-form">
                <input type="hidden" name="store" value={store.slug} />
                <input type="hidden" name="funnel" value={funnel.id} />
                <div className="ad-field">
                  <span className="lbl">País del comprador</span>
                  <select className="ad-in" name="country" defaultValue={country}>
                    {TEST_COUNTRIES.map(([cc, label]) => <option key={cc} value={cc}>{label} ({cc})</option>)}
                  </select>
                  <span className="ad-note">Define la moneda, como en el checkout real. El idioma es el de la oferta (si tiene uno fijo).</span>
                </div>
                <div className="ad-field">
                  <span className="lbl">Mail donde llega la entrega</span>
                  <input className="ad-in" type="email" name="email" defaultValue={DEFAULT_TEST_EMAIL} required />
                </div>
                <div className="ad-field">
                  <span className="lbl">Nombre</span>
                  <input className="ad-in" name="name" defaultValue="Prueba" />
                </div>
                {(chains ?? []).length > 1 && (
                  <div className="ad-field">
                    <span className="lbl">Cadena post-compra</span>
                    <select className="ad-in" name="pp" defaultValue={(chains ?? []).some((c) => c.id === sp.pp) ? sp.pp : ""}>
                      <option value="">La que ve un comprador real</option>
                      {(chains ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (pausada)"}</option>)}
                    </select>
                    <span className="ad-note">Para probar una cadena pausada antes de prenderla.</span>
                  </div>
                )}
                {bumps.length > 0 && (
                  <div className="ad-field">
                    <span className="lbl">Bumps que toma en el checkout</span>
                    <div className="grid gap-1.5">
                      {bumps.map((b) => (
                        <label key={b.id} className="ad-check"><input type="checkbox" name="bumps" value={b.id} /> {b.short_name}</label>
                      ))}
                    </div>
                  </div>
                )}
                <div><button className="ad-btn primary">Empezar compra de prueba</button></div>
              </form>
            </>
          ) : <p className="ad-note">Esta oferta no tiene checkouts.</p>}
        </Card>

        <Card title="Qué hace y qué no">
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed">
            <li>Muestra el resumen del checkout en el idioma y la moneda de ese comprador.</li>
            <li>Sigue la cadena post-compra real: cada «Sí» y cada «No», downsells y condiciones (por ejemplo, si tomó el bump).</li>
            <li>Al final crea un pedido de prueba y manda el mail de entrega real (y uno por cada oferta aceptada, como en una compra), y abre la página de gracias de ese pedido.</li>
            <li>No cobra, no pasa por Stripe, no manda compras a Meta ni al webhook de ventas, y no aparece en ventas, clientes ni métricas.</li>
          </ul>
        </Card>
      </div>

      <Card className="mt" title="Pruebas recientes" sub="Solo se ven acá." pad={false}>
        {tests.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead><tr><th>Fecha</th><th>Mail</th><th>Compró</th><th className="num">Total</th><th>Envío</th><th /></tr></thead>
              <tbody>
                {tests.map((o) => {
                  const cur = o.currency ?? "USD";
                  const loc = ((o.locale as Locale) ?? "en") as Locale;
                  const total = o.items.reduce((a, i) => a + i.amount, 0);
                  const failed = o.mails.filter((m) => m.status !== "sent");
                  return (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap">{new Date(o.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        <span className="sub">{o.country} · {cur} · {o.locale}</span></td>
                      <td style={{ maxWidth: 200 }} className="break-all">{o.email}</td>
                      <td style={{ maxWidth: 320 }}>
                        <div className="flex flex-wrap gap-1">
                          {o.items.filter((i) => i.kind !== "included" && i.kind !== "bonus").map((i, k) => (
                            <Badge key={k} tone={i.kind === "upsell" ? "ok" : i.kind === "bump" ? "brand" : undefined}>{i.name}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">{money(total, cur, loc)}</td>
                      <td>
                        {o.mails.length
                          ? failed.length ? <Badge tone="bad">{failed.length} falló</Badge> : <Badge tone="ok" dot>{o.mails.length} enviado{o.mails.length > 1 ? "s" : ""}</Badge>
                          : <Badge tone="warn">sin mail</Badge>}
                        {o.delivery_error && <span className="sub">{o.delivery_error}</span>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <a className="ad-btn sm" href={`/gracias?session_id=${o.stripe_session_id}&done=1`} target="_blank" rel="noreferrer">Gracias</a>
                          <form action={resend}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><button className="ad-btn sm">Reenviar mail</button></form>
                          <form action={remove}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} /><button className="ad-btn sm danger">Borrar</button></form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Todavía no hay pruebas" icon={<FlaskConical className="h-5 w-5" />}>
            Empezá una arriba: llega el mismo mail que recibe un comprador.
          </Empty>
        )}
      </Card>
    </>
  );
}
