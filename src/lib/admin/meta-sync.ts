import { db } from "@/lib/db";
import { BUSY_PCT, metaBatch, metaError, metaGet, MetaError, metaPressure, readConn } from "./meta-conn";
import { adAccounts } from "./meta-report";
import { PANEL_TZ, shift, todayIn } from "./range";

/**
 * La sincronización con Meta (la corre /api/cron/meta cada 15 minutos; el
 * panel nunca le pregunta a Meta al abrir una pantalla). Por cuenta
 * publicitaria, en UN pedido batch: la cuenta, las campañas, los conjuntos y
 * las métricas por anuncio y por día de los últimos 3 días (lo que Meta
 * todavía corrige). Los anuncios con su miniatura y destino, cada hora. La
 * primera vez carga hacia atrás hasta 62 días, de a tandas, con el tiempo que
 * sobre (62 = 30 días del filtro + los 30 anteriores para las flechas).
 *
 * Si Meta limita las consultas (códigos 4/17/32/613/80000–80014, o avisa que
 * hay que esperar) no se reintenta hasta que pase la espera: se siguen
 * mostrando las filas guardadas. Solo lectura hacia Meta.
 *
 * Cuidar el límite de la cuenta (06/10: Meta cortó con «Ad Account Has Too
 * Many API Calls», código 17/2446079; la cuenta está en el nivel de acceso
 * «development», el más bajo): cada pasada mira el uso que informa Meta y,
 * arriba del 75 %, hace solo lo imprescindible (cuenta, campañas, conjuntos y
 * las métricas de los últimos días). Lo pesado va espaciado: los anuncios con
 * su creativo cada 6 h, el desglose por red social cada hora, y la carga hacia
 * atrás solo mientras falte y con margen.
 */

const RECENT_DAYS = 3;
const BACKFILL_DAYS = 62;
const LOCK_MS = 3 * 60_000;
const ADS_EVERY = 6 * 60 * 60_000;
/** El desglose por red social (Facebook, Instagram…): a lo sumo una vez por hora. */
const PLATFORM_EVERY = 60 * 60_000;

const LIVE = JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "IN_PROCESS", "WITH_ISSUES", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"]);
const AD_F = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions,action_values,video_thruplay_watched_actions,date_start";
const CREATIVE = "creative{thumbnail_url,video_id,link_url,object_story_spec{link_data{link,call_to_action{value{link}},child_attachments{link}},video_data{video_id,call_to_action{value{link}}}},asset_feed_spec{link_urls{website_url},videos{video_id}}}";
// Como las columnas del Administrador de anuncios (con solo el pixel, las variantes valen lo mismo).
const PURCHASE = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const CHECKOUT = ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];
const LANDING = ["landing_page_view", "omni_landing_page_view"];
const RATE = [4, 17, 32, 613];

type Act = { action_type: string; value: string };
type IRow = { ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; date_start: string;
  spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; actions?: Act[]; action_values?: Act[]; video_thruplay_watched_actions?: { value: string }[] };
type MObj = { id: string; name: string; status?: string; effective_status: string; campaign_id?: string; adset_id?: string;
  daily_budget?: string; lifetime_budget?: string; bid_amount?: string | number; bid_strategy?: string; start_time?: string; created_time?: string; creative?: Record<string, unknown> };
type Page<T> = { data?: T[]; paging?: { next?: string } };
type SyncRow = { account_id: string; name: string | null; currency: string | null; timezone: string | null; last_ok_at: string | null;
  retry_at: string | null; fails: number; running_until: string | null; backfilled_from: string | null; ads_at: string | null };

const q = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;
const pick = (list: Act[] | undefined, types = PURCHASE) => {
  for (const t of types) { const a = list?.find((x) => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
};
const isRate = (e: unknown) => {
  const c = Number((e as MetaError)?.code);
  return RATE.includes(c) || (c >= 80000 && c <= 80014) || /request limit|too many calls|rate limit/i.test((e as Error)?.message ?? "");
};
const tooBig = (e: unknown) => /reduce the amount of data/i.test((e as Error)?.message ?? "");

/** Las páginas que no entraron en la primera respuesta; complete = llegó hasta la última. */
async function rest<T>(first: Page<T>, max = 20): Promise<{ items: T[]; complete: boolean }> {
  const items = [...(first.data ?? [])];
  let next = first.paging?.next;
  for (let i = 0; next && i < max; i++) {
    const p = await metaGet<Page<T>>(next);
    items.push(...(p.data ?? []));
    next = p.paging?.next;
  }
  return { items, complete: !next };
}

function destinations(c: Record<string, unknown> | undefined): string[] {
  if (!c) return [];
  const o = c.object_story_spec as { link_data?: { link?: string; call_to_action?: { value?: { link?: string } }; child_attachments?: { link?: string }[] }; video_data?: { call_to_action?: { value?: { link?: string } } } } | undefined;
  const a = c.asset_feed_spec as { link_urls?: { website_url?: string }[] } | undefined;
  return [...new Set([c.link_url as string | undefined, o?.link_data?.link, o?.link_data?.call_to_action?.value?.link, ...(o?.link_data?.child_attachments ?? []).map((x) => x.link),
    o?.video_data?.call_to_action?.value?.link, ...(a?.link_urls ?? []).map((x) => x.website_url)]
    .filter((x): x is string => !!x && /^https?:\/\//.test(x)))];
}

/** Meta da los presupuestos en centavos de la moneda de la cuenta. */
const budget = (v: string | undefined) => (v ? Number(v) / 100 : null);

/** Cuánto pide Meta esperar (min), según lo último que informó en los encabezados. */
async function regainMinutes() {
  const c = await readConn().catch(() => ({} as Awaited<ReturnType<typeof readConn>>));
  const at = c.usage_at ? Date.parse(c.usage_at) : 0;
  const wait = Math.max(0, ...(c.usage?.business ?? []).map((b) => Number(b.estimated_time_to_regain_access ?? 0)));
  const left = wait - (Date.now() - at) / 60_000;
  return left > 0 ? Math.ceil(left) : 0;
}

// ------------------------------------------------------------------ filas

type Obj = { status: string | null; effective: string | null; budget: number | null };

/** Filas por anuncio y día, más las sumas por conjunto y por campaña. */
function toRows(ins: IRow[], objs: { campaigns: Map<string, Obj>; adsets: Map<string, Obj>; ads: Map<string, Obj> }) {
  const out = new Map<string, Record<string, unknown>>();
  const add = (key: string, base: Record<string, unknown>, r: IRow) => {
    const t = out.get(key) ?? { ...base, spend: 0, impressions: 0, clicks: 0, inline_link_clicks: 0, purchases: 0, purchase_value: 0, video_3s_views: 0, thruplays: 0, initiate_checkout: 0, landing_page_views: 0 };
    t.spend = (t.spend as number) + (Number(r.spend) || 0);
    t.impressions = (t.impressions as number) + (Number(r.impressions) || 0);
    t.clicks = (t.clicks as number) + (Number(r.clicks) || 0);
    t.inline_link_clicks = (t.inline_link_clicks as number) + (Number(r.inline_link_clicks) || 0);
    t.purchases = (t.purchases as number) + pick(r.actions);
    t.purchase_value = (t.purchase_value as number) + pick(r.action_values);
    t.video_3s_views = (t.video_3s_views as number) + (Number(r.actions?.find((x) => x.action_type === "video_view")?.value) || 0);
    t.thruplays = (t.thruplays as number) + (Number(r.video_thruplay_watched_actions?.[0]?.value) || 0);
    t.initiate_checkout = (t.initiate_checkout as number) + pick(r.actions, CHECKOUT);
    t.landing_page_views = (t.landing_page_views as number) + pick(r.actions, LANDING);
    out.set(key, t);
  };
  for (const r of ins) {
    const d = r.date_start, c = r.campaign_id ?? "", s = r.adset_id ?? "", a = r.ad_id ?? "";
    const oc = objs.campaigns.get(c), os = objs.adsets.get(s), oa = objs.ads.get(a);
    const names = { campaign_id: c, campaign_name: r.campaign_name ?? null };
    add(`campaign|${d}|${c}`, { date: d, level: "campaign", ...names, status: oc?.status ?? null, effective_status: oc?.effective ?? null, daily_budget: oc?.budget ?? null }, r);
    add(`adset|${d}|${c}|${s}`, { date: d, level: "adset", ...names, adset_id: s, adset_name: r.adset_name ?? null,
      status: os?.status ?? null, effective_status: os?.effective ?? null, daily_budget: os?.budget ?? null }, r);
    add(`ad|${d}|${c}|${s}|${a}`, { date: d, level: "ad", ...names, adset_id: s, adset_name: r.adset_name ?? null, ad_id: a, ad_name: r.ad_name ?? null,
      status: oa?.status ?? null, effective_status: oa?.effective ?? null, daily_budget: null }, r);
  }
  return [...out.values()];
}

async function writeRows(act: string, since: string, until: string, rows: Record<string, unknown>[], started: string) {
  const { data, error } = await db.rpc("meta_sync_rows", { p_account: act, p_since: since, p_until: until, p_rows: rows, p_started: started });
  if (error) throw new Error(`base: ${error.message}`);
  return Number(data ?? 0);
}

async function insights(act: string, since: string, until: string) {
  const first = await metaGet<Page<IRow>>(`${act}/insights`, {
    level: "ad", fields: AD_F, time_increment: "1", use_unified_attribution_setting: "true", time_range: JSON.stringify({ since, until }), limit: "500",
  }, 30_000);
  return (await rest(first)).items;
}

// ------------------------------------------------------- por red social

type PRow = { campaign_id?: string; publisher_platform?: string; date_start: string; spend?: string; impressions?: string; inline_link_clicks?: string; actions?: Act[]; action_values?: Act[] };
const PLATFORM_DAYS = 62;

/** Por campaña, día y red (Facebook, Instagram, Messenger, Audience Network) → meta_platform_daily. */
async function platformInsights(act: string, since: string, until: string) {
  const first = await metaGet<Page<PRow>>(`${act}/insights`, {
    level: "campaign", breakdowns: "publisher_platform", time_increment: "1", use_unified_attribution_setting: "true",
    fields: "campaign_id,spend,impressions,inline_link_clicks,actions,action_values,date_start", time_range: JSON.stringify({ since, until }), limit: "500",
  }, 30_000);
  const { items } = await rest(first, 30);
  const now = new Date().toISOString();
  const rows = items.filter((r) => r.campaign_id && r.publisher_platform).map((r) => ({
    account_id: act, date: r.date_start, campaign_id: r.campaign_id!, platform: r.publisher_platform!,
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, link_clicks: Number(r.inline_link_clicks) || 0,
    purchases: pick(r.actions), purchase_value: pick(r.action_values), updated_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("meta_platform_daily").upsert(rows.slice(i, i + 500), { onConflict: "account_id,date,campaign_id,platform" });
    if (error) throw new Error(`meta_platform_daily: ${error.message}`);
  }
  return rows.length;
}

/**
 * Lo de los últimos días (lo que Meta todavía corrige) y, mientras quede tiempo, hacia atrás hasta
 * 62 días, de a 14. Nunca frena la sincronización principal: si falla, queda para la próxima.
 */
async function syncPlatforms(act: string, tz: string, deadline: number) {
  const { data: st } = await db.from("meta_platform_sync").select("backfilled_from,updated_at").eq("account_id", act).maybeSingle();
  if (st?.updated_at && Date.now() - Date.parse(st.updated_at as string) < PLATFORM_EVERY) return "cada hora";
  const today = todayIn(tz);
  const since = shift(today, -1);
  let n = await platformInsights(act, since, today);
  let from = (st?.backfilled_from as string | null) ?? since;
  const target = shift(today, -(PLATFORM_DAYS - 1));
  while (from > target && Date.now() < deadline - 10_000 && (await metaPressure()).pct < BUSY_PCT) {
    const until = shift(from, -1);
    const s = [shift(from, -14), target].sort().at(-1)!;
    n += await platformInsights(act, s, until);
    from = s;
  }
  await db.from("meta_platform_sync").upsert({ account_id: act, backfilled_from: from, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  return n;
}

/** «2026-10-08T00:00:00-0300» de Meta → ISO (o null). */
const when = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

async function upsertObjects(list: Record<string, unknown>[]) {
  // Todas las filas con las mismas columnas: en un upsert de varias, la que falta se manda como null.
  const rows = list.map((r) => ({ campaign_id: null, adset_id: null, thumb: null, video_id: null, links: [], start_time: null, created_time: null, ...r }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("meta_objects").upsert(rows.slice(i, i + 500), { onConflict: "level,id" });
    if (error) throw new Error(`base: ${error.message}`);
  }
}
/** Lo que Meta ya no lista (archivado o borrado) deja de figurar como activo. */
async function retire(act: string, level: string, started: string) {
  await db.from("meta_objects").update({ status: "ARCHIVED", effective_status: "ARCHIVED", updated_at: new Date().toISOString() })
    .eq("account_id", act).eq("level", level).lt("updated_at", started).not("effective_status", "in", "(ARCHIVED,DELETED)");
}

// ------------------------------------------------------------- una cuenta

export type SyncResult = { account: string; ok: boolean; skipped?: string; rows?: number; backfilledFrom?: string | null; platforms?: number | string; usagePct?: number; error?: string; ms: number };

async function claim(act: string, force: boolean): Promise<{ row: SyncRow } | { skipped: string }> {
  await db.from("meta_sync").upsert({ account_id: act }, { onConflict: "account_id", ignoreDuplicates: true });
  const { data: cur } = await db.from("meta_sync").select("*").eq("account_id", act).maybeSingle();
  const row = cur as SyncRow | null;
  if (!force && row?.retry_at && Date.parse(row.retry_at) > Date.now()) {
    return { skipped: `esperando a Meta hasta ${new Date(row.retry_at).toISOString()}` };
  }
  const now = new Date().toISOString();
  const { data } = await db.from("meta_sync").update({ running_until: new Date(Date.now() + LOCK_MS).toISOString(), updated_at: now })
    .eq("account_id", act).or(`running_until.is.null,running_until.lt.${now}`).select("*");
  return data?.length ? { row: data[0] as SyncRow } : { skipped: "ya se está sincronizando" };
}

async function fail(act: string, row: SyncRow, e: unknown, partial: boolean) {
  const rate = isRate(e);
  const fails = (row.fails ?? 0) + 1;
  // Límite de Meta: lo que pidió esperar o 15, 30, 60… hasta 120 min. Otro error: 5, 10, 20… hasta 60.
  const wait = rate ? Math.max(await regainMinutes(), Math.min(120, 15 * 2 ** (fails - 1))) : Math.min(60, 5 * 2 ** (fails - 1));
  const now = new Date().toISOString();
  await db.from("meta_sync").update({
    last_error: metaError(e), error_at: now, running_until: null, updated_at: now,
    // Si lo reciente ya se guardó y lo que falló es la carga hacia atrás (y no es un límite), no se frena lo de cada 15 min.
    ...(rate || !partial ? { retry_at: new Date(Date.now() + wait * 60_000).toISOString(), fails } : {}),
  }).eq("account_id", act);
}

async function syncAccount(act: string, deadline: number, force: boolean): Promise<SyncResult> {
  const t0 = Date.now();
  const c = await claim(act, force);
  if ("skipped" in c) return { account: act, ok: true, skipped: c.skipped, ms: Date.now() - t0 };
  const row = c.row;
  const wait = await regainMinutes();
  if (wait > 0) {
    await db.from("meta_sync").update({ retry_at: new Date(Date.now() + wait * 60_000).toISOString(), running_until: null, last_error: "Meta limitó las consultas", error_at: new Date().toISOString() }).eq("account_id", act);
    return { account: act, ok: false, skipped: `Meta pidió esperar ${wait} min`, ms: Date.now() - t0 };
  }

  // Arriba del 90 % del límite (o si Meta pidió esperar) no se pide nada: queda lo guardado.
  const pre = await metaPressure();
  if (pre.pct >= 90) {
    const mins = Math.max(15, pre.regainMin);
    await db.from("meta_sync").update({ retry_at: new Date(Date.now() + mins * 60_000).toISOString(), running_until: null }).eq("account_id", act);
    return { account: act, ok: true, skipped: `Meta al ${Math.round(pre.pct)} % del límite: espera ${mins} min`, ms: Date.now() - t0 };
  }

  const started = new Date().toISOString();
  let written = 0, partial = false;
  const busy = async () => (await metaPressure()).pct >= BUSY_PCT;
  try {
    const tz = row.timezone || PANEL_TZ;
    const today = todayIn(tz);
    const since = shift(today, -(RECENT_DAYS - 1));
    const [info, camps, sets, ins] = await metaBatch([
      q(act, { fields: "name,currency,timezone_name" }),
      q(`${act}/campaigns`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,start_time,created_time", effective_status: LIVE, limit: "500" }),
      q(`${act}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_amount,bid_strategy,start_time,created_time", effective_status: LIVE, limit: "500" }),
      q(`${act}/insights`, { level: "ad", fields: AD_F, time_increment: "1", use_unified_attribution_setting: "true", time_range: JSON.stringify({ since, until: today }), limit: "500" }),
    ], 40_000) as [{ name: string; currency: string; timezone_name: string }, Page<MObj>, Page<MObj>, Page<IRow>];
    const [campaigns, adsets, recent] = await Promise.all([rest(camps), rest(sets), rest(ins)]);

    // Los anuncios (miniatura, destino, estado): cada hora; si falla no frena lo demás.
    let ads: { items: MObj[]; complete: boolean } | null = null;
    if ((force || !row.ads_at || Date.now() - Date.parse(row.ads_at) > ADS_EVERY) && !(await busy())) {
      try {
        ads = await rest(await metaGet<Page<MObj>>(`${act}/ads`, { fields: `id,name,adset_id,campaign_id,status,effective_status,${CREATIVE}`, effective_status: LIVE, limit: "150" }, 30_000), 30);
      } catch (e) { if (isRate(e)) throw e; }
    }

    const now = new Date().toISOString();
    const objRows = [
      ...campaigns.items.map((o) => ({ level: "campaign", id: o.id, account_id: act, name: o.name, status: o.status ?? null, effective_status: o.effective_status,
        daily_budget: budget(o.daily_budget), lifetime_budget: budget(o.lifetime_budget), bid_strategy: o.bid_strategy ?? null, start_time: when(o.start_time), created_time: when(o.created_time), updated_at: now })),
      ...adsets.items.map((o) => ({ level: "adset", id: o.id, account_id: act, name: o.name, status: o.status ?? null, effective_status: o.effective_status,
        campaign_id: o.campaign_id ?? null, daily_budget: budget(o.daily_budget), lifetime_budget: budget(o.lifetime_budget),
        bid_amount: o.bid_amount != null ? budget(String(o.bid_amount)) : null, bid_strategy: o.bid_strategy ?? null, start_time: when(o.start_time), created_time: when(o.created_time), updated_at: now })),
      ...(ads?.items ?? []).map((o) => ({ level: "ad", id: o.id, account_id: act, name: o.name, status: o.status ?? null, effective_status: o.effective_status,
        campaign_id: o.campaign_id ?? null, adset_id: o.adset_id ?? null, thumb: (o.creative?.thumbnail_url as string | undefined) ?? null,
        video_id: (o.creative?.video_id as string | undefined)
          ?? (o.creative?.object_story_spec as { video_data?: { video_id?: string } } | undefined)?.video_data?.video_id
          ?? (o.creative?.asset_feed_spec as { videos?: { video_id?: string }[] } | undefined)?.videos?.[0]?.video_id ?? null,
        links: destinations(o.creative), updated_at: now })),
    ];
    await upsertObjects(objRows);
    if (campaigns.complete) await retire(act, "campaign", started);
    if (adsets.complete) await retire(act, "adset", started);
    if (ads?.complete) await retire(act, "ad", started);

    // Estados para las filas: lo recién leído; los anuncios, de lo guardado si esta vez no se leyeron.
    const toObj = (o: { status?: string | null; effective_status?: string | null; daily_budget?: number | null }): Obj =>
      ({ status: o.status ?? null, effective: o.effective_status ?? null, budget: o.daily_budget ?? null });
    const adMap = new Map<string, Obj>();
    if (ads) for (const r of objRows.filter((r) => r.level === "ad")) adMap.set(r.id, toObj(r));
    else {
      const { data } = await db.from("meta_objects").select("id,status,effective_status").eq("account_id", act).eq("level", "ad");
      for (const r of data ?? []) adMap.set(r.id, toObj(r));
    }
    const objs = {
      campaigns: new Map(objRows.filter((r) => r.level === "campaign").map((r) => [r.id, toObj(r)])),
      adsets: new Map(objRows.filter((r) => r.level === "adset").map((r) => [r.id, toObj(r)])),
      ads: adMap,
    };

    written += await writeRows(act, since, today, toRows(recent.items, objs), started);
    let from = row.backfilled_from && row.backfilled_from < since ? row.backfilled_from : since;
    await db.from("meta_sync").update({
      name: info.name, currency: info.currency, timezone: info.timezone_name, last_ok_at: new Date().toISOString(),
      last_error: null, error_at: null, retry_at: null, fails: 0, backfilled_from: from, updated_at: new Date().toISOString(),
      ...(ads ? { ads_at: now } : {}),
    }).eq("account_id", act);
    partial = true;

    // Carga hacia atrás, de a tandas, mientras quede tiempo.
    const target = shift(todayIn(info.timezone_name || tz), -(BACKFILL_DAYS - 1));
    let chunk = 7;
    while (from > target && Date.now() < deadline - 15_000 && !(await busy())) {
      const until = shift(from, -1);
      const s = [shift(from, -chunk), target].sort().at(-1)!;
      try {
        const rows = await insights(act, s, until);
        written += await writeRows(act, s, until, toRows(rows, objs), new Date().toISOString());
      } catch (e) {
        if (tooBig(e) && chunk > 1) { chunk = Math.max(1, Math.floor(chunk / 2)); continue; }
        throw e;
      }
      from = s;
      await db.from("meta_sync").update({ backfilled_from: from, updated_at: new Date().toISOString() }).eq("account_id", act);
    }

    // Por red social (Facebook, Instagram…): aparte, para que un error acá no tire lo de arriba.
    let platforms: number | string = "salteado: Meta cerca del límite";
    if (!(await busy())) {
      try { platforms = await syncPlatforms(act, info.timezone_name || tz, deadline); } catch (e) { if (isRate(e)) throw e; platforms = metaError(e); }
    }

    await db.from("meta_sync").update({ running_until: null, rows_written: written, took_ms: Date.now() - t0, updated_at: new Date().toISOString() }).eq("account_id", act);
    return { account: act, ok: true, rows: written, backfilledFrom: from, platforms, usagePct: Math.round((await metaPressure()).pct), ms: Date.now() - t0 };
  } catch (e) {
    await fail(act, row, e, partial);
    return { account: act, ok: false, rows: written, error: metaError(e), ms: Date.now() - t0 };
  }
}

/**
 * Sincroniza todas las cuentas publicitarias de las tiendas. force = sin
 * respetar la espera tras un error (el botón «Sincronizar ahora»); el pedido
 * de espera de Meta se respeta siempre.
 */
export async function syncMeta(opts: { force?: boolean; budgetMs?: number } = {}): Promise<SyncResult[]> {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const out: SyncResult[] = [];
  for (const a of await adAccounts()) out.push(await syncAccount(a.id, deadline, !!opts.force));
  return out;
}
