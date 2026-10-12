import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushOrderSummaryOnce, SALE_PUSH_DELAY_MIN } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cada minuto (pg_cron «avisar-pedidos»): el aviso único de los pedidos cuyo comprador no llegó a
 * la página de gracias (cerró en un OTO) y ya pasaron SALE_PUSH_DELAY_MIN desde que pagó. También
 * los que por lo que sea no quedaron agendados (más de 15 min sin aviso), así ninguno se pierde.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const { data, error } = await db.from("orders").select("id")
    .is("sale_pushed_at", null).eq("status", "paid").gte("created_at", iso(now - 24 * 3600_000))
    .or(`sale_push_due_at.lte."${iso(now)}",and(sale_push_due_at.is.null,created_at.lte."${iso(now - (SALE_PUSH_DELAY_MIN + 5) * 60_000)}")`)
    .order("created_at").limit(20);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  let sent = 0;
  const errors: string[] = [];
  for (const o of data ?? []) {
    try { if (await pushOrderSummaryOnce(o.id)) sent++; } catch (e) { errors.push(`${o.id.slice(0, 8)}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok: !errors.length, due: data?.length ?? 0, sent, errors });
}
