import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { BUSY_PCT, metaBatch, metaError, metaGet, metaPressure } from "@/lib/admin/meta-conn";
import { adAccounts } from "@/lib/admin/meta-report";
import { addDays, dayOf, startOfDay } from "@/lib/admin/tz";
import { resolveAlerts } from "@/lib/alerts";
import { sendPush } from "@/lib/push";
import { logActivity, short } from "./activity";
import { BID_CAP, CBO, WIN, guardVerdict, pickPauses, targetFor, winnerVerdict, type GuardVerdict, type WinnerVerdict } from "./rules";

/**
 * Piloto Meta Ads: la pasada diaria (09:17 de Argentina, /api/cron/autopiloto).
 *
 *  1. Lee de Meta, por cuenta: las campañas y los anuncios activos (un pedido)
 *     y el gasto, las compras y el valor por anuncio y día de los últimos 7
 *     días completos (otro pedido, más páginas si hace falta).
 *  2. Guardia de CBO: cada CBO activa con los números de los últimos 3 días
 *     completos y su ROAS: con ventas REALES de acá si la campaña manda a un
 *     checkout de acá (pedidos con bumps y OTOs, menos reembolsos, en USD:
 *     por la UTM con el id de la campaña o, sin UTM, repartidos entre las
 *     campañas vinculadas a ese checkout según lo que gastó cada una); si no,
 *     con el valor de compra de Meta. Las reglas: guardVerdict (rules.ts).
 *     Apaga a lo sumo 3 (las que más pierden), vuelve a leer el estado para
 *     confirmar, y las demás quedan en un aviso.
 *  3. Ganadores: cada anuncio activo de una CBO activa con 10+ compras y CPA
 *     en el objetivo (winnerVerdict) se propone UNA vez: push, aviso y la
 *     pantalla para pasarlo a BID CAP (bidcap.ts, solo cuando el dueño toca).
 *  4. Guarda la pasada, la evaluación de cada CBO y el historial.
 *
 * Solo escribe en Meta el estado PAUSED de campañas CBO. Nunca toca las BID
 * CAP, presupuestos, conjuntos, anuncios ni públicos. La simulación («Ver qué
 * haría») hace las mismas lecturas y no escribe nada en ningún lado.
 */

/** Las cuentas publicitarias que cuida (META_AUTOPILOT_ACCOUNTS, separadas por coma: act_123,act_456). */
export const AUTOPILOT_ACCOUNTS = (process.env.META_AUTOPILOT_ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
const H = 3600_000;

type Page<T> = { data?: T[]; paging?: { next?: string } };
type MCamp = { id: string; name: string; bid_strategy?: string; daily_budget?: string; lifetime_budget?: string; effective_status: string };
type MAd = { id: string; name: string; effective_status: string; campaign_id: string; adset_id: string };
type Act = { action_type: string; value: string };
type IRow = { campaign_id?: string; adset_id?: string; ad_id?: string; ad_name?: string; date_start: string; spend?: string; actions?: Act[]; action_values?: Act[] };

export type Settings = { cbo_guard: boolean; winners: boolean };
export type GuardRow = {
  accountId: string; campaignId: string; name: string; status: string; dailyBudget: number | null;
  days: string[]; daySpend: number[]; spend: number;
  metaRevenue: number; realRevenue: number | null; revenue: number; source: "real" | "meta"; sourceNote: string;
  roas: number | null; verdict: GuardVerdict; optedOut: boolean;
  /** Lo que pasa en esta pasada: se apaga, sobra (más de 3: aviso), se queda o no aplica. */
  outcome: "pause" | "over_limit" | "keep" | "skip";
  applied: boolean; confirmed: string | null; error: string | null;
};
export type WinnerRow = {
  accountId: string; campaignId: string; campaign: string; adsetId: string; adId: string; ad: string;
  target: number; verdict: WinnerVerdict; proposedNow: boolean;
};
export type AutoRun = {
  dryRun: boolean; at: string; pressurePct: number; settings: Settings; skipped?: string; error?: string;
  guardWindow: { since: string; until: string } | null; winWindow: { since: string; until: string } | null;
  cbo: GuardRow[]; winners: WinnerRow[]; paused: number; proposed: number;
};

const pick = (list: Act[] | undefined) => {
  for (const t of PURCHASE) { const a = list?.find((x) => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
};
const n2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (n: number) => Math.round(n).toLocaleString("es-AR");
const idOf = (v: unknown) => String(v ?? "").match(/(?:^|\|)\s*(\d{6,25})\s*$/)?.[1] ?? null;

async function allPages<T>(first: Page<T>, max = 10) {
  const items = [...(first.data ?? [])];
  let next = first.paging?.next;
  for (let i = 0; next && i < max; i++) {
    const p = await metaGet<Page<T>>(next, {}, 30_000);
    items.push(...(p.data ?? []));
    next = p.paging?.next;
  }
  return items;
}

export async function autopilotSettings(): Promise<Settings> {
  const { data } = await db.from("app_settings").select("value").eq("key", "meta_autopilot").maybeSingle();
  const v = (data?.value ?? {}) as Partial<Settings>;
  return { cbo_guard: v.cbo_guard !== false, winners: v.winners !== false };
}

/**
 * Lo que cobramos acá (USD, con bumps y OTOs, menos reembolsos) en la ventana, por campaña: por la
 * UTM con su id; sin UTM, el pedido se reparte entre las campañas vinculadas a su checkout según lo
 * que gastó cada una. También: qué campañas mandan a un checkout de acá y desde cuándo vende acá.
 */
async function realByCampaign(storeIds: string[], tz: string, since: string, until: string, spendOf: (c: string) => number) {
  const out = { byCampaign: new Map<string, number>(), linked: new Set<string>(), liveFrom: new Map<string, string>() };
  if (!storeIds.length) return out;
  const [{ data: funnels }, rates] = await Promise.all([
    db.from("funnels").select("id,meta_campaign_ids").in("store_id", storeIds),
    getRates(),
  ]);
  const linkedOf = new Map<string, string[]>();
  for (const f of (funnels ?? []) as { id: string; meta_campaign_ids: string[] | null }[]) {
    const ids = f.meta_campaign_ids ?? [];
    if (!ids.length) continue;
    linkedOf.set(f.id, ids);
    for (const c of ids) out.linked.add(c);
  }
  // Desde qué día vende acá cada checkout vinculado: su primer checkout abierto o su primer pedido.
  await Promise.all([...linkedOf.keys()].map(async (fid) => {
    const [c, o] = await Promise.all([
      db.from("checkouts").select("created_at").eq("funnel_id", fid).order("created_at", { ascending: true }).limit(1),
      db.from("orders").select("created_at").eq("funnel_id", fid).order("created_at", { ascending: true }).limit(1),
    ]);
    const first = [c.data?.[0]?.created_at, o.data?.[0]?.created_at].filter(Boolean).sort()[0] as string | undefined;
    const day = first ? dayOf(new Date(first), tz) : addDays(until, 1);
    for (const cid of linkedOf.get(fid)!) {
      const prev = out.liveFrom.get(cid);
      if (!prev || day > prev) out.liveFrom.set(cid, day);
    }
  }));
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("orders")
      .select("funnel_id,currency,amount_total,amount_refunded,utm,order_items(kind,amount,currency,refunded_amount)")
      .in("store_id", storeIds).in("status", ["paid", "refunded"]).or(HAS_STRIPE).gt("amount_total", 0)
      .gte("created_at", startOfDay(since, tz).toISOString()).lt("created_at", startOfDay(addDays(until, 1), tz).toISOString())
      .order("created_at").range(i, i + 999);
    if (error) throw new Error(`pedidos: ${error.message}`);
    for (const o of data ?? []) {
      const cur = (o.currency ?? "USD").toUpperCase();
      const usd = (n: unknown, c?: string | null) => Number(n ?? 0) / (rates[(c ?? cur).toUpperCase()] ?? 1);
      const items = (o.order_items ?? []) as { kind: string; amount: number; currency: string | null; refunded_amount: number | null }[];
      const gross = items.length ? items.reduce((a, it) => a + usd(it.amount, it.currency), 0) : usd(o.amount_total);
      const refunded = usd(o.amount_refunded) + items.filter((it) => it.kind === "upsell").reduce((a, it) => a + usd(it.refunded_amount, it.currency), 0);
      const value = Math.max(0, gross - refunded);
      const utm = (o.utm ?? {}) as Record<string, unknown>;
      const camp = idOf(utm.utm_id) ?? idOf(utm.campaign_id) ?? idOf(utm.utm_campaign);
      if (camp) {
        out.linked.add(camp);
        out.byCampaign.set(camp, (out.byCampaign.get(camp) ?? 0) + value);
        continue;
      }
      const cs = (o.funnel_id ? linkedOf.get(o.funnel_id) ?? [] : []).filter((c) => spendOf(c) > 0);
      const tot = cs.reduce((a, c) => a + spendOf(c), 0);
      for (const c of cs) out.byCampaign.set(c, (out.byCampaign.get(c) ?? 0) + value * (spendOf(c) / tot));
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function runAutopilot(opts: { dryRun?: boolean; retry?: boolean } = {}): Promise<AutoRun> {
  const t0 = Date.now();
  const dryRun = !!opts.dryRun;
  const at = new Date().toISOString();
  const now = Date.now();
  const settings = await autopilotSettings();
  const out: AutoRun = { dryRun, at, pressurePct: 0, settings, guardWindow: null, winWindow: null, cbo: [], winners: [], paused: 0, proposed: 0 };
  const saveRun = async (p: { ok?: boolean; skipped?: string; error?: string }) => {
    if (dryRun) return;
    await db.from("meta_auto_runs").insert({ at, ok: p.ok ?? true, skipped: p.skipped ?? null, error: p.error ?? null, paused: out.paused, proposed: out.proposed, ms: Date.now() - t0 });
  };
  // El reintento de las 09:47 que tampoco pudo: queda un aviso (ese día no se miraron las CBO).
  const failedToday = async (why: string) => {
    if (dryRun || !opts.retry) return;
    await logActivity({ kind: "error", title: "Piloto Meta Ads: hoy no pudo revisar las CBO", body: why, alert: { severity: "warn", ref: "autopilot-run" }, at });
  };

  if (!dryRun && !settings.cbo_guard && !settings.winners) { out.skipped = "Guardia de CBO y ganadores apagados"; await saveRun({ skipped: out.skipped }); return out; }
  const pre = await metaPressure();
  out.pressurePct = Math.round(pre.pct);
  if (pre.pct >= BUSY_PCT) {
    out.skipped = `Meta al ${out.pressurePct} % del límite${pre.regainMin ? ` (espera ${pre.regainMin} min)` : ""}`;
    await saveRun({ skipped: out.skipped }); await failedToday(out.skipped);
    return out;
  }

  const [{ data: cfgRows }, { data: winRows }, stores, rates] = await Promise.all([
    db.from("meta_auto_campaigns").select("campaign_id,cbo_guard,last_auto_pause_at"),
    db.from("meta_auto_winners").select("ad_id"),
    adAccounts(),
    getRates(),
  ]);
  const cfg = new Map(((cfgRows ?? []) as { campaign_id: string; cbo_guard: boolean; last_auto_pause_at: string | null }[]).map((c) => [c.campaign_id, c]));
  const proposedAds = new Set(((winRows ?? []) as { ad_id: string }[]).map((w) => w.ad_id));
  const storesOf = new Map(stores.map((s) => [s.id, s.storeIds]));

  try {
    for (const act of AUTOPILOT_ACCOUNTS) {
      const [info, camps, ads] = await metaBatch([
        `${act}?fields=currency,timezone_name`,
        // También las pausadas: para saber qué BID CAP hay (un ganador cuyo posteo ya está en una no se propone).
        `${act}/campaigns?${new URLSearchParams({ fields: "id,name,bid_strategy,daily_budget,lifetime_budget,effective_status", effective_status: JSON.stringify(["ACTIVE", "PAUSED"]), limit: "500" })}`,
        `${act}/ads?${new URLSearchParams({ fields: "id,name,effective_status,campaign_id,adset_id", effective_status: JSON.stringify(["ACTIVE"]), limit: "500" })}`,
      ], 30_000) as [{ currency: string; timezone_name: string }, Page<MCamp>, Page<MAd>];
      const tz = info.timezone_name || "America/Argentina/Buenos_Aires";
      const toUsd = (n: unknown) => (Number(n) || 0) / (rates[(info.currency || "USD").toUpperCase()] ?? 1);
      const campaigns = await allPages(camps, 3);
      const cbos = campaigns.filter((c) => c.effective_status === "ACTIVE" && c.bid_strategy === CBO && (Number(c.daily_budget) > 0 || Number(c.lifetime_budget) > 0));
      if (!cbos.length) continue;
      const activeAds = await allPages(ads, 5);

      // Días completos de la cuenta: los 3 de la guardia y los 7 de los ganadores (sin hoy).
      const today = dayOf(new Date(now), tz);
      const gDays = [3, 2, 1].map((k) => addDays(today, -k));
      const wDays = [7, 6, 5, 4, 3, 2, 1].map((k) => addDays(today, -k));
      out.guardWindow = { since: gDays[0], until: gDays[2] };
      out.winWindow = { since: wDays[0], until: wDays[6] };

      // Gasto, compras y valor por anuncio y día, de toda la cuenta (hace falta el gasto de las otras
      // campañas para repartir las ventas sin UTM de un checkout entre las que mandan a él).
      const rows = await allPages(await metaGet<Page<IRow>>(`${act}/insights`, {
        level: "ad", fields: "campaign_id,adset_id,ad_id,ad_name,spend,actions,action_values", time_increment: "1",
        time_range: JSON.stringify({ since: wDays[0], until: wDays[6] }), use_unified_attribution_setting: "true", limit: "500",
      }, 30_000), 10);
      const campDay = new Map<string, Map<string, { spend: number; value: number }>>();
      const adDay = new Map<string, Map<string, { spend: number; buys: number }>>();
      const adMeta = new Map<string, { name: string; campaign: string; adset: string }>();
      for (const r of rows) {
        const c = r.campaign_id ?? "", a = r.ad_id ?? "", d = r.date_start;
        const spend = toUsd(r.spend), buys = pick(r.actions), value = toUsd(pick(r.action_values));
        const cm = campDay.get(c) ?? campDay.set(c, new Map()).get(c)!;
        const cd = cm.get(d) ?? { spend: 0, value: 0 };
        cm.set(d, { spend: cd.spend + spend, value: cd.value + value });
        const am = adDay.get(a) ?? adDay.set(a, new Map()).get(a)!;
        const ad = am.get(d) ?? { spend: 0, buys: 0 };
        am.set(d, { spend: ad.spend + spend, buys: ad.buys + buys });
        if (!adMeta.has(a)) adMeta.set(a, { name: r.ad_name ?? a, campaign: c, adset: r.adset_id ?? "" });
      }
      const spend3 = (c: string) => gDays.reduce((s, d) => s + (campDay.get(c)?.get(d)?.spend ?? 0), 0);
      const real = await realByCampaign(storesOf.get(act) ?? [], tz, gDays[0], gDays[2], spend3);

      // ---- Guardia de CBO.
      for (const c of cbos) {
        const daySpend = gDays.map((d) => campDay.get(c.id)?.get(d)?.spend ?? 0);
        const metaRevenue = gDays.reduce((s, d) => s + (campDay.get(c.id)?.get(d)?.value ?? 0), 0);
        const live = real.liveFrom.get(c.id);
        const linked = real.linked.has(c.id);
        // Ventas reales solo si la oferta ya vendía acá los 3 días (si no, faltarían las de la plataforma anterior).
        const useReal = linked && (!live || live <= gDays[0]);
        const realRevenue = linked ? real.byCampaign.get(c.id) ?? 0 : null;
        const source: "real" | "meta" = useReal ? "real" : "meta";
        const sourceNote = useReal ? "Ventas reales de acá (con bumps y OTOs, menos reembolsos)"
          : linked ? `Valor de Meta: la oferta vende acá desde el ${live} (faltarían ventas de la plataforma anterior)`
            : "Valor de Meta: no manda a un checkout de acá";
        const c0 = cfg.get(c.id);
        const verdict = guardVerdict({
          now, status: c.effective_status, bidStrategy: c.bid_strategy ?? null,
          campaignBudget: Number(c.daily_budget) > 0 || Number(c.lifetime_budget) > 0,
          optedOut: c0 ? !c0.cbo_guard : false, lastAutoPauseAt: c0?.last_auto_pause_at ? Date.parse(c0.last_auto_pause_at) : null,
          daySpend, revenue: useReal ? realRevenue! : metaRevenue, source,
        });
        out.cbo.push({
          accountId: act, campaignId: c.id, name: c.name, status: c.effective_status,
          dailyBudget: Number(c.daily_budget) > 0 ? toUsd(Number(c.daily_budget) / 100) : null,
          days: gDays, daySpend, spend: verdict.spend, metaRevenue, realRevenue, revenue: useReal ? realRevenue! : metaRevenue,
          source, sourceNote, roas: verdict.roas, verdict, optedOut: c0 ? !c0.cbo_guard : false,
          outcome: verdict.action === "pause" ? "pause" : verdict.action, applied: false, confirmed: null, error: null,
        });
      }

      // ---- Ganadores: anuncios activos de las CBO activas.
      const cboOf = new Map(cbos.map((c) => [c.id, c]));
      const firstWinner = out.winners.length;
      for (const a of activeAds) {
        const c = cboOf.get(a.campaign_id);
        if (!c) continue;
        const days = wDays.map((d) => { const x = adDay.get(a.id)?.get(d); return { spend: x?.spend ?? 0, purchases: x?.buys ?? 0 }; });
        if (!days.some((d) => d.spend > 0)) continue;
        const target = targetFor(c.name);
        out.winners.push({
          accountId: act, campaignId: c.id, campaign: c.name, adsetId: a.adset_id, adId: a.id, ad: a.name, target,
          verdict: winnerVerdict({ adActive: a.effective_status === "ACTIVE", campaignActiveCbo: c.effective_status === "ACTIVE", days, target, proposed: proposedAds.has(a.id) }),
          proposedNow: false,
        });
      }
      // Los que califican: ¿su posteo ya corre en una BID CAP de la cuenta? (dos lecturas, solo si hay alguno).
      const qual = out.winners.slice(firstWinner).filter((w) => w.verdict.qualifies);
      const bidCaps = campaigns.filter((c) => c.bid_strategy === BID_CAP);
      if (qual.length && bidCaps.length) {
        type Cr = { creative?: { effective_object_story_id?: string } };
        const [mine, theirs] = await Promise.all([
          metaGet<Record<string, Cr>>("", { ids: qual.map((w) => w.adId).join(","), fields: "creative{effective_object_story_id}" }),
          metaGet<Page<Cr & { campaign_id: string }>>(`${act}/ads`, {
            fields: "campaign_id,creative{effective_object_story_id}", limit: "500",
            filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: bidCaps.map((c) => c.id) }]),
          }).then((p) => allPages(p, 3)),
        ]);
        const nameOf = new Map(campaigns.map((c) => [c.id, c.name]));
        const where = new Map<string, string>();
        for (const x of theirs) { const post = x.creative?.effective_object_story_id; if (post && !where.has(post)) where.set(post, nameOf.get(x.campaign_id) ?? x.campaign_id); }
        for (const w of qual) {
          const inBidCap = where.get(mine[w.adId]?.creative?.effective_object_story_id ?? "") ?? null;
          if (!inBidCap) continue;
          const days = wDays.map((d) => { const x = adDay.get(w.adId)?.get(d); return { spend: x?.spend ?? 0, purchases: x?.buys ?? 0 }; });
          w.verdict = winnerVerdict({ adActive: true, campaignActiveCbo: true, days, target: w.target, proposed: false, inBidCap });
        }
      }
    }
  } catch (e) {
    out.error = `No se pudo leer Meta: ${metaError(e)}`;
    await saveRun({ ok: false, error: out.error });
    if (!dryRun && opts.retry) await failedToday(out.error);
    return out;
  }
  out.cbo.sort((a, b) => Number(b.outcome === "pause") - Number(a.outcome === "pause") || (a.roas ?? 99) - (b.roas ?? 99));
  out.winners.sort((a, b) => Number(b.verdict.qualifies) - Number(a.verdict.qualifies) || b.verdict.purchases - a.verdict.purchases);

  // ---- Cuáles se apagan (a lo sumo 3, las que más pierden) y cuáles quedan para el aviso.
  const want = out.cbo.filter((r) => r.outcome === "pause");
  const { pause, over } = pickPauses(want.map((r) => ({ id: r.campaignId, spend: r.spend, revenue: r.revenue, r })));
  for (const x of over) x.r.outcome = "over_limit";

  if (dryRun) return out;

  // ---- Proponer apagar. Nunca se escribe en
  // Meta: un aviso con push por campaña y por día, y el dueño la apaga con su interruptor (tabla de
  // campañas de Inicio o Meta) si está de acuerdo.
  if (settings.cbo_guard) {
    const today = at.slice(0, 10);
    for (const { r } of [...pause, ...over]) {
      const roas = r.roas == null ? "—" : n2(r.roas);
      const ref = `cbo:${r.campaignId}:${today}`;
      const { data: seen } = await db.from("alerts").select("id").eq("kind", "meta_auto").eq("ref_id", ref).maybeSingle();
      await logActivity({
        kind: "cbo_paused", accountId: r.accountId, campaignId: r.campaignId, campaignName: r.name, at,
        title: `⚠️ Para apagar · ${r.name}`,
        body: `${r.verdict.reason} ${r.sourceNote}. No se apagó: apagala con su interruptor en Inicio si estás de acuerdo.`,
        link: "/admin/piloto?tab=cbo",
        numbers: { spend: r.spend, revenue: r.revenue, metaRevenue: r.metaRevenue, realRevenue: r.realRevenue, roas: r.roas, source: r.source, days: r.days, daySpend: r.daySpend, proposed: true },
        alert: { severity: "warn", ref },
      });
      if (!seen) await sendPush("meta_auto", { title: `⚠️ Para apagar · ${short(r.name)}`, body: `ROAS 3 días ${roas} · ${n0(r.spend)} USD gastados`, url: "/", tag: ref });
    }
  }

  // ---- Ganadores: cada uno se propone una sola vez (la tabla no deja repetir el anuncio).
  if (settings.winners) {
    for (const w of out.winners.filter((x) => x.verdict.qualifies)) {
      const v = w.verdict;
      const { data: ins, error } = await db.from("meta_auto_winners").upsert({
        ad_id: w.adId, account_id: w.accountId, campaign_id: w.campaignId, campaign_name: w.campaign, adset_id: w.adsetId, ad_name: w.ad,
        status: "proposed", proposed_at: at, expires_at: new Date(now + WIN.ttlH * H).toISOString(),
        spend: Math.round(v.spend * 100) / 100, purchases: v.purchases, cpa: v.cpa == null ? null : Math.round(v.cpa * 100) / 100, target: w.target,
        days_run: v.daysRun, window_since: out.winWindow?.since ?? null, window_until: out.winWindow?.until ?? null, updated_at: at,
      }, { onConflict: "ad_id", ignoreDuplicates: true }).select("ad_id");
      if (error) { console.error("[piloto] ganador:", error.message); continue; }
      if (!ins?.length) continue;
      w.proposedNow = true;
      out.proposed++;
      const link = `/admin/piloto/ganador/${w.adId}`;
      await logActivity({
        kind: "winner_proposed", accountId: w.accountId, campaignId: w.campaignId, campaignName: w.campaign, adId: w.adId, at, link,
        title: `🏆 Ganador · ${w.ad} (${short(w.campaign)})`,
        body: `${v.reason} Gastó ${n2(v.spend)} USD en ${v.daysRun} días. ¿Lo pasás a BID CAP? Vence en ${WIN.ttlH} h.`,
        numbers: { spend: v.spend, purchases: v.purchases, cpa: v.cpa, target: w.target, daysRun: v.daysRun },
        alert: { severity: "info", ref: `win:${w.adId}` },
      });
      await sendPush("meta_auto", { title: `🏆 Ganador · ${w.ad}`, body: `CPA ${v.cpa == null ? "—" : n2(v.cpa)} · ${n0(v.purchases)} compras · ¿a BID CAP?`, url: link, tag: `win:${w.adId}` });
    }
  }
  // Las propuestas que nadie contestó en 48 h vencen (y su aviso se cierra).
  const { data: expired } = await db.from("meta_auto_winners").update({ status: "expired", updated_at: at }).eq("status", "proposed").lt("expires_at", at).select("ad_id");
  if (expired?.length) await resolveAlerts("meta_auto", expired.map((x) => `win:${x.ad_id}`));

  // ---- Guardar la evaluación de cada CBO (el interruptor de cada una no se pisa) y la pasada.
  if (out.cbo.length) {
    await db.from("meta_auto_campaigns").upsert(out.cbo.map((r) => ({
      campaign_id: r.campaignId, account_id: r.accountId, name: r.name, status: r.applied && r.confirmed === "PAUSED" ? "PAUSED" : r.status,
      daily_budget: r.dailyBudget, last_eval_at: at, last_spend: Math.round(r.spend * 100) / 100, last_revenue: Math.round(r.revenue * 100) / 100,
      last_roas: r.roas == null ? null : Math.round(r.roas * 1000) / 1000, last_source: r.source, last_days_run: r.verdict.daysRun,
      last_verdict: r.applied ? "paused" : r.outcome, last_reason: r.error ? `${r.verdict.reason} — ${r.error}` : r.verdict.reason,
      // Siempre presente (un upsert de varias filas deja en null las columnas que faltan en alguna).
      last_auto_pause_at: r.applied && !r.error ? at : cfg.get(r.campaignId)?.last_auto_pause_at ?? null,
      updated_at: at,
    })), { onConflict: "campaign_id" });
  }
  await saveRun({ ok: true });
  return out;
}
