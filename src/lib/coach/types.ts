/**
 * Tipos de «Mejoras» (el coach de IA). Sin imports de servidor: los usan la
 * capa de datos, la IA, las rutas y los componentes del panel.
 *
 *  Hallazgo (Finding)  lo que calcula Panel, sin IA: un número contra una
 *                      referencia, con su muestra y su plata estimada.
 *  Recomendación (Rec) lo que escribe la IA a partir de los hallazgos: qué está
 *                      flojo, por qué importa, el cambio y el texto para Claude.
 */

export type Area = "ads" | "landing" | "checkout" | "postpago" | "postventa" | "tracking" | "oferta";
export type Severity = "alta" | "media" | "baja";
export type RecStatus = "nueva" | "hecha" | "descartada";

export const AREA_LABEL: Record<Area, string> = {
  ads: "Anuncios", landing: "Landing", checkout: "Checkout", postpago: "Post-pago",
  postventa: "Post-venta", tracking: "Medición", oferta: "Oferta",
};
export const SEVERITY_LABEL: Record<Severity, string> = { alta: "Alta", media: "Media", baja: "Baja" };

export type Finding = {
  /** Estable entre corridas (sirve para no volver a mostrar lo descartado): «ads.cpa.120252…». */
  id: string;
  area: Area;
  /** «pocos datos» = la muestra no alcanza: se informa, no se recomienda nada con eso. */
  severity: Severity | "info";
  /** tienda~oferta; null = toda la cuenta (anuncios sin oferta en la app, mails de la tienda…). */
  offerKey: string | null;
  storeSlug: string | null;
  /** Checkout (mercado) o campaña a la que se refiere, si es uno solo. */
  funnelSlug?: string | null;
  campaignId?: string | null;
  title: string;
  /** El número: «OTO 1: 8 % (3 de 37)». */
  metric: string;
  /** La referencia y por qué: «15–30 % (típico en infoproductos de 20–30 USD)». */
  benchmark: string | null;
  /** El denominador del número (visitas, pedidos, compras de Meta…). */
  sample: number;
  enough: boolean;
  /** Plata por semana que se pierde (o se podría ganar), en USD, si se puede calcular. */
  impactUsdWeek: number | null;
  /** Cómo se calculó la plata, en una frase. */
  impactHow?: string | null;
  detail: string;
  /** Positivo (algo que anda muy bien y se puede escalar). */
  good?: boolean;
  /** El objetivo medible para el texto de Claude: «Abren el checkout: llegar a 15% o más». */
  goal?: string | null;
};

export type PostIdeaStep = { step: string; productSlug: string | null; newProduct: string | null; price: number | null; currency: string; why: string };
export type PostIdea = { title: string; steps: PostIdeaStep[]; reasoning: string };

export type Rec = {
  id: string;
  run_id: string;
  created_at: string;
  kind: "mejora" | "postpago";
  offer_key: string | null;
  store_slug: string | null;
  fingerprint: string;
  area: Area;
  severity: Severity;
  title: string;
  weak: string | null;
  why: string | null;
  change: string | null;
  prompt: string;
  impact_usd_week: number | null;
  /** Hallazgos citados (con sus números) y, en las ideas de post-pago, la cadena propuesta. */
  evidence: { findings?: Pick<Finding, "id" | "title" | "metric" | "benchmark" | "sample" | "enough" | "impactUsdWeek" | "impactHow">[]; idea?: PostIdea } | null;
  /** Números del texto de la IA que no aparecen en los datos (para revisar). */
  checks: string[] | null;
  sort: number;
  status: RecStatus;
  status_at: string | null;
};

export type RunRow = {
  id: string; created_at: string; finished_at: string | null; status: "running" | "ok" | "error"; trigger: string;
  since: string; until: string; prev_since: string; prev_until: string;
  summary: string | null; model: string | null; ai_calls: number; error: string | null; ms: number | null;
};

/** Lo que guarda cada corrida en coach_runs.facts (sin la IA): para la página y para auditar. */
export type RunFacts = {
  window: { since: string; until: string; prevSince: string; prevUntil: string; days: number };
  findings: Finding[];
  /** Lo que no se puede medir con lo que se registra hoy (se dice, no se inventa). */
  notMeasurable: string[];
  offers: { key: string; name: string; alias: string; storeSlug: string; active: boolean; analyzed: boolean; why?: string }[];
  /** Errores parciales (Meta, grabaciones, diagnóstico): la corrida sigue igual. */
  errors: string[];
};
