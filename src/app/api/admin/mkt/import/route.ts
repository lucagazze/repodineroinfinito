import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importCommit, importPreview, type Mapping } from "@/lib/mkt/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Importar compradores de la plataforma anterior (XLSX «Ventas realizadas → Exportar») o
 * un CSV. Multipart: file, store, mode = preview | commit, mapping (JSON de
 * columnas) y products (JSON nombre del archivo → id de producto de la app).
 * preview no escribe nada.
 */
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 401 }); }
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const store = String(fd?.get("store") ?? "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(store)) return NextResponse.json({ error: "Falta el archivo o la tienda" }, { status: 400 });
  if (file.size > 4_000_000) return NextResponse.json({ error: "El archivo pesa más de 4 MB: exportalo por rangos de fechas" }, { status: 413 });
  const parse = <T,>(k: string, fb: T): T => { try { return JSON.parse(String(fd?.get(k) ?? "")) as T; } catch { return fb; } };
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    if (fd?.get("mode") === "commit") {
      const r = await importCommit(store, buf, file.name, parse<Mapping>("mapping", {}), parse<Record<string, string>>("products", {}));
      return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
    }
    const r = await importPreview(store, buf, file.name, parse<Mapping>("mapping", {}));
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
