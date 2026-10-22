import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db, getProductById, type Product } from "@/lib/db";
import { getRates, priceFor } from "@/lib/fx";
import { simulate, resolveStep, afterAccept, afterDecline, expandOwned } from "@/lib/postpurchase";
import { stepLabels } from "@/lib/postpurchase-labels";
import type { Locale } from "@/lib/i18n";
import { OfferScreen, isLocale, sampleCurrency } from "../[step]/screen";
import { ThankYouView } from "../../gracias/ThankYouView";
import { thankYouItems, thankYouTitle } from "../../gracias/items";
import { storeProducts } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const SAMPLE_ORDER = "3f9a7c21-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Simulación del post-pago de un checkout, como lo vive el comprador:
 * OTO 1 → sí/no → (downsell) → OTO 2 → … → gracias. Misma cadena y mismas
 * reglas que el pedido real (condiciones, packs, downsells) y las mismas
 * pantallas, pero nada se cobra ni se anota. Solo para el panel.
 *
 *   /oferta/simulacion?store={slug}&funnel={id|slug}[&bumps=id|slug,…][&lang=it][&currency=EUR][&name=][&pp={cadena}]
 * `pp`: probar esa cadena post-compra (aunque esté pausada o no sea la que se dispara).
 * El estado viaja en la URL: step (índice en la cadena, o "done") y got (lo
 * que "aceptó", que cuenta como suyo igual que en un pedido real).
 *
 * Compra de prueba (`prueba` = id de la corrida, más country y email): el
 * mismo recorrido, y al final, en lugar de la pantalla de gracias simulada,
 * /api/prueba/fin crea el pedido de prueba, manda los mails reales y lleva a
 * la página de gracias de ese pedido.
 */
export default async function Simulacion({
  searchParams,
}: {
  searchParams: Promise<{
    store?: string; funnel?: string; bumps?: string; lang?: string; currency?: string;
    name?: string; step?: string; got?: string; prueba?: string; country?: string; email?: string; pp?: string;
  }>;
}) {
  const allowed = await requireAdmin().then(() => true, () => false);
  if (!allowed) redirect("/entrar");

  const sp = await searchParams;
  if (!sp.store || !sp.funnel) notFound();
  const prueba = sp.prueba && /^[A-Za-z0-9_-]{6,40}$/.test(sp.prueba) ? sp.prueba : null;

  const { data: store } = await db
    .from("stores")
    .select("id,slug,name,display_name,guarantee_days,default_locale,logo_url,support_email,thankyou")
    .eq("slug", sp.store)
    .maybeSingle();
  if (!store) notFound();

  const { data: funnel } = await db
    .from("funnels")
    .select("id,slug,main_product_id,settings,funnel_items(role,sort_order,product_id)")
    .eq("store_id", store.id)
    .eq(UUID.test(sp.funnel) ? "id" : "slug", sp.funnel)
    .maybeSingle();
  if (!funnel) notFound();

  const catalog = await storeProducts<{ id: string; slug: string }>(store.id, "id,slug");
  const idOf = new Map(catalog.flatMap((p) => [[p.id, p.id], [p.slug, p.id]] as [string, string][]));
  const items = (funnel.funnel_items ?? []) as { role: string; sort_order: number; product_id: string }[];
  const bumpIds = new Set(items.filter((i) => i.role === "bump").map((i) => i.product_id));
  const chosen = [...new Set((sp.bumps ?? "").split(",").map((s) => idOf.get(s.trim())).filter((id): id is string => !!id && bumpIds.has(id)))];

  const pp = sp.pp && UUID.test(sp.pp) ? sp.pp : null;
  const sim = await simulate(store.id, funnel.id, chosen, { full: true, includePaused: true, ppFunnelId: pp });
  const got = [...new Set((sp.got ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  // Como un pedido real: lo del checkout y lo que "aceptó" ya es suyo (con lo que incluyen los packs).
  const owned = await expandOwned([...sim.owned, ...got.map((s) => idOf.get(s)).filter((x): x is string => !!x)]);
  const chain = { ...sim, owned };
  const labels = stepLabels(chain.meta);

  const fixed = ((funnel.settings ?? {}) as { locale?: string }).locale;
  const locale: Locale = isLocale(sp.lang) ? sp.lang : isLocale(fixed) ? fixed : isLocale(store.default_locale) ? store.default_locale : "en";
  const buyerName = sp.name !== undefined ? sp.name : prueba ? null : "Anna";
  const rates = await getRates();
  const currency = sampleCurrency(sp.currency, locale);

  const url = (o: { step: number | "done"; got: string[] }) => {
    const q = new URLSearchParams();
    q.set("store", store.slug);
    q.set("funnel", funnel.id);
    if (chosen.length) q.set("bumps", chosen.join(","));
    q.set("lang", locale);
    if (sp.currency) q.set("currency", sp.currency);
    if (sp.name !== undefined) q.set("name", sp.name);
    if (pp) q.set("pp", pp);
    if (prueba) {
      q.set("prueba", prueba);
      if (sp.country) q.set("country", sp.country);
      if (sp.email) q.set("email", sp.email);
    }
    if (o.got.length) q.set("got", o.got.join(","));
    if (o.step === "done" && prueba) return `/api/prueba/fin?${q.toString()}`;
    q.set("step", String(o.step));
    return `/oferta/simulacion?${q.toString()}`;
  };

  // El paso a mostrar, con las mismas reglas que /oferta/N: se saltea lo que
  // ya tiene o no cumple su condición, un downsell solo aparece si rechazó su
  // OTO, y lo que no tiene precio en esta moneda pasa al siguiente.
  const at = (i: number) => (i < 0 ? "done" : i);
  let i = sp.step === "done" ? -1 : resolveStep(chain, Math.max(0, Number(sp.step ?? 0) || 0));
  for (let guard = 0; i >= 0 && guard < chain.steps.length + 1; guard++) {
    const product = chain.steps[i];
    const price = priceFor(product, currency, rates);
    if (!price?.amount) { i = afterAccept(chain, i); continue; }

    const { data: content } = await db.from("products").select("postcompra_page,postcompra_html").eq("id", product.id).maybeSingle();
    return (
      <OfferScreen
        product={product}
        content={content}
        locale={locale}
        price={price}
        buyerName={buyerName}
        orderId={SAMPLE_ORDER}
        orderNumber="#1001"
        store={store}
        pillDetail={prueba ? `Compra de prueba · ${labels[i]}` : labels[i]}
        mode={{
          kind: "preview",
          acceptNext: url({ step: at(afterAccept(chain, i)), got: [...got, product.slug] }),
          declineNext: url({ step: at(afterDecline(chain, i)), got }),
        }}
      />
    );
  }

  // Compra de prueba: el pedido se crea al final, con lo que "aceptó".
  if (prueba) redirect(url({ step: "done", got }));

  // Fin de la cadena: las descargas, con lo que tendría el pedido.
  const kinds = new Map<string, string>();
  if (funnel.main_product_id) kinds.set(funnel.main_product_id, "main");
  for (const it of [...items].sort((a, b) => a.sort_order - b.sort_order)) {
    if ((it.role === "included" || it.role === "bonus") && !kinds.has(it.product_id)) kinds.set(it.product_id, it.role);
  }
  for (const id of chosen) if (!kinds.has(id)) kinds.set(id, "bump");
  for (const slug of got) { const id = idOf.get(slug); if (id && !kinds.has(id)) kinds.set(id, "upsell"); }
  const products = (await Promise.all([...kinds.keys()].map((id) => getProductById(id)))).filter((p): p is Product => !!p);
  const { items: cards, included } = thankYouItems(products, kinds, null);
  // `next` va incluido: la simulacion tiene que mostrar lo MISMO que ve el
  // comprador. Una vista previa que se saltea una seccion es peor que no tener
  // vista previa, porque se revisa en ella y se publica otra cosa.
  const ty = (store.thankyou ?? {}) as {
    title?: string; message?: string; showSpam?: boolean;
    next?: { kicker?: string; title: string; body?: string; bullets?: string[];
             note?: string; link?: { label: string; url: string } }[];
  };

  return (
    <ThankYouView
      locale={locale}
      storeName={store.display_name || store.name || ""}
      logoUrl={store.logo_url ?? null}
      supportEmail={store.support_email ?? null}
      orderNumber="#1001"
      title={thankYouTitle(locale, ty.title, buyerName)}
      message={ty.message?.trim() || null}
      email="anna@example.com"
      items={cards}
      included={included}
      summary={null}
      showSpam={ty.showSpam !== false}
      next={ty.next ?? []}
      guaranteeDays={Number(store.guarantee_days ?? 0)}
      preview={{}}
    />
  );
}
