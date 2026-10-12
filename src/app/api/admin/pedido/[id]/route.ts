import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripeForStore, dashboardUrl } from "@/lib/stripe";
import { orderRef } from "@/lib/order-ref";
import { resendDeliveryAction } from "@/lib/admin/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
const NO_STORE = { "cache-control": "no-store" };

export type DrawerMail = {
  at: string; to: string; status: string; error: string | null;
  openedAt: string | null; opens: number; clickedAt: string | null; clicks: number;
  downloadedAt: string | null; bouncedAt: string | null; bounceReason: string | null;
};
export type DrawerData = {
  id: string; ref: string; status: string; at: string; storeSlug: string | null;
  email: string | null; name: string | null; phone: string | null; country: string | null; city: string | null; region: string | null;
  payment: { pi: string | null; method: string | null; kind: "card" | "wallet" | "other" | null; url: string | null; error: string | null };
  mails: DrawerMail[];
  downloads: string[];
};

/** El medio de pago del cobro, en palabras: «Visa •••• 4242», «Apple Pay», «Link», «Amazon Pay»… */
function methodOf(pmd: Record<string, unknown> | null | undefined): { method: string | null; kind: DrawerData["payment"]["kind"] } {
  if (!pmd) return { method: null, kind: null };
  const type = String(pmd.type ?? "");
  if (type === "card") {
    const card = (pmd.card ?? {}) as { brand?: string; last4?: string; wallet?: { type?: string } | null };
    const wallet = card.wallet?.type;
    const W: Record<string, string> = { apple_pay: "Apple Pay", google_pay: "Google Pay", link: "Link", samsung_pay: "Samsung Pay", amex_express_checkout: "Amex Express" };
    const brand = card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "Tarjeta";
    if (wallet) return { method: `${W[wallet] ?? wallet}${card.last4 ? ` · ${brand} •••• ${card.last4}` : ""}`, kind: "wallet" };
    return { method: `${brand}${card.last4 ? ` •••• ${card.last4}` : ""}`, kind: "card" };
  }
  const T: Record<string, string> = { link: "Link", amazon_pay: "Amazon Pay", paypal: "PayPal", klarna: "Klarna", revolut_pay: "Revolut Pay", cashapp: "Cash App", bancontact: "Bancontact", ideal: "iDEAL", sepa_debit: "SEPA" };
  return { method: T[type] ?? (type ? type.replace(/_/g, " ") : null), kind: type ? "other" : null };
}

/**
 * El cajón de un pedido (Inicio › Últimos pagos), pedido recién al abrirlo:
 *  GET  → cliente (email, nombre, país, ciudad), el medio de pago (Stripe, solo lectura),
 *         el seguimiento del mail de entrega y las descargas.
 *  POST { action: "email", email } → corrige el email del pedido.
 *  POST { action: "resend" } → reenvía el mail de entrega (la misma acción que en Pedidos).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400, headers: NO_STORE });
  const { data: o, error } = await db.from("orders")
    .select("id,number,status,created_at,email,name,phone,country,store_id,stripe_payment_intent,stores(slug)")
    .eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  if (!o) return NextResponse.json({ error: "No existe ese pedido" }, { status: 404, headers: NO_STORE });

  const pi = (o.stripe_payment_intent as string | null) ?? null;
  // Stripe tarda: se pide a la vez que lo de la base, con un límite de 5 s.
  const stripeP = pi
    ? Promise.race([
      stripeForStore(o.store_id as string).then(async (s) => {
        const intent = await s.stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] });
        const ch = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
        return { ...methodOf(ch?.payment_method_details as unknown as Record<string, unknown> | null), url: dashboardUrl(s, pi), error: null as string | null };
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Stripe no respondió a tiempo")), 5000)),
    ]).catch((e: Error) => ({ method: null, kind: null, url: null, error: e.message }))
    : Promise.resolve({ method: null, kind: null, url: null, error: null });

  const [geo, logs, dls, pay] = await Promise.all([
    db.from("site_events").select("city,region,country").eq("order_id", id).not("city", "is", null).order("at", { ascending: false }).limit(1),
    db.from("email_log").select("created_at,to_email,status,error,opened_at,open_count,clicked_at,click_count,downloaded_at,bounced_at,bounce_reason")
      .eq("order_id", id).eq("kind", "delivery").order("created_at", { ascending: true }),
    db.from("downloads").select("at").eq("order_id", id).order("at", { ascending: true }).limit(50),
    stripeP,
  ]);
  const g = geo.data?.[0] as { city: string | null; region: string | null } | undefined;
  const out: DrawerData = {
    id, ref: orderRef(o as { id: string; number: number | null; status: string }), status: o.status as string, at: o.created_at as string,
    storeSlug: (o.stores as unknown as { slug: string } | null)?.slug ?? null,
    email: o.email as string | null, name: o.name as string | null, phone: o.phone as string | null, country: o.country as string | null,
    city: g?.city ?? null, region: g?.region ?? null,
    payment: { pi, ...pay },
    mails: ((logs.data ?? []) as Record<string, unknown>[]).map((m) => ({
      at: m.created_at as string, to: m.to_email as string, status: m.status as string, error: (m.error as string | null) ?? null,
      openedAt: (m.opened_at as string | null) ?? null, opens: Number(m.open_count ?? 0), clickedAt: (m.clicked_at as string | null) ?? null, clicks: Number(m.click_count ?? 0),
      downloadedAt: (m.downloaded_at as string | null) ?? null, bouncedAt: (m.bounced_at as string | null) ?? null, bounceReason: (m.bounce_reason as string | null) ?? null,
    })),
    downloads: (dls.data ?? []).map((d) => d.at as string),
  };
  return NextResponse.json(out, { headers: NO_STORE });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { action?: string; email?: string } | null;

  if (body?.action === "email") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return NextResponse.json({ error: "Ese email no es válido." }, { status: 400, headers: NO_STORE });
    const { data, error } = await db.from("orders").update({ email }).eq("id", id).select("email").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    if (!data) return NextResponse.json({ error: "No existe ese pedido" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: "Email actualizado", email: data.email }, { headers: NO_STORE });
  }

  if (body?.action === "resend") {
    const { data: o } = await db.from("orders").select("stores(slug)").eq("id", id).maybeSingle();
    const slug = (o?.stores as unknown as { slug: string } | null)?.slug;
    if (!slug) return NextResponse.json({ error: "No existe ese pedido" }, { status: 404, headers: NO_STORE });
    const r = await resendDeliveryAction(slug, id);
    return NextResponse.json(r, { status: r.error ? 400 : 200, headers: NO_STORE });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400, headers: NO_STORE });
}
