import { NextRequest, NextResponse } from "next/server";
import { runMkt } from "@/lib/mkt/send";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Email marketing, cada minuto (pg_cron «email-marketing», con el CRON_SECRET):
 * con el interruptor general prendido, manda un lote de la cola de las
 * campañas confirmadas (sin pasar el tope diario), cierra las que terminaron y
 * avisa los resultados 24 h después. Con el interruptor apagado no manda nada.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const r = await runMkt(45_000).catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json(r);
}
