import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { offerList, offerKeyOfFunnel } from "@/lib/admin/offers";

/**
 * Las direcciones viejas por tienda (/admin/s/tienda/…) llevan a la oferta
 * que corresponde: la del checkout o el pedido si la URL los nombra, si no la
 * primera oferta activa de esa tienda. Es un redirect HTTP de verdad (una
 * página lo hacía a mitad del streaming y la barra seguía con la URL vieja).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ store: string; rest?: string[] }> }) {
  if (!(await isLoggedIn())) return NextResponse.redirect(new URL("/entrar", req.url));
  const { store, rest = [] } = await params;
  const offers = (await offerList()).filter((o) => o.store.slug === store);
  if (!offers.length) return NextResponse.redirect(new URL("/admin", req.url));
  let key = (offers.find((o) => o.active) ?? offers[0]).key;
  const [section, id] = rest;
  if (id && section === "embudos") key = (await offerKeyOfFunnel(id)) ?? key;
  if (id && section === "ventas") {
    const { data } = await db.from("orders").select("funnel_id").eq("id", id).maybeSingle();
    if (data?.funnel_id) key = (await offerKeyOfFunnel(data.funnel_id)) ?? key;
  }
  const path = `/admin/o/${key}${rest.length ? `/${rest.map(encodeURIComponent).join("/")}` : ""}`;
  return NextResponse.redirect(new URL(path + req.nextUrl.search, req.url));
}
