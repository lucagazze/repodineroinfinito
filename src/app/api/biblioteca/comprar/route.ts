import { NextRequest, NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { stripeForStore } from "@/lib/stripe";
import { db, getProductById } from "@/lib/db";
import { toMinor } from "@/lib/fx";
import { orderChargeable, recordUpsell } from "@/lib/upsell";
import { LIB_COOKIE, readLibrary } from "@/lib/library-auth";
import { libraryData } from "@/lib/library";

export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store" };

/**
 * «Desbloquear» en Mi biblioteca: el mismo cobro que el post-pago (tarjeta guardada, on-session, 3DS en la
 * página; si no se puede, hoja de pago), sumado como upsell al último pedido pagado del comprador. Solo se cobra
 * lo que su biblioteca le ofrece, al precio que le muestra (lo decide el servidor). El webhook y la
 * reconciliación registran el cobro aunque la página se cierre (metadata kind=upsell + order).
 *
 * Cuerpo: { productId, returnUrl?, fresh?, cancelPi? }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; returnUrl?: string; fresh?: boolean; cancelPi?: string };
  const auth = readLibrary((await cookies()).get(LIB_COOKIE)?.value);
  if (!auth || auth.admin) return NextResponse.json({ error: "auth" }, { status: 401, headers: NO_STORE });

  const lib = await libraryData(auth.storeId, auth.email);
  // Lo que le falta de sus colecciones, o un libro de «Más libros para vos» (con los regalos de su checkout).
  const more = lib?.more.find((m) => m.id === body.productId && m.price != null && m.price > 0);
  const offer = lib?.collections.flatMap((c) => c.unlock).find((u) => u.id === body.productId)
    ?? (more ? { id: more.id, price: more.price!, currency: more.currency } : undefined);
  if (!lib || !offer || !(offer.price > 0)) return NextResponse.json({ error: "Oferta no disponible" }, { status: 404, headers: NO_STORE });
  if (!lib.chargeOrderId) return NextResponse.json({ error: "Sin pedido para sumar" }, { status: 409, headers: NO_STORE });

  const { data: order } = await db.from("orders").select("id,store_id,stripe_customer,currency,status").eq("id", lib.chargeOrderId).maybeSingle();
  if (!order) return NextResponse.json({ error: "Pedido no válido" }, { status: 403, headers: NO_STORE });
  const { stripe, livemode } = await stripeForStore(order.store_id);
  if (!orderChargeable(order.status, livemode)) return NextResponse.json({ error: "Pedido no válido" }, { status: 403, headers: NO_STORE });

  const product = await getProductById(offer.id);
  if (!product) return NextResponse.json({ error: "Oferta no disponible" }, { status: 404, headers: NO_STORE });
  const { data: dup } = await db.from("order_items").select("id").eq("order_id", order.id).eq("product_id", product.id).maybeSingle();
  if (dup) return NextResponse.json({ ok: true, already: true }, { headers: NO_STORE });

  // Sesión sin verificar (entró escribiendo el mail): no se usa su tarjeta guardada ni su cliente de Stripe; paga con
  // la hoja de pago (tarjeta, Apple Pay…), como cualquiera.
  const customer = order.stripe_customer && auth.verified ? String(order.stripe_customer) : null;
  const amount = toMinor(offer.price, offer.currency);
  const currency = offer.currency.toLowerCase();
  // bonus: los regalos que vienen con ese libro (recordUpsell los suma al pedido, sin cobrar).
  const bonus = (more?.bonus ?? []).slice(0, 12).join(","); // 12 ids entran en los 500 caracteres de la metadata de Stripe
  const metadata = { source: "biblioteca", order: order.id, product: product.slug, kind: "upsell", ...(bonus ? { bonus } : {}) };
  const description = `Biblioteca — ${product.short_name || product.name}`;
  const returnUrl = safeReturnUrl(body.returnUrl, req);
  if (body.cancelPi) await cancelStale(stripe, String(body.cancelPi), order.id);

  let reuseFailed: { method: string; code: string } | null = null;
  if (!body.fresh && customer) {
    const pm = await savedMethod(stripe, customer);
    if (pm) {
      let intent: Stripe.PaymentIntent | null = null;
      try {
        intent = await stripe.paymentIntents.create({
          amount, currency, customer, payment_method: pm.id, payment_method_types: [pm.type], confirm: true,
          ...(pm.type === "card" ? { use_stripe_sdk: true } : {}),
          ...(returnUrl ? { return_url: returnUrl } : {}),
          description, metadata,
        });
      } catch (err) {
        const e = err as { code?: string; decline_code?: string; message?: string; payment_intent?: { id?: string } };
        console.warn("[biblioteca] reutilizar", pm.type, "falló:", e.code, e.decline_code, e.message);
        reuseFailed = { method: pm.type, code: e.decline_code ?? e.code ?? "error" };
        if (e.payment_intent?.id) await cancelStale(stripe, e.payment_intent.id, order.id);
      }
      if (intent?.status === "succeeded") {
        await recordUpsell(order.id, intent, { stripe, defer: (task) => after(task) }).catch((e) => console.error("[biblioteca] registrar:", (e as Error).message));
        return NextResponse.json({ ok: true, method: pm.type }, { headers: NO_STORE });
      }
      if (intent?.status === "processing") return NextResponse.json({ reason: "processing", pi: intent.id }, { status: 202, headers: NO_STORE });
      if (intent?.status === "requires_action") {
        return NextResponse.json({ reason: "requires_action", clientSecret: intent.client_secret, pi: intent.id, method: pm.type }, { status: 202, headers: NO_STORE });
      }
      if (intent) {
        reuseFailed = { method: pm.type, code: intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? intent.status };
        await cancelStale(stripe, intent.id, order.id);
      }
    }
  }

  // Hoja de pago con cualquier medio.
  try {
    const { data: store } = await db.from("stores").select("stripe_pmc").eq("id", order.store_id).maybeSingle();
    const pmc = (store as { stripe_pmc?: string | null } | null)?.stripe_pmc ?? null;
    const intent = await stripe.paymentIntents.create({
      amount, currency,
      ...(customer ? { customer, setup_future_usage: "on_session" as const } : {}),
      automatic_payment_methods: { enabled: true },
      ...(pmc ? { payment_method_configuration: pmc } : {}),
      description, metadata: { ...metadata, flow: "sheet" },
    });
    return NextResponse.json(
      { reason: "needs_payment", clientSecret: intent.client_secret, pi: intent.id, amount: offer.price, currency: offer.currency, ...(reuseFailed ? { reuseFailed } : {}) },
      { status: 202, headers: NO_STORE },
    );
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error("[biblioteca] hoja de pago:", e.code, e.message);
    return NextResponse.json({ reason: "error", code: e.code ?? null }, { status: 500, headers: NO_STORE });
  }
}

async function savedMethod(stripe: Stripe, customer: string) {
  try {
    const methods = await stripe.customers.listPaymentMethods(customer, { limit: 10 });
    return [...methods.data].sort((a, b) => b.created - a.created)[0] ?? null;
  } catch (e) {
    console.warn("[biblioteca] medios guardados:", (e as Error).message);
    return null;
  }
}

async function cancelStale(stripe: Stripe, piId: string, orderId: string) {
  if (!/^pi_[A-Za-z0-9]+$/.test(piId)) return;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.order !== orderId || pi.metadata?.source !== "biblioteca") return;
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) await stripe.paymentIntents.cancel(pi.id);
  } catch (e) {
    console.warn("[biblioteca] anular intento:", (e as Error).message);
  }
}

/** Vuelta de una redirección (3DS fuera de la página, Amazon Pay…): la biblioteca, en el mismo dominio. */
function safeReturnUrl(raw: string | undefined, req: NextRequest) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    // La biblioteca: /biblioteca… en pay.*, o la raíz en su subdominio propio (biblioteca.tumarca.com).
    if (u.host !== host || !(u.pathname.startsWith("/biblioteca") || u.pathname === "/") || (u.protocol !== "https:" && !local)) return null;
    for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}
