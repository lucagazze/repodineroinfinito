import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { COOKIE_TTL_S, LIB_COOKIE, readLibrary, signLibrary } from "@/lib/library-auth";
import { libraryBase } from "@/lib/library";

export const runtime = "nodejs";

/** El link del mail: deja la sesión de la biblioteca (90 días) en este dominio y la abre. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ store: string }> }) {
  const { store: slug } = await params;
  const { data: store } = await db.from("stores").select("id,slug").eq("slug", slug).maybeSingle();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const home = (store ? await libraryBase(host, store as { id: string; slug: string }) : `/biblioteca/${slug}`) || "/";
  const auth = store ? readLibrary(req.nextUrl.searchParams.get("t"), store.id) : null;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const to = (path: string) => new URL(path, `${proto}://${host || req.nextUrl.host}`);
  if (!auth || auth.admin) return NextResponse.redirect(to(`${home}?e=expired`), 303);
  const res = NextResponse.redirect(to(home), 303);
  res.cookies.set(LIB_COOKIE, signLibrary(auth.storeId, auth.email, COOKIE_TTL_S), {
    httpOnly: true, secure: proto === "https", sameSite: "lax", path: "/", maxAge: COOKIE_TTL_S,
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
