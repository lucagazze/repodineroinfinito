import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { PANEL_TZ, presetRange, previousOf, shift, todayIn } from "./range";
import { addDays, dayOf, startOfDay } from "./tz";
import { metaDaily, metaObjects, metaWindows, rangesKey, syncState, type CRow, type Obj } from "./meta-data";
import { platformSplit } from "./meta-platform";
import type { PlatformNums } from "./platforms-shared";
export { metaError } from "./meta-conn";

/**
 * Rendimiento de Meta por campaña → conjunto → anuncio, con lo que de verdad
 * cobramos. Para cada fila y cada ventana (el período del filtro, ayer, 3 y 7
 * días) da el gasto y las métricas de Meta, y NUESTRO valor generado: los
 * pedidos atribuidos a esa campaña (por las UTM con ids de Meta; si no hay,
 * por el checkout al que está vinculada), con bumps y OTOs, en USD, menos
 * reembolsos. Beneficio bruto = valor − gasto − comisiones de Stripe (no
 * están guardadas: se estiman en 2,9 % + US$ 0,30 por cobro y se marcan
 * «est.»). Cada ventana viene con la anterior del mismo largo para la flecha.
 *
 * Nunca le pregunta a Meta: lee meta_insights_daily (por anuncio y día), que
 * llena el cron cada 15 minutos (meta-sync.ts); si Meta limitó, se muestra lo
 * guardado.
 */

export type WinKey = "periodo" | "ayer" | "3d" | "7d";
export type Totals = {
  spend: number; impressions: number; clicks: number; metaPurchases: number; metaValue: number;
  orders: number; revenue: number; fees: number;
};
export type WinStats = { cur: Totals; prev: Totals };
export type Level = "campaign" | "adset" | "ad";
export type PerfNode = {
  id: string; name: string; level: Level; status: string;
  budget: { daily: number | null; lifetime: number | null } | null;
  /** Límite de puja (solo conjuntos) y estrategia de puja, en la moneda de la cuenta. */
  bid: number | null; strategy: string | null;
  thumb: string | null;
  /** Checkouts (mercados) a los que está vinculada la campaña. */
  links: string[];
  w: Record<WinKey, WinStats>;
  children: PerfNode[];
};
export type Perf = {
  account: { id: string; name: string; currency: string; timezone: string };
  windows: Record<WinKey, { since: string; until: string; prevSince: string; prevUntil: string; label: string }>;
  nodes: PerfNode[];
  /** Ventas que no se pudieron atribuir a ninguna campaña de esta cuenta. */
  unattributed: Record<WinKey, WinStats>;
  feesEstimated: boolean;
  /** Gasto de toda la cuenta por día del período (USD), para el gráfico. */
  daily: Record<string, number>;
  fetchedAt: number | null; stale: boolean; error: string | null;
  /** Desde qué día hay datos de Meta guardados (la carga inicial va hacia atrás de a tandas). */
  coverageFrom: string | null;
  /** Por campaña, en el período: gasto, compras y valor de Meta por red (Instagram, Facebook…). */
  platforms: Record<string, PlatformNums[]>;
};

const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, metaPurchases: 0, metaValue: 0, orders: 0, revenue: 0, fees: 0 });
const zeroWin = (): Record<WinKey, WinStats> => ({
  periodo: { cur: zero(), prev: zero() }, ayer: { cur: zero(), prev: zero() }, "3d": { cur: zero(), prev: zero() }, "7d": { cur: zero(), prev: zero() },
});

type Meta = Obj;

// -------------------------------------------------------------- nuestras ventas

type Attr = { day: string; campaign: string | null; adset: string | null; ad: string | null; funnel: string | null; value: number; fees: number };

const idOf = (v: unknown) => {
  const m = String(v ?? "").match(/(?:^|\|)\s*(\d{6,25})\s*$/);
  return m ? m[1] : null;
};

async function ourOrders(storeIds: string[], funnelIds: string[] | null, from: string, to: string) {
  const rates = await getRates();
  const out: Attr[] = [];
  for (let i = 0; ; i += 1000) {
    let q = db.from("orders")
      .select("id,created_at,funnel_id,currency,amount_total,amount_refunded,utm,order_items(kind,amount,currency,refunded_amount,stripe_payment_intent)")
      .in("store_id", storeIds).in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0)
      .gte("created_at", startOfDay(from, PANEL_TZ).toISOString()).lt("created_at", startOfDay(addDays(to, 1), PANEL_TZ).toISOString())
      .order("created_at").range(i, i + 999);
    if (funnelIds) q = q.in("funnel_id", funnelIds.length ? funnelIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q;
    if (error) throw new Error(`orders: ${error.message}`);
    for (const o of data ?? []) {
      const cur = (o.currency ?? "USD").toUpperCase();
      const usd = (n: unknown, c?: string | null) => Number(n ?? 0) / (rates[(c ?? cur).toUpperCase()] ?? 1);
      const items = (o.order_items ?? []) as { kind: string; amount: number; currency: string | null; refunded_amount: number | null; stripe_payment_intent: string | null }[];
      const ups = items.filter((it) => it.kind === "upsell");
      const gross = items.length ? items.reduce((a, it) => a + usd(it.amount, it.currency), 0) : usd(o.amount_total);
      const refunded = usd(o.amount_refunded) + ups.reduce((a, it) => a + usd(it.refunded_amount, it.currency), 0);
      // Comisión estimada de Stripe: 2,9 % + US$ 0,30 por cobro (el pago y cada OTO aparte); no se devuelve con un reembolso.
      const fee = (n: number) => (n > 0 ? n * 0.029 + 0.3 : 0);
      const fees = fee(usd(o.amount_total)) + ups.reduce((a, it) => a + fee(usd(it.amount, it.currency)), 0);
      const utm = (o.utm ?? {}) as Record<string, unknown>;
      out.push({
        day: dayOf(new Date(o.created_at), PANEL_TZ),
        campaign: idOf(utm.utm_campaign) ?? idOf(utm.campaign_id) ?? idOf(utm.utm_id),
        adset: idOf(utm.utm_medium) ?? idOf(utm.adset_id),
        ad: idOf(utm.utm_content) ?? idOf(utm.ad_id),
        funnel: o.funnel_id, value: Math.max(0, gross - refunded), fees,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------------- armado

export type PerfInput = {
  act: string;
  /** Tiendas cuyas ventas cuentan (las que usan esta cuenta). */
  storeIds: string[];
  /** Solo estas campañas (la oferta); null = toda la cuenta. */
  campaigns: string[] | null;
  /** Solo los pedidos de estos checkouts (la oferta); null = todos los de las tiendas. */
  funnelIds: string[] | null;
  /** Campañas vinculadas a cada checkout (para atribuir ventas sin UTM). */
  funnelCampaigns: Record<string, string[]>;
  funnelLabels: Record<string, string>;
  period: { since: string; until: string; label: string };
};

export async function campaignPerf(inp: PerfInput): Promise<Perf> {
  const today = todayIn(PANEL_TZ);
  const y = shift(today, -1);
  const win = (since: string, until: string, label: string) => {
    const p = previousOf({ since, until });
    return { since, until, prevSince: p.since, prevUntil: p.until, label };
  };
  const windows: Perf["windows"] = {
    periodo: win(inp.period.since, inp.period.until, inp.period.label),
    // Las mismas ventanas que el selector de fechas (presetRange): 3 y 7 días cuentan hoy.
    ayer: win(y, y, "Ayer"),
    "3d": win(presetRange("3d", today)!.since, today, "Últimos 3 días"),
    "7d": win(presetRange("7d", today)!.since, today, "Últimos 7 días"),
  };
  const uniq = (list: [string, string][]) => [...new Map(list.map((r) => [r.join("|"), r])).values()];
  // La tabla de campañas muestra solo el período del filtro (simple): no se piden Ayer/3/7 días.
  const ranges = uniq([[windows.periodo.since, windows.periodo.until], [windows.periodo.prevSince, windows.periodo.prevUntil]]);

  // Todo de la base: estado de la sincronización, objetos y métricas de todas las ventanas en una consulta.
  const minDay = ranges.map((r) => r[0]).sort()[0];
  const maxDay = ranges.map((r) => r[1]).sort().at(-1)!;
  const camps = inp.campaigns ? inp.campaigns.join(",") : "*";
  const [sync, objs, metaWin, daily, orders, rates] = await Promise.all([
    syncState(inp.act), metaObjects(inp.act), metaWindows(inp.act, rangesKey(ranges), camps),
    metaDaily(inp.act, inp.period.since, inp.period.until),
    ourOrders(inp.storeIds, inp.funnelIds, minDay, maxDay), getRates(),
  ]);
  const raw = { campaigns: objs.campaigns, adsets: objs.adsets, ads: objs.ads, ranges: metaWin.ranges, names: metaWin.names };
  const synced = sync.fetchedAt != null;
  const cur = sync.currency;
  const toUsd = (n: unknown) => (Number(n) || 0) / (rates[cur] ?? 1);

  // Metadatos: estado, presupuesto, miniatura.
  const meta = new Map<string, Meta>();
  for (const m of [...raw.campaigns, ...raw.adsets, ...raw.ads]) meta.set(m.id, m);
  const adParent = new Map<string, { adset: string; campaign: string }>();
  for (const a of raw.ads) adParent.set(a.id, { adset: a.adset_id ?? "", campaign: a.campaign_id ?? "" });
  const adsetCampaign = new Map<string, string>();
  for (const s of raw.adsets) adsetCampaign.set(s.id, s.campaign_id ?? "");

  // Nodos.
  const nodes = new Map<string, PerfNode>();
  const mk = (id: string, level: Level, name: string): PerfNode => {
    let n = nodes.get(`${level}:${id}`);
    if (!n) {
      const m = meta.get(id);
      n = {
        id, level, name: m?.name ?? name ?? id, status: m?.effective_status ?? (synced ? "ARCHIVED" : "UNKNOWN"),
        budget: level === "ad" ? null : { daily: m?.daily_budget || null, lifetime: m?.lifetime_budget || null },
        bid: level === "adset" ? m?.bid_amount || null : null, strategy: level === "ad" ? null : m?.bid_strategy ?? null,
        thumb: level === "ad" ? m?.thumb ?? null : null,
        links: [], w: zeroWin(), children: [],
      };
      nodes.set(`${level}:${id}`, n);
    }
    return n;
  };
  const wanted = inp.campaigns ? new Set(inp.campaigns) : null;
  const keep = (c: string) => !wanted || wanted.has(c);

  // Lo activo aparece aunque no haya gastado.
  for (const c of raw.campaigns) if (keep(c.id)) mk(c.id, "campaign", c.name);
  for (const s of raw.adsets) if (keep(s.campaign_id ?? "")) mk(s.id, "adset", s.name);
  for (const a of raw.ads) if (keep(a.campaign_id ?? "")) mk(a.id, "ad", a.name);

  const addMeta = (t: Totals, r: CRow) => {
    t.spend += toUsd(r[3]); t.impressions += r[4]; t.clicks += r[5]; t.metaPurchases += r[6]; t.metaValue += toUsd(r[7]);
  };
  for (const [k, w] of Object.entries(windows) as [WinKey, Perf["windows"][WinKey]][]) {
    for (const [side, key] of [["cur", `${w.since}|${w.until}`], ["prev", `${w.prevSince}|${w.prevUntil}`]] as const) {
      for (const r of raw.ranges[key] ?? []) {
        const [adId, adsetId, campaignId] = r;
        if (!keep(campaignId)) continue;
        adParent.set(adId, { adset: adsetId, campaign: campaignId });
        adsetCampaign.set(adsetId, campaignId);
        for (const [lvl, id] of [["campaign", campaignId], ["adset", adsetId], ["ad", adId]] as const) {
          addMeta(mk(id, lvl, raw.names[id] ?? id).w[k][side], r);
        }
      }
    }
  }

  // Árbol: campaña → conjuntos → anuncios.
  const campaignsOut: PerfNode[] = [];
  for (const n of nodes.values()) {
    if (n.level === "campaign") campaignsOut.push(n);
    else if (n.level === "adset") nodes.get(`campaign:${adsetCampaign.get(n.id) ?? meta.get(n.id)?.campaign_id ?? ""}`)?.children.push(n);
    else {
      const p = adParent.get(n.id);
      nodes.get(`adset:${p?.adset ?? meta.get(n.id)?.adset_id ?? ""}`)?.children.push(n);
    }
  }

  // Vínculos checkout → campañas (para la etiqueta y para atribuir sin UTM).
  const campaignFunnels = new Map<string, string[]>();
  for (const [f, cs] of Object.entries(inp.funnelCampaigns)) for (const c of cs) campaignFunnels.set(c, [...(campaignFunnels.get(c) ?? []), f]);
  for (const c of campaignsOut) c.links = (campaignFunnels.get(c.id) ?? []).map((f) => inp.funnelLabels[f] ?? "Checkout");

  // Nuestras ventas, por ventana.
  const unattributed = zeroWin();
  const inWin = (d: string, s: string, u: string) => d >= s && d <= u;
  const spendOn = (campaign: string, k: WinKey) => nodes.get(`campaign:${campaign}`)?.w[k].cur.spend ?? 0;
  for (const o of orders) {
    for (const [k, w] of Object.entries(windows) as [WinKey, Perf["windows"][WinKey]][]) {
      const side = inWin(o.day, w.since, w.until) ? "cur" : inWin(o.day, w.prevSince, w.prevUntil) ? "prev" : null;
      if (!side) continue;
      // Con UTM de Meta: campaña, conjunto y anuncio exactos.
      const ad = o.ad && nodes.get(`ad:${o.ad}`);
      const campaignId = o.campaign ?? (o.ad ? adParent.get(o.ad)?.campaign : null) ?? (o.adset ? adsetCampaign.get(o.adset) : null);
      let shares: [string, number][] = [];
      if (campaignId && nodes.has(`campaign:${campaignId}`)) shares = [[campaignId, 1]];
      else if (o.funnel) {
        // Sin UTM: la campaña vinculada a su checkout; si son varias, en proporción a lo que gastó cada una.
        const cs = (inp.funnelCampaigns[o.funnel] ?? []).filter((c) => nodes.has(`campaign:${c}`));
        const tot = cs.reduce((a, c) => a + spendOn(c, k), 0);
        shares = cs.map((c) => [c, tot ? spendOn(c, k) / tot : 1 / cs.length]);
      }
      if (!shares.length) {
        const t = unattributed[k][side]; t.orders++; t.revenue += o.value; t.fees += o.fees;
        continue;
      }
      for (const [c, share] of shares) {
        const t = nodes.get(`campaign:${c}`)!.w[k][side];
        t.orders += share; t.revenue += o.value * share; t.fees += o.fees * share;
      }
      if (shares.length === 1 && shares[0][0] === campaignId) {
        const adsetId = o.adset ?? (o.ad ? adParent.get(o.ad)?.adset : null);
        for (const n of [adsetId ? nodes.get(`adset:${adsetId}`) : null, ad || null]) {
          if (!n) continue;
          const t = n.w[k][side]; t.orders++; t.revenue += o.value; t.fees += o.fees;
        }
      }
    }
  }

  // Gasto de toda la cuenta por día del período.
  const dailySpend = () => {
    const out: Record<string, number> = {};
    for (const days of Object.values(daily.daily)) for (const [d, r] of Object.entries(days)) out[d] = (out[d] ?? 0) + toUsd(r[0]);
    return out;
  };

  // Sin filas vacías: lo que no gastó ni vendió en ninguna ventana y no está activo no se muestra.
  const any = (n: PerfNode) => (Object.values(n.w) as WinStats[]).some((s) => s.cur.spend || s.cur.orders || s.prev.spend);
  const prune = (list: PerfNode[]): PerfNode[] => list
    .map((n) => ({ ...n, children: prune(n.children) }))
    .filter((n) => any(n) || n.status === "ACTIVE" || n.children.length);

  const nodesOut = prune(campaignsOut);
  // Por red social, de las campañas que se muestran (si la tabla todavía no tiene datos, vacío).
  const platforms = await platformSplit(nodesOut.map((n) => n.id), windows.periodo.since, windows.periodo.until)
    .then((x) => x.byCampaign).catch(() => ({} as Record<string, PlatformNums[]>));

  return {
    account: { id: inp.act, name: sync.name ?? inp.act, currency: cur, timezone: sync.timezone },
    windows, nodes: nodesOut, unattributed, feesEstimated: true, platforms,
    daily: dailySpend(), fetchedAt: sync.fetchedAt, stale: sync.stale, error: sync.error, coverageFrom: sync.coverageFrom,
  };
}
