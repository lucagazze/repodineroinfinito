import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
 */
const page = (title: string, body: string, status: number) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">` +
      `<h1 style="font-size:20px">${title}</h1><p style="color:#6b7280;line-height:1.5">${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

export async function GET(req: NextRequest, { params }: { params: Promise<{ order: string; product: string }> }) {
  const { order: orderId, product: slug } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !/^[a-z0-9-]{1,80}$/.test(slug)) return page("Link inválido", "Revisá el link del mail.", 400);

  const { data: order } = await db.from("orders").select("id,status,store_id,stores(support_email)").eq("id", orderId).maybeSingle();
  if (!order) return page("Pedido no encontrado", "Revisá el link del mail.", 404);
  const support = (order.stores as unknown as { support_email: string } | null)?.support_email ?? "";
  // 'test': compras de prueba del panel, que mandan el mail real con estos links.
  if (order.status !== "paid" && order.status !== "test") {
    return page("Descarga no disponible", order.status === "refunded"
      ? "Este pedido fue reembolsado."
      : `El pago todavía no está acreditado. Si ya pagaste, escribinos a ${support}.`, 403);
  }

  const { data: product } = await db.from("products")
    .select("id,delivery_file,delivery_file_name,delivery_url,order_items!inner(order_id)")
    .eq("store_id", order.store_id).eq("slug", slug).eq("order_items.order_id", orderId).maybeSingle();
  if (!product) return page("Producto no encontrado", `Este producto no es parte del pedido. Escribinos a ${support}.`, 404);

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
