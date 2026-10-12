import { NextRequest, NextResponse } from "next/server";
import { checkAllProductLinks } from "@/lib/link-check";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Una vez por día (pg_cron «revisar-links»): ¿abre el link de entrega de cada producto activo? Los rotos van a Avisos. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const results = await checkAllProductLinks();
  const broken = results.filter((r) => !r.ok);
  return NextResponse.json({
    revisados: results.length, rotos: broken.length,
    detalle: results.map((r) => ({ store: r.store, product: r.product, ok: r.ok, status: r.status, title: r.title, url: r.url, reason: r.reason ?? null })),
  });
}
