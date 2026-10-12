import { NextRequest, NextResponse } from "next/server";
import { db, STORE_COLS, type Store } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { brandFor } from "@/lib/brand";
import { siteUrl } from "@/lib/recovery";
import { signLibrary, LINK_TTL_S, LIB_COOKIE, COOKIE_TTL_S } from "@/lib/library-auth";
import { storeForHost } from "@/lib/library";
import { libTexts, libLocale } from "@/lib/library-texts";
import { legacyOrders } from "@/lib/legacy-lookup";

export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * «Mandame el link» de Mi biblioteca: si ese email compró en la tienda (acá o en el checkout anterior), le llega
 * un link para entrar (vale 48 h). La respuesta es siempre la misma, compre o no (no se puede averiguar quién
 * compró). Como mucho 3 links por email cada hora.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { store?: string; email?: string; locale?: string; direct?: boolean };
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return NextResponse.json({ error: "email" }, { status: 400, headers: NO_STORE });
  const { data: s } = await db.from("stores").select(STORE_COLS).eq("slug", String(b.store ?? "")).maybeSingle();
  if (!s) return NextResponse.json({ error: "store" }, { status: 404, headers: NO_STORE });
  const store = s as unknown as Store;

  const { data: order } = await db.from("orders").select("locale").eq("store_id", store.id).ilike("email", like(email))
    .eq("status", "paid").order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Compró acá, en el checkout anterior, o el administrador le desbloqueó algo (library_grants).
  const { count: grants } = await db.from("library_grants").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("email", email);
  const bought = !!order || (grants ?? 0) > 0 || (await legacyOrders([email], store).catch(() => [])).some((o) => o.status === "paid");

  // Entrar directo: si el mail compró, entra ya, con una sesión sin verificar (ve y baja lo suyo; para
  // comprar se le pide la tarjeta). Límite de intentos por IP (aparte del login del panel: prefijo «bib:»).
  if (b.direct) {
    const ip = `bib:${(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?"}`;
    const { count: fails } = await db.from("login_attempts").select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("ok", false).gte("at", new Date(Date.now() - 15 * 60_000).toISOString());
    if ((fails ?? 0) >= 15) return NextResponse.json({ ok: false, tooMany: true }, { headers: NO_STORE });
    await db.from("login_attempts").insert({ ip, ok: bought });
    if (!bought) return NextResponse.json({ ok: false, notFound: true }, { headers: NO_STORE });
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const res = NextResponse.json({ ok: true, direct: true }, { headers: NO_STORE });
    res.cookies.set(LIB_COOKIE, signLibrary(store.id, email, COOKIE_TTL_S, false, true), {
      httpOnly: true, secure: proto === "https", sameSite: "lax", path: "/", maxAge: COOKIE_TTL_S,
    });
    return res;
  }
  if (!bought) return NextResponse.json({ ok: true }, { headers: NO_STORE });

  const { count } = await db.from("email_log").select("id", { count: "exact", head: true })
    .eq("store_id", store.id).eq("kind", "access").ilike("to_email", like(email)).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 3) return NextResponse.json({ ok: true, tooMany: true }, { headers: NO_STORE });

  // El link va al mismo dominio desde el que lo pidió, si es de esta tienda; si no, a la app.
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const own = (await storeForHost(host))?.id === store.id;
  // El subdominio propio de la biblioteca (migración 067), si la tienda tiene uno: el link siempre lleva ahí.
  const { data: ld } = await db.from("stores").select("library_domain").eq("id", store.id).maybeSingle();
  const libDomain = (ld as { library_domain?: string | null } | null)?.library_domain ?? null;
  const base = libDomain ? `https://${libDomain}` : own ? `https://${host}/biblioteca` : `${siteUrl()}/biblioteca/${store.slug}`;
  const url = `${base}/entrar?t=${encodeURIComponent(signLibrary(store.id, email, LINK_TTL_S))}`;

  const locale = libLocale((order?.locale as string | null) ?? b.locale ?? store.default_locale);
  const t = libTexts(locale);
  const brand = brandFor(store, locale);
  const logo = store.logo_url ?? ((store.brand as { logoEmail?: string } | null)?.logoEmail ?? null);
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:36px 32px">
<tr><td align="center" style="padding-bottom:22px">${logo ? `<img src="${esc(logo)}" alt="${esc(brand)}" height="40" style="height:40px;max-width:200px;object-fit:contain">` : `<b style="font-size:20px">${esc(brand)}</b>`}</td></tr>
<tr><td style="font-size:22px;font-weight:700;line-height:1.3;padding-bottom:10px;text-align:center">${esc(t.title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#424245;text-align:center;padding-bottom:26px">${esc(t.mailIntro)}</td></tr>
<tr><td align="center" style="padding-bottom:26px"><a href="${esc(url)}" style="display:inline-block;background:#1d1d1f;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:15px 30px;border-radius:999px">${esc(t.mailButton)}</a></td></tr>
<tr><td style="font-size:12.5px;line-height:1.5;color:#86868b;text-align:center">${esc(t.mailNote)}</td></tr>
</table>
<p style="font-size:12px;color:#86868b;margin:18px 0 0">${esc(brand)} · <a href="mailto:${esc(store.support_email)}" style="color:#86868b">${esc(store.support_email)}</a></p>
</td></tr></table></body></html>`;

  const r = await sendMail({ store, to: email, subject: t.mailSubject(brand), html, tag: "biblioteca", kind: "access" }).catch((e) => ({ error: (e as Error).message }));
  if (r && "error" in r && r.error) console.error("[biblioteca] link:", r.error);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
