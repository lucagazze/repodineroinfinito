import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { resolveRange, RANGE_TZ } from "@/lib/admin/range";
import { addDays, startOfDay } from "@/lib/admin/tz";
import { orderRef } from "@/lib/order-ref";

export const runtime = "nodejs";

/** Pedidos en CSV, con los mismos filtros que la pantalla. Abre directo en Excel. */
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return new NextResponse("No autorizado", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const { data: store } = await db.from("stores").select("id,slug").eq("slug", sp.get("store") ?? "").maybeSingle();
  if (!store) return new NextResponse("Tienda inexistente", { status: 404 });

  // ?oferta=<id>: solo los pedidos de los checkouts de esa oferta (el panel va por oferta).
  let offerFunnels: string[] | null = null;
  if (sp.get("oferta")) {
    const { data: fs } = await db.from("funnels").select("id").eq("offer_id", sp.get("oferta")!).eq("store_id", store.id);
    offerFunnels = (fs ?? []).map((f) => f.id);
    if (!offerFunnels.length) offerFunnels = ["00000000-0000-0000-0000-000000000000"];
  }

  const R = resolveRange({ r: sp.get("r") ?? undefined, desde: sp.get("desde") ?? undefined, hasta: sp.get("hasta") ?? undefined });
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("orders")
      .select("id,number,created_at,status,email,name,phone,country,locale,currency,amount_total,funnel_id,utm,delivered_at,refunded_at")
      .eq("store_id", store.id).order("created_at", { ascending: false }).range(from, from + 999);
    // Como la pantalla: solo compras de verdad (pagadas o reembolsadas), nunca las de prueba;
    // los intentos sin pagar solo si se piden. Y el mismo período.
    const est = sp.get("estado");
    q = est && ["paid", "pending", "refunded"].includes(est) ? q.eq("status", est) : q.in("status", ["paid", "refunded"]);
    if (est !== "pending") q = q.or(HAS_STRIPE).gt("amount_total", 0);
    q = q.gte("created_at", startOfDay(R.since, RANGE_TZ).toISOString()).lt("created_at", startOfDay(addDays(R.until, 1), RANGE_TZ).toISOString());
    if (sp.get("embudo")) q = q.eq("funnel_id", sp.get("embudo")!);
    if (offerFunnels) q = q.in("funnel_id", offerFunnels);
    const { data } = await q;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const ids = rows.map((r) => r.id as string);
  const extras = new Map<string, { bumps: number; upsells: number; total: number; products: string[] }>();
  const { data: products } = await db.from("products").select("id,short_name").eq("store_id", store.id);
  const pName = new Map((products ?? []).map((p) => [p.id, p.short_name]));
  const { data: funnels } = await db.from("funnels").select("id,name").eq("store_id", store.id);
  const fName = new Map((funnels ?? []).map((f) => [f.id, f.name]));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("order_items").select("order_id,kind,amount,product_id").in("order_id", ids.slice(i, i + 200));
    for (const it of data ?? []) {
      const e = extras.get(it.order_id) ?? { bumps: 0, upsells: 0, total: 0, products: [] };
      e.total += Number(it.amount);
      if (it.kind === "bump") e.bumps++;
      if (it.kind === "upsell") e.upsells++;
      if (Number(it.amount) > 0 && it.product_id) e.products.push(pName.get(it.product_id) ?? "?");
      extras.set(it.order_id, e);
    }
  }

  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Excel ejecuta celdas que empiezan con = + - @: se neutralizan.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["fecha", "pedido", "estado", "email", "nombre", "telefono", "pais", "idioma", "embudo", "productos", "bumps", "upsells", "moneda", "total", "entregado", "reembolsado", "utm_source", "utm_campaign"];
  const lines = rows.map((r) => {
    const e = extras.get(r.id as string);
    const utm = (r.utm ?? {}) as Record<string, string>;
    return [
      new Date(r.created_at as string).toISOString().replace("T", " ").slice(0, 16), orderRef({ id: r.id as string, number: r.number as number | null, status: r.status as string }),
      r.status, r.email, r.name, r.phone, r.country, r.locale, fName.get(r.funnel_id as string) ?? "",
      e?.products.join(" + ") ?? "", e?.bumps ?? 0, e?.upsells ?? 0, r.currency,
      (e?.total || Number(r.amount_total ?? 0)).toFixed(2).replace(".", ","),
      r.delivered_at ? "si" : "no", r.refunded_at ? "si" : "no", utm.utm_source, utm.utm_campaign,
    ].map(cell).join(";");
  });
  // BOM + punto y coma: Excel en español lo abre en columnas y con tildes.
  const csv = "\uFEFF" + [head.join(";"), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pedidos-${store.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
