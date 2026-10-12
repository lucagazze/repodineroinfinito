import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { unreadByStore } from "@/lib/admin/mail-unread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Mails de compradores sin leer: el total (la burbuja de «Mails» y el «(3)
 * Panel» de la pestaña) y por tienda (las pestañas de tienda en Mails). Por
 * fetch y no como server action: una server action que se está pidiendo
 * cuando se toca un link hace que Next descarte la respuesta y vuelva a pedir
 * la página entera al llegar.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE });
  }
  try {
    const stores = await unreadByStore();
    const count = Object.values(stores).reduce((a, n) => a + n, 0);
    return NextResponse.json({ count, stores }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE });
  }
}
