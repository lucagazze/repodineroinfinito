import { NextRequest, NextResponse } from "next/server";
import { syncAllInboxes } from "@/lib/inbox";
import { scanAlerts } from "@/lib/alerts";
import { syncOfferAlerts } from "@/lib/admin/offer-alerts";
import { runAiPilot } from "@/lib/ai-reply";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cada 5 minutos (pg_cron «sincronizar-buzones», con el CRON_SECRET): baja
 * los mails nuevos de cada buzón y repasa los avisos (entregas con error,
 * webhooks trabados, entregas sin abrir en 24 h). Con el tiempo que queda,
 * la IA deja borradores listos y, si la tienda tiene piloto automático,
 * contesta sola los problemas de entrega (nunca reembolsos).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const t0 = Date.now();
  const [inbox, alerts, offers] = await Promise.all([
    syncAllInboxes(),
    scanAlerts().catch((e) => ({ error: (e as Error).message })),
    // «Oferta sin post-pago»: un checkout activo al que después de pagar no se le ofrece nada.
    syncOfferAlerts().catch((e) => ({ error: (e as Error).message })),
  ]);
  const ai = await runAiPilot(Math.max(0, 52_000 - (Date.now() - t0))).catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ inbox, alerts, offers, ai });
}
