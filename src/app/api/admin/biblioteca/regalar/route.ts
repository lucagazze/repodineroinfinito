import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Desbloquear (o quitar) un libro en la biblioteca de un comprador, sin cobrar. No crea pedidos ni
 * manda mails: el libro le aparece en su portal. { store (id), email, productId, remove? }
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401 }); }
  const b = (await req.json().catch(() => ({}))) as { store?: string; email?: string; productId?: string; remove?: boolean };
  const email = String(b.email ?? "").trim().toLowerCase();
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(String(b.store)) || !uuid.test(String(b.productId)) || !/^[^\s@]+@[^\s@]+$/.test(email)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { data: p } = await db.from("products").select("id").eq("id", b.productId!).eq("store_id", b.store!).maybeSingle();
  if (!p) return NextResponse.json({ error: "Ese libro no es de esta tienda" }, { status: 404 });
  const r = b.remove
    ? await db.from("library_grants").delete().eq("store_id", b.store!).eq("email", email).eq("product_id", b.productId!)
    : await db.from("library_grants").upsert({ store_id: b.store, email, product_id: b.productId }, { onConflict: "store_id,email,product_id" });
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
