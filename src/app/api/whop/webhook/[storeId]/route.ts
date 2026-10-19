import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/secrets";
import { verificarFirma } from "@/lib/whop-firma";
import { manejarEventoWhop } from "@/lib/whop-events";

export const runtime = "nodejs";

/**
 * Webhook de UNA tienda que cobra con Whop.
 *
 * `storeId` acepta el uuid o el slug: el que se registró en Whop es el slug,
 * porque una URL legible se revisa mejor cuando algo falla.
 *
 * Lo único que separa un pago real de alguien mandando un POST que dice
 * "pagué, dame los PDF" es la verificación de firma. Por eso pasa antes que
 * cualquier otra cosa y con el secreto de ESTA tienda: un pago de una cuenta
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

  const { data: conn } = await db
    .from("store_whop").select("webhook_secret_enc")
    .eq("store_id", tienda.id)
    .maybeSingle();
  if (!conn?.webhook_secret_enc) {
    return NextResponse.json({ error: "Tienda sin Whop conectado" }, { status: 404 });
  }

  // Cuerpo CRUDO: la firma se calcula sobre estos bytes exactos. Parsearlo y
  // volverlo a serializar cambia espacios y orden, y la firma deja de validar.
  const crudo = await req.text();

  const v = verificarFirma(crudo, req.headers, decrypt(conn.webhook_secret_enc));
  if (!v.ok) {
    console.error("[whop]", storeId, "firma rechazada:", v.motivo);
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  let evento: unknown;
  try { evento = JSON.parse(crudo); }
  catch { return NextResponse.json({ error: "Cuerpo ilegible" }, { status: 400 }); }

  try {
    const r = await manejarEventoWhop(evento as Record<string, unknown>, { storeId: tienda.id });
    await db.from("store_whop").update({ last_event_at: new Date().toISOString() }).eq("store_id", tienda.id);
    return NextResponse.json({ received: true, ...r });
  } catch (err) {
    // 500 a propósito, igual que con Stripe: Whop reintenta. Perder la entrega
    // de una venta ya cobrada es mucho peor que un reintento de más.
    const motivo = (err as Error).message;
    console.error("[whop]", storeId, "fallo procesando:", motivo);
    // El motivo viaja en la respuesta a proposito: a esta altura la firma ya
    // valido, asi que quien lee esto es Whop, y queda en su registro de
    // entregas. Diagnosticar un pago que no se entrego sin eso es a ciegas.
    return NextResponse.json({ error: "fallo", motivo }, { status: 500 });
  }
}
