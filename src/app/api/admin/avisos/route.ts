import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "no-store" };

export type BellItem = { id: string; kind: string; severity: string; title: string; link: string | null; created_at: string };

/**
 * La campanita y el «Resuelto» de cada aviso, con fetch común y no con server
 * actions: una server action en curso al tocar un link hace que Next vuelva a
 * pedir la página entera al llegar (en un celular, otra página completa).
 *  GET  → cuántos avisos abiertos hay y los últimos 10.
 *  POST { id, undo? } → lo marca resuelto (o lo vuelve a abrir con «Deshacer»).
 * Un aviso automático que se vuelve a levantar (reopen) reaparece solo si el
 * problema se detecta otra vez.
 */
async function bell() {
  const [{ count }, { data }] = await Promise.all([
    db.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    db.from("alerts").select("id,kind,severity,title,link,created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(10),
  ]);
  return { count: count ?? 0, items: (data ?? []) as BellItem[] };
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await bell(), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { id?: string; undo?: boolean } | null;
  const id = body?.id ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Aviso inválido" }, { status: 400, headers: NO_STORE });
  const { error } = body?.undo
    ? await db.from("alerts").update({ resolved_at: null }).eq("id", id)
    : await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("id", id).is("resolved_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  return NextResponse.json(await bell(), { headers: NO_STORE });
}
