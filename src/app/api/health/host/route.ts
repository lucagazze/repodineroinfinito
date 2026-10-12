import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Qué host ve la app cuando otro sitio le pasa una página (rewrite externo). Sin datos sensibles. */
export function GET(req: NextRequest) {
  const h = (k: string) => req.headers.get(k);
  return NextResponse.json({
    host: h("host"), xForwardedHost: h("x-forwarded-host"), xForwardedProto: h("x-forwarded-proto"),
    xVercelForwardedFor: !!h("x-vercel-forwarded-for"), country: h("x-vercel-ip-country"),
  }, { headers: { "cache-control": "no-store" } });
}
