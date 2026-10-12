import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brandFor } from "@/lib/brand";
import { PREFETCH_UA, readUnsubToken } from "@/lib/cart-recovery";
import { recoveryTexts } from "@/lib/cart-recovery-texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baja de los mails comerciales (carrito abandonado) de una tienda, en un
 * clic: /api/m/u/{token}?l=idioma. GET desde el link del pie y POST desde el
 * botón «Darse de baja» del cliente de correo (List-Unsubscribe-Post). Los
 * escáneres de links que abren todo antes que la persona no dan de baja: ven
 * un botón para confirmar.
 */

const page = (title: string, body: string, form = "") =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1f2937;text-align:center">` +
      `<h1 style="font-size:20px;line-height:1.35">${title}</h1><p style="color:#6b7280;line-height:1.5">${body}</p>${form}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } }
  );
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function unsubscribe(token: string, source: string) {
  const who = readUnsubToken(token);
  if (!who) return null;
  await db.from("mail_unsubscribes").upsert({ store_id: who.storeId, email: who.email.toLowerCase(), source }, { onConflict: "store_id,email", ignoreDuplicates: true });
  const { data: s } = await db.from("stores").select("name,display_name,brand").eq("id", who.storeId).maybeSingle();
  return s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const l = req.nextUrl.searchParams.get("l");
  const t = recoveryTexts(l);
  if (!readUnsubToken(token)) return page("Link", "—");
  if (PREFETCH_UA.test(req.headers.get("user-agent") ?? "")) {
    return page(t.unsubscribe, "", `<form method="post"><button style="padding:12px 22px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:700;font-size:15px;cursor:pointer">${esc(t.unsubscribe)}</button></form>`);
  }
  const s = await unsubscribe(token, "link");
  const brand = s ? brandFor(s, l) : "";
  return page(esc(t.unsubDone(brand)), esc(t.unsubBody));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const l = req.nextUrl.searchParams.get("l");
  const s = await unsubscribe(token, req.headers.get("content-type")?.includes("form") ? "one-click" : "post");
  if (!s) return NextResponse.json({ ok: false }, { status: 400 });
  const t = recoveryTexts(l);
  return page(esc(t.unsubDone(brandFor(s, l))), esc(t.unsubBody));
}
