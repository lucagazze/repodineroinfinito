import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brandFor } from "@/lib/brand";
import { PREFETCH_UA, readUnsubToken } from "@/lib/cart-recovery";
import { recoveryTexts } from "@/lib/cart-recovery-texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baja de las campañas de email marketing, en un clic: /api/m/n/{token}?l=idioma&s=envío.
 * GET desde el link del pie y POST desde el botón «Darse de baja» del cliente
 * de correo (List-Unsubscribe-Post). Queda en mail_unsubscribes (la misma
 * lista que respeta el mail de carrito), el contacto pasa a «dado de baja» y
 * el envío la cuenta para los resultados. Los escáneres de links no dan de
 * baja: ven un botón para confirmar. Con &t=1 (mail de prueba) no se anota nada.
 * /api/m/n/ping: para saber que esta ruta ya está publicada en el dominio.
 */

const page = (title: string, body: string, form = "") =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">` +
      `<h1 style="font-size:20px;line-height:1.35">${title}</h1><p style="color:#6b7280;line-height:1.5">${body}</p>${form}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } }
  );
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function unsubscribe(token: string, sendId: string | null, source: string) {
  const who = readUnsubToken(token);
  if (!who) return null;
  const email = who.email.toLowerCase();
  const now = new Date().toISOString();
  await Promise.all([
    db.from("mail_unsubscribes").upsert({ store_id: who.storeId, email, source: `mkt-${source}` }, { onConflict: "store_id,email", ignoreDuplicates: true }),
    db.from("mkt_contacts").update({ status: "unsubscribed", status_at: now, status_reason: "se dio de baja desde una campaña" })
      .eq("store_id", who.storeId).eq("email", email).eq("status", "subscribed"),
    sendId && /^[0-9a-f-]{36}$/i.test(sendId)
      ? db.from("mkt_sends").update({ unsubscribed_at: now }).eq("id", sendId).eq("email", email).is("unsubscribed_at", null)
      : Promise.resolve(),
  ]);
  if (sendId && /^[0-9a-f-]{36}$/i.test(sendId)) {
    await db.from("mkt_events").insert({ send_id: sendId, kind: "unsubscribe", detail: source }).then(() => {}, () => {});
  }
  const { data: s } = await db.from("stores").select("name,display_name,brand").eq("id", who.storeId).maybeSingle();
  return s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  if (token === "ping") return NextResponse.json({ ok: "mkt" }, { headers: { "cache-control": "no-store" } });
  const sp = req.nextUrl.searchParams;
  const l = sp.get("l");
  const t = recoveryTexts(l);
  const who = readUnsubToken(token);
  if (!who) return page("Link", "—");
  if (sp.get("t") === "1") return page(esc(t.unsubscribe), "Mail de prueba: este link no da de baja a nadie.");
  if (PREFETCH_UA.test(req.headers.get("user-agent") ?? "")) {
    return page(esc(t.unsubscribe), "", `<form method="post"><button style="padding:12px 22px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:700;font-size:15px;cursor:pointer">${esc(t.unsubscribe)}</button></form>`);
  }
  const s = await unsubscribe(token, sp.get("s"), "link");
  return page(esc(t.unsubDone(s ? brandFor(s, l) : "")), esc(t.unsubBody));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const sp = req.nextUrl.searchParams;
  const l = sp.get("l");
  if (sp.get("t") === "1") return page("OK", "Mail de prueba: no se anotó nada.");
  const s = await unsubscribe(token, sp.get("s"), req.headers.get("content-type")?.includes("form") ? "one-click" : "post");
  if (!s) return NextResponse.json({ ok: false }, { status: 400 });
  const t = recoveryTexts(l);
  return page(esc(t.unsubDone(brandFor(s, l))), esc(t.unsubBody));
}
