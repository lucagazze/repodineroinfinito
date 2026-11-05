import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Qué le pasó de verdad a cada mail, contado por Brevo.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. La API de Brevo acepta el envío, devuelve un
 * `messageId` y recién DESPUÉS decide si lo manda. `email_log.status = 'sent'`
 * sólo dice «lo aceptaron», no «salió». Entre el 24/10 y el 1/11/2026 el
 * remitente `info@physicsstudylab.com` no estaba validado y Brevo rechazó cada
 * mail de entrega después de aceptarlo: siete compradores pagaron y no
 * recibieron nada, el panel mostró siete entregas correctas, y se descubrió
 * doce días tarde y de casualidad. Sin este webhook no hay forma de enterarse.
 *
 * SE AUTENTICA POR LA URL. El webhook clásico de Brevo no firma el cuerpo, así
 * que el secreto va en la ruta y se compara en tiempo constante. Quien no lo
 * tenga recibe 404, no 401: un 401 confirma que la ruta existe.
 *
 * EL SECRETO SE DERIVA, NO SE CONFIGURA. Es un hash de `SECRETS_KEY`, que ya
 * está en producción porque cifra los tokens de la tienda. Así no hay una
 * variable nueva que alguien olvide cargar en un entorno —y un webhook que
 * calla porque falta una variable es exactamente el fallo que esto viene a
 * evitar—. Si la URL se filtra, lo que se expone es un hash truncado, no la
 * llave. `BREVO_WEBHOOK_SECRET` la pisa, por si alguna vez hay que rotarla
 * sin tocar `SECRETS_KEY`.
 *
 * ES IDEMPOTENTE. Brevo reintenta, y el mismo evento puede llegar dos veces.
 * `delivered_at` y `opened_at` se escriben sólo si estaban vacíos, y los
 * contadores sólo suben con eventos que Brevo ya declara únicos.
 */

const TERMINALES: Record<string, string> = {
  hard_bounce: "rebote duro",
  soft_bounce: "rebote blando",
  blocked: "bloqueado",
  spam: "marcado como spam",
  invalid_email: "dirección inválida",
  error: "rechazado por Brevo",
};

type Evento = {
  event?: string;
  email?: string;
  "message-id"?: string;
  reason?: string;
  subject?: string;
  date?: string;
  ts_event?: number;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ secreto: string }> }) {
  const { secreto } = await params;
  const esperado = secretoEsperado();
  if (!esperado || !igual(secreto, esperado)) {
    return NextResponse.json({ error: "No existe" }, { status: 404 });
  }

  let cuerpo: unknown;
  try { cuerpo = await req.json(); }
  catch { return NextResponse.json({ error: "Cuerpo ilegible" }, { status: 400 }); }

  // Brevo manda un objeto por evento, pero una cola reintentada puede venir en lote.
  const eventos: Evento[] = Array.isArray(cuerpo) ? (cuerpo as Evento[]) : [cuerpo as Evento];
  let tratados = 0;
  for (const e of eventos) {
    try { if (await tratar(e)) tratados++; }
    catch (err) { console.error("[brevo]", e.event, (err as Error).message); }
  }
  // 200 siempre que el secreto sea válido: un 500 hace que Brevo reintente
  // eternamente un evento que nunca vamos a poder casar.
  return NextResponse.json({ ok: true, recibidos: eventos.length, tratados });
}

async function tratar(e: Evento): Promise<boolean> {
  const mid = e["message-id"];
  const evento = (e.event ?? "").toLowerCase();
  if (!mid || !evento) return false;

  const { data: log } = await db.from("email_log")
    .select("id,store_id,order_id,kind,to_email,status,opened_at,open_count,click_count,delivered_at")
    .eq("provider_id", mid)
    .maybeSingle();
  // Un mail que no mandó esta app (una campaña, una prueba desde Brevo) no es un error.
  if (!log) return false;

  const cuando = e.ts_event ? new Date(e.ts_event * 1000).toISOString() : new Date().toISOString();

  if (evento === "delivered") {
    if (!log.delivered_at) {
      await db.from("email_log").update({ delivered_at: cuando }).eq("id", log.id);
    }
    // Llegó: si había un aviso por este mail, se cierra solo.
    await resolveAlerts("email_failed", [`${log.kind}:${log.order_id ?? log.to_email.toLowerCase()}`]).catch(() => {});
    return true;
  }

  if (evento in TERMINALES) {
    const motivo = `${TERMINALES[evento]}${e.reason ? `: ${e.reason}` : ""}`;
    await db.from("email_log").update({
      status: "failed",
      bounced_at: cuando,
      bounce_reason: motivo.slice(0, 500),
      error: motivo.slice(0, 500),
    }).eq("id", log.id);

    // Esto es lo único que hace ruido. Un mail de entrega que no llegó es un
    // comprador que pagó y no tiene nada: severidad error, no warn.
    const entrega = log.kind === "delivery";
    await raiseAlert({
      kind: evento === "error" || evento === "blocked" ? "email_failed" : "email_bounced",
      severity: entrega ? "error" : "warn",
      storeId: log.store_id,
      ref: `brevo:${log.id}`,
      reopen: true,
      link: log.order_id ? `/admin/avisos/pedido/${log.order_id}` : "/admin/avisos?tab=mails",
      title: `Brevo no entregó el mail ${entrega ? "de entrega " : ""}a ${log.to_email}`,
      body: motivo,
    }).catch(() => {});
    return true;
  }

  if (evento === "unique_opened" || evento === "opened") {
    await db.from("email_log").update({
      opened_at: log.opened_at ?? cuando,
      open_count: (log.open_count ?? 0) + (evento === "unique_opened" ? 1 : 0),
    }).eq("id", log.id);
    return true;
  }

  if (evento === "click") {
    await db.from("email_log").update({
      clicked_at: cuando,
      click_count: (log.click_count ?? 0) + 1,
    }).eq("id", log.id);
    return true;
  }

  // request, deferred, loaded_by_proxy, unsubscribed: no cambian el estado.
  // `loaded_by_proxy` es la precarga de Apple Mail; contarla como apertura
  // haría que la alarma por «nadie abre» no saltara nunca.
  return false;
}

/** El secreto de la URL: el configurado, o uno derivado de SECRETS_KEY. */
export function secretoEsperado(): string {
  const fijo = process.env.BREVO_WEBHOOK_SECRET;
  if (fijo) return fijo;
  const llave = process.env.SECRETS_KEY;
  if (!llave) return "";
  return createHash("sha256").update(`brevo-webhook:${llave}`).digest("hex").slice(0, 40);
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
