import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { T, type Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga directa de un producto comprado (estilo Shopify).
 *
 * El link del mail y de la página de gracias trae el id del pedido (un uuid
 * que no se puede adivinar). Acá se verifica que el pedido esté pagado y que
 * el producto sea parte de lo que compró (principal, incluido, bono, bump o
 * upsell), y se redirige a un link firmado de Storage que vence en 10
 * minutos y baja el PDF con su nombre. Si el pedido se reembolsó, no baja.
 *
 * EL IDIOMA SALE DEL PEDIDO, NO DEL CODIGO
 *   Esta ruta sirve a TODAS las tiendas. Hasta el 26/10/2026 sus mensajes
 *   estaban en español fijo, asi que un comprador de Physics en el Reino Unido
 *   con un link vencido leia «Pedido no encontrado · Revisá el link del mail».
 *   Y en voseo, que no es el registro de ninguna de las dos tiendas.
 *   Antes de cargar el pedido todavia no hay idioma: ahi se mira el
 *   Accept-Language del navegador y, si no dice nada util, se cae a ingles --
 *   que es el idioma del checkout por defecto, no el mio.
 */

/** El idioma del navegador, sólo para los errores previos a cargar el pedido. */
function idiomaDelNavegador(req: NextRequest): Locale {
  const h = (req.headers.get("accept-language") ?? "").toLowerCase();
  for (const l of ["pt-br", "es", "it", "fr", "de", "en"]) {
    if (h.includes(l)) return (l === "pt-br" ? "pt-BR" : l) as Locale;
  }
  return "en";
}
const page = (title: string, body: string, status: number) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">` +
      `<h1 style="font-size:20px">${title}</h1><p style="color:#6b7280;line-height:1.5">${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

export async function GET(req: NextRequest, { params }: { params: Promise<{ order: string; product: string }> }) {
  const { order: orderId, product: slug } = await params;
  const tn = T[idiomaDelNavegador(req)];
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !/^[a-z0-9-]{1,80}$/.test(slug)) return page(tn.dlBadLink, tn.dlCheckLink, 400);

  const { data: order } = await db.from("orders")
    .select("id,status,store_id,locale,stores(support_email)").eq("id", orderId).maybeSingle();
  if (!order) return page(tn.dlNotFound, tn.dlCheckLink, 404);
  const support = (order.stores as unknown as { support_email: string } | null)?.support_email ?? "";
  // Ya hay pedido: manda SU idioma, que es el que eligio al comprar.
  const t = T[((order.locale as Locale | null) ?? "en") in T ? (order.locale as Locale) : "en"];
  // 'test': compras de prueba del panel, que mandan el mail real con estos links.
  if (order.status !== "paid" && order.status !== "test") {
    return page(t.dlNotFound, order.status === "refunded"
      ? t.dlRefunded
      : t.dlPending(support), 403);
  }

  const { data: product } = await db.from("products")
    .select("id,delivery_file,delivery_file_name,delivery_url,order_items!inner(order_id)")
    .eq("store_id", order.store_id).eq("slug", slug).eq("order_items.order_id", orderId).maybeSingle();
  if (!product) return page(t.dlNotFound, t.dlNotInOrder(support), 404);

  await db.from("downloads").insert({
    order_id: orderId, product_id: product.id,
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
  });

  if (!product.delivery_file) {
    if (product.delivery_url) return NextResponse.redirect(product.delivery_url, 302);
    return page("Sin archivo", `Escribinos a ${support} y te lo mandamos.`, 404);
  }
  const path = decodeURIComponent(product.delivery_file);
  const { data, error } = await db.storage.from("entregas").createSignedUrl(path, 600, {
    download: product.delivery_file_name || path.split("/").pop() || true,
  });
  if (error || !data?.signedUrl) {
    console.error("[descarga]", orderId, slug, error?.message);
    return page("No se pudo generar la descarga", `Probá de nuevo en un minuto. Si sigue, escribinos a ${support}.`, 500);
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
