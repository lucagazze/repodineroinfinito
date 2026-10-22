import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cancelarEnWhop, leerBaja, suscripcionDe } from "@/lib/suscripcion";
import { avisarBaja } from "@/lib/suscripcion-eventos";

export const runtime = "nodejs";

/**
 * La baja en un clic.
 *
 * ORDEN DE LAS DOS BAJAS, Y POR QUE ESTE
 *   Primero se detiene el cobro en Whop, despues se escribe en la base. Al
 *   reves, una baja anotada que no llego a Whop deja a alguien a quien se le
 *   sigue cobrando y que ya tiene la confirmacion en la mano: un contracargo
 *   seguro.
 *   Y si Whop falla, se anota igual y se contesta ok. La promesa «no se te
 *   cobra mas» es nuestra, no de la pasarela: queda la fila en la bitacora para
 *   verlo y arreglarlo a mano, pero el suscriptor no se va de aca sin su baja.
 */
export async function POST(req: NextRequest) {
  let token: string | null = null;
  try {
    const b = (await req.json()) as { token?: string };
    token = b.token ?? null;
  } catch { /* cuerpo ilegible */ }

  const id = leerBaja(token);
  if (!id) return NextResponse.json({ error: "Enlace inválido" }, { status: 400 });

  const { data } = await db
    .from("subscriptions")
    .select("id,store_id,email,status,current_period_end,whop_membership_id")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "No encontramos la suscripción" }, { status: 404 });

  const sub = data as {
    id: string; store_id: string; email: string; status: string;
    current_period_end: string | null; whop_membership_id: string | null;
  };

  // Ya cancelada: se contesta ok. Volver a apretar el botón no es un error, y
  // un mensaje de error acá parece que la baja no funcionó.
  if (sub.status === "canceled" || sub.status === "expired") {
    return NextResponse.json({ ok: true, hasta: sub.current_period_end, ya: true });
  }

  let whop: string | null = null;
  if (sub.whop_membership_id) {
    try {
      await cancelarEnWhop(sub.store_id, sub.whop_membership_id);
    } catch (e) {
      whop = (e as Error).message.slice(0, 300);
      console.error("[suscripcion] no pude cancelar en Whop", sub.whop_membership_id, whop);
    }
  } else {
    whop = "la suscripción no tiene membresía de Whop enlazada";
  }

  const { error } = await db.rpc("sub_baja", {
    p_id: sub.id,
    p_motivo: whop ? `baja del suscriptor; EN WHOP NO SE PUDO: ${whop}` : "baja del suscriptor",
    p_ya: false,
  });
  if (error) {
    return NextResponse.json({ error: "No pudimos registrar la baja" }, { status: 500 });
  }

  // Si Whop quedó cobrando, es un aviso que hay que ver: va a la bitácora con
  // un tipo propio para que salte en el panel.
  if (whop) {
    await db.from("subscription_events").insert({
      subscription_id: sub.id, store_id: sub.store_id, email: sub.email,
      kind: "desconocido",
      detail: `ATENCION: la baja se anoto pero Whop sigue cobrando. ${whop}`,
    });
  }

  const prod = await suscripcionDe(sub.store_id);
  await avisarBaja(sub.store_id, {
    id: sub.id, email: sub.email, hasta: sub.current_period_end, producto: prod,
  }).catch((e) => console.error("[suscripcion] mail de baja:", (e as Error).message));

  return NextResponse.json({ ok: true, hasta: sub.current_period_end, whop: whop ?? "cancelada" });
}
