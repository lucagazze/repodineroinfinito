import { db } from "@/lib/db";
import type { AdminStore } from "./store";

/** «Configurá tu tienda» del Inicio: qué falta para vender y dónde se arregla. */

export type SetupStep = {
  key: string; title: string; sub: string; done: boolean; required?: boolean; optional?: boolean; href: string; cta: string;
};

/** Lo que Stripe mira al revisar la cuenta y lo que muestra el catálogo. */
export function businessMissing(s: AdminStore): string[] {
  const miss: string[] = [];
  if (!s.legal_name) miss.push("razón social");
  if (!s.legal_address) miss.push("dirección legal");
  if (!s.statement_descriptor) miss.push("nombre en el resumen de la tarjeta");
  if (!s.business.phone) miss.push("teléfono");
  if (!s.business.about) miss.push("quiénes somos");
  return miss;
}

export async function setupSteps(s: AdminStore, base: string): Promise<SetupStep[]> {
  const [{ count: products }, { data: stripe }, { count: pixels }] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("store_id", s.id).eq("active", true).eq("kind", "main"),
    db.from("store_stripe").select("livemode").eq("store_id", s.id).maybeSingle(),
    db.from("pixels").select("id", { count: "exact", head: true }).eq("store_id", s.id),
  ]);
  const missing = businessMissing(s);
  return [
    { key: "producto", title: "Producto cargado", sub: "Con su precio y el link de entrega.", done: !!products, required: true, href: `${base}/productos`, cta: "Ver" },
    { key: "stripe", title: "Stripe conectado", sub: "Hasta que lo conectes, el checkout de esta tienda no cobra en tu cuenta.", done: !!stripe, required: true, href: `${base}/configuracion/pagos`, cta: "Ver" },
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
