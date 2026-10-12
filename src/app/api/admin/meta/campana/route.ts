import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { campaignDetail } from "@/lib/admin/campaign-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const NO_STORE = { "cache-control": "no-store" };

/** GET ?id=<campaña>[&fresh=1] → cómo está hecha (conjuntos, anuncios con vista previa) y los creativos de su oferta. Solo lectura. */
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: NO_STORE }); }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^\d{6,25}$/.test(id)) return NextResponse.json({ error: "Campaña inválida" }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(await campaignDetail(id, req.nextUrl.searchParams.get("fresh") === "1"), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: NO_STORE });
  }
}
