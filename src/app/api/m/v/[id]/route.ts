import { NextRequest, after } from "next/server";
import { db } from "@/lib/db";
import { PREFETCH_UA, reqIp } from "@/lib/mail-track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Píxel de apertura de un mail de campaña: /api/m/v/{envío}.gif. Responde siempre la imagen; la apertura se anota después. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.gif$/i, "");
  const ua = req.headers.get("user-agent") ?? "";
  if (/^[0-9a-f-]{36}$/i.test(id) && !PREFETCH_UA.test(ua)) {
    const ip = reqIp(req.headers);
    after(async () => {
      const { error } = await db.rpc("mkt_track", { p_id: id, p_kind: "open", p_url: null, p_ip: ip, p_ua: ua });
      if (error) console.warn("[mkt] apertura:", error.message);
    });
  }
  return new Response(GIF, {
    headers: {
      "content-type": "image/gif", "content-length": String(GIF.length),
      "cache-control": "no-store, no-cache, must-revalidate, private, max-age=0", pragma: "no-cache", expires: "0",
    },
  });
}
