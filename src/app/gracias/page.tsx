import { redirect } from "next/navigation";
import { checkoutUrl } from "@/lib/checkout-url";
import { brandFor } from "@/lib/brand";
import { db, getProductById, type Product } from "@/lib/db";
import { findOrder, refOf } from "@/lib/order-lookup";
import { resolveChain, firstPending } from "@/lib/postpurchase";
import { T, money, type Locale, DEFAULT_LOCALE } from "@/lib/i18n";
import { orderRef } from "@/lib/order-ref";
import { Shell, Card } from "@/components/ui";
import { MetaPixel } from "@/components/MetaPixel";
import Track from "@/components/Track";
import { purchasePixel } from "@/lib/purchase-pixel";
import { ThankYouView } from "./ThankYouView";
import { kindMap, thankYouItems, thankYouTitle, SUMMARY } from "./items";
import { TEST_PREFIX } from "@/lib/test-purchase";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** ¿Ya están guardados los productos del pedido? Espera hasta ~4 s (el webhook los inserta enseguida). */
async function itemsReady(orderId: string) {
  for (let i = 0; i < 8; i++) {
    const { count } = await db.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("kind", "main");
    if (count) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** La dirección de su checkout para volver a intentar (con el email cargado y el aviso). */
async function checkoutBack(pi: string) {
  const { data: ck } = await db.from("checkouts").select("email,funnels(slug,checkout_host,checkout_path,stores(slug))")
    .eq("stripe_payment_intent", pi).maybeSingle();
  const f = ck?.funnels as unknown as { slug: string; checkout_host: string | null; checkout_path: string | null; stores: { slug: string } | null } | null;
  if (!f?.stores) return null;
  const q = new URLSearchParams({ pago: "no", ...(ck?.email ? { email: ck.email } : {}) });
  return `${checkoutUrl(f, f.stores.slug)}?${q}`;
}

/** Configuración › Entrega › Página de gracias. Vacío = los textos de siempre. */
type Thankyou = { title?: string; message?: string; showSummary?: boolean; showSpam?: boolean };

export default async function Gracias({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; payment_intent?: string; done?: string; redirect_status?: string }>;
}) {
  const sp = await searchParams;
  const ref = refOf(sp);
  if (!ref) return <Shell><Card><h1>{T[DEFAULT_LOCALE].missingId}</h1></Card></Shell>;

  const order = await findOrder(ref);
  // Siempre el idioma en que compró.
  const locale = ((order?.locale as Locale) ?? DEFAULT_LOCALE) as Locale;
  const t = T[locale] ?? T.en;

  if (!order) {
    // Klarna, Cash App, Amazon Pay…: si el pago no se completó (canceló o lo rechazaron), Stripe lo
    // devuelve acá. No es «no encontramos tu pedido»: vuelve a su checkout, en su idioma, con el aviso.
    // (Pasó el 06/10 con una compradora de Nails USA que canceló en Klarna y se fue.)
    if (sp.redirect_status === "failed" && ref.startsWith("pi_")) {
      const back = await checkoutBack(ref);
      if (back) redirect(back);
    }
    return <Shell><Card><h1>{t.notFound}</h1></Card></Shell>;
  }

  // Compra de prueba del panel: misma página, sin pixel ni registro de eventos.
  const isTest = order.status === "test" && ref.startsWith(TEST_PREFIX);
  if (order.status !== "paid" && !isTest) {
    return (
      <Shell>
        {/* Se vuelve a mirar sola: apenas Stripe lo da por cobrado, sigue a las ofertas. */}
        {order.status === "pending" && <meta httpEquiv="refresh" content="4" />}
        <Card>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>{t.processing}</h1>
          <p style={{ lineHeight: 1.6, color: "#3a3a3c" }}>{t.processingBody}</p>
        </Card>
      </Shell>
    );
  }

  // Stripe redirige apenas cobra y el webhook crea el pedido en el mismo instante:
  // los productos se guardan un momento después. Sin ellos no hay post-pago que
  // elegir y el comprador se lo saltearía (pasó el 06/10 con 8 de 14 compras), así
  // que se espera a que estén y, si tardan, la página se vuelve a mirar sola.
  if (!(await itemsReady(order.id))) {
    return (
      <Shell>
        <meta httpEquiv="refresh" content="2" />
        <Card>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>{t.processing}</h1>
          <p style={{ lineHeight: 1.6, color: "#3a3a3c" }}>{t.processingBody}</p>
        </Card>
      </Shell>
    );
  }

  // Antes de las descargas, las ofertas post-compra que le tocan.
  if (!sp.done && !isTest) {
    const chain = await resolveChain(order);
    const next = firstPending(chain);
    if (next >= 0) redirect(`/oferta/${next}?session_id=${ref}`);
  }

  const [{ data: store }, { data: totals }, { data: items }] = await Promise.all([
    db.from("stores").select("name,display_name,brand,logo_url,support_email,guarantee_days,thankyou").eq("id", order.store_id).single(),
    db.from("orders").select("amount_total,number").eq("id", order.id).single(),
    // Se entrega todo lo que quedó en el pedido: principal, incluidos, bonos,
    // bumps y los upsells que aceptó. Un producto aparece una sola vez aunque
    // esté cargado con dos roles.
    db.from("order_items").select("product_id,kind,amount,currency").eq("order_id", order.id),
  ]);

  const kinds = kindMap((items ?? []) as { product_id: string; kind: string }[]);
  const products = (await Promise.all([...kinds.keys()].map((id) => getProductById(id))))
    .filter((p): p is Product => !!p);
  const { items: cards, included } = thankYouItems(products, kinds, order.id);

  const ty = (store?.thankyou ?? {}) as Thankyou;
  const px = isTest ? null : await purchasePixel(order);

  // Resumen: principal, bumps y upsells con su importe; incluidos y bonos como "incluido".
  const cur = order.currency ?? "USD";
  const upsellTotal = (items ?? []).filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.amount ?? 0), 0);
  const total = Number(totals?.amount_total ?? 0) + upsellTotal;
  const name = new Map(products.map((p) => [p.id, p.short_name]));
  const S = SUMMARY[locale] ?? SUMMARY.en;
  const rows = (items ?? [])
    .filter((i) => name.has(i.product_id))
    .sort((a, b) => (a.kind === "main" ? -1 : b.kind === "main" ? 1 : 0))
    .map((i) => ({
      name: name.get(i.product_id)!,
      amount: Number(i.amount) ? money(Number(i.amount), i.currency ?? cur, locale) : S.free,
    }));

  return (
    <>
      {px && <MetaPixel pixels={px.pixels} events={px.events} />}
      <Track page="gracias" order={order.id} off={isTest} />
      <ThankYouView
        orderId={isTest ? undefined : order.id}
        test={isTest}
        locale={locale}
        storeName={store ? brandFor(store, locale) : ""}
        logoUrl={store?.logo_url ?? null}
        supportEmail={store?.support_email ?? null}
        orderNumber={orderRef({ id: order.id, number: totals?.number, status: order.status })}
        title={thankYouTitle(locale, ty.title, (order.name as string | null) ?? null)}
        message={ty.message?.trim() || null}
        email={(order.email as string | null) ?? null}
        items={cards}
        included={included}
        summary={ty.showSummary ? { title: S.title, rows, totalLabel: S.total, total: money(total, cur, locale) } : null}
        showSpam={ty.showSpam !== false}
        guaranteeDays={Number(store?.guarantee_days ?? 0)}
      />
    </>
  );
}
