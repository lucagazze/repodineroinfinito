import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const KINDS = ["sale", "alert", "names", "mail", "refund", "dispute", "delivery", "oto", "unpaid", "ai_reply", "bid"] as const;
/** Lo que recibe un dispositivo nuevo (igual que en PushToggle). */
const DEFAULT_KINDS = ["sale", "alert", "mail", "refund", "dispute", "delivery", "oto", "unpaid", "bid"];
const Endpoint = z.string().max(1000).refine((s) => s.startsWith("https://"), "endpoint inválido");
const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const Body = z.object({
  subscription: z.object({
    endpoint: Endpoint,
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  }),
  kinds: z.array(z.enum(KINDS)).max(12).optional(),
  label: z.string().max(80).optional(),
  // Id estable del dispositivo: al volver a suscribirse se borran sus endpoints viejos.
  deviceId: DeviceId.optional(),
  // Lo que ve el navegador (permiso, app instalada, clave): solo para diagnosticar.
  client: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
  // pushsubscriptionchange: el navegador cambió la suscripción; la nueva hereda lo que recibía la vieja.
  oldEndpoint: Endpoint.optional(),
});

async function denied() {
  try {
    await requireAdmin();
    return null;
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE });
  }
}

/**
 * Clave pública VAPID y, con ?endpoint=, si este dispositivo está guardado y
 * qué recibe; con ?device=, si este dispositivo tuvo notificaciones antes (para
 * volver a suscribirlo solo, sin preguntarle nada al dueño).
 */
export async function GET(req: NextRequest) {
  const no = await denied();
  if (no) return no;
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  const device = req.nextUrl.searchParams.get("device");
  const [{ data }, { data: dev }] = await Promise.all([
    endpoint ? db.from("push_subscriptions").select("kinds").eq("endpoint", endpoint).maybeSingle() : Promise.resolve({ data: null }),
    device && DeviceId.safeParse(device).success
      ? db.from("push_subscriptions").select("kinds").eq("device_id", device).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return NextResponse.json(
    { publicKey: process.env.VAPID_PUBLIC_KEY ?? null, subscribed: !!data, kinds: data?.kinds ?? dev?.kinds ?? null, deviceKnown: !!dev },
    { headers: NO_STORE },
  );
}

/**
 * Guarda (o confirma) este dispositivo. Sin `kinds` se conserva lo que ya
 * recibía (el endpoint, el dispositivo o el endpoint viejo); si es nuevo, lo
 * de siempre. Después queda UNA sola fila por dispositivo.
 */
export async function POST(req: NextRequest) {
  const no = await denied();
  if (no) return no;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const { subscription: s, label, oldEndpoint, client } = parsed.data;
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  const now = new Date().toISOString();

  // Lo que recibía: este endpoint, el endpoint viejo (renovación del navegador) o este dispositivo.
  const [{ data: same }, { data: old }, { data: dev }] = await Promise.all([
    db.from("push_subscriptions").select("kinds,device_id").eq("endpoint", s.endpoint).maybeSingle(),
    oldEndpoint && oldEndpoint !== s.endpoint
      ? db.from("push_subscriptions").select("kinds,device_id").eq("endpoint", oldEndpoint).maybeSingle()
      : Promise.resolve({ data: null }),
    parsed.data.deviceId
      ? db.from("push_subscriptions").select("kinds").eq("device_id", parsed.data.deviceId).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const kinds = parsed.data.kinds ?? same?.kinds ?? old?.kinds ?? dev?.kinds ?? DEFAULT_KINDS;
  const deviceId = parsed.data.deviceId ?? same?.device_id ?? old?.device_id ?? null;

  const { data, error } = await db.from("push_subscriptions").upsert({
    endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: ua,
    ...(label ? { device_label: label } : {}),
    kinds, device_id: deviceId, last_seen_at: now, fail_count: 0,
    ...(client ? { client } : {}),
  }, { onConflict: "endpoint" }).select("id,kinds,created_at,device_label").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });

  // Una sola suscripción por dispositivo: las anteriores de este dispositivo (o la vieja renovada) se borran.
  let removed = 0;
  if (oldEndpoint && oldEndpoint !== s.endpoint) {
    const r = await db.from("push_subscriptions").delete().eq("endpoint", oldEndpoint).select("id");
    removed += r.data?.length ?? 0;
  }
  if (deviceId) {
    const r = await db.from("push_subscriptions").delete().eq("device_id", deviceId).neq("id", data.id).select("id");
    removed += r.data?.length ?? 0;
    // Filas de antes de que existiera el id de dispositivo (se apilaban una por reactivación): las del
    // mismo navegador (mismo user agent y nombre) y más viejas que esta. Si alguna era de otro aparato
    // igual, ese aparato la vuelve a guardar solo la próxima vez que abra el panel.
    if (ua && data.device_label) {
      const l = await db.from("push_subscriptions").delete().is("device_id", null).eq("user_agent", ua)
        .eq("device_label", data.device_label).lt("created_at", data.created_at).neq("id", data.id).select("id");
      removed += l.data?.length ?? 0;
    }
  }
  return NextResponse.json({ ok: true, kinds: data.kinds, removed }, { headers: NO_STORE });
}
