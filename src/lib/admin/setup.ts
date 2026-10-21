import { db } from "@/lib/db";
import type { AdminStore } from "./store";

/** «Configurá tu tienda» del Inicio: qué falta para vender y dónde se arregla. */

export type SetupStep = {
  key: string; title: string; sub: string; done: boolean; required?: boolean; optional?: boolean; href: string; cta: string;
};

/**
 * Lo que un procesador mira al revisar la cuenta y lo que muestra el catálogo.
 *
 * Con Whop el comerciante de registro es Whop: el teléfono de contacto que se
 * publica es el suyo, no el de la tienda, así que pedirlo acá marcaba como
 * incompleta una tienda que está completa. Con Stripe la tienda ES el
 * comerciante y sí hace falta.
 */
export function businessMissing(s: AdminStore): string[] {
  const miss: string[] = [];
  if (!s.legal_name) miss.push("razón social");
  if (!s.legal_address) miss.push("dirección legal");
  if (!s.statement_descriptor) miss.push("nombre en el resumen de la tarjeta");
  if ((s.gateway ?? "stripe") !== "whop" && !s.business.phone) miss.push("teléfono");
  if (!s.business.about) miss.push("quiénes somos");
  return miss;
}

export async function setupSteps(s: AdminStore, base: string): Promise<SetupStep[]> {
  const whop = (s.gateway ?? "stripe") === "whop";
  const [{ count: products }, { data: stripe }, { data: wh }, { count: pixels }] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("store_id", s.id).eq("active", true).eq("kind", "main"),
    db.from("store_stripe").select("livemode").eq("store_id", s.id).maybeSingle(),
    db.from("store_whop").select("company_id,webhook_secret_enc").eq("store_id", s.id).maybeSingle(),
    db.from("pixels").select("id", { count: "exact", head: true }).eq("store_id", s.id),
  ]);
  const missing = businessMissing(s);
  // El paso es «la tienda puede cobrar», no «Stripe». Preguntar siempre por
  // Stripe decia "el checkout de esta tienda no cobra en tu cuenta" sobre una
  // tienda que cobra con Whop y que ya tiene una venta real cobrada.
  const pasarela = whop
    ? { key: "pasarela", title: "Whop conectado",
        sub: wh?.webhook_secret_enc
          ? "La tienda cobra con Whop y el webhook está firmado."
          : "Falta el secreto de firma del webhook: sin él se cobra y no se entrega nada.",
        done: !!wh?.company_id && !!wh?.webhook_secret_enc, required: true,
        href: `${base}/configuracion/pagos`, cta: "Ver" }
    : { key: "pasarela", title: "Stripe conectado",
        sub: "Hasta que lo conectes, el checkout de esta tienda no cobra en tu cuenta.",
        done: !!stripe, required: true, href: `${base}/configuracion/pagos`, cta: "Ver" };
  return [
    { key: "producto", title: "Producto cargado", sub: "Con su precio y el link de entrega.", done: !!products, required: true, href: `${base}/productos`, cta: "Ver" },
    pasarela,
    { key: "dominio", title: "Dominio propio", sub: "pay.tutienda.com en vez de la dirección de la app.", done: !!s.domain, href: `${base}/configuracion/dominios`, cta: "Ver" },
    { key: "marca", title: "Marca (logo y colores)", sub: "Logo y colores del checkout.", done: !!s.logo_url, href: `${base}/configuracion/general`, cta: "Ver" },
    {
      key: "negocio", title: "Datos del negocio", sub: missing.length ? `Falta: ${missing.join(", ")}.` : "Lo que revisa Stripe y muestra el catálogo.",
      done: !missing.length, href: `${base}/configuracion/negocio`, cta: "Ver",
    },
    { key: "tracking", title: "Tracking de Meta", sub: "Pixel y API de Conversiones.", done: !!pixels, optional: true, href: `${base}/configuracion/tracking`, cta: "Ver" },
    { key: "remitente", title: "Remitente de los mails", sub: "Que la entrega salga desde tu dominio.", done: !!s.email_from, href: `${base}/configuracion/entrega`, cta: "Ver" },
  ];
}
