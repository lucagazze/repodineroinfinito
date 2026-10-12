import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidateTag } from "next/cache";
import { folderCheck, presaleBoard, scanPresaleFolders, setBookDoneAlert, PRESALE_TAG } from "@/lib/admin/presale";
import { resolveAlerts } from "@/lib/alerts";
import { resendDeliveryFor } from "@/lib/resend-delivery";
import { invalidateEverything } from "@/lib/cache-bust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

/**
 * Preventas desde el panel (fetch común):
 *  POST { action: "ready", productId } → el contenido ya está en su carpeta: el libro (y sus
 *       variantes) deja de ser preventa. El comprador nuevo ya no ve «te llega en N días».
 *  POST { action: "notify", productId } → reenvía la entrega a cada comprador que todavía no
 *       recibió el aviso (una vez por pedido; queda en presale_notices). Solo con el libro listo.
 */
const Body = z.union([
  z.object({ action: z.enum(["ready", "notify"]), productId: z.string().uuid() }),
  z.object({ action: z.literal("scan") }),
  z.object({ action: z.literal("alert_pref"), on: z.boolean() }),
]);

export async function POST(req: NextRequest) {
  const res = await handle(req);
  revalidateTag(PRESALE_TAG);
  return res;
}

async function handle(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE });
  if (parsed.data.action === "scan") {
    // Mirar las carpetas ya (sin esperar el repaso de cada 15 min).
    const r = await scanPresaleFolders(true);
    if (r.ready.length) await invalidateEverything();
    return NextResponse.json({ ok: true, checked: r.checked, ready: r.ready.map((x) => x.name) }, { headers: NO_STORE });
  }
  if (parsed.data.action === "alert_pref") {
    await setBookDoneAlert(parsed.data.on);
    return NextResponse.json({ ok: true, on: parsed.data.on }, { headers: NO_STORE });
  }
  const { action, productId } = parsed.data;

  if (action === "ready") {
    // Solo si se está seguro de que el libro está hecho: un PDF de verdad, con peso de libro, en su carpeta.
    const { data: prod } = await db.from("products").select("delivery_url").eq("id", productId).maybeSingle();
    const chk = await folderCheck((prod?.delivery_url as string | null) ?? null);
    if (chk.state !== "ready") {
      return NextResponse.json({ error: `Todavía no lo doy por hecho: ${chk.why ?? "no encontré el PDF del libro en su carpeta"}. Subí el PDF completo (con portada e índice) a la carpeta y volvé a tocar.` }, { status: 409, headers: NO_STORE });
    }
    const { error } = await db.from("products").update({ presale: false, content_ready_at: new Date().toISOString(), ready_files: chk.files, leftover_notices: chk.notices.length ? chk.notices : null })
      .or(`id.eq.${productId},variant_of.eq.${productId}`);
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
    await resolveAlerts("presale_due", [`${productId}:vence_pronto`, `${productId}:atrasado`]);
    await invalidateEverything();
    const row = (await presaleBoard()).find((r) => r.id === productId);
    return NextResponse.json({ ok: true, pendingNotice: row?.pendingNotice ?? 0 }, { headers: NO_STORE });
  }

  const row = (await presaleBoard()).find((r) => r.id === productId);
  if (!row) return NextResponse.json({ ok: true, sent: 0, failed: [] }, { headers: NO_STORE });
  if (row.state !== "listo_sin_avisar") return NextResponse.json({ error: "Primero marcalo listo: todavía está en preventa." }, { status: 409, headers: NO_STORE });
  // Antes de mandar el mail real, se vuelve a mirar la carpeta: que el libro siga ahí.
  const again = await folderCheck(row.deliveryUrl);
  if (again.state !== "ready") return NextResponse.json({ error: `No mando el aviso: ${again.why ?? "no encontré el PDF del libro en su carpeta"}.` }, { status: 409, headers: NO_STORE });
  // Si en la carpeta quedó el documento de preventa («llega en 2 días») al lado del libro, el comprador vería los dos.
  await db.from("products").update({ leftover_notices: again.notices.length ? again.notices : null }).or(`id.eq.${productId},variant_of.eq.${productId}`);
  if (again.notices.length) {
    return NextResponse.json({ error: `No mando el aviso: en la carpeta sigue el documento de preventa (${again.notices.map((n) => `«${n.title}»`).join(", ")}). Borralo primero; si quedan los dos, el comprador ve el libro y al lado «todavía no llegó».` }, { status: 409, headers: NO_STORE });
  }
  const { data: done } = await db.from("presale_notices").select("order_id").eq("product_id", productId).in("order_id", row.orders);
  const skip = new Set((done ?? []).map((d) => d.order_id as string));
  let sent = 0;
  const failed: string[] = [];
  for (const orderId of row.orders.filter((o) => !skip.has(o))) {
    try {
      await resendDeliveryFor(orderId);
      await db.from("presale_notices").insert({ order_id: orderId, product_id: productId });
      sent++;
    } catch (e) {
      failed.push(`${orderId.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ ok: true, sent, failed }, { headers: NO_STORE });
}
