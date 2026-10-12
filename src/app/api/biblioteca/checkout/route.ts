import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LIB_COOKIE, readLibrary } from "@/lib/library-auth";
import { libraryData, publicBookOffer } from "@/lib/library";
import { soloCheckoutUrl } from "@/lib/solo-checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Desbloquear» de la biblioteca cuando no se le puede cobrar con un clic (sus compras son del checkout anterior):
 * lleva al checkout de ESE libro suelto (se crea la primera vez), con su email ya puesto. Solo libros que su
 * biblioteca le ofrece (sus colecciones o la Tienda). GET ?p=<producto>[&t=<token de administrador>]
 * Sin sesión (catálogo público): un libro de bump o del post-pago cuya
 * oferta no tiene landing se compra en su checkout suelto. GET ?s=<tienda>&p=<producto>
 */
export async function GET(req: NextRequest) {
  const pid = req.nextUrl.searchParams.get("p") ?? "";
  const back = new URL(req.headers.get("referer") || "/", req.url);
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return NextResponse.redirect(back, 303);
  const auth = readLibrary(req.nextUrl.searchParams.get("t")) ?? readLibrary((await cookies()).get(LIB_COOKIE)?.value);
  if (!auth) {
    const sid = req.nextUrl.searchParams.get("s") ?? "";
    const offer = /^[0-9a-f-]{36}$/i.test(sid) ? await publicBookOffer(sid, pid).catch(() => null) : null;
    const url = offer ? await soloCheckoutUrl(sid, offer, pid) : null;
    if (!url) return NextResponse.redirect(back, 303);
    const u = new URL(url);
    u.searchParams.set("utm_source", "biblioteca");
    u.searchParams.set("utm_medium", "catalogo");
    return NextResponse.redirect(u, 303);
  }
  const lib = await libraryData(auth.storeId, auth.email, { admin: auth.admin });
  const offer = lib?.collections.find((c) => c.unlock.some((u) => u.id === pid))?.id ?? lib?.more.find((m) => m.id === pid)?.offer;
  const url = offer ? await soloCheckoutUrl(auth.storeId, offer, pid) : null;
  if (!url) return NextResponse.redirect(back, 303);
  const u = new URL(url);
  if (!auth.admin) u.searchParams.set("email", auth.email);
  u.searchParams.set("utm_source", "biblioteca");
  u.searchParams.set("utm_medium", "portal");
  return NextResponse.redirect(u, 303);
}
