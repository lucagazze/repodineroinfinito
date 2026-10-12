import { NextRequest, NextResponse, after } from "next/server";
import type Stripe from "stripe";
import { stripeForStore } from "@/lib/stripe";
import { db, getProductById } from "@/lib/db";
import { getRates, priceFor, toMinor } from "@/lib/fx";
import { resolveChain } from "@/lib/postpurchase";
import { orderChargeable, recordUpsell } from "@/lib/upsell";

export const runtime = "nodejs";

/**
 * Cobro de una oferta post-compra.
 *
 * 1. Reutiliza el medio que el comprador dejó guardado en el checkout
 *    (`setup_future_usage`): tarjeta (Apple Pay / Google Pay incluidos), Link,
 *    Amazon Pay, Cash App… el que sea. Si pide un paso más (3DS, o la
 *    redirección de Amazon Pay) devuelve 202 `requires_action` con el client
 *    secret; las redirecciones vuelven a la misma oferta con
 *    `upsell_return=1`, y la página registra el cobro.
 * 2. Si no hay nada guardado, o reutilizarlo falla, crea un PaymentIntent
 *    nuevo SIN confirmar y devuelve `needs_payment` con su client secret: la
 *    oferta abre una hoja de pago (Stripe Elements) para que pague como quiera.
 *    Nunca un error genérico cuando el comprador quiere pagar.
 *
 * El importe y el producto los decide el servidor (metadata del PI);
 * /api/upsell/confirm y el webhook registran solo lo que Stripe dice cobrado.
 *
 * Cuerpo: { sessionId, productSlug, returnUrl?, fresh?, cancelPi? }
 *   fresh    → saltear la reutilización (ya falló en el navegador).
 *   cancelPi → un intento anterior de este pedido que quedó a medias.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string; productSlug?: string; returnUrl?: string; fresh?: boolean; cancelPi?: string;
  };
  const { sessionId, productSlug } = body;
  if (!sessionId || !productSlug) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  // La orden es la fuente de verdad, no el query string.
  const ref = String(sessionId);
  const col = ref.startsWith("pi_") ? "stripe_payment_intent" : "stripe_session_id";
  const { data: order } = await db
    .from("orders")
    .select("id,store_id,funnel_id,pp_funnel_id,stripe_customer,currency,status,email")
    .eq(col, ref)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Pedido no válido" }, { status: 403 });
  const { stripe, livemode } = await stripeForStore(order.store_id);
  if (!orderChargeable(order.status, livemode)) {
    return NextResponse.json({ error: "Pedido no válido" }, { status: 403 });
  }

  // Solo se cobra lo que el funnel post-compra de ESTE pedido ofrece:
  // mandar el slug de otro producto no sirve para cobrar cualquier cosa.
  const chain = await resolveChain(order);
  const offered = chain.steps.find((p) => p.slug === productSlug);
  if (!offered) {
    return NextResponse.json({ error: "Oferta no disponible" }, { status: 404 });
  }

  const product = await getProductById(offered.id);
  // Misma moneda que el pedido: si pagó en reales, el upsell también va en reales.
  const price = product ? priceFor(product, order.currency ?? "USD", await getRates()) : null;
  if (!product || !price?.amount) {
    return NextResponse.json({ error: "Oferta sin precio" }, { status: 500 });
  }

  // ¿Ya lo compró? No cobrar dos veces si recarga la pantalla.
  const { data: dup } = await db
    .from("order_items")
    .select("id")
    .eq("order_id", order.id)
    .eq("product_id", product.id)
    .maybeSingle();
  if (dup) return NextResponse.json({ ok: true, already: true });

  const customer = order.stripe_customer ? String(order.stripe_customer) : null;
  const amount = toMinor(Number(price.amount), price.currency);
  const currency = price.currency.toLowerCase();
  const metadata = { source: "checkout-propio", order: order.id, product: product.slug, kind: "upsell" };
  const description = `Upsell — ${product.short_name}`;
  const returnUrl = safeReturnUrl(body.returnUrl, req);

  if (body.cancelPi) await cancelStale(stripe, String(body.cancelPi), order.id);

  // Si reutilizar el medio guardado no funcionó, se avisa al navegador (queda en el panel).
  let reuseFailed: { method: string; code: string } | null = null;

  // ---------------------------------------------- 1. el medio que ya dejó guardado
  if (!body.fresh && customer) {
    const pm = await savedMethod(stripe, customer);
    if (pm) {
      let intent: Stripe.PaymentIntent | null = null;
      try {
        // El comprador está en la pantalla cuando toca "sí", así que el cobro es
        // on-session: si el banco pide 3DS no se rechaza, se le muestra el
        // desafío ahí mismo. Cobrar off_session hacía fallar a casi todas las
        // tarjetas europeas, que piden autenticación en cada operación.
        intent = await stripe.paymentIntents.create({
          amount,
          currency,
          customer,
          payment_method: pm.id,
          payment_method_types: [pm.type],
          confirm: true,
          // 3DS dentro de la página para tarjetas; el resto (Amazon Pay, Cash
          // App…) redirige y vuelve a esta misma oferta.
          ...(pm.type === "card" ? { use_stripe_sdk: true } : {}),
          ...(returnUrl ? { return_url: returnUrl } : {}),
          description,
          metadata,
        });
      } catch (err) {
        const e = err as { code?: string; decline_code?: string; message?: string; payment_intent?: { id?: string } };
        console.warn("[upsell] reutilizar", pm.type, "falló:", e.code, e.decline_code, e.message);
        reuseFailed = { method: pm.type, code: e.decline_code ?? e.code ?? "error" };
        if (e.payment_intent?.id) await cancelStale(stripe, e.payment_intent.id, order.id);
      }

      if (intent?.status === "succeeded") {
        // El email sale después de responder: el comprador no espera a Brevo.
        // Si registrarlo falla, el cobro está hecho igual: lo registra el webhook
        // (nunca devolver error acá, el navegador ofrecería pagarlo de nuevo).
        await recordUpsell(order.id, intent, { stripe, defer: (task) => after(task) })
          .catch((e) => console.error("[upsell] registrar:", (e as Error).message));
        return NextResponse.json({ ok: true, product: product.slug, method: pm.type });
      }
      // Algunos medios confirman unos segundos después: la pantalla espera
      // (consulta /api/upsell/confirm) y, si tarda más, lo registra el webhook.
      if (intent?.status === "processing") {
        return NextResponse.json({ reason: "processing", pi: intent.id, method: pm.type }, { status: 202 });
      }
      if (intent?.status === "requires_action") {
        return NextResponse.json(
          { reason: "requires_action", clientSecret: intent.client_secret, pi: intent.id, method: pm.type },
          { status: 202 }
        );
      }
      // Rechazado o en otro estado: se anula y pasa a la hoja de pago.
      if (intent) {
        reuseFailed = { method: pm.type, code: intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? intent.status };
        await cancelStale(stripe, intent.id, order.id);
      }
    }
  }

  // ---------------------------------------------- 2. hoja de pago con cualquier medio
  try {
    const { data: store } = await db.from("stores").select("stripe_pmc").eq("id", order.store_id).maybeSingle();
    const pmc = (store as { stripe_pmc?: string | null } | null)?.stripe_pmc ?? null;
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      ...(customer ? { customer, setup_future_usage: "on_session" as const } : {}),
      automatic_payment_methods: { enabled: true },
      // Los mismos medios que el checkout (y que la plataforma anterior).
      ...(pmc ? { payment_method_configuration: pmc } : {}),
      description,
      metadata: { ...metadata, flow: "sheet" },
    });
    return NextResponse.json(
      {
        reason: "needs_payment",
        clientSecret: intent.client_secret,
        pi: intent.id,
        amount: Number(price.amount),
        currency: price.currency.toUpperCase(),
        ...(reuseFailed ? { reuseFailed } : {}),
      },
      { status: 202 }
    );
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error("[upsell] hoja de pago:", e.code, e.message);
    return NextResponse.json({ reason: "error", code: e.code ?? null }, { status: 500 });
  }
}

/**
 * El medio guardado a reutilizar: el más reciente del Customer (el que acaba
 * de usar en el checkout). Cualquier tipo: si no se puede confirmar así,
 * Stripe lo rechaza y el comprador paga en la hoja.
 */
async function savedMethod(stripe: Stripe, customer: string) {
  try {
    const methods = await stripe.customers.listPaymentMethods(customer, { limit: 10 });
    return [...methods.data].sort((a, b) => b.created - a.created)[0] ?? null;
  } catch (e) {
    console.warn("[upsell] medios guardados:", (e as Error).message);
    return null;
  }
}

/** Anula un intento de ESTE pedido que quedó sin cobrar (no toca nada cobrado ni de otro pedido). */
async function cancelStale(stripe: Stripe, piId: string, orderId: string) {
  if (!/^pi_[A-Za-z0-9]+$/.test(piId)) return;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.order !== orderId || pi.metadata?.kind !== "upsell") return;
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
      await stripe.paymentIntents.cancel(pi.id);
    }
  } catch (e) {
    console.warn("[upsell] anular intento:", (e as Error).message);
  }
}

/**
 * La URL de vuelta de una redirección (Amazon Pay, Cash App, 3DS fuera de la
 * página): la oferta en la que está el comprador, en su mismo dominio.
 */
function safeReturnUrl(raw: string | undefined, req: NextRequest) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const hosts = new Set(
      [req.headers.get("origin"), `https://${req.headers.get("x-forwarded-host") ?? ""}`, `https://${req.headers.get("host") ?? ""}`]
        .map((h) => { try { return h ? new URL(h).host : ""; } catch { return ""; } })
        .filter(Boolean)
    );
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (!hosts.has(u.host) || !u.pathname.startsWith("/oferta/") || (u.protocol !== "https:" && !local)) return null;
    for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status", "upsell_return"]) u.searchParams.delete(k);
    u.searchParams.set("upsell_return", "1");
    return u.toString();
  } catch {
    return null;
  }
}
