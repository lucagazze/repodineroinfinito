import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Botón «Probar»: una notificación a este dispositivo (o a todos, sin endpoint). */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" && body.endpoint ? body.endpoint : undefined;
  const res = await sendPush("sale", {
    // Igual que una venta de verdad (pushSaleOnce), marcada como prueba.
    title: "Pedido #1001 · prueba",
    body: "USD 36,90 · 2 bumps · así te llega cada venta",
    url: "/admin",
    tag: `test:${Date.now()}`,
  }, { endpoint });
  if (!res.sent && !res.error) {
    res.error = res.removed
      ? "el celular dio de baja la suscripción: tocá Desactivar y activalas de nuevo"
      : "este dispositivo no está guardado: tocá Desactivar y activalas de nuevo";
  }
  return NextResponse.json(res, { status: res.sent ? 200 : 502, headers: { "cache-control": "no-store" } });
}
