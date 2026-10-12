import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LIB_COOKIE } from "@/lib/library-auth";
import { libraryBase } from "@/lib/library";

export const runtime = "nodejs";

/** Cerrar la sesión de la biblioteca. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ store: string }> }) {
  const { store: slug } = await params;
  const { data: store } = await db.from("stores").select("id,slug").eq("slug", slug).maybeSingle();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const home = (store ? await libraryBase(host, store as { id: string; slug: string }) : `/biblioteca/${slug}`) || "/";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const res = NextResponse.redirect(new URL(home, `${proto}://${host || req.nextUrl.host}`), 303);
  res.cookies.set(LIB_COOKIE, "", { httpOnly: true, secure: proto === "https", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
