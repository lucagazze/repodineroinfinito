import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conexionDe } from "@/lib/mercadopago-connect";
import { verificarFirma } from "@/lib/mercadopago-firma";
import { manejarEventoMercadoPago } from "@/lib/mercadopago-events";

export const runtime = "nodejs";

/**
 * Webhook de UNA tienda que cobra con Mercado Pago.
 *
 * `storeId` acepta el uuid o el slug, igual que el de Whop: una URL legible se
 * revisa mejor cuando algo falla.
 *
 * Lo unico que separa un cobro real de alguien mandando un POST que dice
 * «pague, dame acceso» es la verificacion de firma. Por eso pasa antes que
 * cualquier otra cosa y con el secreto de ESTA tienda: un cobro de una cuenta
 * nunca se valida con la llave de otra.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;

  const esUuid = /^[0-9a-f-]{36}$/i.test(storeId);
  const { data: tienda } = await db
    .from("stores").select("id")
    .eq(esUuid ? "id" : "slug", storeId)
    .maybeSingle();
  if (!tienda) return NextResponse.json({ error: "Tienda desconocida" }, { status: 404 });

  const conn = await conexionDe(tienda.id);
  if (!conn) return NextResponse.json({ error: "Tienda sin Mercado Pago conectado" }, { status: 404 });
  if (!conn.webhookSecret) {
    // Sin secreto no se puede distinguir un cobro real de uno inventado, y
    // acreditar a ciegas es peor que no acreditar.
    console.error("[mercadopago]", storeId, "sin secreto de firma: no se puede verificar nada");
    return NextResponse.json({ error: "Tienda sin secreto de firma" }, { status: 503 });
  }

  // La firma se calcula sobre el `data.id` del QUERY STRING, el `x-request-id`
  // y el `ts` -- no sobre el cuerpo. Por eso se le pasa la URL.
  const v = verificarFirma(req.url, req.headers, conn.webhookSecret);
  if (!v.ok) {
    console.error("[mercadopago]", storeId, "firma rechazada:", v.motivo);
    // SE ANOTA EN LA BASE, no solo en la consola.
    //   El 27/10/2026 una notificacion de prueba no aparecio por ningun lado y
    //   no se pudo distinguir «no llego» de «llego y la rechace»: el unico
    //   rastro era un console.error, y los registros del plan Hobby duran
    //   minutos. Un webhook rechazado es justo el que hay que poder mirar.
    //   `.catch` a proposito: si la bitacora falla, igual se contesta 400.
    await db.from("subscription_events").insert({
      store_id: tienda.id, kind: "desconocido", provider: "mercadopago",
      detail: `firma rechazada: ${v.motivo}`,
      raw: {
        url: req.url,
        cabeceras: {
          "x-signature": req.headers.get("x-signature"),
          "x-request-id": req.headers.get("x-request-id"),
        },
      } as never,
    }).then(() => {}, () => {});
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }
  // Cual de las variantes de manifiesto coincidio. Su documentacion no escribe
  // la plantilla, asi que esto es lo que permite cerrarla con el primer webhook
  // real en vez de seguir probando tres para siempre.
  console.log("[mercadopago]", storeId, "firma valida, variante:", v.variante);

  let cuerpo: Record<string, unknown> = {};
  try {
    const crudo = await req.text();
    cuerpo = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Cuerpo ilegible" }, { status: 400 });
  }

  // EL ID QUE SE USA ES EL FIRMADO, NO EL DEL CUERPO.
  //   La firma cubre el `data.id` del query string. El cuerpo no esta firmado
  //   en absoluto. Si se usara el del cuerpo, alguien que vio un webhook valido
  //   podria reenviarlo dentro de la ventana con OTRO id adentro y la firma
  //   seguiria dando bien.
  const url = new URL(req.url);
  const idFirmado = url.searchParams.get("data.id");
  const evento = {
    ...cuerpo,
    type: cuerpo.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic"),
    data: { id: idFirmado },
  };

  try {
    const r = await manejarEventoMercadoPago(evento, { storeId: tienda.id, token: conn.token });
    await db.from("store_mercadopago")
      .update({ last_event_at: new Date().toISOString() }).eq("store_id", tienda.id);
    return NextResponse.json({ received: true, ...r });
  } catch (err) {
    // 500 a proposito, igual que con Whop y Stripe: Mercado Pago reintenta.
    // Perder la acreditacion de un cobro ya hecho es mucho peor que un
    // reintento de mas -- y el indice de idempotencia hace que el reintento no
    // pueda contar dos veces.
    const motivo = (err as Error).message;
    console.error("[mercadopago]", storeId, "fallo procesando:", motivo);
    return NextResponse.json({ error: "fallo", motivo }, { status: 500 });
  }
}
