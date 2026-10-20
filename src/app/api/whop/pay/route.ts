import { NextRequest, NextResponse } from "next/server";
import { brandFor } from "@/lib/brand";
import { db } from "@/lib/db";
import { loadCheckout } from "@/lib/checkout-data";
import { resolveSettings } from "@/lib/checkout-settings";
import { resolveCartDiscount } from "@/lib/cart-discount";
import { getPrevRates, getRates } from "@/lib/fx";
import { pickLocale, type Locale } from "@/lib/i18n";
import { currencyFrom, quoteFrom } from "@/lib/pricing";
import { trackingFrom } from "@/lib/meta";
import { conexionDe, cobrarConToken } from "@/lib/whop";

export const runtime = "nodejs";

/**
 * Cobra con Whop lo que el comprador tiene tildado, desde el checkout propio.
 *
 * Es el gemelo de /api/pi: mismo orden, mismas defensas. La única diferencia
 * es quién procesa la tarjeta.
 *
 * LA REGLA QUE NO SE NEGOCIA: el precio lo calcula el servidor. El navegador
 * manda qué bumps tildó y qué total vio, nunca cuánto hay que cobrar. Si no
 * fuera así, cualquiera edita el importe antes de enviarlo y se lleva el kit
 * por un centavo.
 *
 * El `confirmation_token` que llega acá NO es la tarjeta: los datos fueron de
 * los campos aislados de Whop a Whop sin pasar por nuestro código ni por este
 * servidor. Es una referencia de un solo uso.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const token = typeof body.token === "string" ? body.token.slice(0, 300) : "";
  if (!token) return NextResponse.json({ error: "Falta el token de confirmación" }, { status: 400 });

  const storeSlug = String(body.store ?? "");
  const funnelSlug = String(body.funnel ?? "");
  const bumpSlugs: string[] = Array.isArray(body.bumps) ? body.bumps.map(String).slice(0, 20) : [];
  const checkoutId = typeof body.checkout === "string" && /^[0-9a-f-]{36}$/.test(body.checkout) ? body.checkout : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";

  const [data, rates] = await Promise.all([loadCheckout(storeSlug, funnelSlug), getRates()]);
  if (!data) return NextResponse.json({ error: "Checkout inexistente" }, { status: 404 });

  const tienda = data.funnel.stores;
  const conn = await conexionDe(tienda.id);
  if (!conn) return NextResponse.json({ error: "La tienda no tiene Whop conectado" }, { status: 409 });

  // Mismo freno que en Stripe: un bot probando tarjetas robadas hace cientos
  // de intentos desde una IP. Sin esto la cuenta se gana una revisión en un día.
  const tracking = trackingFrom(req, body);
  if (tracking.ip) {
    const desde = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("pi_rate").select("ip", { count: "exact", head: true })
      .eq("ip", tracking.ip).gte("at", desde);
    if ((count ?? 0) >= 20) {
      return NextResponse.json({ error: "Demasiados intentos, probá en unos minutos" }, { status: 429 });
    }
    await db.from("pi_rate").insert({ ip: tracking.ip });
  }

  const ajustes = resolveSettings(data.funnel.settings);
  const country = req.headers.get("x-vercel-ip-country")
    ?? (typeof body.country === "string" ? body.country.slice(0, 2) : null);
  const currency = ajustes.currency || currencyFrom(data.markets, country, rates);

  // La moneda del formulario ya dibujado tiene que ser la misma que la del cobro.
  if (typeof body.currency === "string" && body.currency.toUpperCase() !== currency) {
    return NextResponse.json({ error: "La moneda cambió, recargá la página", code: "currency" }, { status: 409 });
  }

  const disc = await resolveCartDiscount(typeof body.r === "string" ? body.r.slice(0, 200) : null, data.funnel.id);
  const recovery = disc?.ok ? { pct: disc.pct, bumpSlugs: disc.bumps } : null;
  let q = quoteFrom(data, { currency, bumpSlugs, exitDiscount: body.exit === true, rates, recovery });
  if (!q) return NextResponse.json({ error: "No se pudo cotizar" }, { status: 500 });

  // Se cobra lo que vio en pantalla. Si cargó la página justo antes de que
  // cambiaran los tipos de cambio, se honra el total anterior -- que tambien
  // calcula el servidor, no el navegador.
  const visto = Number(body.shown);
  if (visto > 0 && Math.abs(q.total - visto) >= 0.005) {
    const prev = await getPrevRates();
    const q2 = prev ? quoteFrom(data, { currency, bumpSlugs, exitDiscount: body.exit === true, rates: prev, recovery }) : null;
    if (q2 && Math.abs(q2.total - visto) < 0.005) q = q2;
    else console.warn("[whop/pay] total distinto al mostrado", funnelSlug, currency, visto, q.total);
  }

  const locale: Locale = pickLocale({
    fixed: ajustes.locale, acceptLanguage: req.headers.get("accept-language"),
    country, storeDefault: tienda.default_locale,
  });

  const bumps = q.lines.filter((l) => l.role === "bump");
  const metadata: Record<string, string> = {
    source: "checkout-propio",
    tienda: storeSlug, embudo: funnelSlug,          // los lee whop-events para resolver la entrega
    store: storeSlug, funnel: funnelSlug,           // los lee fulfill
    locale,
    main: q.lines[0].product.slug,
    bumps: bumps.map((l) => l.product.slug).join(","),
    bump_amounts: bumps.map((l) => `${l.product.slug}:${l.amount}`).join(","),
    ...(checkoutId ? { checkout: checkoutId } : {}),
  };

  // Volver atrás tras un 3D Secure: Whop agrega payment, status y client_secret
  // a esta dirección, así que la página de gracias tiene que mirar `status`
  // antes de felicitar a nadie.
  const origen = req.headers.get("origin") ?? process.env.PUBLIC_BASE_URL ?? "";
  const returnUrl = `${origen}/gracias?store=${encodeURIComponent(storeSlug)}&funnel=${encodeURIComponent(funnelSlug)}`;

  try {
    const pago = await cobrarConToken(conn.apiKey, {
      accountId: conn.companyId,
      confirmationToken: token,
      // Monto en línea, calculado acá: así los bumps no obligan a inventar una
      // variante por cada combinación posible de productos.
      currency: q.currency.toLowerCase(),
      amount: q.totalCents,
      email: email || undefined,
      name: name || undefined,
      returnUrl,
      // Guarda la tarjeta para el post-pago de 1 clic. Si no se pide ahora,
      // los compradores de los primeros meses quedan fuera de cualquier
      // upsell que se arme despues: la tarjeta no se puede pedir en diferido.
      setupFutureUsage: "off_session",
      metadata,
      // Reintentar el mismo checkout no cobra dos veces.
      idempotencyKey: checkoutId ? `co_${checkoutId}` : undefined,
      descripcion: `${brandFor(tienda, locale)} — ${q.lines[0].product.short_name}`,
    });

    // El id del pago, en la fila del checkout. Con Stripe lo escribe /api/pi al
    // crear el intento; acá no existía y el checkout quedaba `open` para
    // siempre: contado como carrito abandonado, con su mail de recuperación
    // saliendo por una compra que SÍ se completó.
    if (checkoutId) {
      await db.from("checkouts")
        .update({ stripe_payment_intent: `whop:${pago.id}` })
        .eq("id", checkoutId);
    }

    // El cobro es ASINCRONO: esta respuesta dice en que quedó el intento, no
    // que el dinero entró. La entrega la dispara el webhook payment.succeeded,
    // nunca esta respuesta.
    return NextResponse.json({
      id: pago.id,
      status: pago.status,
      clientSecret: pago.client_secret ?? null,
      nextAction: pago.next_action ?? null,
      total: q.total,
      currency: q.currency,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[whop/pay]", storeSlug, funnelSlug, msg);
    return NextResponse.json({ error: "No se pudo cobrar", motivo: msg }, { status: 502 });
  }
}
