import { Suspense } from "react";
import { after } from "next/server";
import { scopeFor, idsOrNone, type OfferFunnel, type Scope } from "@/lib/admin/offers";
import { Box } from "lucide-react";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { Card, PageHead, Empty } from "@/components/admin/ui";
import { productAlias } from "@/lib/admin/privacy";
import { checkoutUrls } from "@/lib/admin/links";
import { syncMissingLinks } from "@/lib/admin/alerts";
import { ScopeName } from "@/components/admin/OfferBlocks";
import ProductsTable, { type QRow, type RoleTag } from "@/components/admin/ProductsTable";
import { SkCard } from "@/components/admin/Skeleton";
import { deliveryPdfs } from "@/lib/admin/presale";

export const dynamic = "force-dynamic";

type Market = { currency: string; countries: string[]; is_default: boolean };

/**
 * La moneda en que cobra un checkout: la fija del checkout (settings.currency,
 * p. ej. EUR en la oferta alemana), si no la del mercado de su primer país
 * («EE. UU. + Reino Unido» → USD), si no la del mercado por defecto.
 */
function currencyOf(f: OfferFunnel, markets: Market[], fixed: Map<string, string>) {
  if (fixed.get(f.id)) return fixed.get(f.id)!;
  const def = markets.find((m) => m.is_default)?.currency ?? "USD";
  const cc = f.flags[0]?.toUpperCase();
  return (cc && markets.find((m) => m.countries.some((c) => c.toUpperCase() === cc))?.currency) || def;
}

/** Orden de la tabla: Principal, Bonos, Upsells del checkout, OTO 1 (y su downsell), OTO 2, OTO 3. */
const rank = (r: RoleTag) => (r.key === "main" ? 0 : r.key === "bonus" ? 1 : r.key === "bump" ? 2 : 10 * (r.n ?? 1) + (r.key === "downsell" ? 5 : 0));
const tagKey = (r: RoleTag) => `${r.key}${r.n ?? ""}`;

type Step = { id?: string; product_id: string; sort_order?: number; kind?: string; downsell_of?: string | null; level?: number | null };
type Prod = {
  id: string; slug: string; short_name: string; name: string; description: string | null; kind: string; active: boolean;
  image_url: string | null; email_image_url: string | null; delivery_url: string | null; delivery_file: string | null;
  delivery_links?: { url?: string }[] | null;
  variant_of?: string | null; product_prices: { currency: string; amount: number | string | null; compare_at: number | string | null }[] | null;
};
const PCOLS = "id,slug,short_name,name,description,kind,active,image_url,email_image_url,delivery_url,delivery_file,delivery_links,product_prices(currency,amount,compare_at)";

/** Pasos del post-pago de cada cadena: OTO 1..3 por nivel (migración 021) o, en cadenas viejas, por orden. */
async function ppSteps(ids: string[]) {
  const full = await db.from("pp_funnels").select("id,pp_steps(id,product_id,sort_order,kind,downsell_of,level)").in("checkout_funnel_id", ids);
  if (!full.error) return (full.data ?? []) as unknown as { pp_steps: Step[] }[];
  const old = await db.from("pp_funnels").select("id,pp_steps(product_id,sort_order)").in("checkout_funnel_id", ids);
  return (old.data ?? []) as unknown as { pp_steps: Step[] }[];
}

export default async function Productos({ params }: { params: Promise<{ offer: string }> }) {
  const sc = await scopeFor((await params).offer);
  // El encabezado sale al instante; la tabla (5 a 7 consultas, en dos tandas) llega después con su esqueleto.
  return (
    <>
      <PageHead title="Productos" icon={<Box className="h-[18px] w-[18px]" />} color="#ec4899"
        sub={<>Lo que vende y regala <ScopeName sc={sc} />: el principal, sus bonos, los upsells del checkout y los OTO del post-pago.</>} />
      <Suspense fallback={<div data-skeleton><SkCard rows={8} h={420} /></div>}>
        <ProductsSection sc={sc} />
      </Suspense>
    </>
  );
}

async function ProductsSection({ sc }: { sc: Scope }) {
  const store = sc.store;
  const base = `${sc.base}/productos`;

  // Qué papel juega cada producto en los mercados de la oferta (los links de
  // producto suelto no cuentan: son otra forma de vender lo mismo).
  const ids = idsOrNone(sc.markets.map((f) => f.id));
  const [prodQ, { data: fi }, pp, { data: mk }, { data: fx }, rates] = await Promise.all([
    // variant_of (migración 021): si la columna todavía no está, sin ella.
    db.from("products").select(`${PCOLS},variant_of`).eq("store_id", store.id).order("kind").order("sort_order")
      .then((r) => (r.error ? db.from("products").select(PCOLS).eq("store_id", store.id).order("kind").order("sort_order") : r)),
    db.from("funnel_items").select("product_id,funnel_id,role").in("funnel_id", ids),
    ppSteps(ids),
    db.from("markets").select("currency,countries,is_default").eq("store_id", store.id),
    db.from("funnels").select("id,currency:settings->>currency").in("id", ids),
    getRates(),
  ]);
  const all = (prodQ.data ?? []) as unknown as Prod[];
  const roles = new Map<string, Map<string, RoleTag>>();
  const add = (pid: string | null, r: RoleTag) => { if (pid) roles.set(pid, (roles.get(pid) ?? new Map()).set(tagKey(r), r)); };
  for (const f of sc.markets) add(f.main_product_id, { key: "main" });
  for (const r of fi ?? []) add(r.product_id, { key: r.role === "bump" || r.role === "upsell" ? "bump" : "bonus" });
  for (const c of pp) {
    const steps = [...(c.pp_steps ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const otos = steps.filter((x) => (x.kind ?? "oto") === "oto");
    const levelOf = new Map(otos.map((x, i) => [x.id ?? x.product_id, x.level ?? i + 1]));
    for (const x of otos) add(x.product_id, { key: "oto", n: levelOf.get(x.id ?? x.product_id) });
    for (const x of steps.filter((y) => y.kind === "downsell")) add(x.product_id, { key: "downsell", n: x.level ?? levelOf.get(x.downsell_of ?? "") ?? 1 });
  }
  const tags = (pid: string) => [...(roles.get(pid)?.values() ?? [])].sort((a, b) => rank(a) - rank(b));
  const order = (pid: string) => Math.min(...tags(pid).map(rank));
  const used = all.filter((p) => roles.has(p.id));
  // Variantes de precio del mismo libro (variant_of): van dentro de la fila de su producto base, no sueltas.
  const usedIds = new Set(used.map((p) => p.id));
  const isVariant = (p: Prod) => !!p.variant_of && usedIds.has(p.variant_of) && p.variant_of !== p.id;
  const products = used.filter((p) => !isVariant(p))
    .map((p, i) => ({ p, i })).sort((a, b) => order(a.p.id) - order(b.p.id) || a.i - b.i).map((x) => x.p);

  // Link para vender cada producto solo: un checkout activo de la tienda con
  // ese producto como principal y sin bumps ni post compra (los de esta oferta primero).
  const pids = used.map((p) => p.id);
  const { data: cand } = await db.from("funnels").select("id,slug,offer_id,checkout_host,checkout_path,main_product_id")
    .eq("store_id", store.id).eq("active", true).in("main_product_id", idsOrNone(pids));
  const cids = idsOrNone((cand ?? []).map((f) => f.id));
  const [{ data: cIts }, { data: cPps }] = await Promise.all([
    db.from("funnel_items").select("funnel_id").in("funnel_id", cids).in("role", ["bump", "upsell"]),
    db.from("pp_funnels").select("checkout_funnel_id").in("checkout_funnel_id", cids),
  ]);
  const busy = new Set([...(cIts ?? []).map((x) => x.funnel_id), ...(cPps ?? []).map((x) => x.checkout_funnel_id)]);
  const solo = new Map<string, string>();
  for (const f of [...(cand ?? [])].sort((a, b) => Number(b.offer_id === sc.offer.id) - Number(a.offer_id === sc.offer.id))) {
    if (!busy.has(f.id) && f.main_product_id && !solo.has(f.main_product_id)) solo.set(f.main_product_id, checkoutUrls(store, f).primary);
  }

  // Un mercado: su moneda. La oferta entera: la que comparten sus mercados, o la del mercado por defecto.
  const markets = (mk ?? []) as Market[];
  const fixed = new Map(((fx ?? []) as { id: string; currency: string | null }[]).filter((f) => f.currency).map((f) => [f.id, f.currency!.toUpperCase()]));
  const curs = [...new Set(sc.markets.map((f) => currencyOf(f, markets, fixed)))];
  const currency = curs.length === 1 ? curs[0] : markets.find((m) => m.is_default)?.currency ?? "USD";

  const num = (v: unknown) => (v == null ? null : Number(v));
  const extraLinks = (p: Prod) => (p.delivery_links ?? []).filter((l) => l?.url).length;
  const toRow = (p: Prod): QRow => {
    const rs = tags(p.id);
    const prices = (p.product_prices ?? []).map((x) => ({ currency: x.currency, amount: num(x.amount), compare_at: num(x.compare_at) }))
      .sort((a, b) => (a.currency === "USD" ? -1 : b.currency === "USD" ? 1 : a.currency.localeCompare(b.currency)));
    const own = sc.markets.filter((f) => f.main_product_id === p.id);
    const links = own.length
      ? own.map((f) => ({ label: own.length > 1 || sc.markets.length > 1 ? f.market_label || f.name : "", url: checkoutUrls(store, f).primary }))
      : solo.has(p.id) ? [{ label: "", url: solo.get(p.id)! }] : [];
    return {
      id: p.id, alias: productAlias(p.id), active: p.active, roles: rs,
      name: p.name, short_name: p.short_name, description: p.description ?? "",
      image: p.email_image_url ?? p.image_url, delivery_url: p.delivery_url,
      // Sin link principal pero con archivo propio o links extra: se dice qué tiene.
      file: p.delivery_file ? "Archivo propio" : extraLinks(p) ? `${extraLinks(p)} ${extraLinks(p) === 1 ? "link" : "links"}` : null,
      prices, links,
      // Se vende solo si tiene precio en la moneda del checkout (EUR en la oferta alemana) o en USD (las demás se convierten).
      canCreate: !own.length && prices.some((x) => (x.currency === currency || x.currency === "USD") && Number(x.amount) > 0),
      variants: [],
    };
  };
  // El PDF de cada entrega, para abrirlo directo desde la tabla. Guardado 30 min.
  const pdfOf = new Map(await Promise.all(used.map(async (p) => [p.id, await deliveryPdfs(p.delivery_url).catch(() => [])] as const)));
  const rows: QRow[] = products.map((p) => ({
    ...toRow(p),
    pdfs: pdfOf.get(p.id) ?? [],
    variants: used.filter((v) => isVariant(v) && v.variant_of === p.id).sort((a, b) => order(a.id) - order(b.id)).map(toRow),
  }));

  // Activos que se venden o se entregan sin link: aviso para Claude (y se cierra solo cuando lo tienen).
  // Después de responder (after): son escrituras en avisos y no tienen por qué demorar la tabla.
  const deliverable = (p: Prod) => tags(p.id).some((t) => t.key !== "bonus");
  const lacks = (p: Prod) => !p.delivery_url && !p.delivery_file && !extraLinks(p);
  const missing = used.filter((p) => p.active && deliverable(p) && lacks(p)).map((p) => ({ id: p.id, name: p.short_name, link: `${base}/${p.id}` }));
  const fine = used.filter((p) => !lacks(p) || !p.active).map((p) => p.id);
  after(() => syncMissingLinks(store.id, missing, fine));

  return products.length ? (
    <ProductsTable store={store.slug} offerKey={sc.offer.key} market={sc.market?.slug ?? null} base={base}
      currency={currency} rate={rates[currency] ?? null} initial={rows} />
  ) : (
    <Card><Empty title="No hay productos" icon={<Box className="h-5 w-5" />}>Los productos los carga Claude por el MCP.</Empty></Card>
  );
}
