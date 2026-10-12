import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { orderRef, parseOrderNumber } from "@/lib/order-ref";
import { offerList } from "./offers";
import { RANGE_TZ, type Range } from "./range";
import { addDays, startOfDay } from "./tz";

/**
 * Las ventas de TODAS las tiendas juntas (pantallas /admin/ventas y
 * /admin/clientes, y su CSV). Las mismas reglas que el resto del panel: solo
 * compras de verdad (pagadas o reembolsadas, con el pago en Stripe, monto > 0,
 * nunca de una tienda de prueba). Sin las tiendas de EXCLUDED_STORES ni las de prueba, como en la plata (money.ts).
 *
 * El volumen es chico (cientos de pedidos por mes): se trae el período entero
 * y se filtra y ordena en memoria. Así se puede ordenar por columnas que la
 * base no tiene (total en USD, tienda, productos) y la pantalla y el CSV dan
 * exactamente lo mismo.
 */

export const EXCLUDED_STORES = new Set((process.env.EXCLUDED_STORES ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export type SaleItem = { kind: "main" | "bump" | "upsell"; amount: number; productId: string | null; name: string };
export type Sale = {
  id: string; number: number | null; ref: string; createdAt: string;
  name: string | null; email: string | null; phone: string | null; country: string | null; locale: string | null;
  storeId: string; storeSlug: string; storeName: string;
  offerId: string | null; offerName: string | null; offerAlias: string | null; offerKey: string | null;
  funnelId: string | null; checkout: string | null; market: string | null; ppFunnelId: string | null;
  currency: string;
  /** Lo cobrado en su moneda: el pago del checkout (principal + bumps) + los OTO. */
  total: number; usd: number;
  status: "paid" | "refunded";
  refunded: number; refundedUsd: number;
  deliveredAt: string | null;
  items: SaleItem[]; bumps: number; otos: number;
  utmSource: string | null; utmCampaign: string | null;
};

export type StoreLite = { id: string; slug: string; name: string };

/** Tiendas que entran en estas pantallas. */
export async function salesStores(): Promise<StoreLite[]> {
  const { data } = await db.from("stores").select("id,slug,name,display_name").order("name");
  return (data ?? [])
    .filter((s) => !EXCLUDED_STORES.has(s.slug as string))
    .map((s) => ({ id: s.id as string, slug: s.slug as string, name: (s.display_name || s.name) as string }));
}

type Row = {
  id: string; number: number | null; created_at: string; email: string | null; name: string | null; phone: string | null;
  country: string | null; locale: string | null; currency: string | null; amount_total: number | string | null;
  amount_refunded: number | string | null; status: string; delivered_at: string | null; store_id: string;
  funnel_id: string | null; pp_funnel_id: string | null; utm: Record<string, string> | null;
  order_items: { kind: string; amount: number | string; product_id: string | null; products: { short_name: string | null; name?: string | null } | null }[] | null;
};

/**
 * Todas las ventas reales de esas tiendas. Con `range`, solo las de esos días
 * (días de Argentina, como todo el panel); sin él, todas las de siempre.
 */
export async function loadSales(range?: Pick<Range, "since" | "until"> | null): Promise<{ sales: Sale[]; stores: StoreLite[] }> {
  const [stores, offers, rates] = await Promise.all([salesStores(), offerList(), getRates()]);
  if (!stores.length) return { sales: [], stores };
  const sById = new Map(stores.map((s) => [s.id, s]));
  const byFunnel = new Map<string, { offer: (typeof offers)[number]; market: string; checkout: string }>();
  for (const o of offers) for (const f of o.funnels) byFunnel.set(f.id, { offer: o, market: f.market_label, checkout: f.market_label ? `${f.market_label} · ${f.name}` : f.name });
  const toUsd = (n: number, cur: string) => n / (rates[cur] ?? 1);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("orders")
      .select("id,number,created_at,email,name,phone,country,locale,currency,amount_total,amount_refunded,status,delivered_at,store_id,funnel_id,pp_funnel_id,utm,order_items(kind,amount,product_id,products(short_name,name))")
      .in("store_id", stores.map((s) => s.id))
      .in("status", ["paid", "refunded"])
      .or(HAS_STRIPE).gt("amount_total", 0)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (range) {
      q = q.gte("created_at", startOfDay(range.since, RANGE_TZ).toISOString())
        .lt("created_at", startOfDay(addDays(range.until, 1), RANGE_TZ).toISOString());
    }
    const { data, error } = await q;
    if (error) throw new Error(`orders: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < 1000) break;
  }

  const sales = rows.map((o): Sale => {
    const cur = (o.currency ?? "USD").toUpperCase();
    const items: SaleItem[] = (o.order_items ?? [])
      .filter((it) => (it.kind === "main" || it.kind === "bump" || it.kind === "upsell") && (it.kind === "main" || Number(it.amount) > 0))
      .map((it) => ({ kind: it.kind as SaleItem["kind"], amount: Number(it.amount) || 0, productId: it.product_id, name: it.products?.short_name || it.products?.name || "Producto" }))
      .sort((a, b) => ["main", "bump", "upsell"].indexOf(a.kind) - ["main", "bump", "upsell"].indexOf(b.kind));
    const otoSum = items.filter((it) => it.kind === "upsell").reduce((a, it) => a + it.amount, 0);
    const total = Number(o.amount_total ?? 0) + otoSum;
    const refunded = o.status === "refunded" && !Number(o.amount_refunded) ? total : Number(o.amount_refunded ?? 0);
    const f = o.funnel_id ? byFunnel.get(o.funnel_id) : undefined;
    const st = sById.get(o.store_id)!;
    return {
      id: o.id, number: o.number, ref: orderRef(o), createdAt: o.created_at,
      name: o.name, email: o.email, phone: o.phone, country: o.country ? o.country.toUpperCase() : null, locale: o.locale,
      storeId: st.id, storeSlug: st.slug, storeName: st.name,
      offerId: f?.offer.id ?? null, offerName: f?.offer.name ?? null, offerAlias: f?.offer.alias ?? null, offerKey: f?.offer.key ?? null,
      funnelId: o.funnel_id, checkout: f?.checkout ?? null, market: f?.market || null, ppFunnelId: o.pp_funnel_id,
      currency: cur, total, usd: toUsd(total, cur),
      status: o.status === "refunded" ? "refunded" : "paid",
      refunded, refundedUsd: toUsd(refunded, cur),
      deliveredAt: o.delivered_at,
      items, bumps: items.filter((it) => it.kind === "bump").length, otos: items.filter((it) => it.kind === "upsell").length,
      utmSource: o.utm?.utm_source ?? null, utmCampaign: o.utm?.utm_campaign ?? null,
    };
  });
  return { sales, stores };
}

/* ───────────── Filtros y orden de Ventas (pantalla y CSV) ───────────── */

export const SALE_SORTS = {
  fecha: "Fecha", pedido: "Pedido", cliente: "Cliente", email: "Email", pais: "País", tienda: "Tienda", oferta: "Oferta",
  productos: "Productos", total: "Total", moneda: "Moneda", usd: "Total USD", estado: "Estado", entregado: "Entregado",
} as const;
export type SaleSort = keyof typeof SALE_SORTS;

export type SaleFilters = {
  q: string; tienda: string; oferta: string; pais: string; estado: "" | "paid" | "refunded";
  extra: "" | "oto" | "bump" | "alguno" | "ninguno"; min: number | null;
  o: SaleSort; d: "asc" | "desc"; p: number;
  r?: string; desde?: string; hasta?: string;
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseSaleFilters(sp: SP): SaleFilters {
  const estado = one(sp.estado);
  const extra = one(sp.extra);
  const o = one(sp.o);
  const min = Number(one(sp.min).replace(",", "."));
  return {
    q: one(sp.q).trim(), tienda: one(sp.tienda), oferta: one(sp.oferta), pais: one(sp.pais).toUpperCase(),
    estado: estado === "paid" || estado === "refunded" ? estado : "",
    extra: (["oto", "bump", "alguno", "ninguno"] as const).find((x) => x === extra) ?? "",
    min: one(sp.min) && Number.isFinite(min) && min > 0 ? min : null,
    o: o in SALE_SORTS ? (o as SaleSort) : "fecha",
    d: one(sp.d) === "asc" ? "asc" : "desc",
    p: Math.max(1, Math.floor(Number(one(sp.p)) || 1)),
    r: one(sp.r) || undefined, desde: one(sp.desde) || undefined, hasta: one(sp.hasta) || undefined,
  };
}

/** Los filtros como query string (sin los vacíos ni los por defecto). */
export function saleQuery(f: SaleFilters, over: Partial<Record<keyof SaleFilters, string | number | null | undefined>> = {}) {
  const v: Record<string, unknown> = { ...f, ...over };
  const u = new URLSearchParams();
  for (const k of ["q", "tienda", "oferta", "pais", "estado", "extra", "min", "o", "d", "p", "r", "desde", "hasta"]) {
    const x = v[k];
    if (x == null || x === "") continue;
    if (k === "p" && Number(x) <= 1) continue;
    u.set(k, String(x));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export function filterSales(sales: Sale[], f: SaleFilters): Sale[] {
  const needle = f.q.toLowerCase().replace(/^#/, "");
  const num = parseOrderNumber(f.q);
  return sales.filter((s) => {
    if (f.tienda && s.storeSlug !== f.tienda) return false;
    if (f.oferta && s.offerId !== f.oferta) return false;
    if (f.pais && (s.country ?? "") !== f.pais) return false;
    if (f.estado && s.status !== f.estado) return false;
    if (f.extra === "oto" && !s.otos) return false;
    if (f.extra === "bump" && !s.bumps) return false;
    if (f.extra === "alguno" && !s.otos && !s.bumps) return false;
    if (f.extra === "ninguno" && (s.otos || s.bumps)) return false;
    if (f.min != null && s.usd < f.min) return false;
    if (needle) {
      const hit = (s.email ?? "").toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle)
        || (num != null && s.number === num) || s.ref.toLowerCase().replace(/^#/, "").startsWith(needle);
      if (!hit) return false;
    }
    return true;
  });
}

const productsText = (s: Sale) => s.items.map((it) => it.name).join(" + ");

export function sortSales(sales: Sale[], key: SaleSort, dir: "asc" | "desc"): Sale[] {
  const val = (s: Sale): string | number | null => {
    switch (key) {
      case "fecha": return s.createdAt;
      case "pedido": return s.number;
      case "cliente": return s.name?.trim() || null;
      case "email": return s.email?.toLowerCase() || null;
      case "pais": return s.country;
      case "tienda": return s.storeName;
      case "oferta": return s.offerName ? `${s.offerName} ${s.market ?? ""}` : null;
      case "productos": return productsText(s) || null;
      case "total": return s.total;
      case "moneda": return s.currency;
      case "usd": return s.usd;
      case "estado": return s.status === "refunded" ? "reembolsado" : s.refunded > 0 ? "reembolso parcial" : "pagado";
      case "entregado": return s.status === "refunded" ? null : s.deliveredAt ?? "";
    }
  };
  const m = dir === "asc" ? 1 : -1;
  return [...sales].sort((a, b) => {
    const x = val(a), y = val(b);
    // Lo vacío siempre al final, en cualquier sentido.
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { sensitivity: "base", numeric: true });
    return c * m || b.createdAt.localeCompare(a.createdAt);
  });
}

/** Etiqueta del estado de una venta. */
export const saleStatus = (s: Sale) => (s.status === "refunded" ? "Reembolsado" : s.refunded > 0 ? "Reembolso parcial" : "Pagado");

/** Fila del CSV de ventas (misma columna que `SALE_CSV_HEAD`). */
export const SALE_CSV_HEAD = [
  "fecha", "pedido", "nombre", "email", "telefono", "pais", "idioma", "tienda", "oferta", "checkout", "productos",
  "bumps", "otos", "moneda", "total", "total_usd", "estado", "reembolsado", "reembolsado_usd", "entregado", "utm_source", "utm_campaign",
];
