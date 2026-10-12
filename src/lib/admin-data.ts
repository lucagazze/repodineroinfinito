import { notFound } from "next/navigation";
import { db, type Store } from "./db";
import { PANEL_TZ } from "./admin/range";

/** La tienda de la URL del panel, o 404. */
export async function storeBySlug(slug: string) {
  const { data } = await db
    .from("stores")
    .select("id,slug,name,domain,support_email,default_locale,guarantee_days,meta_pixel_id,brand,active,created_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) notFound();
  return data as Store & { active: boolean; created_at: string };
}

export const fmtDate = (iso: string, withTime = true) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : { year: "numeric" }),
    timeZone: PANEL_TZ,
  });

export const money = (amount: number | string | null, currency: string | null) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: (currency ?? "USD").toUpperCase(), minimumFractionDigits: 2 }).format(Number(amount ?? 0));

export const COUNTRY_NAMES: Record<string, string> = {
  IT: "Italia", ES: "España", AR: "Argentina", US: "Estados Unidos", GB: "Reino Unido", MX: "México", BR: "Brasil",
  FR: "Francia", DE: "Alemania", PT: "Portugal", CH: "Suiza", CL: "Chile", CO: "Colombia", PE: "Perú", UY: "Uruguay",
  CA: "Canadá", AU: "Australia", NL: "Países Bajos", BE: "Bélgica", PL: "Polonia", SM: "San Marino",
};
export const countryName = (cc: string | null) => (cc ? COUNTRY_NAMES[cc] ?? cc : "—");
export const flag = (cc: string | null) =>
  cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐";

/** Categorías de producto (migración 008): principal, upsell dentro del checkout, post compra (1 clic después de pagar) y bono. */
export const KIND_LABEL: Record<string, string> = { main: "Principal", upsell: "Upsell", postcompra: "Post-pago", bonus: "Bono" };
export const KIND_ORDER: [string, string][] = [["main", "Principales"], ["upsell", "Upsells"], ["postcompra", "Post-pago"], ["bonus", "Bonos"]];

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
