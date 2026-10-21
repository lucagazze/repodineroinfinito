import { db } from "./db";
import { offerList } from "./admin/offers";
import { clarityProject, clarityRecordingsUrl } from "./clarity";
import { describeSessions, spentOf } from "./event-story";
import { BOT_LABEL, type BotReason } from "./bots";
import { orderRef } from "./order-ref";
import { money, secs, viaText, payErrorText, type Line } from "./event-labels";
import { networkOf, type Network } from "@/lib/network";

/**
 * Panel «En vivo»: quién está ahora en cada página, sacado de site_events
 * (migraciones 015 y 026). Conectado = una carga de página con actividad en
 * los últimos 60 s cuyo último evento no es «leave». Cada pestaña cuenta una
 * vez, en la página donde estuvo por última vez (pasa de la landing al
 * checkout con el mismo sid). Lo usan /admin/en-vivo, /api/admin/en-vivo y el
 * recorrido de un visitante (/admin/en-vivo/recorrido). Cada evento se
 * muestra como una línea legible (event-story.ts): OTO 1, Downsell 1, montos,
 * medio de pago y motivos de error en castellano.
 */

export const LIVE_PAGES = ["landing", "checkout", "oferta", "gracias"] as const;
export type LivePage = (typeof LIVE_PAGES)[number];
export type Counts = Record<LivePage, number>;
export type Devices = { mobile: number; desktop: number; tablet: number };

export type LiveRow = {
  /** Grabación de sesión prendida en este checkout (solo con { full: true }). */
  rec?: boolean;
  funnelId: string | null;
  offer: string; alias: string; market: string; flags: string[];
  counts: Counts; total: number;
  countries: [string, number][]; devices: Devices;
};
export type FeedItem = {
  id: number; at: string; page: LivePage; event: string;
  country: string | null; device: string | null;
  offer: string | null; alias: string | null; market: string | null;
  detail: string | null;
  /** Dato personal (email): se tapa en modo captura. */
  personal: boolean;
  /** Para abrir su recorrido. */
  vid?: string | null;
  /** Etiqueta legible («Compró OTO 1») y su tono, de event-story (feedLabel). */
  label?: string;
  tone?: string;
};

/** De dónde vino: anuncio (UTM), Meta sin UTM (fbclid), otro sitio o directo. */
export type Source = { kind: "ad" | "meta" | "ref" | "direct"; label: string; ad: string | null; campaign: string | null };
/** Lo que se sabe del visitante sin guardar su IP. */
export type Who = {
  country: string | null; city: string | null; region: string | null;
  device: string | null; model: string | null; os: string | null; browser: string | null;
  ip: string | null; returning: boolean | null;
};
export type Person = Who & {
  key: string; vid: string | null;
  page: LivePage; step: string; since: string; lastAt: string;
  source: Source;
  offer: string | null; alias: string | null; market: string | null; flags: string[];
  journey: Line[];
  /** Tiene grabación (rrweb) para verla en vivo. */
  rec: boolean;
  /** Solo con «Mostrar robots»: por qué no parece una persona («revisión de Meta», «posible robot»…). */
  bot?: string | null;
};
/** Lo último que hizo una pestaña, para el feed agrupado por persona. */
export type ActivityGroup = Who & {
  key: string; vid: string | null; firstAt: string; lastAt: string; live: boolean;
  source: Source;
  offer: string | null; alias: string | null; market: string | null; flags: string[];
  /** En orden de hora (la última, abajo). */
  lines: Line[];
  /** Solo con «Mostrar robots»: por qué no parece una persona. */
  bot?: string | null;
};

/** Una ciudad con gente en un paso de un checkout (sin la posición exacta: la de la ciudad, a 1 decimal). */
export type LivePoint = { lat: number; lon: number; city: string | null; country: string | null; page: LivePage; funnelId: string | null; n: number };
export type LiveSnapshot = {
  at: string; windowS: number;
  total: Counts & { all: number };
  countries: [string, number][]; devices: Devices;
  rows: LiveRow[];
  /** Cada ciudad con gente ahora (a 1 decimal, ≈ 10 km), por paso y checkout: para los puntos del mapa de «Ahora». */
  points: LivePoint[];
  /** Solo con { full: true } (la pantalla En vivo); vacíos en el resto. */
  people: Person[];
  activity: ActivityGroup[];
};

const WINDOW_MS = 60_000;
const MAX_PEOPLE = 40;

type Ev = {
  at: string; session_id: string | null; visitor_id: string | null; page: LivePage; event: string;
  funnel_id: string | null; country: string | null; device: string | null; pv: string | null;
  city: string | null; region: string | null; browser: string | null; os: string | null; device_model: string | null;
  ip_masked: string | null; returning_visitor: boolean | null; path: string | null;
  is_bot: boolean; bot_reason: string | null; h: string | null; hv: string | null;
  lat?: number | string | null; lon?: number | string | null;
};
export type FeedRow = {
  id: number; at: string; page: LivePage; event: string; funnel_id: string | null; country: string | null; device: string | null;
  utm: Record<string, string> | null; referrer: string | null; data: Record<string, unknown> | null;
};
/** Fila completa para recorridos. */
type Row = FeedRow & {
  session_id: string | null; visitor_id: string | null; store_id: string | null; order_id: string | null;
  host: string | null; path: string | null;
  city: string | null; region: string | null; browser: string | null; os: string | null; device_model: string | null;
  ip_masked: string | null; returning_visitor: boolean | null;
  ref_host: string | null; utm_source: string | null; utm_campaign: string | null; ad_name: string | null;
  is_bot?: boolean; bot_reason?: string | null;
};
const ROW_COLS =
  "id,at,session_id,visitor_id,store_id,funnel_id,order_id,page,event,host,path,country,city,region,device,browser,os,device_model," +
  "ip_masked,returning_visitor,utm,referrer,ref_host,utm_source,utm_campaign,ad_name,data,is_bot,bot_reason";

/**
 * Sin señales de persona: el navegador ya manda la señal (hv) y en toda la
 * pestaña nunca hubo scroll, toque, puntero ni tecla (h). Pasado este tiempo
 * desde que abrió la página, se la trata como posible robot.
 */
const IDLE_MS = 45_000;
const KEY_ROW = new Set(["lead", "pay_attempt", "pay_error", "paid", "oto_accept", "oto_decline", "download", "cta_click"]);
const botLabel = (r: string | null | undefined) => (r ? BOT_LABEL[r as BotReason] ?? "robot" : null);
/** Por qué un grupo de filas no parece una persona (null = es una persona). */
function rowsBot(rs: Row[]): string | null {
  const b = rs.find((r) => r.is_bot);
  if (b) return botLabel(b.bot_reason ?? "ua");
  const hv = rs.some((r) => r.data?.hv);
  const h = rs.some((r) => r.data?.h);
  if (hv && !h && !rs.some((r) => KEY_ROW.has(r.event))) return BOT_LABEL.idle;
  return null;
}

const zero = (): Counts => ({ landing: 0, checkout: 0, oferta: 0, gracias: 0 });
const noDevices = (): Devices => ({ mobile: 0, desktop: 0, tablet: 0 });
const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);

function hostOf(u: string) {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; }
}

/** Lo que vale la pena leer de cada evento en un feed suelto (sin códigos ni slugs). */
export function detailOf(r: FeedRow): { text: string | null; personal: boolean } {
  const d = r.data ?? {};
  const u = r.utm ?? {};
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : null);
  switch (r.event) {
    case "view": {
      if (u.utm_source || u.fbclid) return { text: [u.utm_source ?? "facebook", u.utm_campaign].filter(Boolean).join(" · "), personal: false };
      return { text: r.referrer ? hostOf(r.referrer) : "directo", personal: false };
    }
    case "lead": return { text: s("email"), personal: true };
    case "pay_attempt": return { text: [d.method === "express" ? "pago exprés" : null, money(d.total, d.currency)].filter(Boolean).join(" · ") || null, personal: false };
    case "pay_error": return { text: payErrorText(d), personal: false };
    case "paid": return { text: money(d.total, d.currency), personal: false };
    case "oto_accept": return { text: viaText(d.via), personal: false };
    case "cta_click": return { text: s("t"), personal: false };
    case "leave": return { text: typeof d.s === "number" ? `${secs(d.s)} en la página` : null, personal: false };
    default: return { text: null, personal: false };
  }
}

// ------------------------------------------------------- quién y de dónde

/** Landing, Checkout, Post-pago, Gracias. */
export function stepLabel(page: LivePage): string {
  return { landing: "Landing", checkout: "Checkout", oferta: "Post-pago", gracias: "Gracias" }[page] ?? page;
}

const plus = (s: string | null | undefined) => (s ? s.replace(/\+/g, " ").trim() || null : null);
/** tumarca.com de oferta.tumarca.com: para saber si el referente es propio. */
const baseOf = (h: string | null | undefined) => (h ? h.replace(/:\d+$/, "").split(".").slice(-2).join(".") : "");
const META = /^(fb|facebook|meta|ig|instagram|an|messenger|msg)$/i;

function refLabel(h: string) {
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|^fb\.me$/.test(h)) return "Facebook";
  if (/instagram\.com$/.test(h)) return "Instagram";
  if (/(^|\.)google\./.test(h)) return "Google";
  if (/bing\.com$/.test(h)) return "Bing";
  if (/tiktok\.com$/.test(h)) return "TikTok";
  if (/youtube\.com$|youtu\.be$/.test(h)) return "YouTube";
  if (/whatsapp\.com$|wa\.me$/.test(h)) return "WhatsApp";
  if (/^t\.co$|twitter\.com$|^x\.com$/.test(h)) return "X";
  return h;
}

/** La fuente de una visita: la primera UTM de la pestaña, si no el referente externo, si no «Directo». */
export function sourceOf(rows: Row[]): Source {
  const u = rows.find((r) => r.ad_name || r.utm_campaign || r.utm_source || r.utm?.fbclid);
  if (u) {
    const src = u.utm_source ?? "";
    const meta = !src || META.test(src);
    if (!u.ad_name && !u.utm_campaign && !src) return { kind: "meta", label: "Meta", ad: null, campaign: null };
    return { kind: "ad", label: meta ? "Meta" : src, ad: plus(u.ad_name), campaign: plus(u.utm_campaign) };
  }
  const own = new Set(rows.map((r) => baseOf(r.host)).filter(Boolean));
  const ref = rows.find((r) => r.event === "view" && r.ref_host && !own.has(baseOf(r.ref_host)));
  if (ref?.ref_host) return { kind: "ref", label: refLabel(ref.ref_host), ad: null, campaign: null };
  return { kind: "direct", label: "Directo", ad: null, campaign: null };
}

/** Para la línea de la tarjeta: sin salidas ni el «procesando» que ya tiene su resultado al lado. */
function compact(lines: Line[]) {
  return lines.filter((l, i) => {
    if (l.event === "leave") return false;
    if (l.page === "oferta" && l.event === "pay_attempt") {
      return !lines.slice(i + 1).some((n) => n.step === l.step && (n.event === "oto_accept" || n.event === "pay_error"));
    }
    return true;
  });
}

/** El paso donde está ahora: el de la última página que abrió (OTO 2, Downsell 1…). */
function currentStep(lines: Line[], page: LivePage) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].page === page && lines[i].event === "view") return lines[i].step;
  return stepLabel(page);
}

/** Lo último conocido de cada dato (los eventos viejos no los traen). */
function whoOf(rows: (Ev | Row)[]): Who {
  const last = <K extends keyof (Ev & Row)>(k: K) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = (rows[i] as Ev & Row)[k];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  return {
    country: last("country") as string | null, city: last("city") as string | null, region: last("region") as string | null,
    device: last("device") as string | null, model: last("device_model") as string | null, os: last("os") as string | null,
    browser: last("browser") as string | null, ip: last("ip_masked") as string | null,
    returning: last("returning_visitor") as boolean | null,
  };
}

/** Pestañas que tienen grabación (rec_sessions, migración 033). */
async function hasRec(sids: string[]) {
  if (!sids.length) return new Set<string>();
  const { data } = await db.from("rec_sessions").select("session_id").in("session_id", sids);
  return new Set((data ?? []).map((r) => r.session_id as string));
}

type FunnelInfo = { offer: string; alias: string; market: string; flags: string[]; active: boolean; key: string };
async function funnelMap() {
  const offers = await offerList();
  const m = new Map<string, FunnelInfo>();
  for (const o of offers) {
    for (const f of o.funnels) {
      m.set(f.id, { offer: o.name, alias: o.alias, market: f.market_label || f.name, flags: f.flags, active: o.active && f.active, key: o.key });
    }
  }
  return m;
}

// ------------------------------------------------------------------ en vivo

/**
 * Foto de ahora. Sin opciones: solo los contadores (lo que usa Inicio).
 * { full: true }: también las tarjetas de cada persona y la actividad.
 */
export async function liveSnapshot(opts: { full?: boolean; robots?: boolean } = {}): Promise<LiveSnapshot> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  // Solo personas: los robots (is_bot, migración 038) quedan guardados pero no cuentan, salvo «Mostrar robots».
  let recentQ = db.from("site_events")
    .select("at,session_id,visitor_id,page,event,funnel_id,country,device,city,region,lat,lon,browser,os,device_model,ip_masked,returning_visitor,path,is_bot,bot_reason,pv:data->>pv,h:data->>h,hv:data->>hv")
    .gte("at", since);
  if (!opts.robots) recentQ = recentQ.eq("is_bot", false);
  let feedQ = db.from("site_events").select(ROW_COLS)
    .neq("event", "heartbeat").gte("at", new Date(Date.now() - 86_400_000).toISOString());
  if (!opts.robots) feedQ = feedQ.eq("is_bot", false);
  const [recent, feed, funnelInfo] = await Promise.all([
    recentQ.order("at", { ascending: true }).limit(20_000),
    opts.full ? feedQ.order("at", { ascending: false }).limit(300) : Promise.resolve({ data: [], error: null }),
    funnelMap(),
  ]);
  if (recent.error) throw new Error(`site_events: ${recent.error.message}`);
  if (feed.error) throw new Error(`site_events: ${feed.error.message}`);

  // Último evento de cada carga de página (vienen ordenados por hora) y el primero que se vio.
  const views = new Map<string, Ev>();
  const firstSeen = new Map<string, string>();
  const byPerson = new Map<string, Ev[]>();
  for (const r of (recent.data ?? []) as unknown as Ev[]) {
    const k = r.pv ?? `${r.session_id ?? r.visitor_id ?? "?"}|${r.page}|${r.funnel_id ?? ""}`;
    views.set(k, r);
    if (!firstSeen.has(k)) firstSeen.set(k, r.at);
    const who = r.session_id ?? r.visitor_id ?? r.pv ?? "?";
    (byPerson.get(who) ?? byPerson.set(who, []).get(who)!).push(r);
  }
  // Una persona (pestaña) = su carga de página abierta más reciente.
  const people = new Map<string, Ev>();
  for (const v of views.values()) {
    if (v.event === "leave") continue;
    const who = v.session_id ?? v.visitor_id ?? v.pv ?? "?";
    const cur = people.get(who);
    if (!cur || v.at > cur.at) people.set(who, v);
  }
  // Robots: marcados al entrar (is_bot) o sin ninguna señal de persona pasados 45 s.
  const robot = new Map<string, string>();
  for (const [who, p] of people) {
    const rs = byPerson.get(who) ?? [p];
    const b = rs.find((r) => r.is_bot);
    if (b) { robot.set(who, botLabel(b.bot_reason ?? "ua")!); continue; }
    // Desde que abrió esta página: su «view» si está en la ventana; si no, abrió hace más de 60 s.
    const view = rs.find((r) => r.event === "view" && r.pv === p.pv);
    const age = view ? Date.now() - Date.parse(view.at) : Infinity;
    if (rs.some((r) => r.hv) && !rs.some((r) => r.h) && age > IDLE_MS) robot.set(who, BOT_LABEL.idle);
  }
  if (!opts.robots) for (const who of robot.keys()) people.delete(who);

  const total = { ...zero(), all: 0 };
  const countries = new Map<string, number>();
  const points = new Map<string, LivePoint>();
  const devices = noDevices();
  const byFunnel = new Map<string, { counts: Counts; countries: Map<string, number>; devices: Devices }>();
  for (const p of people.values()) {
    if (!LIVE_PAGES.includes(p.page)) continue;
    total[p.page]++;
    total.all++;
    if (p.country) countries.set(p.country, (countries.get(p.country) ?? 0) + 1);
    if (p.device && p.device in devices) devices[p.device as keyof Devices]++;
    if (p.lat != null && p.lon != null) {
      const pk = `${p.lat}|${p.lon}|${p.page}|${p.funnel_id ?? ""}`;
      const pt = points.get(pk) ?? { lat: Number(p.lat), lon: Number(p.lon), city: p.city, country: p.country, page: p.page, funnelId: p.funnel_id, n: 0 };
      pt.n++;
      points.set(pk, pt);
    }
    const k = p.funnel_id ?? "";
    const g = byFunnel.get(k) ?? { counts: zero(), countries: new Map(), devices: noDevices() };
    g.counts[p.page]++;
    if (p.country) g.countries.set(p.country, (g.countries.get(p.country) ?? 0) + 1);
    if (p.device && p.device in g.devices) g.devices[p.device as keyof Devices]++;
    byFunnel.set(k, g);
  }

  // Todos los checkouts de las ofertas activas (en cero también) + los que tengan gente.
  const rows: LiveRow[] = [];
  const mk = (id: string | null, g = byFunnel.get(id ?? "")): LiveRow => {
    const info = id ? funnelInfo.get(id) : undefined;
    const counts = g?.counts ?? zero();
    return {
      funnelId: id,
      offer: info?.offer ?? "Sin checkout identificado", alias: info?.alias ?? "—", market: info?.market ?? "", flags: info?.flags ?? [],
      counts, total: LIVE_PAGES.reduce((a, k) => a + counts[k], 0),
      countries: g ? top(g.countries) : [], devices: g?.devices ?? noDevices(),
    };
  };
  for (const [id, info] of funnelInfo) if (info.active || byFunnel.has(id)) rows.push(mk(id));
  for (const id of byFunnel.keys()) if (id && !funnelInfo.has(id)) rows.push(mk(id));
  if (byFunnel.has("")) rows.push(mk(null));
  rows.sort((a, b) => b.total - a.total || a.offer.localeCompare(b.offer) || a.market.localeCompare(b.market));

  const base = { at: new Date().toISOString(), windowS: WINDOW_MS / 1000, total, countries: top(countries), devices, rows, points: [...points.values()] };
  if (!opts.full) return { ...base, people: [], activity: [] };
  const [{ people: cards, activity }, recQ] = await Promise.all([
    details(people, byPerson, firstSeen, funnelInfo, (feed.data ?? []) as unknown as Row[], robot, !!opts.robots),
    db.from("funnels").select("id,record_sessions"),
  ]);
  const recOn = new Map((recQ.data ?? []).map((f) => [f.id as string, f.record_sessions !== false]));
  return { ...base, rows: rows.map((r) => (r.funnelId ? { ...r, rec: recOn.get(r.funnelId) ?? true } : r)), people: cards, activity };
}

/**
 * Una tarjeta por persona conectada (quién es, de qué anuncio vino y qué hizo
 * en esta pestaña) y la actividad de las últimas pestañas, agrupada por
 * persona. Todas las líneas se arman juntas: una sola búsqueda de pedidos y
 * cadenas pos-pago.
 */
async function details(
  people: Map<string, Ev>, byPerson: Map<string, Ev[]>, firstSeen: Map<string, string>, funnelInfo: Map<string, FunnelInfo>,
  feed: Row[], robot: Map<string, string> = new Map(), robots = false,
): Promise<{ people: Person[]; activity: ActivityGroup[] }> {
  const list = [...people.entries()]
    .filter(([, p]) => LIVE_PAGES.includes(p.page))
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, MAX_PEOPLE);

  // Todo lo que hizo cada pestaña conectada en las últimas 24 h (sin latidos).
  const sids = [...new Set(list.map(([, p]) => p.session_id).filter(Boolean) as string[])];
  const bySid = new Map<string, Row[]>();
  const recorded = await hasRec(sids);
  if (sids.length) {
    const { data, error } = await db.from("site_events").select(ROW_COLS)
      .in("session_id", sids).neq("event", "heartbeat")
      .gte("at", new Date(Date.now() - 86_400_000).toISOString())
      .order("at", { ascending: true }).limit(4000);
    if (error) throw new Error(`site_events: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) {
      if (r.session_id) (bySid.get(r.session_id) ?? bySid.set(r.session_id, []).get(r.session_id)!).push(r);
    }
  }

  // Actividad: las pestañas de los últimos eventos (la más reciente primero), cada una en orden de hora.
  // Todas las de la ventana: los filtros de la pantalla buscan en las 24 h, no solo en las primeras.
  const feedGroups = new Map<string, Row[]>();
  for (const r of feed) {
    const k = r.session_id ?? r.visitor_id ?? `ev-${r.id}`;
    (feedGroups.get(k) ?? feedGroups.set(k, []).get(k)!).push(r);
  }
  const feedList = [...feedGroups.entries()].map(([k, rs]) => [k, rs.reverse()] as const);

  const histOf = (p: Ev) => (p.session_id && bySid.get(p.session_id)) || [];
  const described = await describeSessions([...list.map(([, p]) => histOf(p)), ...feedList.map(([, rs]) => rs)]);
  const infoOf = (rs: Row[], id?: string | null) => {
    const f = id ?? [...rs].reverse().find((r) => r.funnel_id)?.funnel_id ?? null;
    const info = f ? funnelInfo.get(f) : undefined;
    return { offer: info?.offer ?? null, alias: info?.alias ?? null, market: info?.market ?? null, flags: info?.flags ?? [] };
  };

  const activity: ActivityGroup[] = feedList.map(([key, rs], i) => ({
    ...whoOf(rs),
    key, vid: rs.find((r) => r.visitor_id)?.visitor_id ?? null,
    firstAt: rs[0].at, lastAt: rs[rs.length - 1].at, live: people.has(key),
    source: sourceOf(rs), ...infoOf(rs),
    lines: described[list.length + i],
    bot: robot.get(key) ?? rowsBot(rs),
  })).filter((g) => g.lines.length && (robots || !g.bot));

  const out = list.map(([key, p], i) => {
    const hist = histOf(p);
    const lines = described[i];
    const recent = byPerson.get(key) ?? [p];
    // En esta página desde que la abrió (la vista de esta carga), o desde el primer latido visto.
    const pvKey = p.pv ?? "";
    const view = pvKey ? hist.find((r) => r.event === "view" && r.data?.pv === pvKey) : undefined;
    const since = [view?.at, firstSeen.get(pvKey), p.at].filter(Boolean).sort()[0] as string;
    const who = whoOf([...hist, ...recent]);
    return {
      start: hist[0]?.at ?? since,
      ...who,
      key, vid: p.visitor_id ?? hist.find((r) => r.visitor_id)?.visitor_id ?? null,
      page: p.page, step: currentStep(lines, p.page), since, lastAt: p.at,
      source: sourceOf(hist), ...infoOf(hist, p.funnel_id),
      journey: compact(lines).slice(-14),
      rec: !!p.session_id && recorded.has(p.session_id),
      bot: robot.get(key) ?? null,
    };
  });
  // Orden fijo entre actualizaciones: el que llegó último, primero (los latidos no las mueven).
  const cards = out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : a.key.localeCompare(b.key)))
    .map(({ start: _start, ...p }) => p);
  return { people: cards, activity };
}

// ------------------------------------------------------ recorrido completo

export type VisitSession = Who & {
  sid: string | null; start: string; end: string; source: Source;
  offer: string | null; alias: string | null; market: string | null; flags: string[];
  journey: Line[]; orders: { id: string; ref: string; href: string | null }[]; paid: boolean;
  /** Tiene grabación (rrweb, se guarda 72 h). */
  rec: boolean;
};
export type VisitorJourney = {
  vid: string; first: string | null; last: string | null; live: boolean; truncated: boolean;
  who: Who; sessions: VisitSession[];
  clarity: { project: string; url: string }[];
};

const JOURNEY_DAYS = 30;
const JOURNEY_MAX = 3000;

/** Todas las visitas de un visitor_id en los últimos 30 días, la más nueva primero. */
export async function visitorJourney(vid: string): Promise<VisitorJourney> {
  const [{ data, error }, liveQ, stores, funnelInfo] = await Promise.all([
    db.from("site_events").select(ROW_COLS)
      .eq("visitor_id", vid).neq("event", "heartbeat")
      .gte("at", new Date(Date.now() - JOURNEY_DAYS * 86_400_000).toISOString())
      .order("at", { ascending: false }).limit(JOURNEY_MAX),
    db.from("site_events").select("event").eq("visitor_id", vid)
      .gte("at", new Date(Date.now() - WINDOW_MS).toISOString()).order("at", { ascending: false }).limit(1),
    db.from("stores").select("id,slug"),
    funnelMap(),
  ]);
  if (error) throw new Error(`site_events: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[]).reverse();
  const slugOf = new Map((stores.data ?? []).map((s) => [s.id as string, s.slug as string]));

  // Por pestaña, en orden de llegada.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.session_id ?? `sin-pestaña-${r.at.slice(0, 10)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const lists = [...groups.values()];
  const recorded = await hasRec(lists.map((rs) => rs[0].session_id).filter(Boolean) as string[]);
  const described = await describeSessions(lists);
  // «#1001» de cada pedido de estas visitas.
  const allOrders = [...new Set(rows.map((r) => r.order_id).filter(Boolean) as string[])];
  const { data: numbered } = allOrders.length ? await db.from("orders").select("id,number,status").in("id", allOrders) : { data: [] };
  const refOf = new Map((numbered ?? []).map((o) => [o.id as string, orderRef(o as { id: string; number: number | null; status: string })]));
  const sessions: VisitSession[] = lists.map((rs, gi) => {
    const funnelId = rs.find((r) => r.funnel_id)?.funnel_id ?? null;
    const info = funnelId ? funnelInfo.get(funnelId) : undefined;
    const orderIds = [...new Set(rs.map((r) => r.order_id).filter(Boolean) as string[])];
    return {
      ...whoOf(rs),
      sid: rs[0].session_id, start: rs[0].at, end: rs[rs.length - 1].at, source: sourceOf(rs),
      offer: info?.offer ?? null, alias: info?.alias ?? null, market: info?.market ?? null, flags: info?.flags ?? [],
      journey: described[gi],
      rec: !!rs[0].session_id && recorded.has(rs[0].session_id),
      orders: orderIds.map((id) => {
        const f = rs.find((r) => r.order_id === id)?.funnel_id ?? funnelId;
        const key = f ? funnelInfo.get(f)?.key : undefined;
        return { id, ref: refOf.get(id) ?? orderRef({ id }), href: key ? `/admin/o/${key}/ventas/${id}` : null };
      }),
      paid: described[gi].some((l) => l.cats.includes("compras")),
    };
  }).sort((a, b) => (a.start < b.start ? 1 : -1));

  // Proyecto de Clarity de cada sitio por el que pasó (casi siempre uno).
  // Solo proyectos de verdad: con NEXT_PUBLIC_CLARITY_ID vacio el link quedaba
  // en /projects/view//impressions y abria un error.
  const projects = new Set<string>();
  for (const r of rows) {
    const pr = clarityProject({ store: r.store_id ? slugOf.get(r.store_id) : null, host: r.host });
    if (pr) projects.add(pr);
  }
  if (!projects.size) {
    const pr = clarityProject({});
    if (pr) projects.add(pr);
  }

  const lastLive = liveQ.data?.[0]?.event;
  return {
    vid, first: rows[0]?.at ?? null, last: rows[rows.length - 1]?.at ?? null,
    live: !!lastLive && lastLive !== "leave", truncated: rows.length >= JOURNEY_MAX,
    who: whoOf(rows), sessions,
    clarity: [...projects].map((project) => ({ project, url: clarityRecordingsUrl(project, vid) })),
  };
}

/** El visitante que hizo un pedido: por los eventos del pedido, el «paid» del checkout o su checkout. */
export async function visitorOfOrder(orderId: string): Promise<string | null> {
  const direct = await db.from("site_events").select("visitor_id")
    .eq("order_id", orderId).not("visitor_id", "is", null).order("at", { ascending: true }).limit(1);
  if (direct.data?.[0]?.visitor_id) return direct.data[0].visitor_id as string;

  const [{ data: order }, { data: checkout }] = await Promise.all([
    db.from("orders").select("stripe_payment_intent,created_at").eq("id", orderId).maybeSingle(),
    db.from("checkouts").select("id").eq("order_id", orderId).maybeSingle(),
  ]);
  if (order?.stripe_payment_intent) {
    const { data } = await db.from("site_events").select("visitor_id")
      .eq("event", "paid").eq("data->>pi", order.stripe_payment_intent).not("visitor_id", "is", null).limit(1);
    if (data?.[0]?.visitor_id) return data[0].visitor_id as string;
  }
  if (checkout?.id) {
    const { data } = await db.from("site_events").select("visitor_id")
      .in("event", ["lead", "pay_attempt", "pay_error"]).eq("data->>checkout", checkout.id).not("visitor_id", "is", null).limit(1);
    if (data?.[0]?.visitor_id) return data[0].visitor_id as string;
  }
  return null;
}

// ------------------------------------------------ eventos por persona (Inicio)

/** Lo que cuenta como «evento» en Inicio: emails, pagos, errores y ofertas (las descargas no: solo en el recorrido). */
const KEY_EVENTS = ["lead", "pay_attempt", "pay_error", "paid", "oto_accept", "oto_decline"];
const MAX_PERSONS = 25;
/** Una pestaña dura minutos: con 3 días alcanza y la consulta es mucho más chica que con 7. */
const PERSON_DAYS = 3;

export type PersonEvents = ActivityGroup & {
  /** De qué red social llegó (navegador de la app, de dónde venía o utm_source), si se sabe. */
  network?: Network | null;
  /** Lo último que hizo (sin salidas). */
  status: Line | null;
  /** Lo gastado de verdad (checkout + OTOs cobrados), por moneda: «US$ 46,80». */
  spent: string | null;
  rec: boolean;
};

/** Las últimas pestañas con un evento importante, la más reciente primero. */
async function personSids(max = MAX_PERSONS) {
  const recent = await db.from("site_events").select("session_id")
    .in("event", KEY_EVENTS).not("session_id", "is", null).eq("is_bot", false)
    .gte("at", new Date(Date.now() - PERSON_DAYS * 86_400_000).toISOString())
    .order("at", { ascending: false }).limit(200);
  if (recent.error) throw new Error(`site_events: ${recent.error.message}`);
  const sids: string[] = [];
  for (const r of recent.data ?? []) {
    const s = r.session_id as string;
    if (!sids.includes(s)) sids.push(s);
    if (sids.length >= max) break;
  }
  return sids;
}

/** Arma la fila de cada una de esas pestañas, con todo lo que hizo (sin `live`: lo pone quien llama). */
async function personGroups(sids: string[]): Promise<PersonEvents[]> {
  if (!sids.length) return [];
  const since = new Date(Date.now() - PERSON_DAYS * 86_400_000).toISOString();
  const [{ data, error }, funnelInfo, recorded] = await Promise.all([
    db.from("site_events").select(ROW_COLS).in("session_id", sids).neq("event", "heartbeat").eq("is_bot", false)
      .gte("at", since).order("at", { ascending: true }).limit(4000),
    funnelMap(),
    hasRec(sids),
  ]);
  if (error) throw new Error(`site_events: ${error.message}`);
  const bySid = new Map<string, Row[]>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (r.session_id) (bySid.get(r.session_id) ?? bySid.set(r.session_id, []).get(r.session_id)!).push(r);
  }
  const keys = sids.filter((s) => bySid.has(s));
  const described = await describeSessions(keys.map((s) => bySid.get(s)!));
  return keys.map((key, i): PersonEvents => {
    const rs = bySid.get(key)!;
    // Las descargas no son un evento importante: en Inicio no van (sí en el recorrido completo).
    const lines = described[i].filter((l) => l.event !== "download");
    const f = [...rs].reverse().find((r) => r.funnel_id)?.funnel_id ?? null;
    const info = f ? funnelInfo.get(f) : undefined;
    return {
      ...whoOf(rs),
      key, vid: rs.find((r) => r.visitor_id)?.visitor_id ?? null,
      firstAt: rs[0].at, lastAt: rs[rs.length - 1].at,
      live: false,
      source: sourceOf(rs),
      offer: info?.offer ?? null, alias: info?.alias ?? null, market: info?.market ?? null, flags: info?.flags ?? [],
      lines, status: [...lines].reverse().find((l) => l.event !== "leave") ?? null,
      // Por los pedidos (checkout + OTOs cobrados), aunque haya pagado en otra visita.
      spent: spentOf(rs),
      rec: recorded.has(key),
      network: rs.map((r) => networkOf({ browser: r.browser, refHost: r.ref_host, utmSource: r.utm_source })).find(Boolean) ?? null,
    };
  });
}

/** Quién de esas pestañas sigue conectado: actividad en el último minuto y lo último no es «se fue». */
async function liveOf(keys: string[]) {
  const out = new Set<string>();
  if (!keys.length) return out;
  const { data } = await db.from("site_events").select("session_id,event").in("session_id", keys).eq("is_bot", false)
    .gte("at", new Date(Date.now() - WINDOW_MS).toISOString()).order("at", { ascending: true });
  const last = new Map<string, string>();
  for (const b of data ?? []) last.set(b.session_id as string, b.event as string);
  for (const [k, ev] of last) if (ev !== "leave") out.add(k);
  return out;
}

const byLast = (a: PersonEvents, b: PersonEvents) => (a.lastAt < b.lastAt ? 1 : -1);

/**
 * Las últimas personas con algo importante (email, pago, error, oferta), la
 * más reciente primero, cada una con TODO lo que hizo en esa pestaña en orden.
 * Armado completo, sin caché.
 */
export async function eventsByPerson(max = MAX_PERSONS): Promise<{ at: string; groups: PersonEvents[] }> {
  const sids = await personSids(max);
  const [groups, live] = await Promise.all([personGroups(sids), liveOf(sids)]);
  return { at: new Date().toISOString(), groups: groups.map((g) => ({ ...g, live: live.has(g.key) })).sort(byLast) };
}

/**
 * Lo mismo, liviano para pedirlo cada 5 s (Inicio › Últimos eventos):
 *  - lo armado se reusa 4 s sin tocar la base;
 *  - después se mira solo el último evento (no latido) y quién sigue conectado;
 *  - si entraron eventos, se rehacen únicamente las pestañas de la lista que
 *    los tuvieron. Todo de nuevo solo si apareció una persona nueva con un
 *    evento importante, si hubo muchos cambios o cada 60 s (por si un pago se
 *    confirmó sin evento nuevo);
 *  - `v` resume el estado: si el panel manda el mismo (?v=), no hay nada que mandarle (same).
 */
type PersonCache = { at: number; built: number; mark: number; groups: PersonEvents[]; v: string };
let personCache: PersonCache | null = null;
let building: Promise<PersonCache> | null = null;
const FRESH_MS = 4000;
const FULL_MS = 60_000;

async function refreshPersons(prev: PersonCache | null): Promise<PersonCache> {
  const keys = prev?.groups.map((g) => g.key) ?? [];
  const [{ data: top }, live] = await Promise.all([
    db.from("site_events").select("id").neq("event", "heartbeat").order("at", { ascending: false }).limit(1),
    liveOf(keys),
  ]);
  const mark = Number(top?.[0]?.id ?? 0);
  let groups = prev?.groups ?? [];
  let built = prev?.built ?? 0;
  let full = !prev || Date.now() - prev.built > FULL_MS;

  if (!full && prev && mark !== prev.mark) {
    // Qué pasó desde la última vez.
    const { data: changed, error } = await db.from("site_events").select("session_id,event")
      .gt("id", prev.mark).neq("event", "heartbeat").not("session_id", "is", null).eq("is_bot", false).limit(500);
    if (error || (changed?.length ?? 0) >= 500) full = true;
    else {
      const mine = new Set(keys);
      // Alguien que no está en la lista hizo algo importante: entra arriba, se arma todo.
      if ((changed ?? []).some((r) => !mine.has(r.session_id as string) && KEY_EVENTS.includes(r.event as string))) full = true;
      else {
        const touched = [...new Set((changed ?? []).map((r) => r.session_id as string).filter((s) => mine.has(s)))];
        if (touched.length) {
          const redone = new Map((await personGroups(touched)).map((g) => [g.key, g]));
          groups = groups.map((g) => redone.get(g.key) ?? g);
        }
        // Lo de las landings de gente que no está en la lista no cambia nada.
      }
    }
  }
  if (full) {
    const sids = await personSids();
    groups = await personGroups(sids);
    built = Date.now();
  }
  const liveNow = full && keys.join() !== groups.map((g) => g.key).join() ? await liveOf(groups.map((g) => g.key)) : live;
  groups = groups.map((g) => ({ ...g, live: liveNow.has(g.key) })).sort(byLast);
  const v = `${mark}.${built}.${groups.map((g) => `${g.key}${g.live ? "*" : ""}:${g.lines.length}`).join(",")}`;
  return { at: Date.now(), built, mark, groups, v };
}

export async function eventsByPersonCached(clientV: string | null): Promise<{ at: string; v: string; same: boolean; groups: PersonEvents[] }> {
  if (!personCache || Date.now() - personCache.at > FRESH_MS) {
    // Un solo armado a la vez aunque haya varias pestañas del panel abiertas.
    building ??= refreshPersons(personCache).finally(() => { building = null; });
    personCache = await building;
  }
  const c = personCache;
  return { at: new Date().toISOString(), v: c.v, same: c.v === clientV, groups: c.groups };
}
