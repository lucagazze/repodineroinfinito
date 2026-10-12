import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { webhookSecret } from "@/lib/mkt/brevo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook transaccional de Brevo (lo crea Email marketing › Ajustes):
 * entregado, rebote, bloqueado, queja (spam), baja y error de cada mail de
 * campaña. Se reconoce por X-Mailin-custom (= el id del envío) o por el
 * message-id. Los eventos de otros mails (entregas por Brevo) se ignoran.
 * Autenticado con ?k= (secreto derivado de SECRETS_KEY) o Bearer.
 *
 * Rebote duro, dirección inválida o bloqueada → el contacto queda «rebotado»;
 * queja → «queja»; baja → «dado de baja» (y en mail_unsubscribes). Ninguno
 * vuelve a recibir campañas.
 */

type Ev = {
  event?: string; email?: string; "message-id"?: string; "X-Mailin-custom"?: string; reason?: string; date?: string; ts_event?: number;
};

function authorized(req: NextRequest) {
  const want = Buffer.from(webhookSecret());
  const got = Buffer.from(req.nextUrl.searchParams.get("k") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  return want.length > 10 && got.length === want.length && timingSafeEqual(got, want);
}

const KIND: Record<string, "delivered" | "bounce" | "complaint" | "unsubscribe" | "blocked" | "error" | "soft"> = {
  delivered: "delivered", hard_bounce: "bounce", hardBounce: "bounce", invalid_email: "bounce", invalid: "bounce",
  soft_bounce: "soft", softBounce: "soft", blocked: "blocked", spam: "complaint", complaint: "complaint",
  unsubscribed: "unsubscribe", unsubscribe: "unsubscribe", error: "error",
};

async function handle(e: Ev) {
  const kind = KIND[e.event ?? ""];
  if (!kind) return "ignorado";
  const custom = (e["X-Mailin-custom"] ?? "").trim();
  const msgId = (e["message-id"] ?? "").trim();
  let q = db.from("mkt_sends").select("id,store_id,contact_id,email,status,is_test");
  if (/^[0-9a-f-]{36}$/i.test(custom)) q = q.eq("id", custom);
  else if (msgId) q = q.eq("provider_id", msgId);
  else return "sin id";
  const { data: s } = await q.maybeSingle();
  if (!s) return "no es de campaña";
  const at = e.date ? new Date(e.date).toISOString() : new Date().toISOString();
  const reason = (e.reason ?? "").slice(0, 300) || null;
  if (kind !== "soft") {
    await db.from("mkt_events").insert({ send_id: s.id, kind: kind === "unsubscribe" ? "unsubscribe" : kind, detail: reason });
  }
  const contact = (patch: Record<string, unknown>) =>
    s.is_test ? Promise.resolve() : db.from("mkt_contacts").update({ ...patch, status_at: at }).eq("store_id", s.store_id).eq("email", s.email).eq("status", "subscribed");
  switch (kind) {
    case "delivered":
      await db.from("mkt_sends").update({ delivered_at: at }).eq("id", s.id).is("delivered_at", null);
      break;
    case "soft":
      await db.from("mkt_events").insert({ send_id: s.id, kind: "bounce", detail: `soft: ${reason ?? ""}`.slice(0, 300) });
      break;
    case "bounce":
    case "blocked":
      await db.from("mkt_sends").update({ bounced_at: at, bounce_type: kind === "blocked" ? "blocked" : "hard", ...(s.status === "sent" ? {} : { status: "failed", error: reason }) }).eq("id", s.id);
      await contact({ status: "bounced", status_reason: kind === "blocked" ? `Brevo lo bloquea${reason ? `: ${reason}` : ""}` : `rebote${reason ? `: ${reason}` : ""}` });
      break;
    case "complaint":
      await db.from("mkt_sends").update({ complained_at: at }).eq("id", s.id);
      await contact({ status: "complained", status_reason: "lo marcó como spam" });
      break;
    case "unsubscribe":
      await db.from("mkt_sends").update({ unsubscribed_at: at }).eq("id", s.id).is("unsubscribed_at", null);
      await contact({ status: "unsubscribed", status_reason: "se dio de baja (Brevo)" });
      if (!s.is_test) await db.from("mail_unsubscribes").upsert({ store_id: s.store_id, email: s.email, source: "mkt-brevo" }, { onConflict: "store_id,email", ignoreDuplicates: true });
      break;
    case "error":
      if (s.status !== "sent") await db.from("mkt_sends").update({ status: "failed", error: reason }).eq("id", s.id);
      break;
  }
  return kind;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Ev | Ev[] | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  const list = Array.isArray(body) ? body.slice(0, 500) : [body];
  const out: string[] = [];
  for (const e of list) out.push(await handle(e).catch((err) => `error: ${(err as Error).message}`));
  return NextResponse.json({ ok: true, out });
}
