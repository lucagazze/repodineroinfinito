import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { LOCALES, type Locale } from "@/lib/i18n";
import { finishTestRun } from "@/lib/test-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isLocale = (l?: string | null): l is Locale => !!l && (LOCALES as readonly string[]).includes(l);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fin de una compra de prueba: crea el pedido de prueba (status 'test') con lo
 * que se "compró" en el recorrido, manda los mails reales de entrega y lleva a
 * la página de gracias de ese pedido. Idempotente por `prueba`: recargar no
 * crea otro pedido ni vuelve a mandar los mails. Solo el panel.
 */
export async function GET(req: NextRequest) {
  const allowed = await requireAdmin().then(() => true, () => false);
  if (!allowed) return NextResponse.redirect(new URL("/entrar", req.url), 303);

  const q = req.nextUrl.searchParams;
  const run = q.get("prueba") ?? "";
  const storeSlug = q.get("store") ?? "";
  const funnelId = q.get("funnel") ?? "";
  const email = (q.get("email") ?? "").trim();
  const country = (q.get("country") ?? "").toUpperCase();
  const currency = (q.get("currency") ?? "USD").toUpperCase();
  const lang = q.get("lang");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(run) || !UUID.test(funnelId) || !/^\S+@\S+\.\S+$/.test(email)
    || !/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency) || !isLocale(lang)) {
    return NextResponse.json({ error: "Datos de la prueba incompletos" }, { status: 400 });
  }
  const { data: f } = await db.from("funnels").select("id,stores!inner(slug)").eq("id", funnelId).eq("stores.slug", storeSlug).maybeSingle();
  if (!f) return NextResponse.json({ error: "Checkout no encontrado" }, { status: 404 });

  try {
    const order = await finishTestRun({
      run, storeSlug, funnelId,
      bumps: (q.get("bumps") ?? "").split(",").filter((x) => UUID.test(x)),
      got: (q.get("got") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,80}$/.test(s)),
      country, currency, locale: lang, email,
      name: (q.get("name") ?? "").trim().slice(0, 80) || null,
    });
    return NextResponse.redirect(new URL(`/gracias?session_id=${order.stripe_session_id}&done=1`, req.url), 303);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
