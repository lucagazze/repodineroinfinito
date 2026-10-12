import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { loadCampaign, previewCampaign } from "@/lib/mkt/send";
import { LocaleZ, VersionZ } from "@/lib/mkt/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vista previa de un idioma, tal como le llegaría a alguien que no tiene
 * ninguno de los productos (o a un contacto puntual). Acepta la versión sin
 * guardar (lo que se está escribiendo) y el descuento elegido.
 */
const Body = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/i),
  locale: LocaleZ,
  version: VersionZ.optional(),
  discount_pct: z.number().int().min(1).max(90).nullable().optional(),
  discount_hours: z.number().int().min(1).max(720).optional(),
  contact: z.string().regex(/^[0-9a-f-]{36}$/i).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401 }); }
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const c = await loadCampaign(p.data.id);
  if (!c) return NextResponse.json({ error: "No existe" }, { status: 404 });
  try {
    const draft = {
      ...c,
      versions: p.data.version ? { ...c.versions, [p.data.locale]: p.data.version } : c.versions,
      ...(p.data.discount_pct !== undefined ? { discount_pct: p.data.discount_pct } : {}),
      ...(p.data.discount_hours !== undefined ? { discount_hours: p.data.discount_hours } : {}),
    };
    const r = await previewCampaign(draft, p.data.locale, { contactId: p.data.contact ?? null });
    return NextResponse.json({ subject: r.subject, preheader: r.preheader, html: r.html, notes: r.notes, skip: r.skip, from: r.from, brand: r.brand },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
