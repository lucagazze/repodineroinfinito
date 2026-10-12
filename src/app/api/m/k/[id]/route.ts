import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { PREFETCH_UA, reqIp } from "@/lib/mail-track";
import { validMktClickSig } from "@/lib/mkt/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clic en un link de un mail de campaña: /api/m/k/{envío}?u=<destino>&s=<firma>.
 * Con firma válida anota el clic y redirige. Sin firma no redirige a ciegas
 * (no es un redirector abierto): muestra el destino con un «Continuar».
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const u = req.nextUrl.searchParams.get("u") ?? "";
  const s = req.nextUrl.searchParams.get("s") ?? "";
  let target: URL | null = null;
  try { target = new URL(u); } catch { /* sin destino */ }
  if (!target || !/^https?:$/.test(target.protocol)) {
    return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><p style="font-family:system-ui;text-align:center;margin-top:20vh">Link incompleto</p>`,
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (/^[0-9a-f-]{36}$/i.test(id) && s && validMktClickSig(id, u, s)) {
    const ua = req.headers.get("user-agent") ?? "";
    if (!PREFETCH_UA.test(ua)) {
      const ip = reqIp(req.headers);
      after(async () => {
        const { error } = await db.rpc("mkt_track", { p_id: id, p_kind: "click", p_url: u, p_ip: ip, p_ua: ua });
        if (error) console.warn("[mkt] clic:", error.message);
      });
    }
    return NextResponse.redirect(target.toString(), 302);
  }
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">` +
      `<h1 style="font-size:20px">Vas a salir a ${esc(target.hostname)}</h1>` +
      `<p><a href="${esc(target.toString())}" rel="noreferrer nofollow" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:700">Continuar</a></p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } }
  );
}
