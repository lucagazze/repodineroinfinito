import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { auditOffers } from "@/lib/admin/offer-audit";
import { syncOfferAlerts } from "@/lib/admin/offer-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diagnóstico de todas las ofertas activas (o de una, con ?oferta=tienda~oferta):
 * una fila por mercado con landing, checkout, pixel, eventos, bumps, post-pago,
 * downsells, entrega, webhook, recuperación y grabación. Todo en el momento.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    // De paso, los avisos «Oferta sin post-pago» quedan al día (el cron también lo hace cada 5 min).
    const [rows, alerts] = await Promise.all([
      auditOffers({ offerKey: req.nextUrl.searchParams.get("oferta") || undefined }),
      syncOfferAlerts().catch((e) => ({ error: (e as Error).message })),
    ]);
    return NextResponse.json({ at: new Date().toISOString(), rows, alerts }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
