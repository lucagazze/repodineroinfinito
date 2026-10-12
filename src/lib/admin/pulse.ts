import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { liveSnapshot, type Counts, type LivePage } from "@/lib/live";
import { offerList } from "./offers";
import { productAlias } from "./privacy";
import { RANGE_TZ, todayIn } from "./range";
import { addDays, startOfDay } from "./tz";
import { deliveryData, deliveryFact, payFact, type Fact } from "./order-facts";
import { orderRef } from "@/lib/order-ref";
import { networkOf, type Network } from "@/lib/network";
import { fetchAll } from "@/lib/fetch-all";

/**
 * «Todas las ofertas» como centro de control: quién está conectado y dónde
 * (site_events, vía liveSnapshot), lo vendido hoy (día de Londres) por
 * checkout y por país. Lo pide el panel cada 5 s
 * por /api/admin/pulso. Las últimas compras (con el período del filtro y
 * «Ver más») van aparte: recentOrders, por /api/admin/compras.
 */

export type PulseOrder = {
  id: string; at: string; funnelId: string | null; status: string;
  /** «#1001» (orderRef). */
  ref: string;
  /** La oferta (para el link a sus Pedidos). */
  offerKey: string | null;
  offer: string | null; alias: string | null; market: string | null; flags: string[];
  country: string | null; amount: number; currency: string; usd: number;
  buyer: string | null;
  /** Lo que sumó además del principal: bumps del checkout y ofertas de 1 clic después de pagar. */
  extras: { kind: "bump" | "upsell"; name: string; alias: string }[];
  /** Exactamente lo que compró: el principal, cada bump y cada OTO o downsell aceptado, con su precio. */
  items: { kind: "main" | "bump" | "oto" | "downsell"; label: string; name: string; alias: string; amount: number; currency: string; refunded: number }[];
  /** El pago y la entrega, en castellano (los mismos hechos que en Pedidos). */
  pay: Fact; delivery: Fact;
  /** De qué red social vino, si se sabe (navegador de la app de Instagram/Facebook o utm_source). */
  network: Network | null;
};
export type Pulse = {
  at: string; windowS: number;
  live: {
    total: Counts & { all: number }; countries: [string, number][]; byFunnel: Record<string, Counts>;
    /** Por checkout: visitantes de países que no son los de su mercado [país, cantidad] (p. ej. los revisores de Meta). */
    outside: Record<string, [string, number][]>;
    /** Cada ciudad con gente (posición de la ciudad, ≈ 10 km), con su paso y su oferta: los puntos del mapa. */
    points: { lat: number; lon: number; city: string | null; cc: string | null; page: LivePage; offer: string | null; n: number }[];
  };
  today: {
    day: string; revenue: number; orders: number;
    byFunnel: Record<string, { revenue: number; orders: number }>;
    /** [país, pedidos, facturado en USD] */
    countries: [string, number, number][];
  };
};


type Item = { kind: string; amount: number | string; currency: string | null; product_id: string | null; products: { short_name: string } | null; refunded_amount?: number | string | null; created_at?: string };
type OrderRow = {
  id: string; number?: number | null; created_at: string; funnel_id: string | null; country: string | null; currency: string | null;
  amount_total: number | string | null; name?: string | null; order_items: Item[] | null; pp_funnel_id?: string | null;
  status?: string; amount_refunded?: number | string | null; delivered_at?: string | null; fulfill_claimed_at?: string | null; delivery_error?: string | null;
  utm?: Record<string, string> | null; tracking?: { ua?: string } | null;
};

/** Nivel (OTO 1/2/3) y tipo (OTO o downsell) de cada producto de esas cadenas de post-pago. */
async function ppStepsOf(ppIds: string[]) {
  const out = new Map<string, { kind: "oto" | "downsell"; level: number }>();
  const full = await fetchAll((a, b) => db.from("pp_steps").select("id,pp_funnel_id,product_id,sort_order,kind,downsell_of,level").in("pp_funnel_id", ppIds).order("id").range(a, b)).catch(() => []);
  const rows = full as { id: string; pp_funnel_id: string; product_id: string; sort_order: number; kind: string | null; downsell_of: string | null; level: number | null }[];
  for (const pp of ppIds) {
    const mine = rows.filter((r) => r.pp_funnel_id === pp).sort((a, b) => a.sort_order - b.sort_order);
    const otos = mine.filter((r) => (r.kind ?? "oto") === "oto");
    const lvl = new Map(otos.map((r, i) => [r.id, r.level ?? i + 1]));
    for (const r of mine) {
      const isDs = r.kind === "downsell";
      out.set(`${pp}|${r.product_id}`, { kind: isDs ? "downsell" : "oto", level: isDs ? r.level ?? lvl.get(r.downsell_of ?? "") ?? 1 : lvl.get(r.id) ?? 1 });
    }
  }
  return out;
}

type Info = Map<string, { offer: string; alias: string; key: string; market: string | null; flags: string[] }>;
async function funnelInfo(): Promise<Info> {
  // Mercado = la etiqueta del país; el nombre interno del checkout no (se vería en modo captura).
  const info: Info = new Map();
  for (const o of await offerList()) for (const f of o.funnels) info.set(f.id, { offer: o.name, alias: o.alias, key: o.key, market: f.market_label || null, flags: f.flags });
  return info;
}

const ORDER_COLS = "id,number,created_at,funnel_id,pp_funnel_id,country,currency,amount_total,amount_refunded,status,delivered_at,fulfill_claimed_at,delivery_error,name,utm,tracking,order_items(kind,amount,currency,product_id,refunded_amount,created_at,products(short_name))";

/** Cada pedido con lo que compró (principal, bumps, OTOs y downsells con su nivel real), el pago y la entrega. */
async function buildOrders(last: OrderRow[], info: Info): Promise<PulseOrder[]> {
  const rates = await getRates();
  const usd = (n: unknown, c: string | null | undefined) => Number(n ?? 0) / (rates[(c ?? "USD").toUpperCase()] ?? 1);
  const ppIds = [...new Set(last.map((o) => o.pp_funnel_id).filter((x): x is string => !!x))];
  const [facts, steps] = await Promise.all([
    deliveryData(last.map((o) => o.id)),
    ppIds.length ? ppStepsOf(ppIds) : Promise.resolve(new Map<string, { kind: "oto" | "downsell"; level: number }>()),
  ]);
  return last.map((o) => {
    const f = o.funnel_id ? info.get(o.funnel_id) : undefined;
    const ups = (o.order_items ?? []).filter((i) => i.kind === "upsell");
    return {
      id: o.id, ref: orderRef(o), at: o.created_at, funnelId: o.funnel_id, status: o.status ?? "paid", offerKey: f?.key ?? null,
      offer: f?.offer ?? null, alias: f?.alias ?? null, market: f?.market ?? null, flags: f?.flags ?? [],
      country: o.country, currency: (o.currency ?? "USD").toUpperCase(),
      // Lo cobrado en el pedido + lo que aceptó después de pagar (se cobra aparte).
      amount: Number(o.amount_total ?? 0) + ups.reduce((a, i) => a + Number(i.amount ?? 0), 0),
      usd: usd(o.amount_total, o.currency) + ups.reduce((a, i) => a + usd(i.amount, i.currency ?? o.currency), 0),
      buyer: o.name?.trim() || null,
      extras: (o.order_items ?? []).filter((i) => i.kind === "bump" || i.kind === "upsell").map((i) => ({
        kind: i.kind as "bump" | "upsell", name: i.products?.short_name ?? "Producto", alias: i.product_id ? productAlias(i.product_id) : "Producto",
      })),
      items: [...(o.order_items ?? [])]
        .filter((i) => i.kind === "main" || i.kind === "bump" || i.kind === "upsell")
        .sort((a, b) => ({ main: 0, bump: 1, upsell: 2 }[a.kind as "main"] - { main: 0, bump: 1, upsell: 2 }[b.kind as "main"]) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
        .map((i) => {
          const st = i.kind === "upsell" ? steps.get(`${o.pp_funnel_id}|${i.product_id}`) : undefined;
          const kind = i.kind === "main" ? "main" as const : i.kind === "bump" ? "bump" as const : st?.kind ?? "oto" as const;
          const label = kind === "main" ? "Principal" : kind === "bump" ? "Bump" : `${kind === "oto" ? "OTO" : "DS"}${st ? ` ${st.level}` : ""}`;
          return {
            kind, label, name: i.products?.short_name ?? "Producto", alias: i.product_id ? productAlias(i.product_id) : "Producto",
            amount: Number(i.amount ?? 0), currency: (i.currency ?? o.currency ?? "USD").toUpperCase(), refunded: Number(i.refunded_amount ?? 0),
          };
        }),
      pay: payFact({ ...o, status: o.status ?? "paid" }),
      delivery: (({ events: _e, ...df }) => df)(deliveryFact({ ...o, status: o.status ?? "paid" }, facts.logs.get(o.id) ?? [], facts.downloads.get(o.id) ?? [])),
      network: networkOf({ ua: o.tracking?.ua ?? null, utmSource: o.utm?.utm_source ?? null }),
    };
  });
}

/**
 * Las compras de verdad de un período (días de Londres, «desde» y «hasta»
 * inclusive), de la más nueva a la más vieja: de todas las ofertas o solo de
 * esos checkouts. total = cuántas hay en el período (para «Ver más»).
 */
export async function recentOrders({ since, until, funnelIds, limit, offset = 0, search }: {
  since: string; until: string; funnelIds?: string[] | null; limit: number;
  /** Para paginar (Últimos pagos de Inicio: de a 10). */
  offset?: number;
  /** Correo, nombre o teléfono (parte), o el número de pedido («1018» o «#1018»). */
  search?: string | null;
}) {
  let q = db.from("orders").select(ORDER_COLS, { count: "exact" })
    .in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0)
    .gte("created_at", startOfDay(since, RANGE_TZ).toISOString()).lt("created_at", startOfDay(addDays(until, 1), RANGE_TZ).toISOString())
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (funnelIds) q = q.in("funnel_id", funnelIds.length ? funnelIds : ["00000000-0000-0000-0000-000000000000"]);
  // Sin los caracteres que PostgREST usa en el filtro (coma, paréntesis, comodines).
  const t = (search ?? "").replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80);
  if (t) {
    const n = /^#?\d{1,9}$/.test(t) ? t.replace("#", "") : null;
    q = q.or([`email.ilike.*${t}*`, `name.ilike.*${t}*`, `phone.ilike.*${t}*`, ...(n ? [`number.eq.${n}`] : [])].join(","));
  }
  const [{ data, error, count }, info] = await Promise.all([q, funnelInfo()]);
  if (error) throw new Error(`orders: ${error.message}`);
  return { day: todayIn(RANGE_TZ), total: count ?? 0, orders: await buildOrders((data ?? []) as unknown as OrderRow[], info) };
}

export async function pulse(): Promise<Pulse> {
  const day = todayIn(RANGE_TZ);
  const from = startOfDay(day, RANGE_TZ).toISOString();
  // Sin los eventos: «Últimos eventos» ahora los pide EventsByPerson (/api/admin/eventos). Así el pedido de cada 5 s es más liviano.
  const [snap, rates, todayQ, info] = await Promise.all([
    liveSnapshot(),
    getRates(),
    db.from("orders").select("id,created_at,funnel_id,country,currency,amount_total,order_items(kind,amount,currency)")
      .eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).gte("created_at", from).order("created_at", { ascending: false }).limit(5000),
    funnelInfo(),
  ]);
  if (todayQ.error) throw new Error(`orders: ${todayQ.error.message}`);

  const usd = (n: unknown, c: string | null | undefined) => Number(n ?? 0) / (rates[(c ?? "USD").toUpperCase()] ?? 1);
  // Lo cobrado en el pedido + lo que aceptó después de pagar (se cobra aparte, como en Métricas).
  const totalUsd = (o: OrderRow) => usd(o.amount_total, o.currency) + (o.order_items ?? []).filter((i) => i.kind === "upsell").reduce((a, i) => a + usd(i.amount, i.currency ?? o.currency), 0);

  const byFunnel: Pulse["today"]["byFunnel"] = {};
  const byCountry = new Map<string, [number, number]>();
  let revenue = 0;
  const today = (todayQ.data ?? []) as unknown as OrderRow[];
  for (const o of today) {
    const v = totalUsd(o);
    revenue += v;
    const k = o.funnel_id ?? "";
    const g = (byFunnel[k] ??= { revenue: 0, orders: 0 });
    g.revenue += v; g.orders++;
    if (o.country) {
      const c = byCountry.get(o.country) ?? [0, 0];
      byCountry.set(o.country, [c[0] + 1, c[1] + v]);
    }
  }

  const liveByFunnel: Record<string, Counts> = {};
  const outside: Record<string, [string, number][]> = {};
  for (const r of snap.rows) {
    if (!r.funnelId || !r.total) continue;
    liveByFunnel[r.funnelId] = r.counts;
    // No se esconden: se marcan. Un mercado sin banderas (mundial) no tiene «afuera».
    const home = new Set(r.flags.map((f) => f.toUpperCase()));
    const out = home.size ? r.countries.filter(([c]) => c && !home.has(c.toUpperCase())) : [];
    if (out.length) outside[r.funnelId] = out;
  }

  return {
    at: snap.at, windowS: snap.windowS,
    live: {
      total: snap.total, countries: snap.countries, byFunnel: liveByFunnel, outside,
      points: snap.points.map((p) => {
        const f = p.funnelId ? info.get(p.funnelId) : undefined;
        return { lat: p.lat, lon: p.lon, city: p.city, cc: p.country, page: p.page, offer: f ? (f.market ? `${f.offer} · ${f.market}` : f.offer) : null, n: p.n };
      }),
    },
    today: {
      day, revenue, orders: today.length, byFunnel,
      countries: [...byCountry].map(([cc, [n, v]]) => [cc, n, v] as [string, number, number]).sort((a, b) => b[2] - a[2]),
    },
  };
}
