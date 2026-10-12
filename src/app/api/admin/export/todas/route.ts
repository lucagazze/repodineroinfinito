import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { resolveRange } from "@/lib/admin/range";
import { loadSales, parseSaleFilters, filterSales, sortSales, saleStatus, SALE_CSV_HEAD } from "@/lib/admin/all-sales";
import { toCsv, csvNum, csvDate } from "@/lib/admin/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ventas de TODAS las tiendas en CSV (/admin/ventas → «Exportar CSV»), con los mismos filtros y
 * el mismo orden que la pantalla, pero sin paginar. BOM + punto y coma: abre directo en Excel.
 */
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return new NextResponse("No autorizado", { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseSaleFilters(sp);
  const R = resolveRange({ r: f.r, desde: f.desde, hasta: f.hasta });
  const { sales } = await loadSales(R);
  const rows = sortSales(filterSales(sales, f), f.o, f.d);

  const csv = toCsv(SALE_CSV_HEAD, rows.map((s) => [
    csvDate(s.createdAt), s.ref, s.name, s.email, s.phone, s.country, s.locale, s.storeName, s.offerName ?? "", s.checkout ?? "",
    s.items.map((it) => (it.kind === "main" ? it.name : `${it.kind === "bump" ? "Bump" : "OTO"}: ${it.name}`)).join(" + "),
    s.bumps, s.otos, s.currency, csvNum(s.total), csvNum(s.usd), saleStatus(s),
    s.refunded > 0 ? csvNum(s.refunded) : "", s.refunded > 0 ? csvNum(s.refundedUsd) : "",
    s.status === "refunded" ? "" : s.deliveredAt ? "si" : "no", s.utmSource, s.utmCampaign,
  ]));
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ventas-${R.since}-a-${R.until}.csv"`,
      "cache-control": "no-store",
    },
  });
}
