import { NextRequest, NextResponse, after } from "next/server";
import { driveDownloadUrl, mirrorDrive, mirroredUrl } from "@/lib/delivery-mirror";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { LIB_COOKIE, readLibrary } from "@/lib/library-auth";
import { ALL_CONTENT, libraryData } from "@/lib/library";
import { deliveryPdfs } from "@/lib/admin/presale";
import { LANG_COOKIE, libTexts, uiLocale } from "@/lib/library-texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * «Scarica» de Mi biblioteca: baja el PDF directo, sin mandar al comprador a Drive. Verifica que el
 * libro sea suyo (o que sea el administrador). Si el producto tiene archivo propio en Supabase (delivery_file), baja
 * de ahí; si no, la app trae el PDF de su carpeta de Drive y lo entrega como descarga. Varios PDF en la carpeta →
 * una lista para bajar cada uno. GET ?p=<producto>&f=<archivo de Drive>&t=<token de admin>
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const page = (title: string, body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet"></head>` +
      `<body style="margin:0;background:#F4F7FD;font-family:Inter,system-ui,-apple-system,sans-serif;color:#101828;text-align:center">` +
      `<div style="height:8px;background:linear-gradient(150deg,#2F55B5,#2645A0 48%,#1F3C92)"></div>` +
      `<main style="max-width:520px;margin:10vh auto;padding:28px 22px;background:#fff;border:1px solid #E1E8F4;border-radius:16px;box-shadow:0 4px 20px rgba(16,24,40,.08)">` +
      `<h1 style="font-size:22px;font-weight:800;margin:0 0 6px">${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const pid = sp.get("p") ?? "";
  const fid = sp.get("f");
  if (!/^[0-9a-f-]{36}$/i.test(pid) || (fid && !/^[A-Za-z0-9_-]{10,80}$/.test(fid))) return page("Link non valido", "", 400);
  const { data: p } = await db.from("products").select("id,store_id,name,short_name,variant_of,delivery_url,delivery_file,delivery_file_name,presale,stores(default_locale)").eq("id", pid).maybeSingle();
  if (!p) return page("Not found", "", 404);
  const auth = readLibrary(sp.get("t"), p.store_id as string) ?? readLibrary((await cookies()).get(LIB_COOKIE)?.value, p.store_id as string);
  // En el idioma de quien mira (el que eligió en la biblioteca o el de su navegador), como el portal.
  const t = libTexts(uiLocale((await cookies()).get(LANG_COOKIE)?.value, req.headers.get("accept-language"), (p.stores as unknown as { default_locale?: string } | null)?.default_locale ?? "en"));
  if (!auth) return page(t.loginTitle, `<p><a href="/biblioteca">${esc(t.loginTitle)}</a></p>`, 401);

  // Que sea suyo (el administrador puede bajar todo).
  if (!auth.admin || auth.email !== ALL_CONTENT) {
    if (!auth.admin) {
      const lib = await libraryData(p.store_id as string, auth.email);
      const mine = new Set((lib?.groups ?? []).flatMap((g) => g.books.map((b) => b.id)));
      if (!mine.has(p.id as string) && !(p.variant_of && mine.has(p.variant_of as string))) return page("Non disponibile", "", 403);
    }
  }

  // Archivo propio en Supabase.
  if (p.delivery_file) {
    const path = decodeURIComponent(p.delivery_file as string);
    const { data } = await db.storage.from("entregas").createSignedUrl(path, 600, { download: (p.delivery_file_name as string | null) || path.split("/").pop() || true });
    if (data?.signedUrl) return NextResponse.redirect(data.signedUrl, 302);
  }

  // De Drive: los PDF de su carpeta (o la del libro base si es una variante).
  let url = p.delivery_url as string | null;
  if (!url && p.variant_of) url = ((await db.from("products").select("delivery_url").eq("id", p.variant_of).maybeSingle()).data?.delivery_url as string | null) ?? null;
  const files = await deliveryPdfs(url).catch(() => []);
  if (!files.length) {
    return p.presale
      ? page(t.presale, `<p style="color:#667085">${esc(t.presaleSub)}</p>`)
      : page("Non disponibile", `<p style="color:#667085">${url ? `<a href="${esc(url)}">Drive</a>` : ""}</p>`, 404);
  }
  const pick = fid ? files.find((f) => f.id === fid) : files.length === 1 ? files[0] : null;
  if (!pick) {
    const q = (f: string) => `/api/biblioteca/descargar?p=${pid}&f=${f}${sp.get("t") ? `&t=${encodeURIComponent(sp.get("t")!)}` : ""}`;
    return page((p.short_name as string) || (p.name as string),
      `<div style="display:grid;gap:10px;margin-top:18px">${files.map((f) => `<a href="${q(f.id)}" style="display:block;padding:14px 18px;border-radius:8px;background:#F97216;color:#fff;text-decoration:none;font-weight:800;box-shadow:0 6px 22px rgba(249,114,22,.42)">⬇ ${esc(f.title)}</a>`).join("")}</div>`);
  }
  const name = /\.pdf$/i.test(pick.title) ? pick.title : `${pick.title}.pdf`;
  // La copia en Supabase (migración 065); si todavía no está, desde Drive y se copia para la próxima.
  const copy = await mirroredUrl(pick.id, name).catch(() => null);
  if (copy) return NextResponse.redirect(copy, 302);
  after(() => mirrorDrive(pick.id, name));
  const r = await fetch(driveDownloadUrl(pick.id), { cache: "no-store", redirect: "follow" });
  if (!r.ok || !r.body || /text\/html/.test(r.headers.get("content-type") ?? "")) {
    // Drive no lo dio directo (permiso o límite de descargas): el link de Drive como respaldo.
    return NextResponse.redirect(`https://drive.google.com/file/d/${pick.id}/view`, 302);
  }
  const headers: Record<string, string> = {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "private, no-store",
  };
  const len = r.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return new NextResponse(r.body, { status: 200, headers });
}
