import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRange } from "@/lib/admin/range";
import { loadSales, parseSaleFilters, filterSales, sortSales } from "@/lib/admin/all-sales";
import { getRates } from "@/lib/fx";
import { stripeForStore } from "@/lib/stripe";
import { xlsx, type Cell } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Ventas en Excel con el formato EXACTO del export de la plataforma anterior: hoja «Ventas», las mismas 27 columnas en el mismo orden,
 * los mismos anchos, una fila por cobro de Stripe (el del checkout: principal + bumps; y cada OTO aparte, con su
 * propio IDPago). Mismos filtros y orden que /admin/ventas.
 *  - Total / Subtotal / Descuento en USD (lo que acreditó Stripe; si todavía no está, al cambio del día).
 *  - Cobrado y MonedaCobro: lo que pagó el comprador en su moneda.
 *  - Metodo, Ciudad y Provincia salen del cobro en Stripe (lo que el comprador cargó); si no hay, vacío.
 */
const HEAD = ["Orden", "Fecha", "Email", "Nombre", "Telefono", "Pais", "Ciudad", "Provincia", "Subtotal", "Descuento", "Total", "Moneda", "Cobrado", "MonedaCobro", "Total (USD)", "EstadoPago", "Metodo", "Pasarela", "IDPago", "UTMSource", "UTMMedium", "UTMCampaign", "UTMAdset", "UTMAd", "Referrer", "Productos", "EmailEnviado"];
const WIDTHS = [10.83, 20.83, 28.83, 20.83, 16.83, 16.83, 16.83, 16.83, 10.83, 10.83, 10.83, 8.83, 14.83, 14.83, 14.83, 14.83, 28.83, 16.83, 16.83, 18.83, 18.83, 18.83, 24.83, 50.83, 20.83];
const METHOD: Record<string, string> = { card: "Tarjeta", link: "Link", satispay: "Satispay", scalapay: "scalapay", paypal: "PayPal", klarna: "Klarna", amazon_pay: "Amazon Pay", revolut_pay: "Revolut Pay", cashapp: "Cash App", sepa_debit: "SEPA", bancontact: "Bancontact", ideal: "iDEAL", eps: "EPS", twint: "TWINT", mobilepay: "MobilePay", afterpay_clearpay: "Afterpay" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString() : "");
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return new NextResponse("No autorizado", { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseSaleFilters(sp);
  const R = resolveRange({ r: f.r, desde: f.desde, hasta: f.hasta });
  const { sales } = await loadSales(R);
  const list = sortSales(filterSales(sales, f), f.o, f.d);
  const ids = list.map((s) => s.id);

  type It = { order_id: string; kind: string; amount: number | string; currency: string | null; refunded_amount: number | string | null; stripe_payment_intent: string | null; created_at: string; products: { name: string | null; short_name: string | null } | null };
  type Or = { id: string; stripe_payment_intent: string | null; discount: { amount?: number; currency?: string } | null; tracking: { referrer?: string } | null; utm: Record<string, string> | null };
  const items: It[] = [], ords: Or[] = [], logs: { order_id: string; kind: string; created_at: string }[] = [];
  for (const part of chunk(ids, 200)) {
    const [a, b, c] = await Promise.all([
      db.from("order_items").select("order_id,kind,amount,currency,refunded_amount,stripe_payment_intent,created_at,products(name,short_name)").in("order_id", part).order("created_at"),
      db.from("orders").select("id,stripe_payment_intent,discount,tracking,utm").in("id", part),
      db.from("email_log").select("order_id,kind,created_at").in("order_id", part).eq("status", "sent").in("kind", ["delivery", "upsell"]).order("created_at"),
    ]);
    items.push(...((a.data ?? []) as unknown as It[])); ords.push(...((b.data ?? []) as unknown as Or[])); logs.push(...((c.data ?? []) as { order_id: string; kind: string; created_at: string }[]));
  }
  const ordOf = new Map(ords.map((o) => [o.id, o]));

  // Lo acreditado en USD por cobro (movimientos reales de Stripe).
  const pis = [...new Set([...ords.map((o) => o.stripe_payment_intent), ...items.map((i) => i.stripe_payment_intent)].filter((x): x is string => !!x))];
  const usdOf = new Map<string, number>();
  for (const part of chunk(pis, 300)) {
    const { data } = await db.from("stripe_balance_txns").select("payment_intent,amount,currency,reporting_category").in("payment_intent", part).eq("reporting_category", "charge");
    for (const t of data ?? []) if (String(t.currency).toUpperCase() === "USD") usdOf.set(t.payment_intent as string, (usdOf.get(t.payment_intent as string) ?? 0) + Number(t.amount));
  }
  const rates = await getRates();
  const toUsd = (n: number, cur: string) => (cur === "USD" ? n : rates[cur] ? n / rates[cur] : n);

  // Medio de pago y dirección del cobro, de Stripe (una lista por tienda para el rango).
  const info = new Map<string, { method: string; city: string; state: string }>();
  const from = Math.floor(Date.parse(`${R.since}T00:00:00Z`) / 1000) - 86400, to = Math.floor(Date.parse(`${R.until}T23:59:59Z`) / 1000) + 2 * 86400;
  for (const storeId of [...new Set(list.map((s) => s.storeId))]) {
    try {
      const { stripe } = await stripeForStore(storeId);
      let n = 0;
      for await (const ch of stripe.charges.list({ created: { gte: from, lte: to }, limit: 100 })) {
        if (++n > 20000) break;
        const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
        if (!pi || ch.status !== "succeeded") continue;
        const type = ch.payment_method_details?.type ?? "";
        const a = ch.billing_details?.address;
        info.set(pi, { method: METHOD[type] ?? type, city: a?.city ?? "", state: a?.state ?? "" });
      }
    } catch (e) {
      console.error("[export excel] stripe", storeId, (e as Error).message);
    }
  }

  const country = new Intl.DisplayNames(["es"], { type: "region" });
  const pais = (c: string | null) => { try { return c ? country.of(c.trim().toUpperCase()) ?? c : ""; } catch { return c ?? ""; } };
  const label = (k: string) => (k === "main" ? "Principal" : k === "bonus" || k === "included" ? "Bonus" : "Upsell");
  const prod = (i: It) => `${i.products?.name || i.products?.short_name || "(producto)"} (${label(i.kind)}) x1 - ${Number(i.amount ?? 0).toFixed(2)}`;
  const estado = (paid: number, refunded: number) => (refunded <= 0 ? "Aprobado" : refunded >= paid - 0.005 ? "Reembolsado" : "Reembolsado parcial");

  const rows: Cell[][] = [HEAD];
  for (const s of list) {
    const o = ordOf.get(s.id);
    const its = items.filter((i) => i.order_id === s.id);
    const utm = o?.utm ?? {};
    const common = (orden: string, fecha: string) => [orden, fecha, s.email ?? "", s.name ?? "", s.phone ?? "", pais(s.country)];
    const tail = (pi: string | null) => {
      const x = pi ? info.get(pi) : undefined;
      return { x, utm: [utm.utm_source ?? "", utm.utm_medium ?? "", utm.utm_campaign ?? "", utm.utm_adset ?? utm.utm_term ?? "", utm.utm_ad ?? utm.utm_content ?? "", o?.tracking?.referrer ?? ""] };
    };
    // 1. El cobro del checkout: principal + bumps (+ bonus).
    const rank = (k: string) => (k === "main" ? 0 : k === "bump" ? 1 : 2);
    const main = its.filter((i) => i.kind !== "upsell").sort((a, b) => rank(a.kind) - rank(b.kind));
    const mainPaid = main.reduce((a, i) => a + Number(i.amount ?? 0), 0);
    const mainRef = Number(s.refunded ?? 0) - its.filter((i) => i.kind === "upsell").reduce((a, i) => a + Number(i.refunded_amount ?? 0), 0);
    const pi = o?.stripe_payment_intent ?? null;
    const usd = r2(pi && usdOf.has(pi) ? usdOf.get(pi)! : toUsd(mainPaid, s.currency));
    const disc = Number(o?.discount?.amount ?? 0);
    const discUsd = disc > 0 && mainPaid > 0 ? r2((usd / mainPaid) * disc) : 0;
    const t1 = tail(pi);
    rows.push([
      ...common(`#${s.number ?? s.ref}`, iso(s.createdAt)), t1.x?.city ?? "", t1.x?.state ?? "",
      r2(usd + discUsd), discUsd, usd, "USD", r2(mainPaid), s.currency, usd, estado(mainPaid, mainRef),
      t1.x?.method ?? "", "Stripe", pi ?? "", ...t1.utm, main.map(prod).join(" | "), iso(s.deliveredAt),
    ]);
    // 2. Cada OTO: su propio cobro.
    let k = 1;
    for (const u of its.filter((i) => i.kind === "upsell")) {
      k++;
      const paid = Number(u.amount ?? 0);
      const upi = u.stripe_payment_intent;
      const uUsd = r2(upi && usdOf.has(upi) ? usdOf.get(upi)! : toUsd(paid, (u.currency ?? s.currency).toUpperCase()));
      const sent = logs.find((l) => l.order_id === s.id && l.kind === "upsell" && l.created_at >= u.created_at);
      const t2 = tail(upi);
      rows.push([
        ...common(`#${s.number ?? s.ref}-${k}`, iso(u.created_at)), t2.x?.city ?? t1.x?.city ?? "", t2.x?.state ?? t1.x?.state ?? "",
        uUsd, 0, uUsd, "USD", r2(paid), (u.currency ?? s.currency).toUpperCase(), uUsd, estado(paid, Number(u.refunded_amount ?? 0)),
        t2.x?.method ?? "", "Stripe", upi ?? "", ...t2.utm, prod(u), iso(sent?.created_at),
      ]);
    }
  }

  const store = f.tienda || "todas";
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(xlsx("Ventas", rows, WIDTHS)), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ventas-${store}-${today}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
