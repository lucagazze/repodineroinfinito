import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { loadCheckout } from "@/lib/checkout-data";
import { trackingFrom, sendInitiateCheckout } from "@/lib/meta";
import { pickLocale } from "@/lib/i18n";
import { resolveSettings } from "@/lib/checkout-settings";

export const runtime = "nodejs";

/**
 * Registra que alguien abrió el checkout (conversión, carritos abandonados,
 * barra de compradores). No toca Stripe: el pago se crea recién al pagar,
 * así la página no espera a nadie para mostrar el formulario.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const store = String(body.store ?? "");
  const funnel = String(body.funnel ?? "");
  const data = await loadCheckout(store, funnel);
  if (!data) return NextResponse.json({ error: "Checkout inexistente" }, { status: 404 });

  const tracking = trackingFrom(req, body);
  if (tracking.ip) {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("checkouts").select("id", { count: "exact", head: true })
      .eq("store_id", data.funnel.stores.id).eq("status", "open").gte("created_at", since)
      .contains("tracking", { ip: tracking.ip });
    if ((count ?? 0) >= 30) return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }

  const country = req.headers.get("x-vercel-ip-country") ?? (typeof body.country === "string" ? body.country.slice(0, 2) : null);

  const utm: Record<string, string> =
    body.utm && typeof body.utm === "object"
      ? Object.fromEntries(Object.entries(body.utm).slice(0, 8).map(([k, v]) => [String(k).slice(0, 30), String(v).slice(0, 120)]))
      : {};

  const { data: row, error } = await db.from("checkouts").insert({
    store_id: data.funnel.stores.id,
    funnel_id: data.funnel.id,
    country,
    locale: pickLocale({
      fixed: resolveSettings(data.funnel.settings).locale, acceptLanguage: req.headers.get("accept-language"),
      country, storeDefault: data.funnel.stores.default_locale,
    }),
    currency: typeof body.currency === "string" ? body.currency.slice(0, 3).toUpperCase() : null,
    amount: typeof body.amount === "number" ? body.amount : null,
    utm,
    tracking,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // El mismo InitiateCheckout que dispara el navegador (ic_{id}), por el servidor: después de responder.
  after(() => sendInitiateCheckout({
    storeId: data.funnel.stores.id, funnelPixelIds: data.funnel.pixel_ids, eventId: `ic_${row.id}`, tracking,
    value: typeof body.amount === "number" ? body.amount : null,
    currency: typeof body.currency === "string" ? body.currency.slice(0, 3) : null,
    contentIds: data.main?.slug ? [data.main.slug] : [],
  }));
  return NextResponse.json({ id: row.id });
}
