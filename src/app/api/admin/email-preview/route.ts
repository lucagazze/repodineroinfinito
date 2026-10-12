import { NextRequest, NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getFunnel, getProductById, itemsByRole } from "@/lib/db";
import { renderDelivery, renderRecovery } from "@/lib/email";
import { LOCALES, type Locale } from "@/lib/i18n";
import { siteUrl } from "@/lib/recovery";

export const runtime = "nodejs";

/** Vista previa de los emails al comprador, con los productos reales del embudo. */
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn())) return new NextResponse("No autorizado", { status: 401 });
  const q = req.nextUrl.searchParams;
  const funnel = await getFunnel(q.get("store") ?? "", q.get("funnel") ?? "");
  const main = funnel?.main_product_id ? await getProductById(funnel.main_product_id) : null;
  if (!funnel || !main) return new NextResponse("Embudo no encontrado", { status: 404 });

  const locale = (LOCALES as readonly string[]).includes(q.get("locale") ?? "")
    ? (q.get("locale") as Locale) : (funnel.stores.default_locale as Locale);
  const currency = q.get("currency") ?? (locale === "it" ? "EUR" : "USD");
  const price = main.product_prices.find((p) => p.currency === currency) ?? main.product_prices.find((p) => p.currency === "USD");

  const html = q.get("type") === "recovery"
    ? renderRecovery({
        to: "", name: "Giulia Rossi", store: funnel.stores, locale, product: main,
        url: `${siteUrl()}/c/${funnel.stores.slug}/${funnel.slug}`, amount: Number(price?.amount ?? 0), currency,
      }).html
    : renderDelivery({
        to: "", name: "Giulia Rossi", store: funnel.stores, locale, main,
        extras: [...itemsByRole(funnel, "included"), ...itemsByRole(funnel, "bonus"), ...itemsByRole(funnel, "bump").slice(0, 1)],
        currency, orderRef: "#1001", total: Number(price?.amount ?? 0),
      }).html;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "x-frame-options": "SAMEORIGIN" },
  });
}
