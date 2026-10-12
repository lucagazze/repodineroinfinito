import { NextRequest, NextResponse } from "next/server";
import { bookPages } from "@/lib/library";

export const runtime = "nodejs";

/**
 * Vista previa de un libro de la Tienda o del catálogo público: sus
 * páginas de muestra, las mismas que muestran las landings. Se piden al abrir la vista previa, así la página de la
 * biblioteca no las carga todas. GET ?s=<tienda>&p=<producto> → { pages: string[] }
 */
export async function GET(req: NextRequest) {
  const uuid = /^[0-9a-f-]{36}$/i;
  const s = req.nextUrl.searchParams.get("s") ?? "";
  const p = req.nextUrl.searchParams.get("p") ?? "";
  if (!uuid.test(s) || !uuid.test(p)) return NextResponse.json({ pages: [] }, { status: 400 });
  const pages = await bookPages(s, p).catch(() => null);
  if (!pages) return NextResponse.json({ pages: [] }, { status: 404 });
  // En el CDN 1 h (y 1 día sirviendo la anterior mientras se renueva); sin páginas, 5 min (puede ser una landing caída).
  const cc = pages.length ? "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" : "public, max-age=120, s-maxage=300";
  return NextResponse.json({ pages }, { headers: { "cache-control": cc } });
}
