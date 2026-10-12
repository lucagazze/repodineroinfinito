/**
 * Piloto Meta Ads: las reglas, en funciones puras (sin base ni Meta). Las
 * prueba scripts/test-autopilot.mjs con casos inventados. Reglas del dueño (06/10):
 *
 *  Guardia de CBO — una campaña ACTIVA con presupuesto de campaña y «costo más
 *  bajo» (LOWEST_COST_WITHOUT_CAP) se apaga cuando, en los últimos 3 días
 *  COMPLETOS (hora de la cuenta): corrió los 3, gastó 150 USD o más y su ROAS
 *  es menor que 1. Nunca toca las BID CAP (las maneja el piloto de pujas), ni
 *  las que el dueño excluyó, ni una que la guardia apagó y él volvió a prender (72 h).
 *  A lo sumo 3 por pasada; las demás quedan en un aviso.
 *
 *  Ganadores — en una CBO activa, un anuncio activo que en los últimos 7 días
 *  completos corrió 3 o más, tuvo 10 compras o más y un CPA menor o igual al
 *  objetivo (USA 15, el resto 10, como el piloto de pujas). Se propone una sola vez.
 *
 *  Y lo de la campaña BID CAP nueva: su nombre, su público y su creativo.
 *
 * Sin imports a propósito: se corre igual en el servidor y en la prueba.
 */

export const CBO = "LOWEST_COST_WITHOUT_CAP";
export const BID_CAP = "LOWEST_COST_WITH_BID_CAP";
export const GUARD = { days: 3, minSpend: 150, minRoas: 1, maxPauses: 3, cooldownH: 72 };
export const WIN = { days: 7, minDays: 3, minPurchases: 10, ttlH: 48 };
/** Presupuesto diario de las BID CAP nuevas (USD), como las que ya tiene el dueño (las pasó todas a 500 el 06/10). */
export const BIDCAP_BUDGET = 500;

const H = 3600_000;
const n2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (n: number) => Math.round(n).toLocaleString("es-AR");

/**
 * El tope de puja (y la puja de arranque) de una BID CAP: el 70 % del precio del front de su oferta
 * en USD, redondeado HACIA ABAJO a 0,05. El freno y el aviso de «CPA caro» siguen en el
 * 100 % del precio: el 30 % de diferencia es el margen (el CPA puede pasar la puja). El porcentaje
 * se cambia en la página del piloto (app_settings «bid_pilot».ceiling_pct); este es el de fábrica.
 */
export const CEILING_FACTOR = 0.7;
export const ceilingFromFront = (usd: number, factor = CEILING_FACTOR) => Math.floor(usd * factor * 20 + 1e-9) / 20;
/** La escalera de un ganador: 3 conjuntos a (tope − 20), (tope − 10) y tope % del precio del front: 50 / 60 / 70 %. */
export const ladderPcts = (factor = CEILING_FACTOR) => [factor - 0.2, factor - 0.1, factor].map((f) => Math.round(f * 100) / 100);

/** host + ruta, sin www, sin consulta y sin barra final (como normUrl de meta-links). */
export function linkKey(u: string) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch { return ""; }
}
/**
 * Las formas de la landing de un checkout para reconocer el link de un anuncio: tal cual y sin el
 * idioma del principio (p. ej. /oferta ↔ /es/oferta).
 * Un link con otro idioma (/fr/oferta) no coincide con /it/oferta.
 */
export function landingKeys(u: string) {
  const k = linkKey(u);
  if (!k) return [];
  const m = k.match(/^([^/]+)\/[a-z]{2}(\/.+)$/);
  return m ? [k, `${m[1]}${m[2]}`] : [k];
}

/** Objetivo de CPA por mercado (el dueño): «USA» → 15; el resto (Italia, Francia, UK, España…) → 10. */
export const targetFor = (name: string) => (/\bUSA\b/i.test(name) ? 15 : 10);

// ------------------------------------------------------------ guardia de CBO

export type GuardInput = {
  now: number;
  /** effective_status de la campaña. */
  status: string;
  bidStrategy: string | null;
  /** Tiene presupuesto de campaña (diario o total): es CBO. */
  campaignBudget: boolean;
  /** el dueño la sacó de la guardia (interruptor por campaña). */
  optedOut: boolean;
  /** La última vez que la apagó la guardia (si está activa de nuevo, la prendió el dueño). */
  lastAutoPauseAt: number | null;
  /** Gasto (USD) de cada uno de los 3 días completos. */
  daySpend: number[];
  /** Ingresos de esos 3 días (USD), de la fuente que corresponde. */
  revenue: number;
  source: "real" | "meta";
};
export type GuardVerdict = {
  action: "pause" | "keep" | "skip";
  rule: string;
  reason: string;
  spend: number;
  roas: number | null;
  daysRun: number;
};

export function guardVerdict(x: GuardInput): GuardVerdict {
  const spend = x.daySpend.reduce((a, b) => a + b, 0);
  const daysRun = x.daySpend.filter((s) => s > 0).length;
  const roas = spend > 0 ? x.revenue / spend : null;
  const v = (action: GuardVerdict["action"], rule: string, reason: string): GuardVerdict => ({ action, rule, reason, spend, roas, daysRun });
  if (x.bidStrategy === BID_CAP) return v("skip", "bid_cap", "Es BID CAP: la maneja el piloto de pujas.");
  if (x.bidStrategy !== CBO || !x.campaignBudget) return v("skip", "not_cbo", "No es una CBO de costo más bajo.");
  if (x.status !== "ACTIVE") return v("skip", "inactive", "No está activa.");
  if (x.optedOut) return v("skip", "opted_out", "La sacaste de la guardia.");
  if (x.lastAutoPauseAt != null && x.now - x.lastAutoPauseAt < GUARD.cooldownH * H) {
    const left = Math.ceil((GUARD.cooldownH * H - (x.now - x.lastAutoPauseAt)) / H);
    return v("skip", "reactivated", `La apagó la guardia y la volviste a prender: no la toca por ${left} h más.`);
  }
  const src = x.source === "real" ? "ventas reales" : "valor de Meta";
  if (daysRun < GUARD.days) return v("keep", "too_new", `Corrió ${daysRun} de los últimos ${GUARD.days} días completos.`);
  if (spend < GUARD.minSpend) return v("keep", "low_spend", `Gastó ${n2(spend)} USD en 3 días (menos de ${GUARD.minSpend}).`);
  if (roas! >= GUARD.minRoas) return v("keep", "roas_ok", `ROAS 3 días ${n2(roas!)} (${src}) con ${n0(spend)} USD gastados.`);
  return v("pause", "roas_low", `ROAS 3 días ${n2(roas!)} (${src}) con ${n0(spend)} USD gastados.`);
}

/**
 * De las que hay que apagar, cuáles se apagan en esta pasada (a lo sumo `max`, primero las que
 * más plata pierden) y cuáles quedan para un aviso.
 */
export function pickPauses<T extends { id: string; spend: number; revenue: number }>(list: T[], max = GUARD.maxPauses) {
  const sorted = [...list].sort((a, b) => (b.spend - b.revenue) - (a.spend - a.revenue) || b.spend - a.spend);
  return { pause: sorted.slice(0, max), over: sorted.slice(max) };
}

// ------------------------------------------------------------------ ganadores

export type WinnerInput = {
  adActive: boolean;
  /** La campaña es una CBO activa. */
  campaignActiveCbo: boolean;
  /** Gasto y compras (según Meta) de cada uno de los 7 días completos. */
  days: { spend: number; purchases: number }[];
  target: number;
  /** Ya se propuso alguna vez (se propone una sola). */
  proposed: boolean;
  /** Su posteo ya corre en una BID CAP de la cuenta (el nombre de esa campaña): no hace falta otra. */
  inBidCap?: string | null;
};
export type WinnerVerdict = {
  qualifies: boolean; rule: string; reason: string;
  spend: number; purchases: number; cpa: number | null; daysRun: number;
};

export function winnerVerdict(x: WinnerInput): WinnerVerdict {
  const spend = x.days.reduce((a, d) => a + d.spend, 0);
  const purchases = x.days.reduce((a, d) => a + d.purchases, 0);
  const daysRun = x.days.filter((d) => d.spend > 0).length;
  const cpa = purchases > 0 ? spend / purchases : null;
  const v = (qualifies: boolean, rule: string, reason: string): WinnerVerdict => ({ qualifies, rule, reason, spend, purchases, cpa, daysRun });
  const nums = `${n0(purchases)} compras · CPA ${cpa == null ? "—" : n2(cpa)} (obj. ${n2(x.target)}) · ${daysRun} días`;
  if (!x.campaignActiveCbo) return v(false, "not_cbo", "La campaña no es una CBO activa.");
  if (!x.adActive) return v(false, "inactive", "El anuncio no está activo.");
  if (x.proposed) return v(false, "proposed", `Ya se propuso. ${nums}.`);
  if (x.inBidCap) return v(false, "in_bid_cap", `Su posteo ya está en «${x.inBidCap}». ${nums}.`);
  if (daysRun < WIN.minDays) return v(false, "too_new", `Corrió ${daysRun} de los últimos ${WIN.days} días (mínimo ${WIN.minDays}).`);
  if (purchases < WIN.minPurchases) return v(false, "few_sales", `Pocas compras: ${nums}.`);
  if (cpa! > x.target) return v(false, "expensive", `CPA arriba del objetivo: ${nums}.`);
  return v(true, "winner", `Ganador: ${nums}.`);
}

// ------------------------------------------------------ la campaña BID CAP nueva

/** «Italia | CBO | Mi Oferta» → ["Italia", "CBO", "Mi Oferta"]. */
const parts = (name: string) => name.split(/\s*[|·]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);

/** El mercado de una CBO por su nombre: lo primero («Italia | CBO | …» → «Italia»). */
export function marketOf(cboName: string) {
  const p = parts(cboName);
  return p.length > 1 && !/^CBO$/i.test(p[0]) ? p[0] : "";
}
/** La oferta: lo que va después de «CBO» («Italia | CBO | Mi Oferta» → «Mi Oferta»). */
export function offerOf(cboName: string) {
  const p = parts(cboName);
  const i = p.findIndex((s) => /^CBO$/i.test(s));
  const rest = i >= 0 ? p.slice(i + 1) : p.slice(1);
  return rest.join(" ") || cboName.trim();
}
/** «BID CAP - <Mercado> - <Oferta> - <anuncio>». */
export function bidCapName(cboName: string, adName: string) {
  return ["BID CAP", marketOf(cboName), offerOf(cboName), adName.trim()].filter(Boolean).join(" - ").slice(0, 250);
}

/** Ubicaciones manuales del dueño: Facebook e Instagram (sin Audience Network ni Messenger), las mismas que sus CBO. */
export const MANUAL_PLACEMENTS = {
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["feed", "story", "search", "facebook_reels", "profile_feed"],
  instagram_positions: ["stream", "story", "explore", "reels", "explore_home", "profile_feed"],
  device_platforms: ["mobile", "desktop"],
};

type Aud = { id: string; name?: string };

/**
 * El público de la BID CAP: el del conjunto ganador (países, edades, idiomas…) con las reglas de
 * el dueño encima: sin público Advantage+ (advantage_audience 0), ubicaciones manuales en Facebook e
 * Instagram, y excluyendo a los compradores (los del ganador más los que se pasan en `exclude`).
 */
export function bidCapTargeting(src: Record<string, unknown>, exclude: Aud[]): Record<string, unknown> {
  const t: Record<string, unknown> = JSON.parse(JSON.stringify(src ?? {}));
  // Lo que Meta devuelve al leer pero arma solo (o choca con age_min/age_max al escribir).
  delete t.user_age_unknown; delete t.age_range;
  delete t.audience_network_positions; delete t.messenger_positions;
  const pp = Array.isArray(t.publisher_platforms) ? (t.publisher_platforms as string[]).filter((p) => p === "facebook" || p === "instagram") : [];
  if (!pp.length) {
    delete t.facebook_positions; delete t.instagram_positions;
    Object.assign(t, JSON.parse(JSON.stringify(MANUAL_PLACEMENTS)));
  } else {
    t.publisher_platforms = pp;
    if (!pp.includes("facebook")) delete t.facebook_positions;
    if (!pp.includes("instagram")) delete t.instagram_positions;
  }
  const ex = new Map<string, Aud>();
  for (const a of [...((t.excluded_custom_audiences as Aud[] | undefined) ?? []), ...exclude]) if (a?.id) ex.set(String(a.id), { id: String(a.id) });
  t.excluded_custom_audiences = [...ex.values()];
  t.targeting_automation = { advantage_audience: 0 };
  t.targeting_relaxation_types = { lookalike: 0, custom_audience: 0 };
  return t;
}

/** Países de la UE y el EEE: un conjunto que llega a alguno necesita los datos de la DSA. */
const EU = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split(" "));
export function needsDsa(targeting: Record<string, unknown>) {
  const g = (targeting.geo_locations ?? {}) as Record<string, unknown>;
  // Grupos de países («worldwide», «europe»…): pueden incluir Europa.
  if (((g.country_groups as string[] | undefined) ?? []).length) return true;
  // Los países: los de la lista y los de cada región, ciudad o código postal.
  const cs = new Set(((g.countries as string[] | undefined) ?? []).map((c) => String(c).toUpperCase()));
  for (const k of ["regions", "cities", "zips", "geo_markets", "electoral_districts", "places", "custom_locations"]) {
    for (const x of ((g[k] as { country?: string }[] | undefined) ?? [])) if (x?.country) cs.add(String(x.country).toUpperCase());
  }
  // Sin ningún país a la vista: por las dudas, sí.
  return !cs.size || [...cs].some((c) => EU.has(c));
}

export type WinnerCreative = {
  effective_object_story_id?: string; instagram_user_id?: string; url_tags?: string;
  contextual_multi_ads?: { enroll_status?: string };
};
/**
 * El creativo: el MISMO posteo del ganador (object_story_id), así los «me gusta» y comentarios
 * siguen sumando, con las únicas mejoras que acepta el dueño: comentarios relevantes y mejorar la CTA.
 */
export function bidCapCreative(src: WinnerCreative, name: string): Record<string, unknown> {
  if (!src.effective_object_story_id) throw new Error("El anuncio ganador no tiene posteo (effective_object_story_id).");
  return {
    name: name.slice(0, 250),
    object_story_id: src.effective_object_story_id,
    ...(src.instagram_user_id ? { instagram_user_id: src.instagram_user_id } : {}),
    ...(src.url_tags ? { url_tags: src.url_tags } : {}),
    ...(src.contextual_multi_ads?.enroll_status === "OPT_OUT" ? { contextual_multi_ads: { enroll_status: "OPT_OUT" } } : {}),
    degrees_of_freedom_spec: { creative_features_spec: { inline_comment: { enroll_status: "OPT_IN" }, enhance_cta: { enroll_status: "OPT_IN" } } },
  };
}

/** Lo que tiene que haber quedado en Meta (leído de vuelta) antes de prender nada. Devuelve los problemas. */
export function checkBuilt(read: {
  campaign: { bid_strategy?: string; daily_budget?: string | number; objective?: string; status?: string } | null;
  adset: { bid_amount?: string | number; status?: string; promoted_object?: { pixel_id?: string }; targeting?: Record<string, unknown> } | null;
  ad: { status?: string; effective_status?: string; creative?: { id?: string }; issues_info?: unknown[] } | null;
}, want: { bidCents: number; budgetCents: number; pixelId: string | null; exclude: string[]; creativeId: string }): string[] {
  const p: string[] = [];
  const c = read.campaign, s = read.adset, a = read.ad;
  if (!c) p.push("no se pudo leer la campaña");
  else {
    if (c.bid_strategy !== BID_CAP) p.push(`la campaña quedó con ${c.bid_strategy ?? "otra estrategia"}`);
    if (Number(c.daily_budget) !== want.budgetCents) p.push(`presupuesto ${Number(c.daily_budget) / 100} en vez de ${want.budgetCents / 100}`);
    if (c.objective && c.objective !== "OUTCOME_SALES") p.push(`objetivo ${c.objective}`);
  }
  if (!s) p.push("no se pudo leer el conjunto");
  else {
    if (Number(s.bid_amount) !== want.bidCents) p.push(`puja ${Number(s.bid_amount) / 100} en vez de ${want.bidCents / 100}`);
    if (want.pixelId && s.promoted_object?.pixel_id !== want.pixelId) p.push("el conjunto no quedó con el pixel del ganador");
    const t = s.targeting ?? {};
    const ex = new Set(((t.excluded_custom_audiences as Aud[] | undefined) ?? []).map((x) => String(x.id)));
    const miss = want.exclude.filter((id) => !ex.has(id));
    if (miss.length) p.push("no quedó excluido el público de compradores");
    if ((t.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience === 1) p.push("quedó con público Advantage+");
    const pp = (t.publisher_platforms as string[] | undefined) ?? [];
    if (!pp.length || pp.some((x) => x !== "facebook" && x !== "instagram")) p.push("las ubicaciones no quedaron en Facebook + Instagram");
  }
  if (!a) p.push("no se pudo leer el anuncio");
  else {
    if (a.creative?.id !== want.creativeId) p.push("el anuncio no quedó con el creativo nuevo");
    if (["DISAPPROVED", "WITH_ISSUES"].includes(a.effective_status ?? "")) p.push(`el anuncio quedó ${a.effective_status}`);
    if (Array.isArray(a.issues_info) && a.issues_info.length) p.push("el anuncio tiene problemas (issues_info)");
  }
  return p;
}
