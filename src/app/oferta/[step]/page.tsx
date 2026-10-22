import { redirect } from "next/navigation";
import { withBrand } from "@/lib/brand";
import { after } from "next/server";
import { db } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";
import { conexionDe } from "@/lib/whop";
import { getRates, priceFor } from "@/lib/fx";
import { resolveChain, resolveStep, afterAccept, afterDecline } from "@/lib/postpurchase";
import { orderViewable, recordUpsell } from "@/lib/upsell";
import { logUpsellEvent } from "@/lib/upsell-events";
import { findOrder, refOf } from "@/lib/order-lookup";
import { type Locale, DEFAULT_LOCALE } from "@/lib/i18n";
import { OfferScreen } from "./screen";
import { orderRef } from "@/lib/order-ref";
import { MetaPixel } from "@/components/MetaPixel";
import Track from "@/components/Track";
import { purchasePixel } from "@/lib/purchase-pixel";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Oferta({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ session_id?: string; payment_intent?: string; upsell_return?: string }>;
}) {
  const { step } = await params;
  const sp = await searchParams;
  // Vuelta de una redirección de pago del upsell (Amazon Pay, Cash App…):
  // Stripe agrega ?payment_intent= del UPSELL; el pedido sigue siendo session_id.
  const upsellPi = sp.upsell_return === "1" && /^pi_[A-Za-z0-9]+$/.test(sp.payment_intent ?? "") ? sp.payment_intent! : null;
  const session_id = upsellPi ? sp.session_id : refOf(sp);
  const idx = Number(step);
  if (!session_id || Number.isNaN(idx)) redirect("/");

  const order = await findOrder(session_id);
  if (!order) redirect("/");

  // Stripe se pide SOLO si hace falta: `stripeForStore` TIRA cuando la tienda
  // no lo tiene conectado, y una tienda que cobra con Whop no lo tiene. Pedirlo
  // siempre hacia que la pagina de la oferta respondiera 500 a todos los
  // compradores de esa tienda -- el post-pago entero, invisible, sin un error
  // que lo delatara en ningun panel. Medido el 22/10/2026 contra
  // financestudylab: /gracias daba 200 y /oferta/1 daba 500 para el MISMO
  // pedido.
  //
  // Solo se necesita para dos cosas: el `livemode` que decide si un pedido de
  // prueba puede "cobrar", y la vuelta de una redireccion de pago, que es un
  // camino exclusivo de Stripe.
  const whop = await conexionDe(order.store_id);
  const stripeCfg = whop ? null : await stripeForStore(order.store_id);
  const livemode = whop ? whop.livemode : stripeCfg!.livemode;
  // VER, no cobrar: un pedido de prueba tiene que poder recorrer estas
  // mismas paginas -- son las unicas que prueban lo que ve el comprador.
  if (!orderViewable(order.status)) redirect("/");
  void livemode;

  const chain = await resolveChain(order);
  const done = `/gracias?session_id=${session_id}&done=1`;

  const stepUrl = (i: number) => (i < 0 ? done : `/oferta/${i}?session_id=${session_id}`);

  // Si ya lo tiene (lo agarró como bump, o en un paso anterior), saltamos
  // al siguiente pendiente en vez de ofrecerle algo que acaba de comprar. Un
  // downsell solo se muestra si rechazó su OTO.
  const pending = resolveStep(chain, idx);
  if (pending < 0) redirect(done);
  if (pending !== idx) redirect(`/oferta/${pending}?session_id=${session_id}`);
  const product = chain.steps[idx];

  // ¿Volvió de pagar esta oferta con redirección? Se registra acá (el webhook
  // también lo haría) y la pantalla sigue sola al próximo paso.
  let returned: "ok" | "failed" | undefined;
  if (upsellPi && stripeCfg) {
    const { stripe } = stripeCfg;
    const pi = await stripe.paymentIntents.retrieve(upsellPi).catch(() => null);
    if (pi && pi.metadata?.order === order.id && pi.metadata?.kind === "upsell" && pi.metadata?.product === product.slug) {
      if (pi.status === "succeeded") {
        await recordUpsell(order.id, pi, { stripe, defer: (task) => after(task) })
          .catch((e) => console.error("[oferta] registrar upsell:", (e as Error).message));
      }
      returned = pi.status === "succeeded" || pi.status === "processing" ? "ok" : "failed";
    }
  }

  // Vista de la oferta: base de la tasa de aceptación del panel.
  if (!returned) await logUpsellEvent({ storeId: order.store_id, orderId: order.id, ppFunnelId: chain.ppFunnelId, productId: product.id, event: "view" });

  const currency = order.currency ?? "USD";
  const price = priceFor(product, currency, await getRates());
  if (!price?.amount) redirect(stepUrl(afterAccept(chain, idx)));

  // Con Whop no hay llave publica de Stripe que pasarle al navegador: la hoja
  // de pago de respaldo es de Stripe y en esa tienda no existe.
  const publishableKey = stripeCfg?.publishableKey ?? "";
  const [{ data: store }, { data: content }, px, { data: who }] = await Promise.all([
    db.from("stores").select("name,display_name,brand,guarantee_days").eq("id", order.store_id).single(),
    db.from("products").select("postcompra_page,postcompra_html").eq("id", product.id).maybeSingle(),
    purchasePixel(order),
    // País del comprador: la hoja de pago lo manda como dirección (no la pide).
    db.from("orders").select("country,number,status").eq("id", order.id).maybeSingle(),
  ]);
  const buyerCountry = (who?.country as string | null) ?? null;

  // Siempre el idioma en que compró: nunca se mezcla con el del navegador.
  const locale = ((order.locale as Locale) ?? DEFAULT_LOCALE) as Locale;

  // "Sí": el siguiente OTO pendiente. "No, gracias": el downsell de este OTO
  // si tiene uno, o el siguiente. Sin downsells, los dos van al mismo lugar.
  const next = stepUrl(afterDecline(chain, idx));
  const acceptNext = stepUrl(afterAccept(chain, idx));

  return (
    <>
      <MetaPixel pixels={px.pixels} events={px.events} />
      <Track page="oferta" order={order.id} />
      <OfferScreen
        product={product}
        content={content}
        locale={locale}
        price={price}
        buyerName={(order.name as string | null) ?? null}
        orderId={order.id}
        orderNumber={orderRef({ id: order.id, number: who?.number, status: who?.status })}
        store={store ? withBrand(store, locale) : {}}
        mode={{
          kind: "live", sessionId: session_id, orderId: order.id, productSlug: product.slug, next, acceptNext, publishableKey,
          locale, productName: product.short_name || product.name, returned,
          buyer: { email: (order.email as string | null) ?? null, name: (order.name as string | null) ?? null, country: buyerCountry },
        }}
      />
    </>
  );
}
