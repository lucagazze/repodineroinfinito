import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Para saber si el seguimiento de mails está publicado en este dominio antes de usarlo en un mail. */
export function GET() {
  return NextResponse.json({ ok: "mail-track" }, { headers: { "cache-control": "no-store" } });
}
