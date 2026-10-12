import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { AI_MISSING, aiConfigured, draftReply, type Decision } from "@/lib/ai-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };
const DECISIONS: Decision[] = ["auto", "refund", "no_refund"];

/**
 * Borrador de la IA (el guardado, o uno nuevo con `force`). Va por fetch y no
 * como server action: una server action de 7–20 s ocupa la fila del router de
 * Next y, dentro de una transición, deja colgado cualquier toque (volver a la
 * lista, cambiar de pestaña) hasta que termina. Así la página sigue
 * respondiendo; si se navega, el navegador corta el pedido pero el servidor lo
 * termina y el borrador queda guardado para cuando se vuelva a abrir.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE });
  }
  // Solo desde el panel (la cookie es lax; esto lo cierra del todo).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403, headers: NO_STORE });
  }
  const b = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown; force?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const decision = DECISIONS.find((d) => d === b?.decision);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !decision) return NextResponse.json({ error: "Pedido inválido" }, { status: 400, headers: NO_STORE });
  if (!aiConfigured()) return NextResponse.json({ error: AI_MISSING }, { headers: NO_STORE });
  try {
    const d = await draftReply(id, { decision, force: b?.force === true });
    return NextResponse.json({ ok: "Borrador listo", data: { draft: d } }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "No se pudo armar el borrador" }, { headers: NO_STORE });
  }
}
