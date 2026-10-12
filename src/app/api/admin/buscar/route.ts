import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";
import { offerList } from "@/lib/admin/offers";
import { dayOf } from "@/lib/admin/tz";
import { RANGE_TZ } from "@/lib/admin/range";
import { orderRef } from "@/lib/order-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El buscador del panel: pedidos (pagados, reembolsados y sin pagar),
 * carritos y visitantes que dejaron el email, por email, nombre, teléfono,
 * país, número de pedido o pago de Stripe. Los más nuevos primero. Con un
 * cargo de Stripe (ch_…/py_…) se busca su PaymentIntent en la cuenta de cada
 * tienda (solo lectura).
 */

export type SearchHit = {
  kind: "order" | "cart" | "visitor";
  id: string; at: string;
  /** Pedidos: «#1001». */
  ref?: string | null;
  name: string | null; email: string | null; country: string | null;
  offer: string | null; alias: string | null;
  total: number | null; currency: string | null;
  status: { label: string; tone: "ok" | "warn" | "bad" | "off" };
  href: string;
  /** El pago en el panel de Stripe, en la cuenta de la tienda. */
  stripe: string | null;
};

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const [offers, { data: accts }] = await Promise.all([
    offerList(),
    db.from("store_stripe").select("store_id,account_id,livemode"),
  ]);

  // Un cargo de Stripe: su PaymentIntent, en la tienda que lo tenga.
  if (/^(ch|py)_[A-Za-z0-9]+$/.test(q)) {
    for (const a of accts ?? []) {
      try {
        const ch = await (await stripeForStore(a.store_id)).stripe.charges.retrieve(q);
        const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
        if (pi) { q = pi; break; }
      } catch { /* no es de esta cuenta */ }
    }
  }

  const { data, error } = await db.rpc("admin_search", { p_q: q, p_limit: 8 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = (data ?? {}) as { orders?: Row[]; carts?: Row[]; visitors?: Row[] };

  const funnel = new Map(offers.flatMap((o) => o.funnels.map((f) => [f.id, { o, f }] as const)));
  const acct = new Map((accts ?? []).map((a) => [a.store_id as string, a as { account_id: string | null; livemode: boolean }]));
  const offerOf = (fid: unknown) => (typeof fid === "string" ? funnel.get(fid) : undefined);
  const stripeUrl = (storeId: unknown, pi: unknown) => {
    const a = acct.get(String(storeId));
    if (!a?.account_id || typeof pi !== "string" || !pi.startsWith("pi_")) return null;
    return `https://dashboard.stripe.com/${a.account_id}/${a.livemode ? "" : "test/"}payments/${pi}`;
  };
  const STATUS: Record<string, SearchHit["status"]> = {
    paid: { label: "Pagado", tone: "ok" }, refunded: { label: "Reembolsado", tone: "bad" }, pending: { label: "Sin pagar", tone: "off" },
  };

  const hits: SearchHit[] = [
    ...(res.orders ?? []).map((o): SearchHit => {
      const x = offerOf(o.funnel_id);
      return {
        kind: "order", id: String(o.id), ref: orderRef({ id: String(o.id), number: o.number as number | null, status: String(o.status) }), at: String(o.created_at), name: (o.name as string) || null, email: (o.email as string) || null,
        country: (o.country as string) || null, offer: x?.o.name ?? null, alias: x?.o.alias ?? null,
        total: Number(o.amount_total ?? 0) + Number(o.ups ?? 0), currency: String(o.currency ?? "usd").toUpperCase(),
        status: STATUS[String(o.status)] ?? { label: String(o.status), tone: "off" },
        href: `/admin/avisos/pedido/${o.id}`, stripe: stripeUrl(o.store_id, o.stripe_payment_intent),
      };
    }),
    ...(res.carts ?? []).map((c): SearchHit => {
      const x = offerOf(c.funnel_id);
      return {
        kind: "cart", id: String(c.id), at: String(c.created_at), name: (c.name as string) || null, email: (c.email as string) || null,
        country: (c.country as string) || null, offer: x?.o.name ?? null, alias: x?.o.alias ?? null,
        total: c.amount != null ? Number(c.amount) : null, currency: c.currency ? String(c.currency).toUpperCase() : null,
        status: { label: "Carrito", tone: "warn" },
        // Carritos de esa oferta, todos (también los ya contactados), el día en que se abrió.
        href: x ? (() => { const d = dayOf(new Date(String(c.created_at)), RANGE_TZ); return `/admin/o/${x.o.key}/carritos?ver=todos&desde=${d}&hasta=${d}`; })() : "/admin", stripe: null,
      };
    }),
    ...(res.visitors ?? []).map((v): SearchHit => {
      const x = offerOf(v.funnel_id);
      return {
        kind: "visitor", id: String(v.visitor_id), at: String(v.at), name: null, email: (v.email as string) || null,
        country: (v.country as string) || null, offer: x?.o.name ?? null, alias: x?.o.alias ?? null, total: null, currency: null,
        status: { label: "Visitante", tone: "off" },
        href: `/admin/en-vivo/recorrido?v=${encodeURIComponent(String(v.visitor_id))}`, stripe: null,
      };
    }),
  ];
  return NextResponse.json({ hits }, { headers: { "cache-control": "no-store" } });
}
