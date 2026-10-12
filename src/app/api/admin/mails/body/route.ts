import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { deliveryHtmlFor } from "@/lib/resend-delivery";
import { escHtml, srcDoc } from "@/lib/admin/mail-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (b: Record<string, unknown>, status = 200) => NextResponse.json(b, { status, headers: NO_STORE });

/**
 * El cuerpo de un mail de la conversación, recién cuando se abre la fila
 * (?k=in: lo que escribió el comprador; ?k=out: lo que le mandamos). El HTML
 * vuelve listo para el iframe con sandbox, sin nuestro píxel ni links con
 * seguimiento: mirarlo en el panel no cuenta como apertura ni clic.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return json({ error: "No autorizado" }, 401);
  }
  const k = req.nextUrl.searchParams.get("k");
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || (k !== "in" && k !== "out")) return json({ error: "Pedido inválido" }, 400);

  if (k === "in") {
    const { data: m } = await db.from("inbox_messages").select("text,html").eq("id", id).maybeSingle();
    if (!m) return json({ error: "No encontré ese mail" }, 404);
    // Lo que escribió, como texto (con lo citado abajo); si vino solo en HTML, el HTML.
    if (m.text?.trim() || !m.html) return json({ text: m.text?.trim() || "" });
    return json({ html: srcDoc(m.html) });
  }

  const { data: l } = await db.from("email_log").select("kind,store_id,order_id,provider_id,body_html").eq("id", id).maybeSingle();
  if (!l) return json({ error: "No encontré ese mail" }, 404);
  // Nuestra respuesta: el texto que se escribió (el HTML trae además el mail citado).
  if (l.kind === "reply") {
    const { data: out } = l.provider_id
      ? await db.from("inbox_messages").select("text,html").eq("store_id", l.store_id).eq("message_id", l.provider_id).maybeSingle()
      : { data: null };
    if (out?.text?.trim()) return json({ text: out.text.trim() });
    const html = l.body_html ?? out?.html;
    return html ? json({ html: srcDoc(html) }) : json({ error: "El cuerpo de esta respuesta no se guardó." });
  }
  if (l.body_html) return json({ html: srcDoc(l.body_html) });
  // Mails viejos (antes de guardar los cuerpos): el de entrega armado con el pedido de hoy.
  if (l.order_id && (l.kind === "delivery" || l.kind === "upsell")) {
    const html = await deliveryHtmlFor(l.order_id).catch(() => null);
    if (html) return json({ html: srcDoc(html), note: "Salió antes de que se guardaran los cuerpos: lo ves armado con el pedido de hoy (mismos productos y links)." });
  }
  return json({ html: srcDoc(`<p style="color:#71717a">${escHtml("El cuerpo de este mail no se guardó.")}</p>`) });
}
