import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Email del comprador apenas lo escribe, antes de pagar. Sin esto no hay
 * carrito abandonado que recuperar. Solo actualiza un checkout abierto que
 * ya existe: no crea nada ni pisa uno pagado.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.checkout === "string" && /^[0-9a-f-]{36}$/.test(body.checkout) ? body.checkout : null;
  const pi = typeof body.pi === "string" && body.pi.startsWith("pi_") ? body.pi : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  if ((!id && !pi) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null;
  const q = db.from("checkouts").update({ email, ...(name ? { name } : {}) }).eq("status", "open");
  await (id ? q.eq("id", id) : q.eq("stripe_payment_intent", pi!));
  return NextResponse.json({ ok: true });
}
