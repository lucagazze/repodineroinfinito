import { cache } from "react";
import { notFound } from "next/navigation";
import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { pixelNames } from "./pixel-names";

/**
 * La tienda tal como la ve el panel: todas las columnas, incluidas las que el
 * checkout no necesita (catálogo, webhooks, cuenta de anuncios).
 */

export type Brand = {
  primary?: string;
  payButton?: string;
  guaranteeImage?: string;
  /** JPG del logo para los mails: Outlook no muestra WebP. */
  logoEmail?: string;
  [k: string]: unknown;
};

export type Business = {
  tagline?: string; about?: string; audience?: string; phone?: string; reply_hours?: string;
  languages?: string[]; catalog_enabled?: boolean;
};

/**
 * Un bloque de «y ahora qué» bajo las descargas de la página de gracias.
 *
 * Es por tienda y no esta cableado en el componente a proposito: la pagina de
 * gracias la comparten todas las tiendas, y un bloque de Finance apareciendo
 * en una compra de Physics seria peor que no tener bloque.
 */
export type ThankyouNext = {
  kicker?: string;      // la linea chica de arriba
  title: string;        // el titular del bloque
  body?: string;        // el cuerpo; respeta los saltos de linea
  bullets?: string[];   // lista corta, opcional
  note?: string;        // la letra chica: la promesa, la condicion
  link?: { label: string; url: string };
};

export type Thankyou = {
  title?: string; message?: string; showSummary?: boolean; showSpam?: boolean;
  next?: ThankyouNext[];
};
export type DeliveryEmail = { subject?: string; welcome?: string; closing?: string; color?: string; headerImage?: string };

export type AdminStore = {
  id: string; slug: string; name: string; display_name: string | null; domain: string | null; catalog_domain: string | null;
  support_email: string; default_locale: string; guarantee_days: number; timezone: string; active: boolean;
  logo_url: string | null; email_from: string | null; legal_name: string | null; legal_address: string | null;
  statement_descriptor: string | null; meta_pixel_id: string | null; meta_ad_account_id: string | null; sales_webhook_url: string | null;
  /** "stripe" | "whop": con que cobra la tienda. Lo lee select("*"), pero
   *  sin declararlo aca el panel lo ve como undefined y asume Stripe. */
  gateway: string | null;
  brand: Brand; business: Business; thankyou: Thankyou; delivery_email: DeliveryEmail; created_at: string;
};

/*
 * Caché. Cada página del panel lee la tienda (layout, página, pestañas) y la
 * lista de tiendas (menú): son datos que cambian poco y cada ida a Supabase
 * suma latencia. Se guardan con etiquetas y se invalidan al guardar desde el
 * panel (revalidateStore). Lo que se edite por fuera (MCP, scripts) se ve a
 * lo sumo 10 s tarde, o al instante si quien edita llama a revalidateStore.
 */
export const STORES_TAG = "stores";
export const storeTag = (slug: string) => `store:${slug}`;
export const pixelsTag = (storeId: string) => `pixels:${storeId}`;

/** Llamar después de cambiar una tienda: refresca el panel en el próximo render. */
export function revalidateStore(slug: string) {
  revalidateTag(storeTag(slug));
  revalidateTag(STORES_TAG);
}

async function readStore(slug: string) {
  const { data, error } = await db.from("stores").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`stores: ${error.message}`);
  return data as AdminStore | null;
}

const normalize = (s: AdminStore): AdminStore => ({
  ...s,
  timezone: s.timezone || DEFAULT_TZ,
  brand: s.brand ?? {}, business: s.business ?? {}, thankyou: s.thankyou ?? {}, delivery_email: s.delivery_email ?? {},
});

/** La tienda de la URL del panel, o 404. Una sola lectura por request aunque la pidan layout y página. */
export const adminStore = cache(async (slug: string): Promise<AdminStore> => {
  const s = await unstable_cache(() => readStore(slug), ["admin-store", slug], { tags: [storeTag(slug), STORES_TAG], revalidate: 10 })();
  if (!s) notFound();
  return normalize(s);
});

/** Sin caché: para las server actions, que mezclan lo guardado con lo nuevo y no pueden partir de algo viejo. */
export async function freshStore(slug: string): Promise<AdminStore> {
  const s = await readStore(slug);
  if (!s) throw new Error("No existe esa tienda");
  return normalize(s);
}

export type StoreListItem = { id: string; slug: string; name: string; display_name: string | null; domain: string | null; active: boolean };

/** Para el menú y el selector de tiendas. */
export const storeList = cache(() =>
  unstable_cache(
    async () => {
      const { data, error } = await db.from("stores").select("id,slug,name,display_name,domain,active").order("name");
      if (error) throw new Error(`stores: ${error.message}`);
      return (data ?? []) as StoreListItem[];
    },
    ["admin-stores"],
    { tags: [STORES_TAG], revalidate: 10 },
  )()
);

export type PixelItem = { id: string; pixel_id: string; name: string; has_token: boolean; test_event_code: string | null; all_funnels: boolean };

/** Pixels de la tienda, sin el token (nunca sale del servidor). */
export const pixelList = (storeId: string) =>
  unstable_cache(
    async () => {
      const { data, error } = await db.from("pixels").select("id,pixel_id,name,capi_token_enc,test_event_code,all_funnels,created_at")
        .eq("store_id", storeId).order("created_at");
      if (error) throw new Error(`pixels: ${error.message}`);
      // Los que no tienen nombre: se lo pide a Meta (y queda guardado) para mostrar el nombre primero.
      const unnamed = (data ?? []).filter((p) => !p.name?.trim()).map((p) => p.pixel_id as string);
      const names = unnamed.length ? await pixelNames(unnamed) : {};
      return (data ?? []).map((p) => ({
        id: p.id, pixel_id: p.pixel_id, name: p.name?.trim() || names[p.pixel_id] || null, has_token: !!p.capi_token_enc, test_event_code: p.test_event_code, all_funnels: p.all_funnels,
      })) as PixelItem[];
    },
    ["admin-pixels", storeId],
    { tags: [pixelsTag(storeId)], revalidate: 10 },
  )();

export const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

export const LANG_LABEL: Record<string, string> = { it: "Italiano", en: "Inglés", es: "Español", "pt-BR": "Portugués (Brasil)", fr: "Francés", de: "Alemán" };

/** Idiomas del contenido para el catálogo: se guardan con su nombre, listos para mostrar. */
export const CONTENT_LANGUAGES = ["English", "Italiano", "Español", "Português", "Français", "Deutsch"];

/** Las mismas ciudades que ofrece Winnerfy, con su zona IANA. */
export const TIMEZONES: [string, string][] = [
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["America/Montevideo", "Montevideo"],
  ["America/Santiago", "Santiago de Chile"],
  ["America/Asuncion", "Asunción"],
  ["America/Sao_Paulo", "São Paulo, Brasilia"],
  ["America/La_Paz", "La Paz"],
  ["America/Lima", "Lima"],
  ["America/Bogota", "Bogotá"],
  ["America/Guayaquil", "Quito, Guayaquil"],
  ["America/Caracas", "Caracas"],
  ["America/Panama", "Panamá"],
  ["America/Costa_Rica", "San José de Costa Rica"],
  ["America/Guatemala", "Ciudad de Guatemala"],
  ["America/Santo_Domingo", "Santo Domingo"],
  ["America/Havana", "La Habana"],
  ["America/Mexico_City", "Ciudad de México"],
  ["America/Tijuana", "Tijuana"],
  ["America/New_York", "Nueva York, Miami, Toronto"],
  ["America/Chicago", "Chicago, Houston"],
  ["America/Denver", "Denver"],
  ["America/Phoenix", "Phoenix"],
  ["America/Los_Angeles", "Los Ángeles, Vancouver"],
  ["Europe/Madrid", "Madrid, Barcelona"],
  ["Europe/Lisbon", "Lisboa"],
  ["Europe/London", "Londres, Dublín"],
  ["Europe/Paris", "París, Ámsterdam, Bruselas"],
  ["Europe/Rome", "Roma, Milán, Berlín"],
  ["Europe/Athens", "Atenas, Bucarest"],
  ["Europe/Moscow", "Moscú"],
  ["Africa/Casablanca", "Casablanca"],
  ["Africa/Lagos", "Lagos"],
  ["Africa/Johannesburg", "Johannesburgo"],
  ["Africa/Nairobi", "Nairobi"],
  ["Asia/Jerusalem", "Tel Aviv"],
  ["Asia/Dubai", "Dubái"],
  ["Asia/Karachi", "Karachi"],
  ["Asia/Kolkata", "Delhi, Bombay"],
  ["Asia/Bangkok", "Bangkok, Yakarta"],
  ["Asia/Ho_Chi_Minh", "Ciudad Ho Chi Minh, Hanói"],
  ["Asia/Singapore", "Singapur, Kuala Lumpur"],
  ["Asia/Shanghai", "Shanghái, Pekín, Hong Kong"],
  ["Asia/Manila", "Manila"],
  ["Asia/Seoul", "Seúl"],
  ["Asia/Tokyo", "Tokio"],
  ["Australia/Sydney", "Sídney, Melbourne"],
  ["Pacific/Auckland", "Auckland"],
  ["UTC", "Hora universal"],
];

/** "Buenos Aires (GMT-3)": el desfase de hoy, así respeta el horario de verano. */
export function tzOptions(): [string, string][] {
  return TIMEZONES.map(([id, label]) => {
    let off = "";
    try {
      off = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "shortOffset" })
        .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    } catch { /* zona desconocida para este Node: va sin desfase */ }
    return [id, off ? `${label} (${off.replace("GMT", "UTC").replace("-", "−")})` : label];
  });
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** "https://Pay.Tienda.com/x" → "pay.tienda.com". Vacío = null. */
export function cleanHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  return h || null;
}
export const isHost = (h: string) => /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h);
