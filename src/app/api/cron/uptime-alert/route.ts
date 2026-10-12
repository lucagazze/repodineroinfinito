import { NextRequest, NextResponse } from "next/server";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Lo llama el monitor de la base (public.uptime_tick, pg_cron cada 2 min)
 * cuando un checkout o el post-pago se cae (2 fallas seguidas) o vuelve. El
 * aviso del panel y el de ntfy.sh ya los manda la base (funcionan aunque la
 * app esté caída); acá va el push a TODOS los dispositivos del panel.
 *   GET ?target=us-checkout&state=down|up&label=…&detail=…&title=…  (Bearer CRON_SECRET)
 * `title` (migración 040): el título ya armado por la base, p. ej.
 * «🚨 Checkout caído: Mi Oferta (España) · 404». Sin él, como antes.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  const down = q.get("state") === "down";
  const label = (q.get("label") ?? q.get("target") ?? "checkout").slice(0, 80);
  const detail = (q.get("detail") ?? "").slice(0, 160);
  const title = (q.get("title") ?? "").trim().slice(0, 120);
  const r = await sendPush("checkout_down", {
    title: title || (down ? `🚨 CAÍDO: ${label}` : `✅ Volvió: ${label}`),
    body: down ? `Falla hace 2 controles seguidos${detail ? ` · ${detail}` : ""}` : "Responde bien otra vez",
    url: "/admin/avisos",
    tag: `uptime:${q.get("target") ?? label}`,
  });
  return NextResponse.json({ ok: true, ...r });
}
