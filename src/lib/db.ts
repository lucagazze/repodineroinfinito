import { createClient } from "@supabase/supabase-js";

/**
 * Acceso a datos. Siempre desde el servidor con la secret key: las tablas
 * tienen RLS sin políticas, así que nada de esto es alcanzable desde el
 * navegador aunque se filtre una URL.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY");

export const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    // Next memoiza los GET idénticos dentro de un mismo render. Si buscamos
    // un pedido, lo creamos y lo buscamos de nuevo, la segunda consulta
    // devolvía la respuesta vacía de la primera. Una señal propia por
    // request saca a supabase-js de esa memoización.
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        cache: "no-store",
        signal: init?.signal ?? new AbortController().signal,
      }),
  },
});

// ------------------------------------------------------------------ tipos

export type Price = {
  currency: string;
  amount: number | null;
  compare_at: number | null;
  display_value: number | null;
  /** Solo lo tienen los que se sincronizaron a Stripe (bumps y upsells). */
  stripe_price_id?: string | null;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  description: string;
  /** main = Principal · upsell = se suma en el checkout · postcompra = 1 clic después de pagar · bonus = Bono */
  kind: "main" | "bonus" | "upsell" | "postcompra";
  delivery_url: string | null;
  /** Archivo propio en Storage (bucket «entregas»): baja directo por /d/{pedido}/{producto}. */
  delivery_file?: string | null;
  delivery_file_name?: string | null;
  /** Links extra de entrega (además de delivery_url): [{label,url}]. */
  delivery_links?: { label: string; url: string }[] | null;
  /** Pack: los productos que se entregan dentro (tener el pack cuenta como tener cada uno). */
  includes?: string[] | null;
  /** Variante de precio de otro producto (mismo libro/pack): tenerla = tener el base. */
  variant_of?: string | null;
  /** Cuántos libros trae (null = 1, o los productos que incluye). */
  book_count?: number | null;
  /** «Toda la biblioteca»: se ofrece aunque ya tenga algunos de sus libros (no si los tiene todos). */
  is_library?: boolean | null;
  /** Preventa: se vende antes de que exista el contenido; llega en `presale_days` días (055). */
  presale?: boolean | null;
  presale_days?: number | null;
  /** Suscripcion: no se baja, llega cada semana por mail mientras este al dia. */
  subscription?: boolean | null;
  image_url: string | null;
  /** JPG liviano para email: Outlook no muestra WebP. */
  email_image_url: string | null;
  sort_order: number;
  product_prices: Price[];
};

export type Store = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  support_email: string;
  default_locale: string;
  guarantee_days: number;
  meta_pixel_id: string | null;
  brand: Record<string, unknown>;
  display_name?: string | null;
  logo_url?: string | null;
  /** Configuración de medios de pago de Stripe (la de la plataforma anterior). */
  stripe_pmc?: string | null;
  /** Pasarela con la que cobra: stripe | whop. El checkout monta una sola. */
  gateway?: "stripe" | "whop";
  timezone?: string;
  email_from?: string | null;
  legal_name?: string | null;
  legal_address?: string | null;
  statement_descriptor?: string | null;
  thankyou?: Record<string, unknown>;
  delivery_email?: Record<string, unknown>;
};

/** Columnas de la tienda que necesitan el checkout, la entrega y los mails. */
export const STORE_COLS =
  "id,slug,name,domain,support_email,default_locale,guarantee_days,meta_pixel_id,brand," +
  "display_name,logo_url,timezone,email_from,legal_name,legal_address,statement_descriptor,thankyou,delivery_email,stripe_pmc," +
  // Sin esta columna acá el checkout leería gateway como undefined y cobraría
  // siempre con Stripe, sin un solo error: la lista de columnas es explícita.
  "gateway";

/** Nombre legal y descriptor: los de la tienda, o los del entorno como respaldo. */
export function legalOf(s: Store) {
  return {
    name: s.legal_name || process.env.LEGAL_NAME || "Mi Empresa LLC",
    address: s.legal_address || process.env.LEGAL_ADDRESS || "",
    statement: s.statement_descriptor || process.env.STATEMENT_NAME || "MI EMPRESA",
  };
}

export type FunnelItem = {
  /** bump = order bump dentro del checkout; upsell = 1-click después de pagar */
  role: "included" | "bonus" | "upsell" | "bump";
  sort_order: number;
  products: Product;
};

export type Funnel = {
  id: string;
  slug: string;
  name: string;
  main_product_id: string | null;
  /** Pixels propios de esta oferta (además de los de la tienda marcados para todos). */
  pixel_ids?: string[];
  settings?: Record<string, unknown>;
  stores: Store;
  funnel_items: FunnelItem[];
};

const PRODUCT_COLS =
  "id,slug,name,short_name,description,kind,delivery_url,delivery_file,delivery_file_name,delivery_links,includes,variant_of,book_count,is_library,presale,presale_days,subscription,image_url,email_image_url,sort_order," +
  "product_prices(currency,amount,compare_at,display_value,stripe_price_id)";

// --------------------------------------------------------------- consultas

/**
 * Embudo completo con tienda, items y precios, en una sola ida a la base.
 * `anyState`: también los pausados. La entrega lo usa así: si se pausó un
 * checkout después de que alguien pagó, igual hay que entregarle.
 */
export async function getFunnel(
  storeSlug: string,
  funnelSlug: string,
  opts: { anyState?: boolean } = {}
): Promise<Funnel | null> {
  let q = db
    .from("funnels")
    .select(
      `id,slug,name,main_product_id,pixel_ids,settings,
       stores!inner(${STORE_COLS}),
       funnel_items(role,sort_order,products(${PRODUCT_COLS}))`
    )
    .eq("slug", funnelSlug)
    .eq("stores.slug", storeSlug);
  // Checkout pausado o tienda pausada: no se vende (la entrega sí, con anyState).
  if (!opts.anyState) q = q.eq("active", true).eq("stores.active", true);
  const { data, error } = await q.maybeSingle();

  if (error) throw new Error(`getFunnel: ${error.message}`);
  return (data as unknown as Funnel) ?? null;
}

export async function getProductById(id: string): Promise<Product | null> {
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProductById: ${error.message}`);
  return (data as unknown as Product) ?? null;
}

/**
 * Moneda de cobro según el país del comprador.
 * Si el país no está en ningún mercado, devuelve null y el checkout usa la
 * moneda base con Adaptive Pricing de Stripe.
 */
export async function currencyForCountry(
  storeId: string,
  country?: string | null
): Promise<string | null> {
  if (!country) return null;
  const { data, error } = await db
    .from("markets")
    .select("currency,countries")
    .eq("store_id", storeId);
  if (error) throw new Error(`currencyForCountry: ${error.message}`);
  const cc = country.toUpperCase();
  const hit = (data ?? []).find((m) => (m.countries ?? []).includes(cc));
  return hit?.currency ?? null;
}

export const roleOrder = { included: 0, bonus: 1, bump: 2, upsell: 3 } as const;

/** Items del embudo por rol, ya ordenados. */
export function itemsByRole(f: Funnel, role: FunnelItem["role"]): Product[] {
  return f.funnel_items
    .filter((i) => i.role === role && i.products)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => i.products);
}
