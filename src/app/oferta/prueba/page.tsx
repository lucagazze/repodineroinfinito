import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { quote } from "@/lib/pricing";
import { T, money } from "@/lib/i18n";
import { buyerSettings, defaultCountry, newRun, DEFAULT_TEST_EMAIL } from "@/lib/test-purchase";
import { OTO_CSS } from "../[step]/oto.css";
import { PreviewPill } from "../[step]/PreviewPill";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compra de prueba, paso 1: el resumen del checkout como lo vería un
 * comprador de ese país (idioma de la oferta, moneda del país), con los bumps
 * elegidos. «Pagar» no cobra: sigue a la cadena post-compra real
 * (/oferta/simulacion en modo prueba), y al final se crea el pedido de prueba
 * y se mandan los mails reales. Solo el panel.
 *
 *   /oferta/prueba?store={slug}&funnel={id}&country=US&email=…[&name=][&bumps=id,id][&pp={cadena}]
 */
export default async function Prueba({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; funnel?: string; country?: string; email?: string; name?: string; bumps?: string | string[]; pp?: string }>;
}) {
  const allowed = await requireAdmin().then(() => true, () => false);
  if (!allowed) redirect("/entrar");

  const sp = await searchParams;
  if (!sp.store || !sp.funnel || !UUID.test(sp.funnel)) notFound();
  const { data: f } = await db
    .from("funnels")
    .select("id,slug,name,market_label,settings,store_id,stores!inner(id,slug,name,display_name,default_locale)")
    .eq("id", sp.funnel).eq("stores.slug", sp.store).maybeSingle();
  if (!f) notFound();
  const store = f.stores as unknown as { id: string; slug: string; name: string; display_name: string | null; default_locale: string };

  const country = /^[A-Za-z]{2}$/.test(sp.country ?? "") ? sp.country!.toUpperCase() : defaultCountry(f.market_label, store.default_locale);
  const email = /^\S+@\S+\.\S+$/.test((sp.email ?? "").trim()) ? sp.email!.trim() : DEFAULT_TEST_EMAIL;
  const name = (sp.name ?? "").trim().slice(0, 80);
  const { locale, currency } = await buyerSettings(store.id, store.default_locale, f.settings, country);

  const bumpIds = ([] as string[]).concat(sp.bumps ?? []).flatMap((x) => x.split(",")).filter((x) => UUID.test(x));
  const { data: bumpRows } = await db.from("products").select("id,slug").in("id", bumpIds.length ? bumpIds : ["00000000-0000-0000-0000-000000000000"]);
  const q = await quote({ storeSlug: store.slug, funnelSlug: f.slug, currency, bumpSlugs: (bumpRows ?? []).map((b) => b.slug) });
  if (!q) notFound();
  const t = T[locale] ?? T.en;
  const fmt = (n: number) => money(n, q.currency, locale);

  const next = new URLSearchParams({
    store: store.slug, funnel: f.id, lang: locale, currency: q.currency, country, email, prueba: newRun(), step: "0",
  });
  if (name) next.set("name", name);
  if (sp.pp && UUID.test(sp.pp)) next.set("pp", sp.pp);
  const takenBumps = q.lines.filter((l) => l.role === "bump").map((l) => l.product.id);
  if (takenBumps.length) next.set("bumps", takenBumps.join(","));

  return (
    <div className="oto" style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: OTO_CSS }} />
      <PreviewPill label="Compra de prueba" detail="no se cobra nada" />
      <main className="pg">
        <div className="banda">{store.display_name || store.name}</div>
        <section className="top">
          <div className="eyebrow" style={{ color: "#1c3479", background: "#eff4fd" }}>
            {f.market_label ? `${f.name} · ${f.market_label}` : f.name}
          </div>
          <h1>{t.ckSummary}</h1>
          <p className="sub">País {country} · idioma {locale} · moneda {q.currency} · mail a <b>{email}</b></p>
        </section>

        <section className="offer" style={{ marginTop: 18 }}>
          <div className="body">
            {q.lines.map((l) => (
              <div key={l.product.id} className="b" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.product.image_url && <img src={l.product.image_url} alt="" style={{ width: 44, borderRadius: 5, flex: "none" }} />}
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: "block" }}>{l.product.short_name}</b>
                    {l.role === "bump" && <small style={{ color: "#667085" }}>Order bump</small>}
                  </span>
                </span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                  {l.compareAt && l.compareAt > l.amount && <s style={{ color: "#667085", fontWeight: 500, marginRight: 6 }}>{fmt(l.compareAt)}</s>}
                  {fmt(l.amount)}
                </span>
              </div>
            ))}
            {[...q.included, ...q.bonuses.map((b) => b.product)].map((p) => (
              <div key={p.id} className="b" style={{ justifyContent: "space-between" }}>
                <span><i>✓</i> {p.short_name}</span>
                <span style={{ color: "#067647", fontWeight: 700 }}>{t.ckFree}</span>
              </div>
            ))}
            <div className="precio">
              <span className="antes">{t.ckTotal}</span>
              <span className="hoy">{fmt(q.total)}</span>
              <small>Prueba: no se cobra. Sigue la cadena post-compra real y al final llega el mail de entrega.</small>
            </div>
            <a className="si" href={`/oferta/simulacion?${next.toString()}`} style={{ textAlign: "center", textDecoration: "none" }}>
              {t.ckPay(fmt(q.total))}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
