import { db, getProductById, STORE_COLS, type Product, type Store } from "./db";
import { renderDelivery, sendDelivery } from "./email";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./i18n";
import { withBrand } from "./brand";
import { orderRef } from "./order-ref";

/**
 * El mail de entrega de un pedido con lo que tiene hoy (principal, incluidos,
 * bonos, bumps y upsells). Lo usan la IA del buzón, su piloto automático y
 * «Enviados» (para mostrar un mail viejo que no se guardó); el panel y el MCP
 * tienen su propia copia del reenvío.
 */
async function deliveryArgsFor(orderId: string) {
  const { data: o } = await db.from("orders").select("id,number,store_id,status,email,name,locale,currency,amount_total").eq("id", orderId).maybeSingle();
  if (!o) throw new Error("No existe el pedido.");
  const { data: items } = await db.from("order_items").select("kind,amount,product_id").eq("order_id", orderId).order("created_at");
  const mainItem = (items ?? []).find((i) => i.kind === "main");
  const main = mainItem?.product_id ? await getProductById(mainItem.product_id) : null;
  if (!main) throw new Error("El pedido no tiene producto principal.");
  const extras = (await Promise.all((items ?? []).filter((i) => i.kind !== "main" && i.product_id).map((i) => getProductById(i.product_id!))))
    .filter((p): p is Product => !!p);
  const { data: store } = await db.from("stores").select(STORE_COLS).eq("id", o.store_id).single();
  const total = (items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(o.amount_total ?? 0);
  const locale = (LOCALES as readonly string[]).includes(o.locale ?? "") ? (o.locale as Locale) : DEFAULT_LOCALE;
  return {
    order: o,
    args: {
      // Con la marca del idioma del pedido, como el mail que salió al pagar (fulfill).
      to: o.email ?? "", name: o.name, store: withBrand(store as unknown as Store, locale),
      locale,
      main, extras, currency: o.currency ?? "USD", orderRef: orderRef(o), total, orderId,
    },
  };
}

export async function resendDeliveryFor(orderId: string) {
  const { order: o, args } = await deliveryArgsFor(orderId);
  if (o.status !== "paid") throw new Error(`El pedido está «${o.status}»: solo se reenvía uno pagado.`);
  if (!o.email) throw new Error("El pedido no tiene email.");
  const r = await sendDelivery(args);
  if ("skipped" in r) throw new Error("No hay proveedor de mail configurado.");
  await db.from("orders").update({ delivered_at: new Date().toISOString(), delivery_error: null }).eq("id", orderId);
  return { sent_to: o.email, message_id: r.messageId };
}

/** El HTML del mail de entrega de un pedido, armado hoy (sin seguimiento). */
export async function deliveryHtmlFor(orderId: string) {
  const { args } = await deliveryArgsFor(orderId);
  return renderDelivery(args).html;
}
