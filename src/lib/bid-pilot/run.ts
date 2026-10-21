import { db } from "@/lib/db";
import { BUSY_PCT, metaBatch, metaError, metaGet, metaPost, metaPressure } from "@/lib/admin/meta-conn";
import { adAccounts } from "@/lib/admin/meta-report";
import { addDays, dayOf, startOfDay } from "@/lib/admin/tz";
import { sendPush } from "@/lib/push";
import { cpaAlert, decide, type Decision, type PilotInput } from "./decide";
import { logActivity } from "./activity";
import { frontCeilings, frontLabel } from "./front";
import { CEILING_FACTOR, targetFor } from "./rules";

/**
 * Piloto de pujas: una pasada (cada hora, /api/cron/pujas).
 *
 *  1. Lee de Meta, en 2 pedidos: las campañas y los conjuntos (con su puja) y
 *     el gasto y las compras por hora de los conjuntos con límite de puja
 *     (últimos 3 días).
 *  2. Decide cada conjunto con decide() (reglas fijas, sin IA).
 *  3. Si no es simulación y está encendido (todo y la campaña): cambia el
 *     bid_amount en Meta, uno por uno; si Meta da error, frena ahí (sin
 *     reintentos) y deja UN aviso. Después vuelve a leer las pujas para
 *     confirmar que quedaron.
 *  4. Guarda una decisión por conjunto (también las de «se queda», con los
 *     números), el estado de cada conjunto y avisa por push cada cambio.
 *
 * El tope de puja de cada campaña es el precio del front de su oferta en USD
 * (front.ts), salvo que el dueño lo ponga a mano. Y si el costo por compra pasa
 * ese precio, avisa (push «CPA caro», una vez por campaña y por día; el aviso
 * se cierra solo cuando vuelve a estar por debajo).
 *
 * SOLO toca el bid_amount de los conjuntos de campañas con «límite de puja»
 * (LOWEST_COST_WITH_BID_CAP). Nunca presupuestos, estados, anuncios,
 * creativos ni públicos, ni campañas con otra estrategia.
 */

const BID_CAP = "LOWEST_COST_WITH_BID_CAP";
const LIVE = JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"]);
const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
const H = 3600_000;

type MCampaign = { id: string; name: string; bid_strategy?: string; daily_budget?: string; lifetime_budget?: string; effective_status: string };
type MAdset = { id: string; name: string; campaign_id: string; bid_amount?: number | string; bid_strategy?: string; daily_budget?: string; effective_status: string };
type Act = { action_type: string; value: string };
type HRow = { adset_id?: string; date_start: string; hourly_stats_aggregated_by_advertiser_time_zone?: string; spend?: string; actions?: Act[] };
type Page<T> = { data?: T[]; paging?: { next?: string } };
type CampaignCfg = { campaign_id: string; enabled: boolean; target_cpa: number; max_bid: number; floor_bid: number; max_manual?: boolean };
type AdsetState = {
  /** ladder: escalón de una escalera (puja fija; solo se apaga). */
  ladder?: boolean | null; ladder_pct?: number | null;
  adset_id: string; last_set_bid: number | null; last_change_at: string | null; last_change_reason: string | null; last_raise_at: string | null; last_lower_at: string | null;
  manual_until: string | null; first_seen_at: string;
};

export type PilotRow = {
  accountId: string; campaignId: string; campaign: string; campaignEnabled: boolean; adsetId: string; adset: string; status: string;
  bid: number; target: number; max: number; floor: number; dailyBudget: number | null;
  /** El precio del front de su oferta (USD) y de dónde salió; null: sin oferta vinculada. maxManual: el tope lo puso el dueño. */
  frontUsd: number | null; frontLabel: string | null; frontVia: string | null; frontFunnel: string | null; maxManual: boolean;
  spend3h: number; spend12h: number; spend24h: number; purchases24h: number; spend72h: number; purchases72h: number; cpa72h: number | null;
  spend7d: number; purchases7d: number; ladder: boolean; firstSight: boolean;
  spendSinceChange: number; purchasesSinceChange: number; hoursSinceChange: number;
  decision: Decision;
  /** En una pasada real: si se mandó a Meta, y lo que Meta confirma que quedó. */
  applied: boolean; confirmedBid: number | null; error: string | null;
};
/** «CPA caro» de una campaña en esta pasada (ver cpaAlert). */
export type CpaAlertRow = { campaignId: string; campaign: string; rule: string; body: string; frontUsd: number; spend24h: number; purchases24h: number; spend72h: number; purchases72h: number };
export type PilotRun = { runId: string | null; dryRun: boolean; at: string; pressurePct: number; skipped?: string; error?: string; rows: PilotRow[]; changes: number; alerts: CpaAlertRow[] };

/** Objetivo por nombre (el dueño): «USA» → 15; el resto (Italia, Francia, UK, Europa) → 10. Tope 1,5 ×, piso 0,3 ×. */
export function defaultsFor(name: string) {
  const target = targetFor(name);
  return { target_cpa: target, max_bid: Math.round(target * 1.5 * 100) / 100, floor_bid: Math.round(target * 0.3 * 100) / 100 };
}
/** «BID CAP - USA - ABG» → «USA - ABG»: para el push y el panel. */
export const shortName = (n: string) => n.replace(/^\s*(BID CAP)\s*[-|·]\s*/i, "").replace(/\s*[-|]\s*BID CAP\s*[-|]?\s*/i, " · ").trim() || n;

const pick = (list: Act[] | undefined) => {
  for (const t of PURCHASE) { const a = list?.find((x) => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
};
const usd2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function allPages<T>(first: Page<T>, max = 10) {
  const items = [...(first.data ?? [])];
  let next = first.paging?.next;
  for (let i = 0; next && i < max; i++) {
    const p = await metaGet<Page<T>>(next);
    items.push(...(p.data ?? []));
    next = p.paging?.next;
  }
  return items;
}

/** El interruptor general y el porcentaje del precio del front que es el tope de puja (70 de fábrica). */
export async function pilotSettings() {
  const { data } = await db.from("app_settings").select("value").eq("key", "bid_pilot").maybeSingle();
  const v = (data?.value ?? {}) as { enabled?: boolean; ceiling_pct?: number };
  const pct = Number(v.ceiling_pct);
  return { enabled: v.enabled !== false, ceilingPct: pct >= 30 && pct <= 100 ? pct : Math.round(CEILING_FACTOR * 100) };
}
/**
 * Los ids de campania vinculados a algun embudo de esta app.
 *
 * Es la unica definicion de «campania propia» que el piloto puede usar sin
 * equivocarse: una cuenta publicitaria puede tener campanias de otra marca que
 * esta app ni ve. Vacio = el piloto no toca nada, que es el default seguro.
 */
export async function campaignIdsLinked(): Promise<Set<string>> {
  const { data } = await db.from("funnels").select("meta_campaign_ids").not("meta_campaign_ids", "is", null);
  const out = new Set<string>();
  for (const f of data ?? []) for (const id of (f.meta_campaign_ids as string[] | null) ?? []) if (id) out.add(id);
  return out;
}

export async function pilotEnabled() {
  return (await pilotSettings()).enabled;
}

export async function runPilot(opts: { dryRun?: boolean } = {}): Promise<PilotRun> {
  const t0 = Date.now();
  const dryRun = !!opts.dryRun;
  const at = new Date().toISOString();
  const out: PilotRun = { runId: null, dryRun, at, pressurePct: 0, rows: [], changes: 0, alerts: [] };
  const { enabled, ceilingPct } = await pilotSettings();
  const factor = ceilingPct / 100;
  const saveRun = async (patch: { ok?: boolean; skipped?: string; error?: string; changes?: number }) => {
    if (dryRun) return null;
    const { data } = await db.from("bid_pilot_runs").insert({ at, dry_run: false, ok: patch.ok ?? true, skipped: patch.skipped ?? null, error: patch.error ?? null, changes: patch.changes ?? 0, ms: Date.now() - t0 }).select("id").single();
    return (data?.id as string | undefined) ?? null;
  };

  if (!dryRun && !enabled) { out.skipped = "Piloto apagado"; out.runId = await saveRun({ skipped: out.skipped }); return out; }
  const pre = await metaPressure();
  out.pressurePct = Math.round(pre.pct);
  // Arriba del 75 % del límite de Meta, el piloto espera a la próxima hora (no tocar la puja no rompe nada).
  if (pre.pct >= BUSY_PCT) { out.skipped = `Meta al ${out.pressurePct} % del límite${pre.regainMin ? ` (espera ${pre.regainMin} min)` : ""}`; out.runId = await saveRun({ skipped: out.skipped }); return out; }

  const accounts = await adAccounts();
  const [{ data: cfgRows }, { data: stRows }] = await Promise.all([
    db.from("bid_pilot_campaigns").select("campaign_id,enabled,target_cpa,max_bid,floor_bid,max_manual"),
    db.from("bid_pilot_adsets").select("adset_id,last_set_bid,last_change_at,last_change_reason,last_raise_at,last_lower_at,manual_until,first_seen_at,ladder,ladder_pct"),
  ]);
  const cfgOf = new Map(((cfgRows ?? []) as CampaignCfg[]).map((c) => [c.campaign_id, { ...c, target_cpa: Number(c.target_cpa), max_bid: Number(c.max_bid), floor_bid: Number(c.floor_bid) }]));
  const stOf = new Map(((stRows ?? []) as AdsetState[]).map((s) => [s.adset_id, s]));
  const now = Date.now();
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
  const newCfg: Record<string, unknown>[] = [];

  try {
    for (const { id: act } of accounts) {
      const [info, camps, sets] = await metaBatch([
        `${act}?fields=currency,timezone_name`,
        `${act}/campaigns?${new URLSearchParams({ fields: "id,name,bid_strategy,daily_budget,lifetime_budget,effective_status", effective_status: LIVE, limit: "500" })}`,
        `${act}/adsets?${new URLSearchParams({ fields: "id,name,campaign_id,bid_amount,bid_strategy,daily_budget,effective_status", effective_status: LIVE, limit: "500" })}`,
      ], 30_000) as [{ currency: string; timezone_name: string }, Page<MCampaign>, Page<MAdset>];
      const tz = info.timezone_name || "America/Argentina/Buenos_Aires";
      // Los objetivos son en USD (el dueño): una cuenta en otra moneda no se toca.
      if ((info.currency ?? "").toUpperCase() !== "USD") continue;
      // Pujas en centavos de la moneda de la cuenta (USD).
      const minor = 100;
      const campaigns = await allPages(camps, 5);
      const adsets = await allPages(sets, 5);
      const campOf = new Map(campaigns.map((c) => [c.id, c]));
      // SOLO las campanias que esta app sabe que son suyas
      // (funnels.meta_campaign_ids). El filtro de antes miraba unicamente la
      // estrategia de puja, asi que en una cuenta publicitaria COMPARTIDA entre
      // dos marcas el piloto se auto-inscribia las campanias de la otra y les
      // movia la puja con datos que no eran de ellas. La cuenta de Finance
      // Study Lab es la misma que la de Physics Study Lab, que no vive en esta
      // app: sus ventas no se ven desde aca y sus campanias no se tocan.
      const propias = await campaignIdsLinked();
      const mine = adsets.filter((s) => {
        if (!propias.has(s.campaign_id)) return false;
        const c = campOf.get(s.campaign_id);
        return (c?.bid_strategy === BID_CAP || s.bid_strategy === BID_CAP) && s.bid_amount != null;
      });
      if (!mine.length) continue;
      // El tope de cada campaña: el 70 % del precio del front de su oferta (de la base, sin preguntarle a Meta).
      const ceil = await frontCeilings([...new Set(mine.map((s) => s.campaign_id))], factor);

      // Gasto y compras por hora (3 días) de los que están entregando: un pedido (más páginas si hiciera falta).
      const activeIds = mine.filter((s) => s.effective_status === "ACTIVE" && campOf.get(s.campaign_id)?.effective_status === "ACTIVE").map((s) => s.id);
      const today = dayOf(new Date(now), tz);
      const hourly = activeIds.length ? await allPages(await metaGet<Page<HRow>>(`${act}/insights`, {
        // time_increment=1: una fila por día y hora (sin eso, Meta suma cada hora del día de todo el rango).
        level: "adset", fields: "adset_id,spend,actions", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", time_increment: "1",
        time_range: JSON.stringify({ since: addDays(today, -2), until: today }),
        filtering: JSON.stringify([{ field: "adset.id", operator: "IN", value: activeIds }]),
        use_unified_attribution_setting: "true", limit: "500",
      }, 30_000), 8) : [];
      // Y 7 días por conjunto, sin el detalle por hora (para «subir por volumen»): otro pedido, liviano.
      const week = activeIds.length ? await allPages(await metaGet<Page<HRow>>(`${act}/insights`, {
        level: "adset", fields: "adset_id,spend,actions", time_range: JSON.stringify({ since: addDays(today, -6), until: today }),
        filtering: JSON.stringify([{ field: "adset.id", operator: "IN", value: activeIds }]),
        use_unified_attribution_setting: "true", limit: "500",
      }, 30_000), 3) : [];
      const week7 = new Map(week.filter((r) => r.adset_id).map((r) => [r.adset_id!, { spend: Number(r.spend) || 0, buys: pick(r.actions) }]));
      const byAdset = new Map<string, { start: number; spend: number; buys: number }[]>();
      for (const r of hourly) {
        const hh = Number((r.hourly_stats_aggregated_by_advertiser_time_zone ?? "").slice(0, 2));
        if (!r.adset_id || !Number.isFinite(hh)) continue;
        const start = startOfDay(r.date_start, tz).getTime() + hh * H;
        (byAdset.get(r.adset_id) ?? byAdset.set(r.adset_id, []).get(r.adset_id)!).push({ start, spend: Number(r.spend) || 0, buys: pick(r.actions) });
      }

      for (const s of mine) {
        const c = campOf.get(s.campaign_id)!;
        let cfg = cfgOf.get(c.id);
        const front = ceil.get(c.id) ?? null;
        if (!cfg) {
          const d = defaultsFor(c.name);
          cfg = { campaign_id: c.id, enabled: true, ...d, max_bid: front?.max ?? d.max_bid, max_manual: false };
          cfgOf.set(c.id, cfg);
          newCfg.push({ campaign_id: c.id, account_id: act, name: c.name, enabled: true, ...d, max_bid: front?.max ?? d.max_bid });
        }
        // Tope: el que puso el dueño; si no, el 70 % del precio del front; sin oferta vinculada, 1,5 × objetivo.
        const max = cfg.max_manual ? cfg.max_bid : front ? front.max : Math.round(cfg.target_cpa * 1.5 * 100) / 100;
        const st = stOf.get(s.id);
        const hours = byAdset.get(s.id) ?? [];
        const sum = (sinceMs: number) => hours.filter((h) => h.start >= sinceMs).reduce((a, h) => ({ spend: a.spend + h.spend, buys: a.buys + h.buys }), { spend: 0, buys: 0 });
        const w3 = sum(now - 3 * H), w12 = sum(now - 12 * H), w24 = sum(now - 24 * H), w72 = sum(now - 72 * H);
        const changeAt = ms(st?.last_change_at) ?? ms(st?.first_seen_at) ?? now;
        const w7 = week7.get(s.id) ?? { spend: 0, buys: 0 };
        const sinceChange = sum(changeAt);
        const budgetMinor = Number(c.daily_budget ?? s.daily_budget ?? 0);
        const input: PilotInput = {
          now, bid: Number(s.bid_amount) / minor, target: cfg.target_cpa, max, floor: cfg.floor_bid, frontUsd: front?.usd ?? null,
          dailyBudget: budgetMinor ? budgetMinor / minor : null,
          active: s.effective_status === "ACTIVE" && c.effective_status === "ACTIVE",
          spend3h: w3.spend, spend12h: w12.spend, purchases24h: w24.buys, spend72h: w72.spend, purchases72h: w72.buys,
          spend7d: w7.spend, purchases7d: w7.buys, firstSight: !st, ladder: !!st?.ladder, maxIsFirm: !!front || !!cfg.max_manual,
          spendSinceChange: sinceChange.spend, purchasesSinceChange: sinceChange.buys, hoursSinceChange: (now - changeAt) / H,
          lastRaiseAt: ms(st?.last_raise_at), lastLowerAt: ms(st?.last_lower_at),
          lastSetBid: st?.last_set_bid == null ? null : Number(st.last_set_bid), manualUntil: ms(st?.manual_until),
        };
        out.rows.push({
          accountId: act, campaignId: c.id, campaign: c.name, campaignEnabled: cfg.enabled, adsetId: s.id, adset: s.name,
          status: input.active ? "ACTIVE" : s.effective_status === "ACTIVE" ? c.effective_status : s.effective_status,
          bid: input.bid, target: cfg.target_cpa, max, floor: cfg.floor_bid, dailyBudget: input.dailyBudget,
          frontUsd: front?.usd ?? null, frontLabel: front ? frontLabel(front) : null, frontVia: front?.via ?? null, frontFunnel: front?.funnel ?? null, maxManual: !!cfg.max_manual,
          spend3h: w3.spend, spend12h: w12.spend, spend24h: w24.spend, purchases24h: w24.buys, spend72h: w72.spend, purchases72h: w72.buys,
          cpa72h: w72.buys ? w72.spend / w72.buys : null,
          spend7d: w7.spend, purchases7d: w7.buys, ladder: !!st?.ladder, firstSight: !st,
          spendSinceChange: sinceChange.spend, purchasesSinceChange: sinceChange.buys, hoursSinceChange: input.hoursSinceChange,
          decision: decide(input), applied: false, confirmedBid: null, error: null,
        });
      }
    }
  } catch (e) {
    out.error = `No se pudo leer Meta: ${metaError(e)}`;
    if (!dryRun) {
      out.runId = await saveRun({ ok: false, error: out.error });
      // Sin push: a los 37 reintenta (y una puja que no se tocó no rompe nada). Queda en Avisos.
      await logActivity({ kind: "error", title: "Piloto de pujas: no pudo leer Meta", body: out.error, link: "/admin/piloto", alert: { severity: "warn", ref: "bid-pilot" }, at });
    }
    return out;
  }

  // ---- «CPA caro» por campaña (las que entregan y tienen precio del front): 24 h y 3 días, todos sus conjuntos juntos.
  const byCamp = new Map<string, PilotRow[]>();
  for (const r of out.rows) if (r.status === "ACTIVE" && r.frontUsd != null) byCamp.set(r.campaignId, [...(byCamp.get(r.campaignId) ?? []), r]);
  for (const [cid, rs] of byCamp) {
    const t = rs.reduce((a, r) => ({ s24: a.s24 + r.spend24h, b24: a.b24 + r.purchases24h, s72: a.s72 + r.spend72h, b72: a.b72 + r.purchases72h }), { s24: 0, b24: 0, s72: 0, b72: 0 });
    const hit = cpaAlert({ front: rs[0].frontUsd, spend24h: t.s24, purchases24h: t.b24, spend72h: t.s72, purchases72h: t.b72 });
    if (hit) out.alerts.push({ campaignId: cid, campaign: rs[0].campaign, ...hit, frontUsd: rs[0].frontUsd!, spend24h: t.s24, purchases24h: t.b24, spend72h: t.s72, purchases72h: t.b72 });
  }

  // ---- Aplicar (solo pasada real, encendido y campaña encendida). Uno por uno; al primer error, se frena.
  // Apagar un escalón NO se aplica: queda como propuesta abajo.
  const toApply = out.rows.filter((r) => r.decision.newBid != null && r.decision.action !== "pause" && r.campaignEnabled);
  let stopped: string | null = null;
  if (!dryRun && enabled) {
    for (const r of toApply) {
      if (stopped) { r.error = `No se intentó: Meta dio error antes (${stopped}).`; continue; }
      try {
        // Un escalón de la escalera no cambia de puja: se apaga.
        await metaPost(r.adsetId, r.decision.action === "pause" ? { status: "PAUSED" } : { bid_amount: String(Math.round(r.decision.newBid! * 100)) });
        r.applied = true;
      } catch (e) {
        stopped = metaError(e);
        r.error = stopped;
      }
    }
    // Confirmar: volver a leer las pujas de lo que se cambió (un pedido).
    const done = toApply.filter((r) => r.applied);
    if (done.length) {
      try {
        const back = await metaBatch(done.map((r) => `${r.adsetId}?fields=bid_amount,status`), 20_000) as { id: string; bid_amount?: number | string; status?: string }[];
        back.forEach((b, i) => {
          done[i].confirmedBid = b?.bid_amount != null ? Number(b.bid_amount) / 100 : null;
          if (done[i].decision.action === "pause" && b?.status !== "PAUSED") done[i].error = `Meta aceptó apagarlo pero sigue ${b?.status ?? "sin estado"}.`;
        });
      } catch (e) {
        for (const r of done) r.error = `Cambiada, pero no se pudo confirmar: ${metaError(e)}`;
      }
    }
    if (stopped) {
      await logActivity({ kind: "error", title: "Piloto de pujas: Meta no aceptó un cambio de puja", body: stopped, link: "/admin/piloto", alert: { severity: "error", ref: "bid-pilot" }, at });
    }
  }
  out.changes = out.rows.filter((r) => r.applied).length;
  if (dryRun) return out;

  // ---- Guardar: la pasada, una decisión por conjunto y el estado de cada uno.
  out.runId = await saveRun({ ok: !stopped, error: stopped ?? undefined, changes: out.changes });
  if (newCfg.length) await db.from("bid_pilot_campaigns").upsert(newCfg, { onConflict: "campaign_id", ignoreDuplicates: true });
  // (el tope y el precio del front de las nuevas se completan abajo, con las demás)
  // Nombre, estado y presupuesto al día (lo editable —objetivo, tope, encendido— no se pisa).
  const seenCamps = [...new Map(out.rows.map((r) => [r.campaignId, r])).values()];
  // También el tope (el precio del front, en cada pasada: cambia con el precio o el tipo de cambio) si no lo puso el dueño.
  const alertOf = new Map(out.alerts.map((a) => [a.campaignId, a]));
  await Promise.all(seenCamps.map((r) => db.from("bid_pilot_campaigns").update({
    name: r.campaign, status: r.status === "ACTIVE" ? "ACTIVE" : r.status, daily_budget: r.dailyBudget,
    ...(r.maxManual ? {} : { max_bid: r.max }),
    front_usd: r.frontUsd == null ? null : Math.round(r.frontUsd * 100) / 100, front_label: r.frontLabel, front_funnel: r.frontFunnel, front_via: r.frontVia,
    cpa_alert: alertOf.get(r.campaignId)?.body ?? null, cpa_alert_at: alertOf.has(r.campaignId) ? at : null,
    updated_at: at,
  }).eq("campaign_id", r.campaignId)));

  // «CPA caro»: aviso y push una vez por campaña y por día (hora de Argentina); se cierra solo al volver por debajo.
  const day = dayOf(new Date(at), "America/Argentina/Buenos_Aires");
  for (const a of out.alerts) {
    const ref = `cpa:${a.campaignId}:${day}`;
    const { data: seen } = await db.from("alerts").select("id").eq("kind", "meta_auto").eq("ref_id", ref).maybeSingle();
    if (seen) continue;
    await logActivity({
      kind: "cpa_alert", campaignId: a.campaignId, campaignName: a.campaign, at, link: "/admin/piloto",
      title: `⚠️ CPA caro · ${a.campaign}`,
      body: `${a.body}. 24 h: ${usd2(a.spend24h)} USD y ${a.purchases24h} compras · 3 días: ${usd2(a.spend72h)} USD y ${a.purchases72h} compras. Precio del front ${usd2(a.frontUsd)} USD.`,
      numbers: { ...a },
      alert: { severity: "warn", ref },
    });
    await sendPush("meta_auto", { title: `⚠️ CPA caro · ${shortName(a.campaign)}`, body: a.body, url: "/admin/piloto", tag: ref });
  }
  {
    const { data: open } = await db.from("alerts").select("id,ref_id").eq("kind", "meta_auto").like("ref_id", "cpa:%").is("resolved_at", null);
    const back = (open ?? []).filter((x) => !alertOf.has(String(x.ref_id).split(":")[1]) && seenCamps.some((r) => r.campaignId === String(x.ref_id).split(":")[1]));
    if (back.length) await db.from("alerts").update({ resolved_at: at }).in("id", back.map((x) => x.id));
  }

  // Una decisión por conjunto: los que entregan (también los «se queda», con los números) y cualquier
  // cambio o error. Los pausados no llenan el registro cada hora (su estado queda en bid_pilot_adsets).
  const logged = out.rows.filter((r) => r.status === "ACTIVE" || r.decision.action !== "hold" || r.error);
  if (logged.length) await db.from("bid_pilot_log").insert(logged.map((r) => ({
    run_id: out.runId, at, campaign_id: r.campaignId, adset_id: r.adsetId, campaign_name: r.campaign,
    action: r.error && (r.decision.newBid != null || r.decision.action === "pause") && !r.applied ? "error" : r.decision.action,
    rule: r.campaignEnabled ? r.decision.rule : `${r.decision.rule} (campaña apagada en el piloto)`,
    bid_before: r.bid, bid_after: r.decision.newBid, applied: r.applied, confirmed_bid: r.confirmedBid,
    reason: r.error ? `${r.decision.reason} — ${r.error}` : r.decision.reason,
    numbers: {
      spend3h: r.spend3h, spend12h: r.spend12h, spend24h: r.spend24h, frontUsd: r.frontUsd, maxManual: r.maxManual, purchases24h: r.purchases24h, spend72h: r.spend72h, purchases72h: r.purchases72h,
      cpa72h: r.cpa72h, spendSinceChange: r.spendSinceChange, purchasesSinceChange: r.purchasesSinceChange,
      spend7d: r.spend7d, purchases7d: r.purchases7d, ladder: r.ladder, firstSight: r.firstSight,
      hoursSinceChange: Math.round(r.hoursSinceChange * 10) / 10, target: r.target, max: r.max, floor: r.floor, dailyBudget: r.dailyBudget,
    },
  })));

  await db.from("bid_pilot_adsets").upsert(out.rows.map((r) => {
    const st = stOf.get(r.adsetId);
    const d = r.decision;
    const changed = r.applied;
    const paused = changed && d.action === "pause";
    const nowBid = changed && !paused ? r.confirmedBid ?? d.newBid! : r.bid;
    return {
      adset_id: r.adsetId, campaign_id: r.campaignId, account_id: r.accountId, name: r.adset, status: paused ? "PAUSED" : r.status, bid: nowBid,
      // La que puso el piloto: la nueva si cambió; al vencer el «a mano», la de Meta pasa a ser la suya.
      last_set_bid: changed && !paused ? nowBid : d.adopt ? r.bid : st?.last_set_bid ?? null,
      last_change_at: changed ? at : st?.last_change_at ?? null,
      last_change_reason: changed ? d.reason : st?.last_change_reason ?? null,
      last_raise_at: changed && d.action === "raise" ? at : st?.last_raise_at ?? null,
      last_lower_at: changed && d.action === "lower" ? at : st?.last_lower_at ?? null,
      manual_until: d.manualUntil ? new Date(d.manualUntil).toISOString() : d.adopt ? null : st?.manual_until ?? null,
      first_seen_at: st?.first_seen_at ?? at,
      spend_12h: r.spend12h, spend_24h: r.spend24h, purchases_24h: r.purchases24h, spend_72h: r.spend72h, purchases_72h: r.purchases72h,
      state: d.state, reason: r.campaignEnabled ? d.reason : `Apagada en el piloto. ${d.reason}`, updated_at: at,
    };
  }), { onConflict: "adset_id" });

  // ---- Cada cambio que quedó, al historial del Piloto Meta Ads y a Avisos (un aviso por conjunto, con el último).
  // Escalones para apagar: aviso y push una vez por día; el dueño decide con el interruptor.
  const rungsOff = dryRun || !enabled ? [] : out.rows.filter((r) => r.decision.action === "pause" && r.campaignEnabled);
  for (const r of rungsOff) {
    const ref = `ladder:${r.adsetId}:${at.slice(0, 10)}`;
    const { data: seen } = await db.from("alerts").select("id").eq("kind", "meta_auto").eq("ref_id", ref).maybeSingle();
    if (seen) continue;
    await logActivity({
      kind: "ladder_paused", accountId: r.accountId, campaignId: r.campaignId, campaignName: r.campaign, at, link: "/admin/piloto",
      title: `⚠️ Para apagar · escalón ${r.campaign} · ${r.adset}`, body: `${r.decision.reason} No se apagó: apagalo con su interruptor si estás de acuerdo.`,
      numbers: { adset: r.adsetId, bid: r.bid, cpa72h: r.cpa72h, frontUsd: r.frontUsd, purchases72h: r.purchases72h, proposed: true },
      alert: { severity: "warn", ref },
    });
    await sendPush("meta_auto", { title: `⚠️ Para apagar · escalón ${shortName(r.campaign)}`, body: `CPA 3 días ${usd2(r.cpa72h ?? 0)} > precio ${usd2(r.frontUsd ?? 0)}`, url: "/", tag: ref });
  }
  const ok = out.rows.filter((r) => r.applied && r.decision.action !== "pause");
  await Promise.all(ok.map((r) => {
    const nb = r.confirmedBid ?? r.decision.newBid!;
    return logActivity({
      kind: "bid_change", accountId: r.accountId, campaignId: r.campaignId, campaignName: r.campaign, at, link: "/admin/piloto",
      title: `${r.decision.action === "raise" ? "↑" : "↓"} Puja · ${r.campaign}: ${usd2(r.bid)} → ${usd2(nb)} USD`,
      body: r.decision.reason, numbers: { adset: r.adsetId, before: r.bid, after: nb, rule: r.decision.rule, cpa72h: r.cpa72h, target: r.target },
      alert: { severity: "info", ref: `bid:${r.adsetId}` },
    });
  }));

  // ---- Avisar por push cada cambio que quedó (más de 3 en una pasada: uno solo, agrupado).
  if (ok.length > 3) {
    const up = ok.filter((r) => r.decision.action === "raise").length;
    await sendPush("bid", { title: `Pujas · ${ok.length} cambios`, body: `↑ ${up} · ↓ ${ok.length - up} · tocá para ver el detalle`, url: "/admin/piloto", tag: `bid:${at}` });
  } else {
    for (const r of ok) {
      const nb = r.confirmedBid ?? r.decision.newBid!;
      const why = r.decision.rule === "starving" ? "3 h sin gastar" : r.decision.rule === "start" ? "arranca en el tope"
        : r.decision.rule === "over_max" ? "baja al tope"
        : r.decision.rule === "over_front" && r.cpa72h != null && r.frontUsd != null ? `CPA ${usd2(r.cpa72h)} > front ${usd2(r.frontUsd)}`
        : r.cpa72h != null && r.decision.rule === "expensive" ? `CPA 3 días ${usd2(r.cpa72h)} (obj. ${usd2(r.target)})`
          : r.decision.rule === "cheap" && r.purchases7d ? `CPA 7 días ${usd2(r.spend7d / r.purchases7d)} (obj. ${usd2(r.target)})`
          : r.decision.rule === "no_sales" ? `${usd2(r.spendSinceChange)} sin compras` : r.decision.reason;
      await sendPush("bid", {
        title: `${r.decision.action === "raise" ? "↑" : "↓"} Puja · ${shortName(r.campaign)}`,
        body: `${usd2(r.bid)} → ${usd2(nb)} USD · ${why}`,
        url: "/admin/piloto", tag: `bid:${r.adsetId}`,
      });
    }
  }
  return out;
}
