import { db } from "@/lib/db";
import { stripeHealth } from "@/lib/stripe-connect";
import { mailProvider } from "@/lib/email";
import { freshStore } from "./store";
import { businessMissing } from "./setup";
import { liveChecks } from "./diag-live";
import { uptimeChecks } from "@/lib/uptime";
import { offerAuditChecks } from "./offer-audit";

/**
 * Diagnóstico de tienda: todo lo que puede hacer que una venta no se cobre,
 * no se entregue o no se mida, en una lista con el link para arreglarlo.
 */

export type DiagStatus = "ok" | "warn" | "bad";
export type DiagCheck = {
  id: string; status: DiagStatus; title: string; detail?: string; href?: string; fix?: string;
  /** Un botón para probar algo en el momento (p. ej. mandar un evento de prueba al pixel). */
  action?: { kind: "pixel-test"; pixelId: string; url: string };
};

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `base`: la sección del panel desde donde se abre (la oferta), para los links de «Ver». */
export async function runDiagnostics(slug: string, base: string): Promise<{ store: string; checks: DiagCheck[] }> {
  const s = await freshStore(slug);
  const cfg = `${base}/configuracion`;
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const tenMin = new Date(Date.now() - 10 * 60_000).toISOString();

  const [live, offerRows, health, products, undelivered, evErrors, disputes, pixels, { data: smtpBox }] = await Promise.all([
    // Lo que se prueba en el momento: mail, pixels, páginas, Apple Pay y links de entrega.
    liveChecks(s.id, base),
    // Cada oferta activa: botón de la landing, precio, bumps, post-pago, downsells, recuperación y grabación.
    offerAuditChecks(s.id).catch((e) => [{ id: "oa-x", status: "warn" as const, title: "No se pudieron revisar las ofertas", detail: (e as Error).message }]),
    stripeHealth(s.id),
    db.from("products").select("name,delivery_url,delivery_links,delivery_file").eq("store_id", s.id).eq("active", true).in("kind", ["main", "upsell"]),
    db.from("orders").select("id,email,delivery_error,created_at", { count: "exact" }).eq("store_id", s.id).eq("status", "paid")
      .is("delivered_at", null).lt("created_at", tenMin).order("created_at", { ascending: false }).limit(3),
    db.from("stripe_events").select("type,error,received_at", { count: "exact" }).eq("store_id", s.id).not("error", "is", null)
      .is("processed_at", null).gte("received_at", since7).order("received_at", { ascending: false }).limit(1),
    db.from("stripe_events").select("id", { count: "exact", head: true }).eq("store_id", s.id)
      .eq("type", "charge.dispute.created").gte("received_at", since30),
    db.from("pixels").select("pixel_id,name,capi_token_enc").eq("store_id", s.id),
    db.from("store_mail").select("username").eq("store_id", s.id).maybeSingle(),
  ]);

  const checks: DiagCheck[] = [];

  // ---- Pasarela
  // Con Whop no se revisa Stripe. Decir "Stripe sin conectar: esta tienda cobra
  // con la llave general del servidor" sobre una tienda que cobra con Whop, y
  // que tiene una venta real cobrada y entregada, es una alarma falsa en rojo
  // sobre lo unico que no hay que dudar: si la tienda cobra.
  const whop = (s.gateway ?? "stripe") === "whop";
  if (whop) {
    const { data: w } = await db.from("store_whop")
      .select("company_id,webhook_secret_enc,last_event_at").eq("store_id", s.id).maybeSingle();
    checks.push(
      !w?.company_id
        ? { id: "pasarela", status: "bad", title: "Whop sin conectar",
            detail: "El checkout de esta tienda no puede cobrar.", href: `${cfg}/pagos`, fix: "Ver" }
        : !w.webhook_secret_enc
          ? { id: "pasarela", status: "bad", title: "El webhook de Whop no tiene secreto de firma",
              detail: "Se cobra y no se entrega nada: hay que rehacerlo guardando su ws_.", href: `${cfg}/pagos`, fix: "Ver" }
          : { id: "pasarela", status: "ok", title: "Whop conectado y con el webhook firmado",
              detail: w.last_event_at ? `Último evento recibido: ${w.last_event_at}` : w.company_id });
  } else if (!health.connected) {
    checks.push({ id: "stripe", status: "bad", title: "Stripe sin conectar",
      detail: "Esta tienda cobra con la llave general del servidor, no con su propia cuenta.", href: `${cfg}/pagos`, fix: "Ver" });
  } else if (health.error) {
    checks.push({ id: "stripe", status: "bad", title: "Stripe no responde con la llave guardada", detail: health.error, href: `${cfg}/pagos`, fix: "Ver" });
  } else {
    checks.push(health.livemode
      ? { id: "stripe", status: "ok", title: "Stripe conectado y en modo real", detail: health.accountName ?? health.accountId }
      : { id: "stripe", status: "warn", title: "Stripe conectado en modo prueba", detail: "Con llaves de test nadie puede pagar de verdad.", href: `${cfg}/pagos`, fix: "Ver" });
    checks.push(health.chargesEnabled
      ? { id: "charges", status: "ok", title: "Cobros habilitados en Stripe" }
      : { id: "charges", status: "bad", title: "Stripe todavía no habilitó los cobros", detail: "Completá la verificación de la cuenta en el dashboard de Stripe." });
    const hookOk = health.webhookOk && health.webhookUrlOk;
    const last = health.lastEventAt;
    const stale = last && Date.now() - new Date(last).getTime() > 7 * 864e5;
    checks.push({
      id: "webhook",
      status: !hookOk ? "bad" : !last || stale ? "warn" : "ok",
      title: !hookOk ? "El webhook de Stripe no está activo o apunta a otro lado" : "Webhook de Stripe activo",
      detail: !hookOk
        ? "Sin webhook los pedidos no se entregan solos. Conectá Stripe de nuevo para recrearlo."
        : last ? `Último evento recibido ${ago(last)}.${stale ? " Hace más de 7 días que no llega nada." : ""}` : "Todavía no llegó ninguno.",
      href: hookOk ? undefined : `${cfg}/pagos`, fix: "Ver",
    });
  }

  // ---- Mails
  const provider = mailProvider();
  const api = provider ? (provider === "postmark" ? "Postmark" : "Brevo") : null;
  checks.push(smtpBox?.username
    ? { id: "mail", status: "ok", title: `Los mails salen por SMTP (${smtpBox.username})`, detail: api ? `${api} queda de respaldo si la casilla falla.` : "Sin respaldo: si la casilla falla, el mail no sale." }
    : provider
      ? { id: "mail", status: "warn", title: `Los mails salen por ${api}`, detail: "La tienda no tiene casilla propia (SMTP del proveedor): pedile a Claude que la conecte.", href: `${cfg}/entrega`, fix: "Ver" }
      : { id: "mail", status: "bad", title: "No hay cómo mandar mails", detail: "Ni casilla del proveedor ni POSTMARK_TOKEN / BREVO_API_KEY: los pedidos no se entregan.", href: `${cfg}/entrega`, fix: "Ver" });
  checks.push(s.email_from
    ? { id: "from", status: "ok", title: "Remitente cargado", detail: s.email_from }
    : { id: "from", status: "warn", title: "Sin remitente propio", detail: `Los mails salen desde ${process.env.DELIVERY_FROM || s.support_email}.`, href: `${cfg}/entrega`, fix: "Ver" });

  // ---- Entregas
  const noLink = (products.data ?? []).filter((p) =>
    // delivery_file cuenta: un PDF o una planilla en el bucket privado es la
    // entrega MAS segura, no la ausencia de una. Sin esto el diagnostico decia
    // "3 productos activos sin link de entrega" sobre los tres que entregan.
    !p.delivery_url && !p.delivery_file && !((p.delivery_links as { url?: string }[] | null) ?? []).some((l) => l?.url));
  checks.push(noLink.length
    ? { id: "links", status: "bad", title: `${plural(noLink.length, "producto activo", "productos activos")} sin link de entrega`,
        detail: noLink.slice(0, 4).map((p) => p.name).join(" · "), href: `${base}/productos`, fix: "Ver" }
    : { id: "links", status: "ok", title: "Todos los productos tienen link de entrega" });
  const und = undelivered.count ?? 0;
  checks.push(und
    ? { id: "undelivered", status: "bad", title: `${plural(und, "pedido pagado", "pedidos pagados")} sin entregar`,
        detail: (undelivered.data ?? []).map((o) => `${o.email ?? "sin email"}: ${o.delivery_error ?? "sin error registrado"}`).join(" · "),
        href: `${base}/ventas?estado=paid`, fix: "Ver" }
    : { id: "undelivered", status: "ok", title: "Todos los pedidos pagados se entregaron" });

  // ---- Stripe: errores y contracargos
  const errs = evErrors.count ?? 0;
  const lastErr = evErrors.data?.[0];
  checks.push(errs
    ? { id: "events", status: "bad", title: `${plural(errs, "evento de Stripe", "eventos de Stripe")} con error en 7 días`,
        detail: lastErr ? `Último: ${lastErr.type} — ${lastErr.error}` : undefined }
    : { id: "events", status: "ok", title: "Sin errores al procesar eventos de Stripe (7 días)" });
  const disp = disputes.count ?? 0;
  checks.push(disp
    ? { id: "disputes", status: "bad", title: `${plural(disp, "contracargo", "contracargos")} en 30 días`, detail: "Respondelos desde el dashboard de Stripe antes de que venza el plazo." }
    : { id: "disputes", status: "ok", title: "Sin contracargos en 30 días" });

  // ---- Tracking
  const px = pixels.data ?? [];
  const envToken = !!process.env.META_CAPI_TOKEN;
  const noToken = px.filter((p) => !p.capi_token_enc && !envToken);
  checks.push(!px.length
    ? { id: "pixels", status: "warn", title: "Sin pixel de Meta", detail: "Las ventas no se informan a tus anuncios.", href: `${cfg}/tracking`, fix: "Ver" }
    : noToken.length
      ? { id: "pixels", status: "warn", title: `${plural(noToken.length, "pixel", "pixels")} sin token de la API de Conversiones`,
          detail: noToken.map((p) => p.name || p.pixel_id).join(" · "), href: `${cfg}/tracking`, fix: "Ver" }
      : { id: "pixels", status: "ok", title: "Pixels con API de Conversiones" });

  // ---- Negocio y dominio
  const miss = businessMissing(s);
  checks.push(miss.length
    ? { id: "business", status: "warn", title: "Datos del negocio incompletos", detail: `Falta: ${miss.join(", ")}.`, href: `${cfg}/negocio`, fix: "Ver" }
    : { id: "business", status: "ok", title: "Datos del negocio completos" });
  checks.push(s.domain
    ? { id: "domain", status: "ok", title: "Dominio de checkout cargado", detail: s.domain }
    : { id: "domain", status: "warn", title: "Sin dominio de checkout propio", href: `${cfg}/dominios`, fix: "Ver" });

  // Los links de entrega ya se prueban uno por uno arriba (que abran): el chequeo de «tiene link» queda solo si falta alguno.
  checks.push(...live);
  checks.push(...offerRows);

  // ---- Disponibilidad (monitor de la base cada 2 min): checkout y post-pago en línea.
  checks.push(...(await uptimeChecks(s.id).catch((e) => [{ id: "uptime", status: "warn" as const, title: "No se pudo leer el monitor", detail: (e as Error).message }])));

  // Lo roto primero, después lo que conviene mirar.
  const rank = { bad: 0, warn: 1, ok: 2 } as const;
  checks.sort((a, b) => rank[a.status] - rank[b.status]);
  return { store: s.display_name || s.name, checks };
}
