import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/checkouts?k=HEALTH_SECRET → { checkouts: [...] }: cada
 * checkout PÚBLICO de una oferta activa (mercado activo, tienda activa y de
 * verdad, sin los links de producto suelto) con la URL que abre el comprador
 * y su landing. Mismas reglas que el monitor (migración 040,
 * uptime_sync_targets). Lo usa scripts/smoke.mjs para probarlos todos.
 * Solo lecturas.
 */
type Row = {
  slug: string; market_label: string | null; name: string; checkout_host: string | null; checkout_path: string | null; landing_url: string | null;
  offers: { name: string; slug: string; active: boolean } | null;
  stores: { slug: string; domain: string | null; active: boolean; is_test: boolean } | null;
};

export async function GET(req: NextRequest) {
  const secret = process.env.HEALTH_SECRET ?? "";
  const k = req.nextUrl.searchParams.get("k") ?? req.headers.get("x-health-key") ?? "";
  const a = Buffer.from(k);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { data, error } = await db.from("funnels")
    .select("slug,market_label,name,checkout_host,checkout_path,landing_url,offers!inner(name,slug,active),stores!inner(slug,domain,active,is_test)")
    .eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: { "cache-control": "no-store" } });
  const app = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  const checkouts = ((data ?? []) as unknown as Row[])
    .filter((f) => f.offers?.active && f.stores?.active && !f.stores?.is_test && !f.slug.endsWith("-solo"))
    .map((f) => {
      const host = (f.checkout_host ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const store = f.stores!.slug;
      const url = host && f.checkout_path ? `https://${host}${f.checkout_path}`
        : host ? `https://${host}/c/${store}/${f.slug}`
        : f.stores!.domain ? `https://${f.stores!.domain}/${f.slug}`
        : `${app}/c/${store}/${f.slug}`;
      return { name: `${f.offers!.name} (${f.market_label || f.name})`, store, funnel: f.slug, url, landing: f.landing_url || null };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
  return NextResponse.json({ checkouts }, { headers: { "cache-control": "no-store" } });
}
