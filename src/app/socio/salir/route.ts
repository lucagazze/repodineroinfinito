import { NextResponse, type NextRequest } from "next/server";
import { partnerLogout } from "@/lib/partner";

/** «Salir» del panel de socio. */
export async function POST(req: NextRequest) {
  await partnerLogout();
  return NextResponse.redirect(new URL("/entrar", req.url), 303);
}
