import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { isDownloadUrl, reqIp, validClickSig } from "@/lib/mail-track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clic en un link de un mail: /api/m/c/{email_log}?u=<destino>&s=<firma>.
 * Con firma válida anota el clic y redirige. Sin firma (o con una vieja) el
 * comprador igual llega a su archivo: se redirige si el destino es nuestro o
 * de Drive/Dropbox; a cualquier otro sitio se muestra un «continuar», así la
 * ruta no sirve de redirector abierto. Nunca un 404.
 */

const FIXED = ["drive.google.com", "docs.google.com", "dropbox.com", (process.env.SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split("/")[0]].filter(Boolean);
let hosts: { at: number; list: string[] } | null = null;

async function ourHosts() {
  if (hosts && Date.now() - hosts.at < 5 * 60_000) return hosts.list;
  const [{ data: st }, { data: fu }] = await Promise.all([
    db.from("stores").select("domain,catalog_domain,catalog_url,support_email"),
    db.from("funnels").select("checkout_host").not("checkout_host", "is", null),
  ]);
  const clean = (h: string | null | undefined) => (h ?? "").toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  const list = new Set<string>(FIXED);
  for (const s of st ?? []) {
    for (const h of [s.domain, s.catalog_domain, s.catalog_url, (s.support_email ?? "").split("@")[1]]) {
      const c = clean(h);
      // El dominio de la marca entero (pay.*, nails.*, catalogo.*).
      if (c) list.add(c.split(".").slice(-2).join("."));
    }
  }
  for (const f of fu ?? []) { const c = clean(f.checkout_host); if (c) list.add(c.split(".").slice(-2).join(".")); }
  hosts = { at: Date.now(), list: [...list] };
  return hosts.list;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } }
  );

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const u = req.nextUrl.searchParams.get("u") ?? "";
  const s = req.nextUrl.searchParams.get("s") ?? "";
  let target: URL | null = null;
  try { target = new URL(u); } catch { /* sin destino */ }
  if (!target || !/^https?:$/.test(target.protocol)) {
    return page(`<h1 style="font-size:20px">Link incompleto</h1><p style="color:#6b7280">Abrí de nuevo el mail y tocá el botón otra vez.</p>`, 400);
  }
  const okId = /^[0-9a-f-]{36}$/i.test(id);
  const signed = okId && !!s && validClickSig(id, u, s);

  if (signed) {
    const ip = reqIp(req.headers), ua = req.headers.get("user-agent") ?? "";
    // Se anota después de responder: el comprador no espera a la base.
    after(async () => {
      const { error } = await db.rpc("mail_track", { p_id: id, p_kind: "click", p_url: u, p_ip: ip, p_ua: ua, p_download: isDownloadUrl(u) });
      if (error) console.warn("[mail] clic:", error.message);
    });
    return NextResponse.redirect(target.toString(), 302);
  }

  const host = target.hostname.toLowerCase();
  const allowed = (await ourHosts().catch(() => FIXED)).some((h) => host === h || host.endsWith(`.${h}`));
  if (allowed) return NextResponse.redirect(target.toString(), 302);
  return page(
    `<h1 style="font-size:20px">Vas a salir a ${esc(host)}</h1><p style="color:#6b7280;line-height:1.5">Este link vino en un mail. Si lo esperabas, seguí:</p>` +
      `<p><a href="${esc(target.toString())}" rel="noreferrer nofollow" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:700">Continuar</a></p>`
  );
}
