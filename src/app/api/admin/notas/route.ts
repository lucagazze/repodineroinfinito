import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * El anotador del Inicio (offer_tasks): tareas por oferta o generales (offerId null).
 *  POST { action: "add", offerId?, text } · { action: "toggle", id, done } · { action: "delete", id }
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), offerId: z.string().uuid().nullable().optional(), text: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("toggle"), id: z.string().uuid(), done: z.boolean() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
]);

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  const b = parsed.data;
  if (b.action === "add") {
    const { data, error } = await db.from("offer_tasks").insert({ offer_id: b.offerId ?? null, text: b.text }).select("id,offer_id,text,done,created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ ok: true, task: data }, { headers: NO_STORE });
  }
  if (b.action === "toggle") {
    const { error } = await db.from("offer_tasks").update({ done: b.done, done_at: b.done ? new Date().toISOString() : null }).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }
  const { error } = await db.from("offer_tasks").delete().eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
