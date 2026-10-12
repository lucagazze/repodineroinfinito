import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { signLibrary } from "@/lib/library-auth";
import { ALL_CONTENT } from "@/lib/library";

export const runtime = "nodejs";

/**
 * «Ver su biblioteca» desde el panel: abre la
 * biblioteca de ese comprador tal cual la ve él, con un token de administrador de 2 horas (sin poder comprar).
 * GET ?email=…&store=<slug o id>
 */
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401 }); }
  // ?all=1: el portal con todo el contenido de la tienda (vista de administrador).
  const all = req.nextUrl.searchParams.get("all") === "1";
  const email = all ? ALL_CONTENT : (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  const s = req.nextUrl.searchParams.get("store") ?? "";
  if (!email) return NextResponse.json({ error: "Falta el email" }, { status: 400 });
  const isId = /^[0-9a-f-]{36}$/i.test(s);
  const { data: store } = await db.from("stores").select("id,slug").eq(isId ? "id" : "slug", s).maybeSingle();
  if (!store) return NextResponse.json({ error: "No existe la tienda" }, { status: 404 });
  const t = signLibrary(store.id, email, 2 * 3600, true);
  const as = req.nextUrl.searchParams.get("as") === "buyer" ? "&as=buyer" : "";
  return NextResponse.redirect(new URL(`/biblioteca/${store.slug}?t=${encodeURIComponent(t)}${as}`, req.nextUrl.origin), 303);
}
