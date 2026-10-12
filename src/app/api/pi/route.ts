import { brandFor } from "@/lib/brand";
import { NextRequest, NextResponse } from "next/server";
import { stripeForStore } from "@/lib/stripe";
import { quoteFrom, currencyFrom } from "@/lib/pricing";
import { db } from "@/lib/db";
import { getRates, getPrevRates } from "@/lib/fx";
import { loadCheckout } from "@/lib/checkout-data";
import { trackingFrom } from "@/lib/meta";
import { resolveSettings } from "@/lib/checkout-settings";
import { pickLocale, type Locale } from "@/lib/i18n";
import { resolveCartDiscount } from "@/lib/cart-discount";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

/**
 * Solo scripts/smoke.mjs: `dry: true` CON el header x-smoke = SMOKE_SECRET.
 * Cotiza igual que un pago de verdad y prueba la llave de Stripe de la tienda
 * con una lectura, pero no crea nada (ni Customer, ni PaymentIntent, ni fila
 * de checkouts): antes cada smoke dejaba 3 pagos anulados en el dashboard.
 * Sin el header (cualquier comprador) `dry` se ignora y todo sigue igual.
 */
function smokeDry(req: NextRequest, body: { dry?: unknown }) {
  if (body.dry !== true) return false;
  const secret = process.env.SMOKE_SECRET ?? "";
  const got = Buffer.from(req.headers.get("x-smoke") ?? "");
  return !!secret && got.length === Buffer.from(secret).length && timingSafeEqual(got, Buffer.from(secret));
}

/**
 * Crea el PaymentIntent cuando el comprador toca "Pagar" (pago diferido).
 *
 * El formulario de Stripe ya está dibujado desde que abrió la página con el
 * importe que calculamos nosotros; acá se vuelve a calcular desde la base con
 * los bumps tildados (el navegador nunca manda un precio) y se devuelve el
 * client secret para confirmar.
 *
 * Si el mismo checkout ya tenía un PaymentIntent sin pagar (tarjeta
 * rechazada, reintento), se reusa: un intento nuevo por cada clic ensucia el
 * dashboard de Stripe.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const storeSlug = String(body.store ?? "");
  const funnelSlug = String(body.funnel ?? "");
  const bumpSlugs: string[] = Array.isArray(body.bumps) ? body.bumps.map(String).slice(0, 20) : [];
  const checkoutId = typeof body.checkout === "string" && /^[0-9a-f-]{36}$/.test(body.checkout) ? body.checkout : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";

  const [data, rates] = await Promise.all([loadCheckout(storeSlug, funnelSlug), getRates()]);
  if (!data) return NextResponse.json({ error: "Checkout inexistente" }, { status: 404 });
  const storeId = data.funnel.stores.id;
  const tracking = trackingFrom(req, body);
  const dry = smokeDry(req, body);

  // Prueba de tarjetas robadas: un bot crea cientos de pagos desde la misma IP.
  if (tracking.ip && !dry) {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("pi_rate").select("ip", { count: "exact", head: true }).eq("ip", tracking.ip).gte("at", since);
    if ((count ?? 0) >= 20) {
      return NextResponse.json({ error: "Demasiados intentos, probá en unos minutos" }, { status: 429 });
    }
    await db.from("pi_rate").insert({ ip: tracking.ip });
  }

  const country = req.headers.get("x-vercel-ip-country") ?? (typeof body.country === "string" ? body.country.slice(0, 2) : null);
  const currency = resolveSettings(data.funnel.settings).currency || currencyFrom(data.markets, country, rates);
  // La moneda tiene que ser la misma que la del formulario ya dibujado.
  if (typeof body.currency === "string" && body.currency.toUpperCase() !== currency) {
    return NextResponse.json({ error: "La moneda cambió, recargá la página", code: "currency" }, { status: 409 });
  }

  const exitDiscount = body.exit === true;
  // Descuento del mail de carrito abandonado: el token se verifica acá (firma, vencimiento, que sea de este checkout y no usado).
  const disc = await resolveCartDiscount(typeof body.r === "string" ? body.r.slice(0, 200) : null, data.funnel.id);
  const recovery = disc?.ok ? { pct: disc.pct, bumpSlugs: disc.bumps } : null;
  let q = quoteFrom(data, { currency, bumpSlugs, exitDiscount, rates, recovery });
  if (!q) return NextResponse.json({ error: "No se pudo cotizar" }, { status: 500 });
  // Se cobra lo que vio. Si cargó la página justo antes de que cambiaran los
  // tipos de cambio, su total sale con los tipos anteriores: se honra ese,
  // que también calcula el servidor (el navegador nunca pone el precio).
  const shown = Number(body.shown);
  if (shown > 0 && Math.abs(q.total - shown) >= 0.005) {
    const prev = await getPrevRates();
    const q2 = prev ? quoteFrom(data, { currency, bumpSlugs, exitDiscount, rates: prev, recovery }) : null;
    if (q2 && Math.abs(q2.total - shown) < 0.005) q = q2;
    else console.warn("[pi] total distinto al mostrado", funnelSlug, currency, shown, q.total);
  }

  const locale: Locale = pickLocale({
    fixed: resolveSettings(data.funnel.settings).locale, acceptLanguage: req.headers.get("accept-language"),
    country, storeDefault: data.funnel.stores.default_locale,
  });
  const bumps = q.lines.filter((l) => l.role === "bump");
  const metadata = {
    source: "checkout-propio",
    store: storeSlug,
    funnel: funnelSlug,
    locale,
    bumps: bumps.map((l) => l.product.slug).join(","),
    // Importe exacto de cada bump al momento de cobrar: el pedido usa esto y
    // no recalcula, así un cambio de tipo de cambio no descuadra el registro.
    bump_amounts: bumps.map((l) => `${l.product.slug}:${l.amount}`).join(","),
    main: q.lines[0].product.slug,
    ...(checkoutId ? { checkout: checkoutId } : {}),
    ...(exitDiscount && q.lines[0].compareAt && !recovery ? { exit_offer: "1" } : {}),
    // Pedido recuperado de un carrito: el pedido guarda el carrito y el descuento.
    ...(disc?.ok && q.recovery && disc.cartId ? { recovered_from: disc.cartId, recovery_pct: String(disc.pct), recovery_discount: String(q.recovery.amount) } : {}),
    // Descuento de una campaña de email marketing (token del botón del mail, verificado arriba).
    ...(disc?.ok && q.recovery && disc.campaignId ? { campaign_discount: disc.campaignId, recovery_pct: String(disc.pct), recovery_discount: String(q.recovery.amount) } : {}),
  };
  const common = {
    amount: q.totalCents,
    currency: q.currency.toLowerCase(),
    metadata,
    description: `${brandFor(data.funnel.stores, locale)} — ${q.lines[0].product.short_name}`,
    // El banco rechazó con «authentication_required» (pide verificar): el reintento le pide 3D Secure.
    ...(body.sca === true ? { payment_method_options: { card: { request_three_d_secure: "any" as const } } } : {}),
  };

  const { stripe, livemode } = await stripeForStore(storeId);

  if (dry) {
    try {
      // Una lectura con la llave de la tienda: que la llave ande. La configuración de medios de pago, si la hay, se informa.
      await stripe.paymentIntents.list({ limit: 1 });
      const pmcId = data.funnel.stores.stripe_pmc;
      const pmc = pmcId ? await stripe.paymentMethodConfigurations.retrieve(pmcId).then((c) => ({ id: c.id, active: c.active }), (e) => ({ id: pmcId, error: (e as Error).message })) : null;
      return NextResponse.json({ dry: true, livemode, amount: q.total, currency: q.currency, cents: common.amount, metadata, pmc });
    } catch (err) {
      return NextResponse.json({ dry: true, error: `Stripe no responde con la llave de la tienda: ${(err as Error).message}` }, { status: 502 });
    }
  }

  try {
    const { data: ck } = checkoutId
      ? await db.from("checkouts").select("id,stripe_payment_intent,status").eq("id", checkoutId).eq("store_id", storeId).maybeSingle()
      : { data: null };

    let intent = null;
    if (ck?.stripe_payment_intent) {
      const prev = await stripe.paymentIntents.retrieve(ck.stripe_payment_intent);
      if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(prev.status) && prev.currency === common.currency) {
        intent = await stripe.paymentIntents.update(prev.id, common);
      }
    }
    if (!intent) {
      // El Customer guarda la tarjeta para el upsell de 1 clic.
      const customer = await stripe.customers.create({
        ...(email ? { email } : {}), ...(name ? { name } : {}), ...(phone ? { phone } : {}),
        // El recibo automático de Stripe sale en el idioma del comprador (no en el de la cuenta).
        preferred_locales: [locale],
        metadata: { store: storeSlug, funnel: funnelSlug },
      });
      intent = await stripe.paymentIntents.create({
        ...common,
        customer: customer.id,
        // on_session alcanza: el upsell se cobra con el comprador en pantalla.
        // off_session obliga a mostrar el aviso de cobros futuros, que espanta.
        setup_future_usage: "on_session",
        automatic_payment_methods: { enabled: true },
        // Los mismos medios de pago que el formulario (y que la plataforma anterior).
        ...(data.funnel.stores.stripe_pmc ? { payment_method_configuration: data.funnel.stores.stripe_pmc } : {}),
      });
    }

    const row = {
      stripe_payment_intent: intent.id,
      amount: q.total,
      currency: q.currency,
      bumps: bumps.map((l) => l.product.slug),
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    };
    if (ck) await db.from("checkouts").update(row).eq("id", ck.id);
    else {
      await db.from("checkouts").insert({
        ...row, store_id: storeId, funnel_id: data.funnel.id, country, locale, tracking,
      });
    }

    return NextResponse.json({ pi: intent.id, clientSecret: intent.client_secret, amount: q.total, currency: q.currency });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    console.error("[pi]", e.code, e.message);
    return NextResponse.json({ error: "No se pudo preparar el pago", code: e.code }, { status: 409 });
  }
}
