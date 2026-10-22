import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mask } from "@/lib/secrets";
import { publicBaseUrl } from "@/lib/stripe-connect";
import { siteUrl } from "@/lib/recovery";
import { invalidateEverything } from "@/lib/cache-bust";

/**
 * Piezas compartidas por las herramientas del MCP: registro con auditoría,
 * búsqueda de tienda/producto/checkout por slug con errores que le dicen a
 * Claude cómo corregir la llamada, fechas por zona horaria y montos.
 */

/** Error que se le muestra tal cual a Claude: tiene que decir cómo arreglar la llamada. */
export class UserError extends Error {}

export type ToolKind = "read" | "write" | "destructive";

type ToolDef<S extends z.ZodObject> = {
  title: string;
  description: string;
  input: S;
  kind: ToolKind;
  /** true = repetir la llamada con los mismos argumentos no cambia nada más. */
  idempotent?: boolean;
  /** true = toca sistemas externos (Stripe, Meta, mail, descargas). */
  external?: boolean;
  handler: (args: z.infer<S>, ctx: { tokenName: string | null }) => Promise<unknown>;
};

export function defineTool<S extends z.ZodObject>(server: McpServer, name: string, def: ToolDef<S>) {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: Record<string, unknown>,
    cb: (args: unknown, ctx: { http?: { authInfo?: { clientId?: string } } }) => Promise<unknown>
  ) => unknown;

  register(
    name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: {
        title: def.title,
        readOnlyHint: def.kind === "read",
        destructiveHint: def.kind === "destructive",
        idempotentHint: def.idempotent ?? def.kind === "read",
        openWorldHint: def.external ?? false,
      },
    },
    async (rawArgs, ctx) => {
      const tokenName = ctx?.http?.authInfo?.clientId ?? null;
      const args = rawArgs as z.infer<S>;
      try {
        const result = await def.handler(args, { tokenName });
        const text = toText(result);
        if (def.kind !== "read") {
          await audit(name, args, true, text, tokenName);
          // Lo que cambió tiene que verse ya en checkouts, catálogo y panel (están cacheados).
          await invalidateEverything().catch((e) => console.error("[mcp] cache:", e));
        }
        return { content: [{ type: "text", text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!(e instanceof UserError)) console.error(`[mcp] ${name}:`, e);
        if (def.kind !== "read") await audit(name, args, false, msg, tokenName);
        return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    }
  );
}

// JSON compacto: menos tokens para Claude, mismo contenido.
const toText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

// ------------------------------------------------------------------ auditoría

const SECRET_KEY = /(secret|token|password|passwd|api_?key|capi|webhook_secret|private)/i;

/** Copia de los argumentos con los secretos tapados (sk_live_…AbCd). */
export function redact(v: unknown, key = ""): unknown {
  if (typeof v === "string") return SECRET_KEY.test(key) && v ? mask(v) : v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  if (Array.isArray(v)) return v.map((x) => redact(x, key));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redact(x, k)]));
  }
  return v;
}

async function audit(tool: string, args: unknown, ok: boolean, summary: string, tokenName: string | null) {
  const { error } = await db.from("mcp_audit").insert({
    tool,
    args: redact(args ?? {}),
    ok,
    result_summary: summary.slice(0, 1500),
    token_name: tokenName,
  });
  if (error) console.error("[mcp_audit]", error.message);
}

// ---------------------------------------------------------------- búsquedas

/**
 * OJO: lista EXPLICITA. Una columna nueva que no se agregue aqui llega como
 * `undefined` sin un solo error, y el codigo que la lee toma su valor por
 * defecto en silencio. Paso dos veces con `gateway`: el diagnostico daba
 * "la tienda no puede cobrar" en una tienda que cobra perfectamente con Whop.
 */
export const STORE_FULL_COLS =
  "id,slug,name,display_name,domain,catalog_domain,support_email,default_locale,guarantee_days,timezone,email_from," +
  "gateway," +
  "legal_name,legal_address,statement_descriptor,logo_url,brand,business,thankyou,delivery_email,sales_webhook_url," +
  "meta_ad_account_id,meta_pixel_id,active,created_at,updated_at";

export type StoreRow = {
  id: string; slug: string; name: string; display_name: string | null; domain: string | null; catalog_domain: string | null;
  /** Pasarela con la que cobra la tienda: stripe | whop. */
  gateway?: "stripe" | "whop";
  support_email: string; default_locale: string; guarantee_days: number; timezone: string; email_from: string | null;
  legal_name: string | null; legal_address: string | null; statement_descriptor: string | null; logo_url: string | null;
  brand: Record<string, unknown>; business: Record<string, unknown>; thankyou: Record<string, unknown>;
  delivery_email: Record<string, unknown>; sales_webhook_url: string | null; meta_ad_account_id: string | null;
  meta_pixel_id: string | null; active: boolean; created_at: string; updated_at: string;
};

export async function allStores(): Promise<StoreRow[]> {
  const { data, error } = await db.from("stores").select(STORE_FULL_COLS).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StoreRow[];
}

export async function getStore(slug: string): Promise<StoreRow> {
  const { data, error } = await db.from("stores").select(STORE_FULL_COLS).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: all } = await db.from("stores").select("slug");
    throw new UserError(`Store "${slug}" not found. Valid store slugs: ${(all ?? []).map((s) => s.slug).join(", ") || "(none)"}. Use list_stores.`);
  }
  return data as unknown as StoreRow;
}

// OJO: lista explicita de columnas. Lo que no este aca llega como undefined y
// las herramientas de lectura informan null sobre un dato que SI esta guardado.
// Paso con `gateway` en las tiendas y con `variant_of` aca: upsert_product lo
// guardaba bien y la respuesta decia variant_of: null.
export const PRODUCT_COLS =
  "id,store_id,slug,name,short_name,description,kind,delivery_url,delivery_links,delivery_file,image_url,email_image_url,sort_order," +
  "variant_of,includes,presale,presale_days,postcompra_page,active,show_in_catalog,created_at,updated_at," +
  "product_prices(currency,amount,compare_at,display_value)";

export type PriceRow = { currency: string; amount: number | string | null; compare_at: number | string | null; display_value: number | string | null };
export type ProductRow = {
  id: string; store_id: string; slug: string; name: string; short_name: string; description: string; kind: string;
  delivery_url: string | null; delivery_links: { label: string; url: string }[] | null;
  /** Archivo propio en el bucket privado. Entrega tan valida como un link,
   *  y mas segura: se sirve con un enlace firmado de 10 minutos. */
  delivery_file: string | null;
  image_url: string | null;
  /** id (no slug) del producto base cuando este es una variante de precio. */
  variant_of: string | null;
  /** slugs de los productos que se entregan DENTRO de este (un pack). */
  includes: string[] | null;
  presale: boolean | null;
  presale_days: number | null;
  /** Una suscripcion se entrega como la edicion de cada semana, nunca con un archivo. */
  subscription?: boolean | null;
  /** Contenido de la pagina del OTO. upsert_product promete devolverla. */
  postcompra_page: Record<string, unknown> | null;
  email_image_url: string | null; sort_order: number; active: boolean; show_in_catalog: boolean;
  created_at: string; updated_at: string; product_prices: PriceRow[];
};

export async function storeProducts(storeId: string): Promise<ProductRow[]> {
  // De a 1000: Supabase corta en 1000 filas y la tienda ya tiene más productos.
  return fetchAll<ProductRow>((a, b) => db.from("products").select(PRODUCT_COLS).eq("store_id", storeId).order("kind").order("sort_order").order("id").range(a, b));
}

export async function getProduct(store: StoreRow, slug: string): Promise<ProductRow> {
  const { data, error } = await db.from("products").select(PRODUCT_COLS).eq("store_id", store.id).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const all = await storeProducts(store.id);
    throw new UserError(`Product "${slug}" not found in store "${store.slug}". Valid product slugs: ${all.map((p) => p.slug).join(", ") || "(none)"}.`);
  }
  return data as unknown as ProductRow;
}

/** Varios productos por slug, en el orden pedido. Error con todos los que faltan. */
export async function productsBySlugs(store: StoreRow, slugs: string[]): Promise<Map<string, ProductRow>> {
  const all = await storeProducts(store.id);
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const missing = [...new Set(slugs)].filter((s) => !bySlug.has(s));
  if (missing.length) {
    throw new UserError(
      `Unknown product slug(s) in store "${store.slug}": ${missing.join(", ")}. Valid: ${all.map((p) => p.slug).join(", ") || "(none)"}. Create them first with upsert_product.`
    );
  }
  return bySlug;
}

export type FunnelRow = {
  id: string; store_id: string; slug: string; name: string; active: boolean; main_product_id: string | null;
  pixel_ids: string[] | null; settings: Record<string, unknown> | null; sort_order: number; created_at: string; updated_at: string;
};
export const FUNNEL_COLS = "id,store_id,slug,name,active,main_product_id,pixel_ids,settings,sort_order,created_at,updated_at";

export async function getFunnelRow(store: StoreRow, slug: string): Promise<FunnelRow> {
  const { data, error } = await db.from("funnels").select(FUNNEL_COLS).eq("store_id", store.id).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: all } = await db.from("funnels").select("slug").eq("store_id", store.id);
    throw new UserError(`Checkout "${slug}" not found in store "${store.slug}". Valid checkout slugs: ${(all ?? []).map((f) => f.slug).join(", ") || "(none)"}. Use list_checkouts.`);
  }
  return data as unknown as FunnelRow;
}

/** Pedido por número (#1001), uuid, la referencia vieja de 8 caracteres (#ABCD1234) o PaymentIntent (pi_…). */
export async function findOrderId(ref: string): Promise<string> {
  const r = ref.trim().replace(/^#/, "");
  let q = db.from("orders").select("id");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r)) q = q.eq("id", r.toLowerCase());
  // El número de pedido (1001…): hasta 7 cifras; 8 caracteres es la referencia vieja.
  else if (/^\d{1,7}$/.test(r)) q = q.eq("number", Number(r));
  else if (/^[0-9a-f]{8}$/i.test(r)) {
    const p = r.toLowerCase();
    q = q.gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`);
  } else if (/^pi_[A-Za-z0-9]+$/.test(r)) q = q.eq("stripe_payment_intent", r);
  else throw new UserError(`"${ref}" is not an order id. Pass the order number (e.g. 1001), the order uuid, the old 8-character reference (e.g. ABCD1234) or the Stripe PaymentIntent id (pi_...).`);
  const { data, error } = await q.limit(2);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    // Un upsell tiene su propio PaymentIntent, guardado en el item.
    if (r.startsWith("pi_")) {
      const { data: it } = await db.from("order_items").select("order_id").eq("stripe_payment_intent", r).limit(1);
      if (it?.length) return it[0].order_id;
    }
    throw new UserError(`Order "${ref}" not found. Use list_orders to find it.`);
  }
  if (data.length > 1) throw new UserError(`Reference "${ref}" matches more than one order: pass the full uuid.`);
  return data[0].id;
}

// --------------------------------------------------------------------- URLs

export const appBaseUrl = () => publicBaseUrl() || siteUrl();

export function checkoutUrls(store: Pick<StoreRow, "slug" | "domain">, funnelSlug: string) {
  return {
    url: `${appBaseUrl()}/c/${store.slug}/${funnelSlug}`,
    custom_domain_url: store.domain ? `https://${store.domain}/${funnelSlug}` : null,
  };
}

// ---------------------------------------------------------------- números

export const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Trae todas las filas: Supabase corta en 1000 por consulta sin avisar. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

export function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ----------------------------------------------------------- fechas y zonas

export function assertTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new UserError(`Invalid timezone "${tz}". Use an IANA name like "Europe/Rome", "America/New_York" or "America/Argentina/Buenos_Aires".`);
  }
}

function tzOffsetMs(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second) - at.getTime();
}

/** Medianoche de una fecha local (YYYY-MM-DD) en una zona, como instante UTC. */
function localMidnight(ymd: string, tz: string) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(t), tz);
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}

/** Fecha local (YYYY-MM-DD) de un instante en una zona. */
export const localDate = (at: Date | string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, "Use YYYY-MM-DD (a day in the timezone) or a full ISO datetime like 2026-10-01T00:00:00Z");

/**
 * Rango [from, to) en UTC. Fechas sin hora = días completos en `tz`, `to`
 * inclusive. Sin fechas: los últimos `defaultDays` días contando hoy.
 */
export function parseRange(from: string | undefined, to: string | undefined, tz: string, defaultDays = 7) {
  const today = localDate(new Date(), tz);
  const toStart = (s: string) => (s.includes("T") ? new Date(s) : localMidnight(s, tz));
  const toEnd = (s: string) => (s.includes("T") ? new Date(s) : localMidnight(addDays(s, 1), tz));
  const end = to ? toEnd(to) : localMidnight(addDays(today, 1), tz);
  const start = from ? toStart(from) : localMidnight(addDays(to && !to.includes("T") ? to : today, -(defaultDays - 1)), tz);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new UserError("Invalid from/to date.");
  if (start >= end) throw new UserError(`"from" (${start.toISOString()}) must be before "to" (${end.toISOString()}).`);
  return { from: start, to: end, timezone: tz, label: `${localDate(start, tz)} → ${localDate(new Date(end.getTime() - 1), tz)} (${tz})` };
}

// -------------------------------------------------------------- validación

export const slugArg = (what: string) =>
  z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${what} slug: lowercase letters, digits and single hyphens (e.g. "kit-completo")`);

export const storeArg = z.string().min(1).describe("Store slug (see list_stores), e.g. \"mystore\".");

export const confirmArg = z
  .literal(true)
  .describe("Must be exactly true. Only set it after the user explicitly approved this destructive / money-moving action.");

export const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Hex color like #005bd1");

export const httpsUrl = z.string().max(1000).regex(/^https:\/\/[^\s]+$/, "Must be an https:// URL");

export function normalizeHost(raw: string) {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) {
    throw new UserError(`"${raw}" is not a valid domain. Pass a bare hostname like "checkout.mybrand.com" (no https://, no path).`);
  }
  return h;
}
