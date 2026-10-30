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
import { conexionDe } from "@/lib/mercadopago-connect";
import { crearPreferencia, type ItemPreferencia } from "@/lib/mercadopago";
import { revisarDuplicado, textoDuplicado } from "@/lib/ya-lo-tiene";

export const runtime = "nodejs";

/**
 * Arma el carrito que Mercado Pago le va a cobrar al comprador.
 *
 * Es el gemelo de /api/whop/pay y /api/pi: mismo orden y mismas defensas. La
 * diferencia es que aqui NO se cobra: se crea una preferencia y se devuelve el
 * `init_point`, que es la direccion a la que el navegador manda al comprador.
 * El dinero entra alla, y lo que lo convierte en una entrega es el webhook.
 *
 * LA REGLA QUE NO SE NEGOCIA: el precio lo calcula el servidor. El navegador
 * manda que bumps tildo y que total vio, nunca cuanto hay que cobrar.
 *
 * POR QUE SE VA A OTRA PAGINA Y NO HAY CAMPOS DE TARJETA AQUI
 *   Checkout Pro trae lo que en Argentina decide la venta: cuotas, la billetera
 *   de Mercado Pago, y Rapipago / Pago Facil para quien no tiene tarjeta. Un
 *   formulario propio no tiene nada de eso.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

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
  if (!conn) return NextResponse.json({ error: "La tienda no tiene Mercado Pago conectado" }, { status: 409 });

  // Mismo freno que en Stripe y Whop: un bot probando tarjetas hace cientos de
  // intentos desde una IP, y la cuenta se gana una revision en un dia.
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

  if (typeof body.currency === "string" && body.currency.toUpperCase() !== currency) {
    return NextResponse.json({ error: "La moneda cambió, recargá la página", code: "currency" }, { status: 409 });
  }

  const disc = await resolveCartDiscount(typeof body.r === "string" ? body.r.slice(0, 200) : null, data.funnel.id);
  const recovery = disc?.ok ? { pct: disc.pct, bumpSlugs: disc.bumps } : null;
  let q = quoteFrom(data, { currency, bumpSlugs, exitDiscount: body.exit === true, rates, recovery });
  if (!q) return NextResponse.json({ error: "No se pudo cotizar" }, { status: 500 });

  // Se cobra lo que vio en pantalla, y el total anterior tambien lo calcula el
  // servidor: si cargo la pagina justo antes de que cambiaran los tipos de
  // cambio, se honra el que vio.
  const visto = Number(body.shown);
  if (visto > 0 && Math.abs(q.total - visto) >= 0.005) {
    const prev = await getPrevRates();
    const q2 = prev ? quoteFrom(data, { currency, bumpSlugs, exitDiscount: body.exit === true, rates: prev, recovery }) : null;
    if (q2 && Math.abs(q2.total - visto) < 0.005) q = q2;
    else console.warn("[mercadopago/pay] total distinto al mostrado", funnelSlug, currency, visto, q.total);
  }


  // NO COBRARLE DOS VECES EL MISMO LIBRO.
  //   `overlapsOwned` dice de si mismo «nunca se cobra dos veces un libro»,
  //   pero hasta el 29/10/2026 solo lo respetaban la biblioteca y el
  //   post-pago: el checkout no preguntaba nunca. En Physics eso dejaba cinco
  //   caminos abiertos (ver lib/ya-lo-tiene.ts). Aca si se conoce el mail, que
  //   es lo que la pagina todavia no tiene.
  //   Se frena SOLO el duplicado puro; tener una pieza de un pack no frena
  //   nada, porque el resto es una compra legitima.
  if (email) {
    const v = await revisarDuplicado(tienda.id, email, q.lines[0].product);
    if (v.duplicado) {
      console.warn("[mercadopago/pay] duplicado frenado", funnelSlug, q.lines[0].product.slug, email);
      return NextResponse.json({ error: textoDuplicado(ajustes.locale), code: "ya_lo_tiene" }, { status: 409 });
    }
    if (v.parcial) console.warn("[mercadopago/pay] compra parcial", funnelSlug, q.lines[0].product.slug, v.piezas);
  }

  const locale: Locale = pickLocale({
    fixed: ajustes.locale, acceptLanguage: req.headers.get("accept-language"),
    country, storeDefault: tienda.default_locale,
  });

  const bumps = q.lines.filter((l) => l.role === "bump");
  // Las MISMAS claves que manda Whop. `fulfill` lee store/funnel/locale, y
  // escribir otras aqui obligaria a que la entrega sepa quien cobro.
  const metadata: Record<string, string> = {
    source: "checkout-propio",
    tienda: storeSlug, embudo: funnelSlug,
    store: storeSlug, funnel: funnelSlug,
    locale,
    main: q.lines[0].product.slug,
    bumps: bumps.map((l) => l.product.slug).join(","),
    bump_amounts: bumps.map((l) => `${l.product.slug}:${l.amount}`).join(","),
    ...(checkoutId ? { checkout: checkoutId } : {}),
  };

  const origen = req.headers.get("origin") ?? process.env.PUBLIC_BASE_URL ?? "";
  const gracias = `${origen}/gracias?store=${encodeURIComponent(storeSlug)}&funnel=${encodeURIComponent(funnelSlug)}`;

  // Un renglon por linea cotizada: asi el comprador ve en Mercado Pago lo mismo
  // que tildo aqui, y el total de alla coincide con el de aqui por construccion.
  const items: ItemPreferencia[] = q.lines.map((l) => ({
    id: l.product.slug,
    title: l.product.short_name || l.product.name,
    quantity: 1,
    unit_price: Number(l.amount),
    currency_id: q.currency.toUpperCase(),
    ...(l.product.image_url ? { picture_url: l.product.image_url } : {}),
  }));

  try {
    const pref = await crearPreferencia(conn.token, {
      items,
      email: email || null,
      nombre: name || null,
      volverA: { success: gracias, pending: gracias, failure: `${origen}/c/${storeSlug}/${funnelSlug}?pago=fallo` },
      // El webhook de ESTA tienda. Sin esto el cobro entra y no se entrega nada.
      avisarA: `${origen}/api/mercadopago/webhook/${encodeURIComponent(storeSlug)}`,
      // Es lo unico nuestro que vuelve con el pago, asi que lleva el checkout:
      // con el se reencuentra todo lo demas si la metadata no viajara.
      referencia: checkoutId ?? `${storeSlug}:${funnelSlug}`,
      descriptor: brandFor(tienda, locale),
      metadata,
      // Reintentar el mismo checkout no crea dos preferencias.
      idempotencia: checkoutId ? `co_${checkoutId}` : undefined,
    });

    const destino = conn.livemode ? pref.init_point : (pref.sandbox_init_point ?? pref.init_point);
    if (!destino) {
      return NextResponse.json({ error: "Mercado Pago no devolvió a dónde enviar al comprador" }, { status: 502 });
    }

    // El id de la preferencia en la fila del checkout: sin esto el checkout
    // queda `open` para siempre y sale un mail de carrito abandonado por una
    // compra que se completo. Mismo arreglo que se hizo en el de Whop.
    if (checkoutId) {
      await db.from("checkouts")
        .update({ stripe_payment_intent: `mercadopago:${pref.id}` })
        .eq("id", checkoutId);
    }

    // Esta respuesta NO dice que el dinero entro: dice a donde mandar al
    // comprador. La entrega la dispara el webhook del pago, nunca esto.
    return NextResponse.json({ id: pref.id, url: destino, total: q.total, currency: q.currency });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[mercadopago/pay]", storeSlug, funnelSlug, msg);
    return NextResponse.json({ error: "No se pudo abrir el pago", motivo: msg }, { status: 502 });
  }
}
