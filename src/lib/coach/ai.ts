import { db, type Product } from "@/lib/db";
import { getRates, priceFor } from "@/lib/fx";
import { resolveSettings } from "@/lib/checkout-settings";
import { fmtShort } from "@/lib/admin/range";
import { AREA_LABEL, type Area, type Finding, type PostIdea, type Severity } from "./types";
import type { CampaignFacts, Facts, MarketFacts, StoreFacts } from "./facts";
import { pc } from "./facts";

/**
 * «Mejoras», capa 2: la IA (Gemini, la misma clave que el buzón) convierte
 * los hallazgos en una lista corta de recomendaciones en castellano, cada una
 * con el texto para pegarle a Claude, y propone ideas de post-pago armadas
 * SOLO con productos del catálogo de la tienda (o marcadas «producto nuevo a
 * crear»). Nunca recibe datos de compradores (ni mails ni nombres), solo
 * números calculados; y lo que escribe se revisa: los números que no están en
 * los datos quedan marcados, los productos que no existen se pasan a «nuevo».
 */

export type DraftRec = {
  kind: "mejora" | "postpago";
  offerKey: string | null; storeSlug: string | null;
  fingerprint: string; area: Area; severity: Severity; title: string;
  weak: string | null; why: string | null; change: string | null; prompt: string;
  impactUsdWeek: number | null; findings: Finding[]; idea?: PostIdea; checks: string[];
};

const MODEL = () => process.env.AI_MODEL?.trim() || "gemini-3.5-flash";
export const coachModel = () => (process.env.GEMINI_API_KEY?.trim() ? MODEL() : process.env.ANTHROPIC_API_KEY?.trim() ? "claude" : null);

/** Gemini con salida JSON forzada (como el buzón), con más lugar: las recomendaciones traen textos largos. */
async function callJson(sys: string, user: string, schema: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    // Sin Gemini: Anthropic por el mismo camino que el buzón (se carga solo si hace falta).
    const { aiJson } = await import("@/lib/ai-reply");
    return aiJson(sys, user, { name: "coach", description: "Recomendaciones de mejora", input_schema: schema }, { temperature: 0.4, maxTokens: 8000 });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 32_768, responseMimeType: "application/json", responseJsonSchema: schema },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`La IA respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const c = j.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`La IA no devolvió JSON${c?.finishReason === "MAX_TOKENS" ? " (se cortó por largo)" : ""}.`);
  }
}

// ------------------------------------------------------------------ esquemas

const AREAS = Object.keys(AREA_LABEL);
const REC_ITEM = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "Qué hacer, en 4–10 palabras (imperativo). Sin el nombre de la oferta." },
    area: { type: "string", enum: AREAS },
    severidad: { type: "string", enum: ["alta", "media", "baja"] },
    hallazgos: { type: "array", items: { type: "string" }, description: "ids de los hallazgos en los que se apoya (de la lista dada). El primero es el principal." },
    que_esta_flojo: { type: "string", description: "1–2 frases con los números de los hallazgos citados, tal cual." },
    por_que_importa: { type: "string", description: "1–2 frases: qué se pierde (plata, compradores, aprendizaje de Meta)." },
    cambio: { type: "string", description: "El cambio concreto, en 1–3 frases. Qué tocar y cómo." },
    prompt_claude: { type: "string", description: "Instrucción para Claude, autosuficiente, en castellano (voseo): qué cambiar, en qué tienda/checkout/producto (slugs), los números actuales y el objetivo medible. Sin el bloque de contexto: se agrega solo." },
  },
  required: ["titulo", "area", "severidad", "hallazgos", "que_esta_flojo", "por_que_importa", "cambio", "prompt_claude"],
};
const IDEA_ITEM = {
  type: "object",
  properties: {
    titulo: { type: "string", description: "Nombre corto de la cadena, p. ej. «Colección completa → mitad de precio → pie»." },
    pasos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paso: { type: "string", enum: ["OTO 1", "Downsell 1", "OTO 2", "Downsell 2", "OTO 3", "Downsell 3"] },
          producto_slug: { type: "string", description: "slug EXACTO del catálogo dado, o \"\" si es un producto nuevo." },
          producto_nuevo: { type: "string", description: "Si no existe en el catálogo: qué producto crear (\"\" si existe)." },
          precio: { type: "number", description: "Precio sugerido en la moneda del mercado." },
          por_que: { type: "string" },
        },
        required: ["paso", "producto_slug", "producto_nuevo", "precio", "por_que"],
      },
    },
    razonamiento: { type: "string", description: "Por qué esta cadena para este comprador, citando números si los hay." },
    prompt_claude: { type: "string", description: "Instrucción para Claude que arma esta cadena de post-pago (sin el bloque de contexto)." },
  },
  required: ["titulo", "pasos", "razonamiento", "prompt_claude"],
};
const OFFER_SCHEMA = {
  type: "object",
  properties: {
    recomendaciones: { type: "array", maxItems: 4, items: REC_ITEM },
    ideas_postpago: { type: "array", maxItems: 3, items: IDEA_ITEM },
  },
  required: ["recomendaciones", "ideas_postpago"],
};
const GLOBAL_SCHEMA = {
  type: "object",
  properties: {
    resumen: { type: "string", description: "2–4 frases: cómo viene el negocio en la ventana y lo más urgente, con números de los hechos." },
    recomendaciones: { type: "array", maxItems: 5, items: REC_ITEM },
  },
  required: ["resumen", "recomendaciones"],
};

const SYS = `Sos el analista de crecimiento del dueño de la tienda. Vende productos digitales de bajo precio con anuncios de Meta, en su propio checkout (bumps en el checkout y post-pago de 1 clic: OTO 1/2/3 con downsell a mitad de precio).
Recibís HECHOS ya calculados (JSON). Tu trabajo: decir qué está flojo y qué cambiar, priorizado por plata.
Reglas duras:
1. Usá SOLO números que estén en los hechos, escritos igual (mismo redondeo y unidad). No calcules porcentajes nuevos, no estimes montos, no inventes.
2. Cada recomendación se apoya en hallazgos de la lista (ids exactos en "hallazgos"). Los hallazgos con "suficiente": false son «pocos datos»: no recomiendes cambios por ellos; a lo sumo, qué medir.
3. Priorizá por impacto_usd_semana y severidad. Nada de consejos genéricos («mejorá el copy»): decí qué parte y cómo.
4. Productos: solo los slugs del catálogo dado. Si proponés algo que no existe, producto_slug = "" y producto_nuevo = qué crear. Precios en la moneda del mercado, coherentes con los del catálogo.
5. Castellano, directo, sin relleno ni emojis. Montos: 1.124 USD, 19,73 USD; porcentajes: 9,9%.
6. Ofertas que todavía cobran en la plataforma anterior (sin pedidos en la app): no propongas pasarlas a la app ni mover su tráfico; eso lo decide el dueño.
7. Campañas de Meta: proponé, pero el texto para Claude tiene que pedir el análisis y la propuesta, no aplicar cambios en campañas activas.
8. prompt_claude: una instrucción que el dueño pega a Claude Code para que lo haga. Autosuficiente: qué cambiar, dónde (tienda, checkout y productos por slug), los números actuales y el objetivo medible, y cómo verificarlo. Claude trabaja con el MCP «checkout» (tiendas, checkouts, productos, post-pago) y el repo de la app; para Meta solo puede leer y proponer. No pongas el bloque de contexto: se agrega solo.`;

// ------------------------------------------------------------------ catálogo

type CatRow = { id: string; slug: string; name: string; short_name: string | null; kind: string; active: boolean; description: string | null; book_count: number | null; is_library: boolean | null; includes: string[] | null; variant_of: string | null; product_prices: Product["product_prices"] };

/**
 * Los productos que tienen sentido para el post-pago de una oferta: los del
 * mismo idioma que el mercado (los que se usan en checkouts y cadenas con ese
 * idioma en la tienda) más los de la oferta. Con precio en la moneda del mercado.
 */
async function catalogFor(m: MarketFacts) {
  const [{ data: fus }, { data: prods }, { data: pps }] = await Promise.all([
    db.from("funnels").select("id,settings,main_product_id,funnel_items(product_id)").eq("store_id", m.storeId),
    db.from("products").select("id,slug,name,short_name,kind,active,description,book_count,is_library,includes,variant_of,product_prices(currency,amount,compare_at,display_value)").eq("store_id", m.storeId),
    db.from("pp_funnels").select("id,checkout_funnel_id,trigger_product_ids,pp_steps(product_id)").eq("store_id", m.storeId),
  ]);
  const rates = await getRates();
  const all = (prods ?? []) as unknown as CatRow[];
  const byId = new Map(all.map((p) => [p.id, p]));
  const sameLang = new Set<string>();
  const locOf = new Map<string, string>();
  for (const f of fus ?? []) {
    const loc = resolveSettings(f.settings).locale || "";
    locOf.set(f.id as string, loc);
    if (m.locale && loc === m.locale) {
      if (f.main_product_id) sameLang.add(f.main_product_id as string);
      for (const i of (f.funnel_items as { product_id: string }[] | null) ?? []) sameLang.add(i.product_id);
    }
  }
  const mainLoc = new Map<string, string>();
  for (const f of fus ?? []) if (f.main_product_id) mainLoc.set(f.main_product_id as string, locOf.get(f.id as string) ?? "");
  for (const pp of pps ?? []) {
    const loc = pp.checkout_funnel_id ? locOf.get(pp.checkout_funnel_id as string) : ((pp.trigger_product_ids as string[] | null) ?? []).map((t) => mainLoc.get(t)).find(Boolean);
    if (m.locale && loc === m.locale) for (const s of (pp.pp_steps as { product_id: string }[] | null) ?? []) sameLang.add(s.product_id);
  }
  // Lo de esta oferta siempre entra (aunque el checkout no tenga idioma fijo).
  const inOffer = new Map<string, string>();
  if (m.main) inOffer.set(m.main.id, "principal");
  for (const b of m.bumps) inOffer.set(b.id, "bump");
  for (const s of m.chain?.steps ?? []) inOffer.set(s.id, s.kind === "downsell" ? `Downsell ${s.level}` : `OTO ${s.level}`);
  const pick = all.filter((p) => p.active && (inOffer.has(p.id) || sameLang.has(p.id) || (p.variant_of && sameLang.has(p.variant_of))));
  const rows = pick.map((p) => {
    const pr = p.product_prices?.length ? priceFor(p as unknown as Product, m.currency, rates) : null;
    return {
      slug: p.slug, nombre: p.short_name || p.name, tipo: p.kind,
      precio: pr?.amount != null ? Number(pr.amount) : null,
      libros: p.book_count ?? ((p.includes ?? []).length || 1),
      incluye: (p.includes ?? []).map((id) => byId.get(id)?.slug).filter(Boolean),
      variante_de: p.variant_of ? byId.get(p.variant_of)?.slug ?? null : null,
      en_esta_oferta: inOffer.get(p.id) ?? null,
      descripcion: (p.description ?? "").replace(/\s+/g, " ").slice(0, 120),
    };
  });
  // Lo de la oferta primero; después, sin variantes (las «mitad de precio» las propone la IA como downsell), hasta 70.
  rows.sort((a, b) => Number(!!b.en_esta_oferta) - Number(!!a.en_esta_oferta) || Number(!!a.variante_de) - Number(!!b.variante_de) || (b.libros ?? 1) - (a.libros ?? 1));
  return { rows: rows.slice(0, 70), slugs: new Set(all.filter((p) => p.active).map((p) => p.slug)) };
}

// ------------------------------------------------------------------ hechos para la IA

const W = (F: Facts) => ({ desde: F.window.since, hasta: F.window.until, antes_desde: F.window.prevSince, antes_hasta: F.window.prevUntil, dias_transcurridos: Math.round(F.window.effDays * 10) / 10 });
const fFinding = (f: Finding) => ({
  id: f.id, area: f.area, severidad: f.severity === "info" ? "pocos_datos" : f.severity, titulo: f.title, metrica: f.metric, referencia: f.benchmark,
  muestra: f.sample, suficiente: f.enough, impacto_usd_semana: f.impactUsdWeek, detalle: f.detail, ...(f.good ? { positivo: true } : {}),
});
const r2 = (n: number) => Math.round(n * 100) / 100;
const stepsJson = (s: MarketFacts["cur"]) => ({
  landing: { cargas: s.landingVisits, personas: s.landingVisitors, cargas_que_tocaron_la_pantalla: s.touched, tocaron_el_boton: s.ctaVisits, clics_por_boton: s.ctaByIndex,
    segundos_mediana: s.medianSec != null ? Math.round(s.medianSec) : null, salidas_medidas: s.timeSamples, salidas_antes_de_10s: s.under10s },
  checkout: { personas: s.checkoutVisitors, de_la_landing: s.reachFromLanding, dejaron_mail: s.leads, intentos_de_pago: s.payAttempts, errores_de_pago: s.payErrors, errores: s.errorCodes },
  pedidos: s.orders, facturado_bruto_usd: r2(s.grossUsd), facturado_neto_usd: r2(s.netUsd), principal_usd: r2(s.mainUsd), bumps_usd: r2(s.bumpUsd), postpago_usd: r2(s.upsellUsd),
  ticket_usd: s.orders ? r2(s.grossUsd / s.orders) : null, pedidos_con_bump: s.bumpOrders, reembolsos: s.refunds, reembolsado_usd: r2(s.refundedUsd),
  por_dispositivo: s.byDevice, por_red: s.byNetwork,
  por_pais: Object.fromEntries(Object.entries(s.byCountry).sort((a, b) => b[1].visitors + b[1].orders * 10 - (a[1].visitors + a[1].orders * 10)).slice(0, 6)),
});
const adsJson = (a: { spend: number; impressions: number; linkClicks: number; purchases: number; lpv: number; ic: number }) => ({
  gasto_usd: r2(a.spend), compras_meta: Math.round(a.purchases), cpa_usd: a.purchases ? r2(a.spend / a.purchases) : null, impresiones: a.impressions, clics_enlace: a.linkClicks,
  ctr: a.impressions ? pc(a.linkClicks / a.impressions) : null, cpm_usd: a.impressions ? r2((a.spend / a.impressions) * 1000) : null, visitas_landing_meta: Math.round(a.lpv), inicios_de_pago_meta: Math.round(a.ic),
});

function marketJson(m: MarketFacts) {
  return {
    checkout: m.slug, mercado: m.market, moneda: m.currency, idioma: m.locale || null, landing: m.landingUrl, url_checkout: m.checkoutUrl,
    principal: m.main && { slug: m.main.slug, nombre: m.main.name, precio: m.main.price },
    bumps: m.bumps.map((b) => ({ slug: b.slug, nombre: b.name, precio: b.price })),
    postpago: m.chain ? {
      nombre: m.chain.name, niveles_que_ve_quien_rechaza_todo: m.chain.levels, otos: m.chain.otos, otos_con_downsell: m.chain.otosWithDs,
      pasos: m.chain.steps.map((s) => ({ paso: `${s.kind === "downsell" ? "Downsell" : "OTO"} ${s.level}`, slug: s.slug, nombre: s.name, precio: s.price, activo: s.active })),
    } : null,
    ventana_actual: stepsJson(m.cur), ventana_anterior: stepsJson(m.prev),
    postpago_por_nivel: { actual: m.levels.cur.map((l) => ({ paso: `${l.kind === "downsell" ? "Downsell" : "OTO"} ${l.level}`, lo_vieron: l.shown, aceptaron: l.accepted, tasa: l.shown ? pc(l.accepted / l.shown) : null })),
      anterior: m.levels.prev.map((l) => ({ paso: `${l.kind === "downsell" ? "Downsell" : "OTO"} ${l.level}`, lo_vieron: l.shown, aceptaron: l.accepted })) },
    grabaciones_landing_3_dias: m.landing && {
      visitas: m.landing.sessions, segundos_mediana: m.landing.medianSec, tocaron_imagen: pc(m.landing.imgClickShare), tocaron_boton: pc(m.landing.ctaShare),
      celular: m.landing.mobile && { visitas: m.landing.mobile.n, pantallas_de_alto: m.landing.mobile.screens, no_bajaron: pc(m.landing.mobile.noScroll), llegan_50: pc(m.landing.mobile.reached.p50), llegan_90: pc(m.landing.mobile.reached.p90),
        salidas_por_tramo_10: m.landing.mobile.exitByDecile.map((x) => pc(x)) },
      computadora: m.landing.desktop && { visitas: m.landing.desktop.n, pantallas_de_alto: m.landing.desktop.screens, no_bajaron: pc(m.landing.desktop.noScroll), llegan_50: pc(m.landing.desktop.reached.p50), llegan_90: pc(m.landing.desktop.reached.p90) },
    },
    anuncios: m.ads && { campañas: m.ads.campaignIds, cpa_objetivo_usd: m.ads.target, actual: adsJson(m.ads.cur), anterior: adsJson(m.ads.prev) },
    entregas: m.delivery,
  };
}

function campaignJson(c: CampaignFacts) {
  return {
    id: c.id, nombre: c.name, estado: c.status, presupuesto_diario_usd: c.budget != null ? r2(c.budget) : null, cpa_objetivo_usd: c.target, oferta_en_app: c.offerKey,
    actual: adsJson(c.cur), anterior: adsJson(c.prev),
    por_red: c.platforms.map((p) => ({ red: p.platform, gasto_usd: r2(p.spend), compras: Math.round(p.purchases), cpa_usd: p.purchases ? r2(p.spend / p.purchases) : null })),
    anuncios_activos: c.adsActive, anuncios_que_gastan_sin_vender: c.adsNoSale.slice(0, 5).map((a) => ({ id: a.id, nombre: a.name, gasto_usd: r2(a.spend) })),
    mejor_anuncio: c.bestAd && { id: c.bestAd.id, nombre: c.bestAd.name, compras: c.bestAd.purchases, cpa_usd: r2(c.bestAd.cpa) },
  };
}

// ------------------------------------------------------------------ control de lo que escribe

/** Los números «de verdad» de un JSON de hechos, en las formas en que se pueden escribir. */
function allowedNumbers(json: string) {
  const out = new Set<string>();
  for (const m of json.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (!Number.isFinite(n)) continue;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.floor(n), Math.ceil(n)]) out.add(String(Math.abs(v)));
    if (Math.abs(n) <= 1) for (const v of [Math.round(n * 100), Math.round(n * 1000) / 10]) out.add(String(Math.abs(v)));
  }
  return out;
}
/** Números del texto de la IA que no están en los hechos (ignora 0–10 sueltos: niveles, pasos, «3 libros»). */
function unverified(text: string, ok: Set<string>) {
  const bad = new Set<string>();
  const clean = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "").replace(/\b(OTO|Downsell|DS)\s*\d\b/gi, "");
  for (const m of clean.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const n = Number(/\.\d{3}/.test(raw) && !/,/.test(raw) ? raw.replace(/\./g, "") : raw.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (!Number.isFinite(n) || (Number.isInteger(n) && n <= 10)) continue;
    const forms = [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100].map(String);
    if (!forms.some((f) => ok.has(f))) bad.add(raw);
  }
  return [...bad];
}

const SEV_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2, info: 3 };
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ------------------------------------------------------------------ contexto que se pega con cada texto para Claude

const money = (n: number | null, cur: string) => (n == null ? "sin precio" : `${n.toFixed(2).replace(".", ",")} ${cur}`);
function windowLine(F: Facts) {
  return `últimos ${F.window.days} días (${fmtShort(F.window.since)} – ${fmtShort(F.window.until)}, hoy incluido) contra ${fmtShort(F.window.prevSince)} – ${fmtShort(F.window.prevUntil)}`;
}
/** La cadena de post-pago en una línea por nivel: el OTO y downsell que ve quien no tiene nada, y cuántas variantes hay según lo que ya compró. */
function chainLines(m: MarketFacts) {
  const steps = m.chain?.steps ?? [];
  if (!steps.length) return "sin post-pago";
  const levels = [...new Set(steps.map((s) => s.level))].sort((a, b) => a - b);
  return levels.map((lv) => {
    const otos = steps.filter((s) => s.level === lv && s.kind === "oto");
    const first = otos[0];
    const i = first ? steps.indexOf(first) : -1;
    const ds = i >= 0 && steps[i + 1]?.kind === "downsell" ? steps[i + 1] : null;
    const alt = otos.length - 1;
    return `OTO ${lv}: ${first ? `${first.slug} (${money(first.price, m.currency)})${first.active ? "" : " [archivado]"}` : "—"}${ds ? ` → downsell ${ds.slug} (${money(ds.price, m.currency)})` : ""}${alt > 0 ? ` [+${alt} variante${alt === 1 ? "" : "s"} según lo que ya tiene]` : ""}`;
  }).join(" · ");
}
export function marketContext(m: MarketFacts) {
  return [
    `• Checkout ${m.slug} (${m.market}, ${m.currency}${m.locale ? `, idioma ${m.locale}` : ""}): ${m.checkoutUrl}${m.landingUrl ? ` · landing ${m.landingUrl}` : ""}`,
    `• Principal: ${m.main ? `${m.main.slug} (${money(m.main.price, m.currency)})` : "—"} · bumps: ${m.bumps.length ? m.bumps.map((b) => `${b.slug} (${money(b.price, m.currency)})`).join(", ") : "ninguno"}`,
    `• Post-pago${m.chain?.name ? ` «${m.chain.name}»` : ""}: ${chainLines(m)}`,
    m.ads ? `• Campañas de Meta vinculadas: ${m.ads.campaignIds.join(", ")}${m.ads.target ? ` (CPA objetivo ${m.ads.target} USD)` : ""}` : null,
  ].filter(Boolean).join("\n");
}
function contextBlock(F: Facts, head: string, lines: string[], cited: Finding[], goal: string | null) {
  return [
    `— Contexto (lo calculó la app; ${windowLine(F)}) —`,
    head,
    ...lines,
    cited.length ? "• Números:" : null,
    ...cited.map((f) => `  – ${f.metric}${f.benchmark ? ` · referencia: ${f.benchmark}` : ""}${f.enough ? "" : " · OJO: pocos datos"}`),
    goal ? `• Objetivo: ${goal}` : null,
    "Reglas: hacelo con el MCP checkout o en el repo de la app. No toques campañas ni anuncios activos de Meta sin confirmarme. No hagas compras de prueba reales ni mandes mails a compradores. Mostrame el cambio antes de publicarlo y verificá que funciona.",
  ].filter((x): x is string => x != null).join("\n");
}

// ------------------------------------------------------------------ llamadas

type RawRec = { titulo: string; area: string; severidad: string; hallazgos: string[]; que_esta_flojo: string; por_que_importa: string; cambio: string; prompt_claude: string };
type RawIdea = { titulo: string; pasos: { paso: string; producto_slug: string; producto_nuevo: string; precio: number; por_que: string }[]; razonamiento: string; prompt_claude: string };

function toRec(F: Facts, raw: RawRec, pool: Finding[], ok: Set<string>, scope: { offerKey: string | null; storeSlug: string | null; head: string; lines: string[] }): DraftRec | null {
  if (!raw?.titulo || !raw.prompt_claude) return null;
  const cited = (raw.hallazgos ?? []).map((id) => pool.find((f) => f.id === id)).filter((f): f is Finding => !!f);
  const real = cited.filter((f) => f.enough && f.severity !== "info");
  // Sin un hallazgo con datos suficientes detrás no se recomienda nada (regla 2).
  if (!real.length) return null;
  // La gravedad y la plata salen de los hallazgos (calculados), no de la IA.
  const sev = real.reduce<Severity>((a, f) => (SEV_RANK[f.severity] < SEV_RANK[a] ? (f.severity as Severity) : a), "baja");
  const impact = real.reduce<number | null>((a, f) => (f.impactUsdWeek != null && (a == null || f.impactUsdWeek > a) ? f.impactUsdWeek : a), null);
  const area = (AREAS.includes(raw.area) ? raw.area : real[0].area) as Area;
  const goal = real.find((f) => f.goal)?.goal ?? null;
  const checks = unverified([raw.titulo, raw.que_esta_flojo, raw.por_que_importa, raw.cambio].join(" "), ok);
  return {
    kind: "mejora", offerKey: scope.offerKey, storeSlug: scope.storeSlug,
    fingerprint: `${scope.offerKey ?? "cuenta"}|${real[0].id}`, area, severity: sev, title: raw.titulo.trim(),
    weak: raw.que_esta_flojo?.trim() || null, why: raw.por_que_importa?.trim() || null, change: raw.cambio?.trim() || null,
    prompt: `${raw.prompt_claude.trim()}\n\n${contextBlock(F, scope.head, scope.lines, real, goal)}`,
    impactUsdWeek: impact, findings: real, checks,
  };
}

function toIdea(F: Facts, raw: RawIdea, m: MarketFacts, slugs: Set<string>, ok: Set<string>, head: string, lines: string[]): DraftRec | null {
  if (!raw?.titulo || !raw.pasos?.length) return null;
  const steps = raw.pasos.map((p) => {
    const exists = !!p.producto_slug && slugs.has(p.producto_slug);
    return {
      step: p.paso, productSlug: exists ? p.producto_slug : null,
      newProduct: exists ? null : (p.producto_nuevo?.trim() || (p.producto_slug ? `${p.producto_slug} (no existe en el catálogo)` : "producto nuevo a crear")),
      price: Number.isFinite(p.precio) ? Math.round(p.precio * 100) / 100 : null, currency: m.currency, why: p.por_que ?? "",
    };
  });
  const idea: PostIdea = { title: raw.titulo.trim(), steps, reasoning: raw.razonamiento?.trim() ?? "" };
  const chainText = steps.map((s) => `  – ${s.step}: ${s.productSlug ?? `PRODUCTO NUEVO A CREAR: ${s.newProduct}`} a ${money(s.price, m.currency)} — ${s.why}`).join("\n");
  return {
    kind: "postpago", offerKey: m.offerKey, storeSlug: m.storeSlug,
    fingerprint: `${m.offerKey}|postpago|${steps.map((s) => s.productSlug ?? slugify(s.newProduct ?? "")).join(",")}`,
    area: "postpago", severity: "baja", title: idea.title, weak: null, why: idea.reasoning || null, change: null,
    prompt: `${raw.prompt_claude.trim()}\n\nCadena propuesta (checkout ${m.slug}):\n${chainText}\n\n${contextBlock(F, head, lines, [], "subir el ticket promedio con post-pago sin bajar la conversión del checkout")}`,
    impactUsdWeek: null, findings: [], idea, checks: unverified([idea.reasoning, ...steps.map((s) => s.why)].join(" "), ok),
  };
}

/** Una llamada por oferta: recomendaciones (hasta 4) e ideas de post-pago (2–3). */
export async function adviseOffer(F: Facts, offerKey: string): Promise<DraftRec[]> {
  const ms = F.markets.filter((m) => m.offerKey === offerKey);
  if (!ms.length) return [];
  const pool = F.findings.filter((f) => f.offerKey === offerKey);
  const cats = await Promise.all(ms.map((m) => catalogFor(m)));
  const o = ms[0];
  const facts = {
    ventana: W(F),
    oferta: { nombre: o.offerName, clave: o.offerKey, tienda: o.storeSlug, mercados: ms.map(marketJson) },
    hallazgos: pool.map(fFinding),
    catalogo: Object.fromEntries(ms.map((m, i) => [m.slug, cats[i].rows])),
    no_se_puede_medir: F.notMeasurable,
  };
  const json = JSON.stringify(facts);
  const ok = allowedNumbers(json);
  const user = `HECHOS (JSON):\n${json}\n\nDevolvé hasta 4 recomendaciones para esta oferta (solo con hallazgos suficientes; si no hay ninguno, la lista vacía) y 2–3 ideas de post-pago para el comprador de esta oferta, con productos del catálogo del mercado (o «producto nuevo a crear»), precios en ${[...new Set(ms.map((m) => m.currency))].join("/")} y cada paso con su porqué. Si la oferta ya tiene post-pago, las ideas tienen que ser alternativas para probar contra la cadena actual, no la misma.`;
  const res = (await callJson(SYS, user, OFFER_SCHEMA)) as { recomendaciones?: RawRec[]; ideas_postpago?: RawIdea[] };
  const head = `• Oferta «${o.offerName}» · clave ${o.offerKey} · tienda ${o.storeSlug}`;
  const lines = ms.map(marketContext);
  const recs = (res.recomendaciones ?? []).map((r) => toRec(F, r, pool, ok, { offerKey, storeSlug: o.storeSlug, head, lines })).filter((x): x is DraftRec => !!x);
  const mainM = [...ms].sort((a, b) => b.cur.orders - a.cur.orders)[0];
  const slugs = new Set(cats.flatMap((c) => [...c.slugs]));
  const ideas = (res.ideas_postpago ?? []).slice(0, 3).map((r) => toIdea(F, r, mainM, slugs, ok, head, lines)).filter((x): x is DraftRec => !!x);
  return [...recs, ...ideas];
}

/** Una llamada global: el resumen y lo de la cuenta (campañas que no son de una oferta de la app, mails de las tiendas). */
export async function adviseGlobal(F: Facts, offerRecs: DraftRec[]): Promise<{ summary: string | null; recs: DraftRec[] }> {
  const pool = F.findings.filter((f) => f.offerKey == null);
  const top = F.findings.filter((f) => f.enough && f.severity !== "info").slice(0, 15);
  const camps = F.campaigns.filter((c) => !c.offerKey && c.cur.spend > 0).slice(0, 25);
  const tot = F.campaigns.reduce((a, c) => ({ spend: a.spend + c.cur.spend, purchases: a.purchases + c.cur.purchases, pspend: a.pspend + c.prev.spend, ppurchases: a.ppurchases + c.prev.purchases }), { spend: 0, purchases: 0, pspend: 0, ppurchases: 0 });
  const facts = {
    ventana: W(F),
    cuenta_de_anuncios: {
      actual: { gasto_usd: r2(tot.spend), compras_meta: Math.round(tot.purchases), cpa_usd: tot.purchases ? r2(tot.spend / tot.purchases) : null },
      anterior: { gasto_usd: r2(tot.pspend), compras_meta: Math.round(tot.ppurchases), cpa_usd: tot.ppurchases ? r2(tot.pspend / tot.ppurchases) : null },
      cpa_objetivo_usd: { europa: 10, eeuu: 15 },
      campañas_sin_oferta_en_app: camps.map(campaignJson),
    },
    ofertas_en_app: F.markets.map((m) => ({ oferta: m.offerName, mercado: m.market, pedidos: m.cur.orders, facturado_neto_usd: r2(m.cur.netUsd), gasto_meta_usd: m.ads ? r2(m.ads.cur.spend) : null })),
    tiendas: F.stores.map((s: StoreFacts) => ({ tienda: s.slug, mails_de_compradores: s.mailsIn, sin_responder_24h: s.unanswered, motivos: s.intents, contracargos: s.disputes })),
    hallazgos_de_la_cuenta: pool.map(fFinding),
    lo_mas_importante_de_todo: top.map((f) => ({ id: f.id, titulo: f.title, metrica: f.metric, impacto_usd_semana: f.impactUsdWeek })),
    ya_recomendado_por_oferta: offerRecs.filter((r) => r.kind === "mejora").map((r) => r.title),
  };
  const json = JSON.stringify(facts);
  const ok = allowedNumbers(json);
  const user = `HECHOS (JSON):\n${json}\n\nDevolvé: (1) "resumen": 2–4 frases para el dueño con cómo viene todo y lo más urgente (citá números de los hechos); (2) hasta 5 recomendaciones SOLO con los hallazgos de la cuenta ("hallazgos_de_la_cuenta": campañas que no son de una oferta de la app y mails de las tiendas). No repitas lo ya recomendado por oferta.`;
  const res = (await callJson(SYS, user, GLOBAL_SCHEMA)) as { resumen?: string; recomendaciones?: RawRec[] };
  const recs = (res.recomendaciones ?? []).map((r) => {
    const first = pool.find((f) => f.id === r.hallazgos?.[0]);
    const c = first?.campaignId ? F.campaigns.find((x) => x.id === first.campaignId) : null;
    const head = c ? `• Campaña de Meta «${c.name}» (id ${c.id})${c.target ? ` · CPA objetivo ${c.target} USD` : ""}${c.status ? ` · estado ${c.status}` : ""}` : first?.storeSlug ? `• Tienda ${first.storeSlug}` : "• Toda la cuenta";
    return toRec(F, r, pool, ok, { offerKey: null, storeSlug: first?.storeSlug ?? null, head, lines: [] });
  }).filter((x): x is DraftRec => !!x);
  return { summary: res.resumen?.trim() || null, recs };
}

/** Sin IA (sin clave o si falla): los hallazgos más fuertes como recomendaciones, con un texto para Claude armado a mano. */
export function fallbackRecs(F: Facts, offerKey: string | null, max = 4): DraftRec[] {
  const pool = F.findings.filter((f) => f.offerKey === offerKey && f.enough && f.severity !== "info" && !f.good).slice(0, max);
  const ms = offerKey ? F.markets.filter((m) => m.offerKey === offerKey) : [];
  return pool.map((f) => {
    const c = f.campaignId ? F.campaigns.find((x) => x.id === f.campaignId) : null;
    const head = ms[0] ? `• Oferta «${ms[0].offerName}» · clave ${ms[0].offerKey} · tienda ${ms[0].storeSlug}` : c ? `• Campaña de Meta «${c.name}» (id ${c.id})` : `• Tienda ${f.storeSlug ?? "—"}`;
    return {
      kind: "mejora" as const, offerKey, storeSlug: f.storeSlug, fingerprint: `${offerKey ?? "cuenta"}|${f.id}`, area: f.area, severity: f.severity as Severity,
      title: f.title.replace(/ · .*$/, ""), weak: `${f.metric}.`, why: f.benchmark ? `Referencia: ${f.benchmark}.` : null, change: null,
      prompt: `Revisá esto y proponeme el cambio concreto para mejorarlo (no lo publiques sin mostrármelo): ${f.title}. ${f.detail}\n\n${contextBlock(F, head, ms.map(marketContext), [f], f.goal ?? null)}`,
      impactUsdWeek: f.impactUsdWeek, findings: [f], checks: [],
    };
  });
}

