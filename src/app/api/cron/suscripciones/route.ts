import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { barrido, suscripcionDe } from "@/lib/suscripcion";
import { avisarTarjetaRechazada } from "@/lib/suscripcion-eventos";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Una vez por dia (pg_cron «suscripciones»). Lo que cambia por el PASO DEL
 * TIEMPO y no por un webhook:
 *
 *  1. Las bajas cuyo periodo pagado ya termino pasan a `expired`. Whop no manda
 *     un evento por «se cumplio el mes de alguien que cancelo hace 29 dias», y
 *     sin esto el muro seguiria dejando entrar a quien ya no paga.
 *  2. Los morosos que no se recuperaron se cortan pasada la gracia.
 *  3. Reintenta el aviso de tarjeta rechazada de quien quedo en mora sin que le
 *     haya salido el mail. Es el aviso que mas plata salva y no puede depender
 *     de que el envio haya andado en el momento exacto del webhook.
 *
 * El parametro `gracia` existe para poder probar: en produccion manda el valor
 * por defecto.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const gracia = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get("gracia") ?? 14) || 14));

  const { vencidas, cortadas } = await barrido(gracia);

  // Los que estan en mora y nunca recibieron el aviso. `dunning_sent_at` se
  // limpia solo con un cobro bueno, asi que esto no vuelve a escribirle a quien
  // ya fue avisado en este episodio.
  const { data: callados } = await db
    .from("subscriptions")
    .select("id,store_id,email,failed_count")
    .eq("status", "past_due").is("dunning_sent_at", null)
    .limit(50);

  let avisados = 0;
  const fallos: string[] = [];
  for (const s of callados ?? []) {
    const storeId = s.store_id as string;
    try {
      const prod = await suscripcionDe(storeId);
      const r = await avisarTarjetaRechazada(storeId, {
        id: s.id as string, email: s.email as string,
        fallos: s.failed_count as number, status: "past_due",
        producto: prod ?? undefined,
      });
      if (!("skipped" in r)) avisados++;
    } catch (e) {
      fallos.push(`${s.email}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  return NextResponse.json({
    ok: !fallos.length, gracia, vencidas, cortadas, avisados,
    ...(fallos.length ? { fallos } : {}),
  });
}
