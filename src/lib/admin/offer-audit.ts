import { db } from "@/lib/db";
import { checkoutUrl } from "@/lib/checkout-url";
import { pixelsFor } from "@/lib/meta";
import { pixelNames, pixelRef, pixelText } from "./pixel-names";
import { stripeHealth } from "@/lib/stripe-connect";
import { resolveSettings } from "@/lib/checkout-settings";
import { clarityProject } from "@/lib/clarity";
import { simulate, firstPending, resolveStep, afterDecline, type Chain } from "@/lib/postpurchase";
import { offerList, type OfferFunnel, type OfferItem } from "./offers";
import { checkHttp } from "./domains";
import { pixelStats } from "./diag-live";
import type { DiagCheck } from "./diagnostico";
import { worst, type AuditCell, type OfferAuditRow } from "./offer-audit-types";
import { testStoreIds } from "@/lib/test-store";

/**
 * Diagnóstico de cada oferta activa, por mercado (su checkout), en una fila:
 * landing (responde y su botón lleva a ESTE checkout), checkout (responde,
 * con precio), pixel (cargado, con CAPI, el mismo en la landing), eventos de
 * las últimas 24 h, bumps, post-pago (cadena activa y cuántos niveles ve el
 * comprador), downsells, links de entrega, webhook de Stripe, recuperación de
 * carritos y grabación. Todo en el momento, nada de caché.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const UA = "Mozilla/5.0 (checkout-panel diagnóstico)";
/** Botones de comprar que NO son de la app: si la landing todavía manda ahí, se vende por otro lado. */
const FOREIGN = /mitiendanube|tiendanube|hotmart|kiwify|gumroad|shopify\.com\/checkout|eduzz|monetizze/i;

type FunnelRow = { id: string; store_id: string; pixel_ids: string[] | null; settings: unknown; record_sessions: boolean | null; main_product_id: string | null };
type ProdRow = { id: string; slug: string; short_name: string | null; active: boolean; includes: string[] | null; delivery_url: string | null; delivery_links: { url?: string }[] | null; delivery_file: string | null; presale: boolean | null; presale_days: number | null; subscription: boolean | null };
type Price = { product_id: string; currency: string; amount: number | null };

/** De a pocos a la vez: no martillar Drive ni las landings. */
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}

async function getHtml(url: string) {
  const t = Date.now();
  try {
    const r = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": UA } });
    return { status: r.status, html: await r.text(), final: r.url, ms: Date.now() - t, error: null as string | null };
  } catch (e) {
    return { status: null as number | null, html: "", final: url, ms: Date.now() - t, error: (e as Error).message };
  }
}

const norm = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch { return ""; }
};

/** Landing: responde, carga pixel y su botón de compra lleva a ESTE checkout (no a la plataforma anterior ni a otro). */
function landingCell(f: OfferFunnel, storeSlug: string, storeDomain: string | null, page: Awaited<ReturnType<typeof getHtml>> | null, ckUrl: string): AuditCell {
  if (!f.landing_url) return { status: "warn", label: "Sin landing", detail: "El checkout no tiene landing cargada (landing_url): no se puede revisar a dónde manda el botón." };
  if (!page || !page.status || page.status >= 400) return { status: "bad", label: page?.status ? `Responde ${page.status}` : "No responde", detail: `${f.landing_url}: ${page?.error ?? page?.status ?? "sin respuesta"}` };
  const hrefs = [...page.html.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)].map((m) => {
    try { return new URL(m[1].replace(/&amp;/g, "&"), page.final).toString(); } catch { return ""; }
  }).filter(Boolean);
  const landHost = (() => { try { return new URL(page.final).host; } catch { return ""; } })();
  const want = new Set([norm(ckUrl), f.checkout_path ? norm(`https://${landHost}${f.checkout_path}`) : "", storeDomain ? norm(`https://${storeDomain}/${f.slug}`) : ""].filter(Boolean));
  const mine = hrefs.filter((h) => want.has(norm(h)) || new URL(h).pathname.replace(/\/+$/, "") === `/c/${storeSlug}/${f.slug}`);
  const foreign = [...new Set(hrefs.filter((h) => FOREIGN.test(h)).map((h) => new URL(h).host))];
  if (foreign.length) return { status: "bad", label: "Botón a otro checkout", detail: `La landing tiene links a ${foreign.join(", ")}: esas ventas no pasan por la app.` };
  if (!mine.length) return { status: "bad", label: "El botón no lleva al checkout", detail: `Ningún link de ${f.landing_url} lleva a ${ckUrl.replace(/^https:\/\//, "")}.` };
  return { status: "ok", label: `${page.status} · botón ✓`, detail: `${f.landing_url.replace(/^https:\/\//, "")} → ${norm(mine[0])} (${plural(mine.length, "botón", "botones")}) · ${page.ms} ms` };
}

/** Lo que vería un comprador sin bumps si dice que no a todo: cuántos niveles distintos se le ofrecen. */
function declineAllLevels(c: Chain) {
  const levels = new Set<number>();
  let i = firstPending(c);
  i = i < 0 ? -1 : resolveStep(c, i);
  for (let guard = 0; i >= 0 && guard < 60; guard++) {
    levels.add(c.meta[i].level);
    const d = afterDecline(c, i);
    i = d < 0 ? -1 : resolveStep(c, d);
  }
  return levels.size;
}

export async function postPurchaseOf(storeId: string, funnelId: string, bumpIds: string[]) {
  const none = await simulate(storeId, funnelId, [], { full: true });
  const all = bumpIds.length ? await simulate(storeId, funnelId, bumpIds, { full: true }) : none;
  const otos = none.meta.map((m, i) => (m.kind === "oto" ? i : -1)).filter((i) => i >= 0);
  const withDs = new Set(none.meta.filter((m) => m.kind === "downsell" && m.parent !== null).map((m) => m.parent!));
  return {
    name: none.name, ppFunnelId: none.ppFunnelId, steps: none.steps.length, bumps: bumpIds.length,
    levels: declineAllLevels(none), levelsAllBumps: declineAllLevels(all),
    configuredLevels: new Set(none.meta.filter((m) => m.kind === "oto").map((m) => m.level)).size,
    otos: otos.length, otosWithDs: otos.filter((i) => withDs.has(i)).length,
    productIds: [...new Set([...none.steps, ...all.steps].map((p) => p.id))],
  };
}

function postCell(pp: Awaited<ReturnType<typeof postPurchaseOf>>): AuditCell {
  if (!pp.steps || !pp.levels) return { status: "bad", label: "Sin post-pago", detail: "Después de pagar no se le ofrece nada: no hay cadena post-compra activa para este checkout (ni upsells cargados)." };
  const allB = pp.levelsAllBumps !== pp.levels ? ` · con todos los bumps: ${plural(pp.levelsAllBumps, "nivel", "niveles")}` : "";
  // El mejor comprador (el que agrega todos los bumps) no ve ningún OTO: la cadena está hecha con los
  // mismos libros de los bumps y el motor no ofrece lo que ya tiene. Las reglas dicen que está bien; no lo está.
  if (pp.bumps && !pp.levelsAllBumps) {
    return {
      status: "bad", label: "0 OTO con todos los bumps",
      detail: `«${pp.name ?? "upsells del checkout"}»: el comprador sin bumps ve ${plural(pp.levels, "nivel", "niveles")}, pero el que agrega los ${pp.bumps} bumps no ve ninguno (la cadena repite los bumps). Sumale un nivel con algo que no esté en el checkout, p. ej. la biblioteca completa.`,
    };
  }
  return {
    status: pp.levels >= 3 ? "ok" : "warn",
    label: plural(pp.levels, "nivel", "niveles"),
    detail: `«${pp.name ?? "upsells del checkout"}»: el comprador sin bumps ve ${plural(pp.levels, "nivel", "niveles")}${allB}. ${pp.otos} OTO cargados.${pp.levels < 3 ? " Lo ideal son 3 niveles." : ""}`,
  };
}

export async function auditOffers(opts: { storeId?: string; offerKey?: string } = {}): Promise<OfferAuditRow[]> {
  // Las tiendas de prueba (llaves de test de Stripe) no son ofertas que vendan: fuera del diagnóstico.
  const test = await testStoreIds();
  const offers = (await offerList()).filter((o) => o.active && !test.has(o.store.id) && (!opts.storeId || o.store.id === opts.storeId) && (!opts.offerKey || o.key === opts.offerKey));
  const markets = offers.flatMap((o) => o.markets.filter((f) => f.active).map((f) => ({ o, f })));
  if (!markets.length) return [];
  const since24 = new Date(Date.now() - 864e5).toISOString();

  const { data: frows } = await db.from("funnels").select("id,store_id,pixel_ids,settings,record_sessions,main_product_id").in("id", markets.map((m) => m.f.id));
  const { data: items } = await db.from("funnel_items").select("funnel_id,product_id,role").in("funnel_id", markets.map((m) => m.f.id));
  const fOf = new Map(((frows ?? []) as FunnelRow[]).map((f) => [f.id, f]));

  const limit = limiter(8);
  const linkCache = new Map<string, Promise<{ ok: boolean; why: string }>>();
  const checkLink = (url: string) => {
    if (!linkCache.has(url)) {
      linkCache.set(url, limit(async () => {
        const h = await checkHttp(url);
        const login = !!h.location && /accounts\.google\.com|ServiceLogin/i.test(h.location);
        return { ok: !!h.status && h.status < 400 && !login, why: login ? "pide iniciar sesión (no está compartido)" : h.status ? `responde ${h.status}` : h.error ?? "no responde" };
      }));
    }
    return linkCache.get(url)!;
  };
  /** Con que cobra cada tienda y, si es Whop, como esta su webhook.
   *  Sin esto el control preguntaba SIEMPRE por Stripe, y una tienda que cobra
   *  con Whop salia «Stripe sin conectar» en rojo con el cobro andando
   *  perfecto. Un aviso que siempre esta encendido deja de mirarse. */
  const pasarelaCache = new Map<string, Promise<{ gateway: string; whop: { webhook_id: string | null; webhook_secret_enc: string | null; last_event_at: string | null } | null }>>();
  const pasarelaDe = (storeId: string) => {
    if (!pasarelaCache.has(storeId)) {
      pasarelaCache.set(storeId, (async () => {
        const [{ data: s }, { data: w }] = await Promise.all([
          db.from("stores").select("gateway").eq("id", storeId).maybeSingle(),
          db.from("store_whop").select("webhook_id,webhook_secret_enc,last_event_at").eq("store_id", storeId).maybeSingle(),
        ]);
        return { gateway: ((s?.gateway as string | null) ?? "stripe"), whop: (w as never) ?? null };
      })());
    }
    return pasarelaCache.get(storeId)!;
  };

  const healthCache = new Map<string, ReturnType<typeof stripeHealth>>();
  const healthOf = (storeId: string) => {
    if (!healthCache.has(storeId)) healthCache.set(storeId, stripeHealth(storeId).catch((e) => ({ connected: true, error: (e as Error).message }) as Awaited<ReturnType<typeof stripeHealth>>));
    return healthCache.get(storeId)!;
  };
  const statsCache = new Map<string, Promise<Map<string, number> | null>>();
  const statsOf = (pixel: string) => {
    if (!statsCache.has(pixel)) {
      statsCache.set(pixel, pixelStats(pixel, "event").then((rows) => {
        if (!rows) return null;
        const m = new Map<string, number>();
        for (const b of rows) for (const d of b.data) m.set(d.value, (m.get(d.value) ?? 0) + d.count);
        return m;
      }).catch(() => null));
    }
    return statsCache.get(pixel)!;
  };

  const rows = await Promise.all(markets.map(async ({ o, f }) => auditMarket(o, f)));
  return rows.sort((a, b) => ({ bad: 0, warn: 1, ok: 2, off: 3 })[a.status] - ({ bad: 0, warn: 1, ok: 2, off: 3 })[b.status] || a.offer.localeCompare(b.offer));

  async function auditMarket(o: OfferItem, f: OfferFunnel): Promise<OfferAuditRow> {
    const fr = fOf.get(f.id);
    const storeId = o.store.id;
    const ckUrl = checkoutUrl(f, o.store.slug);
    const mine = (items ?? []).filter((i) => i.funnel_id === f.id);
    const bumpIds = mine.filter((i) => i.role === "bump").map((i) => i.product_id as string);
    const settings = resolveSettings(fr?.settings);

    const [land, ck, pp, px, health, pasarela, visits, orders] = await Promise.all([
      f.landing_url ? limit(() => getHtml(f.landing_url!)) : Promise.resolve(null),
      limit(() => getHtml(ckUrl)),
      postPurchaseOf(storeId, f.id, bumpIds).catch((e) => ({ error: (e as Error).message }) as const),
      pixelsFor(storeId, fr?.pixel_ids ?? []),
      healthOf(storeId),
      pasarelaDe(storeId),
      db.from("site_events").select("id", { count: "exact", head: true }).eq("funnel_id", f.id).eq("event", "view").gte("at", since24),
      db.from("orders").select("id,capi_sent_at").eq("funnel_id", f.id).eq("status", "paid").gte("created_at", since24),
    ]);

    // Productos que se entregan desde este checkout: principal, incluidos, bonos, bumps y todo lo del post-pago.
    const pids = [...new Set([fr?.main_product_id, ...mine.map((i) => i.product_id as string), ...("error" in pp ? [] : pp.productIds)].filter(Boolean) as string[])];
    const [{ data: prods }, { data: prices }] = await Promise.all([
      db.from("products").select("id,slug,short_name,active,includes,delivery_url,delivery_links,delivery_file,presale,presale_days,subscription")
        .in("id", pids.length ? pids : ["00000000-0000-0000-0000-000000000000"])
        .then(async (r) => {
          const dentro = [...new Set(((r.data ?? []) as { includes: string[] | null }[])
            .flatMap((x) => (x.includes ?? []).filter(Boolean)))].filter((id) => !pids.includes(id));
          if (!dentro.length || r.error) return r;
          const hijos = await db.from("products")
            .select("id,slug,short_name,active,includes,delivery_url,delivery_links,delivery_file,presale,presale_days,subscription")
            .in("id", dentro);
          return { ...r, data: [...(r.data ?? []), ...(hijos.data ?? [])] };
        }),
      db.from("product_prices").select("product_id,currency,amount").eq("product_id", fr?.main_product_id ?? "00000000-0000-0000-0000-000000000000"),
    ]);

    // ---- Landing
    const landing = landingCell(f, o.store.slug, o.store.domain, land, ckUrl);

    // ---- Checkout: responde y tiene precio.
    const mainPrices = ((prices ?? []) as Price[]).filter((p) => Number(p.amount) > 0);
    const checkout: AuditCell = !ck.status || ck.status >= 400
      ? { status: "bad", label: ck.status ? `Responde ${ck.status}` : "No responde", detail: `${ckUrl}: ${ck.error ?? ck.status}` }
      : !mainPrices.length
        ? { status: "bad", label: "Sin precio", detail: "El producto principal no tiene precio cargado." }
        // Sin precio en una moneda se convierte desde el que tenga (priceFor): con uno alcanza.
        : { status: "ok", label: `${ck.status} · ${ck.ms} ms`, detail: `${ckUrl.replace(/^https:\/\//, "")} · ${mainPrices.map((p) => `${p.currency} ${p.amount}`).join(" · ")} (las demás monedas se convierten)` };

    // ---- Pixel: cargado, con CAPI, y el mismo que carga la landing.
    const pxIds = px.map((p) => p.pixel_id);
    const noCapi = px.filter((p) => !p.capi_token_enc && !process.env.META_CAPI_TOKEN).map((p) => p.pixel_id);
    const landPx = land ? [...new Set([...land.html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g)].map((m) => m[1]))] : [];
    // Cada pixel por su nombre (el número, entre paréntesis): los nuestros de la tabla; los otros, de Meta.
    const pxn = await pixelNames([...pxIds, ...landPx]);
    const pt = (ids: string[]) => ids.map((id) => pixelText(id, pxn)).join(", ");
    const pixel: AuditCell = !pxIds.length
      ? { status: "bad", label: "Sin pixel", detail: "El checkout no tiene pixel: las compras no se informan a Meta." }
      : noCapi.length
        ? { status: "warn", label: "Sin CAPI", detail: `${pixelRef(noCapi, pxn)} sin token de la API de Conversiones.` }
        : land && landPx.length && !(landPx.length === pxIds.length && landPx.every((x) => pxIds.includes(x)))
          ? { status: "bad", label: "Distinto en landing", detail: `Landing: ${pt(landPx)} · checkout: ${pt(pxIds)}. Meta no puede unir la visita con la compra.` }
          : land && !landPx.length && land.status && land.status < 400
            ? { status: "bad", label: "Landing sin pixel", detail: `La landing no carga fbq('init', …): Meta no ve las visitas. Checkout: ${pt(pxIds)}.` }
            : { status: "ok", label: pxIds.map((id) => pxn[id] ?? id).join(", "), detail: `${pixelRef(pxIds, pxn)} con API de Conversiones${landPx.length ? ", el mismo en la landing" : ""}.` };

    // ---- Eventos de las últimas 24 h: lo que Meta recibió del pixel, nuestras visitas y las compras por CAPI.
    const ev = pxIds[0] ? await statsOf(pxIds[0]) : null;
    const nVisits = visits.count ?? 0;
    const paid = orders.data ?? [];
    const capi = paid.filter((x) => x.capi_sent_at).length;
    const evText = ev ? ["PageView", "ViewContent", "InitiateCheckout", "Purchase"].map((k) => `${k.replace("InitiateCheckout", "IC").replace("ViewContent", "VC").replace("PageView", "PV")} ${ev.get(k) ?? 0}`).join(" · ") : "";
    const events: AuditCell = !pxIds.length
      ? { status: "off", label: "—" }
      : !ev
        ? { status: "warn", label: "Sin datos de Meta", detail: `No se pudo leer el pixel en Meta (¿token de Meta Ads?). Visitas registradas por la app en 24 h: ${nVisits}. Compras: ${paid.length}, informadas por CAPI: ${capi}.` }
        : nVisits && !(ev.get("PageView") ?? 0)
          ? { status: "bad", label: "Meta no recibe", detail: `${plural(nVisits, "visita", "visitas")} en 24 h y 0 PageView en Meta (Permisos de tráfico o pixel roto). ${evText}.` }
          : paid.length > capi
            ? { status: "bad", label: `CAPI ${capi}/${paid.length}`, detail: `${paid.length - capi} compras de 24 h sin informar por la API de Conversiones. ${evText}.` }
            : !nVisits && !(ev.get("PageView") ?? 0)
              ? { status: "off", label: "Sin tráfico", detail: `Ni visitas ni eventos en 24 h. ${evText}.` }
              : { status: "ok", label: `PV ${ev.get("PageView") ?? 0} · Compras ${paid.length}`, detail: `Meta, 24 h (todo el pixel): ${evText}. App: ${plural(nVisits, "visita", "visitas")} a este checkout y su landing, ${plural(paid.length, "compra", "compras")}, ${capi} por CAPI.` };

    // ---- Bumps
    const bumpProds = ((prods ?? []) as ProdRow[]).filter((p) => bumpIds.includes(p.id) && p.active);
    const bumps: AuditCell = bumpProds.length >= 2
      ? { status: "ok", label: String(bumpProds.length), detail: bumpProds.map((p) => p.short_name).join(" · ") }
      : { status: "warn", label: String(bumpProds.length), detail: bumpProds.length ? `Solo ${bumpProds[0].short_name}: lo ideal son 2 o más.` : "Sin order bumps en el checkout." };

    // ---- Post-pago y downsells
    const post: AuditCell = "error" in pp ? { status: "warn", label: "No se pudo simular", detail: pp.error } : postCell(pp);
    const downsells: AuditCell = "error" in pp || !pp.otos
      ? { status: "off", label: "—" }
      : pp.otosWithDs === pp.otos
        ? { status: "ok", label: `${pp.otosWithDs}/${pp.otos}`, detail: "Cada OTO tiene su downsell (a mitad de precio si lo rechaza)." }
        : { status: "warn", label: `${pp.otosWithDs}/${pp.otos}`, detail: `${pp.otos - pp.otosWithDs} OTO sin downsell: quien lo rechaza pasa directo al nivel siguiente.` };

    // ---- Entrega: cada producto que se entrega tiene link y el link abre para cualquiera.
    const deliverable = ((prods ?? []) as ProdRow[]);
    // Un producto entrega de dos formas: carpeta/links (Drive) o archivo propio en
    // Supabase (delivery_file). Mirando solo la primera, una tienda que entrega
    // archivos propios salia entera en rojo con la entrega funcionando.
    // Una PREVENTA no es una entrega rota: su archivo todavia no existe, y ese
    // plazo es exactamente lo que el comprador acepto. Marcarla en rojo deja el
    // aviso encendido 60 dias, y un aviso que siempre esta encendido deja de
    // mirarse -- el dia que falte una entrega de verdad, nadie reacciona.
    // Tampoco se oculta: pasa a su propio renglon con el plazo, para que se siga
    // viendo y se note el dia que venza.
    const tieneArchivo = (p: ProdRow) => !!p.delivery_url || !!p.delivery_file || (p.delivery_links ?? []).some((l) => l?.url);
    const porId = new Map(deliverable.map((p) => [p.id, p]));
    // Un PACK no tiene archivo propio y no le hace falta: entrega lo que trae
    // adentro, y eso se expande al armar el pedido (incluidos.ts). Marcarlo
    // como «sin link» es el mismo punto ciego que tenian la preventa y la
    // suscripcion: un aviso siempre encendido que se deja de mirar.
    // Solo cuenta como entregable si TODO lo que incluye tiene archivo.
    const entregaLoQueIncluye = (p: ProdRow) => {
      const dentro = (p.includes ?? []).filter(Boolean);
      return dentro.length > 0 && dentro.every((id) => { const h = porId.get(id); return !!h && tieneArchivo(h); });
    };
    const sinEntrega = deliverable.filter((p) => p.active && !tieneArchivo(p) && !entregaLoQueIncluye(p));
    const packs = deliverable.filter((p) => p.active && !tieneArchivo(p) && entregaLoQueIncluye(p));
    // Y una SUSCRIPCION tampoco: se entrega como la edicion de cada semana.
    // Una variante comparte el short_name con su base (el trial de la
    // suscripcion se llama igual que la suscripcion), asi que la lista salia
    // «The Weekly Screen · The Weekly Screen» y se leia como un duplicado.
    // Cuando el nombre se repite, se aclara con el slug.
    const nombres = (ps: ProdRow[]) => {
      const veces = new Map<string, number>();
      for (const p of ps) veces.set(p.short_name ?? p.slug, (veces.get(p.short_name ?? p.slug) ?? 0) + 1);
      return ps.map((p) => {
        const n = p.short_name ?? p.slug;
        return (veces.get(n) ?? 0) > 1 ? `${n} (${p.slug})` : n;
      });
    };
    const noLink = sinEntrega.filter((p) => !p.presale && !p.subscription);
    const enPreventa = sinEntrega.filter((p) => p.presale);
    const suscripciones = sinEntrega.filter((p) => p.subscription && !p.presale);
    const urls = [...new Set(deliverable.flatMap((p) => [p.delivery_url, ...(p.delivery_links ?? []).map((l) => l?.url)].filter(Boolean) as string[]))];
    const res = await Promise.all(urls.map(async (u) => ({ u, ...(await checkLink(u)) })));
    const broken = res.filter((r) => !r.ok);
    const delivery: AuditCell = noLink.length
      ? { status: "bad", label: `${noLink.length} sin link`, detail: `Sin link de entrega: ${nombres(noLink.slice(0, 4)).join(" · ")}.` }
      : broken.length
        ? { status: "bad", label: `${broken.length} no abren`, detail: broken.slice(0, 3).map((b) => `${b.u.slice(0, 70)}: ${b.why}`).join(" · ") }
        : packs.length
          ? { status: "ok", label: `${packs.length} ${packs.length === 1 ? "pack" : "packs"}`,
              detail: `Entrega lo que trae adentro: ${nombres(packs).join(" · ")}.` }
        : suscripciones.length
          ? { status: "ok", label: `${suscripciones.length} por suscripcion`,
              detail: `Se entrega como la edicion de cada semana: ${nombres(suscripciones).join(" · ")}.` }
        : enPreventa.length
          ? { status: "warn", label: `${enPreventa.length} en preventa`,
              detail: `Todavia sin archivo, como se vendio: ${(() => {
                const ps = enPreventa.slice(0, 4), ns = nombres(ps);
                return ps.map((p, i) => `${ns[i]} (${p.presale_days ?? "?"} dias)`).join(" · ");
              })()}.` }
        : { status: "ok", label: res.length ? `${res.length} abren` : `${deliverable.length} con archivo`,
            detail: `${plural(deliverable.length, "producto", "productos")} (checkout y post-pago). `
              + (res.length ? `${plural(res.length, "link", "links")} de entrega: todos abren.` : "")
              + (deliverable.filter((p) => p.delivery_file).length
                  ? ` ${plural(deliverable.filter((p) => p.delivery_file).length, "entrega", "entregas")} por archivo propio.` : "") };

    // ---- El webhook de la pasarela QUE USA ESTA TIENDA.
    // Preguntar por Stripe en una tienda que cobra con Whop daba «Stripe sin
    // conectar» en rojo, permanente, sobre un cobro que funciona. Es el mismo
    // error que el monitor de checkout exigiendo «pk_live_» en una pagina de
    // Whop: un control escrito cuando solo existia Stripe.
    const webhook: AuditCell = pasarela.gateway === "whop"
      ? !pasarela.whop?.webhook_id || !pasarela.whop?.webhook_secret_enc
        ? { status: "bad", label: "Whop sin webhook",
            detail: "Sin webhook firmado los pedidos no se entregan solos." }
        : !pasarela.whop.last_event_at || Date.now() - new Date(pasarela.whop.last_event_at).getTime() > 7 * 864e5
          ? { status: "warn", label: "Sin eventos",
              detail: pasarela.whop.last_event_at ? `Ultimo evento ${ago(pasarela.whop.last_event_at)}.` : "Todavia no llego ninguno." }
          : { status: "ok", label: "Whop activo", detail: `Ultimo evento ${ago(pasarela.whop.last_event_at)}.` }
      : !health.connected
      ? { status: "bad", label: "Stripe sin conectar" }
      : health.error
        ? { status: "bad", label: "Stripe no responde", detail: health.error }
        : !(health.webhookOk && health.webhookUrlOk)
          ? { status: "bad", label: "Inactivo", detail: "El webhook no está activo o apunta a otro lado: los pedidos no se entregan solos." }
          : !health.livemode
            ? { status: "warn", label: "Modo prueba", detail: "Stripe conectado con llaves de test." }
            : !health.lastEventAt || Date.now() - new Date(health.lastEventAt).getTime() > 7 * 864e5
              ? { status: "warn", label: "Sin eventos", detail: health.lastEventAt ? `Último evento ${ago(health.lastEventAt)}.` : "Todavía no llegó ninguno." }
              : { status: "ok", label: "Activo", detail: `Último evento ${ago(health.lastEventAt)}.` };

    // ---- Recuperación de carritos y grabación
    const rc = settings.recovery;
    // Alemania y Austria: sin consentimiento previo no se puede mandar el mail (UWG §7). Apagada a propósito, no es un problema.
    const consentMarket = f.flags.includes("de") || /austria|österreich/i.test(f.market_label) || (settings.locale ?? "").startsWith("de");
    const recovery: AuditCell = rc.enabled
      ? { status: "ok", label: "Encendida", detail: `Mail a los ${rc.delayMinutes} min con ${rc.discountPercent}% de descuento, válido ${rc.validHours} h.` }
      : consentMarket
        ? { status: "off", label: "Apagado por ley (Alemania)", detail: "En Alemania y Austria el mail de carrito abandonado necesita consentimiento previo (UWG §7): queda apagado a propósito." }
        : { status: "warn", label: "Apagada", detail: "Los carritos abandonados no reciben mail de recuperación." };
    const recOn = fr?.record_sessions !== false;
    const recProject = clarityProject({ store: o.store.slug });
    const recording: AuditCell = !recOn
      ? { status: "warn", label: "Apagada", detail: "No se graban las sesiones de este checkout (En vivo › grabación)." }
      : recProject
        ? { status: "ok", label: "Encendida", detail: `Grabación de sesiones de la app encendida · Clarity ${recProject}.` }
        // Decia "Encendida" sin proyecto detras: la app grababa sus propios pasos
        // pero NO habia grabacion de pantalla que mirar.
        : { status: "warn", label: "Sin Clarity", detail: "Los pasos quedan registrados en «En vivo», pero no hay grabación de pantalla: falta NEXT_PUBLIC_CLARITY_ID." };

    const cells = { landing, checkout, pixel, events, bumps, post, downsells, delivery, webhook, recovery, recording };
    return {
      key: f.key, offerKey: o.key, offer: o.name, alias: o.alias, market: f.market_label || f.name,
      store: o.store.display_name || o.store.name, storeSlug: o.store.slug,
      checkoutUrl: ckUrl, landingUrl: f.landing_url, status: worst(Object.values(cells)), cells,
    };
  }
}

/**
 * Para el Diagnóstico de tienda: lo que el resto de los chequeos no mira
 * (botón de la landing, precio del checkout, bumps, post-pago, downsells,
 * recuperación y grabación), un renglón por oferta y mercado.
 */
export async function offerAuditChecks(storeId: string): Promise<DiagCheck[]> {
  const rows = await auditOffers({ storeId });
  const out: DiagCheck[] = [];
  const KEYS = [["landing", "landing"], ["checkout", "checkout"], ["bumps", "bumps"], ["post", "post-pago"], ["downsells", "downsells"], ["recovery", "recuperación de carritos"], ["recording", "grabación"]] as const;
  for (const r of rows) {
    const base = `/admin/o/${r.key}`;
    const href: Record<string, string> = { landing: `${base}/mercados`, checkout: `${base}/embudos`, bumps: `${base}/embudos`, post: `${base}/post-compra`, downsells: `${base}/post-compra`, recovery: `${base}/carritos`, recording: "/admin/en-vivo" };
    // Lo que falla, un renglón cada uno; lo que está bien, un solo renglón por mercado.
    const good: string[] = [];
    for (const [k, what] of KEYS) {
      const c = r.cells[k];
      if (c.status === "off") continue;
      if (c.status === "ok") { good.push(`${what} ${c.label}`); continue; }
      out.push({
        id: `oa-${k}-${r.key}`, status: c.status,
        title: `${r.offer} (${r.market}) · ${k === "post" && c.status === "bad" ? "Oferta sin post-pago" : `${what}: ${c.label}`}`,
        detail: c.detail, href: href[k], fix: "Ver",
      });
    }
    if (good.length) out.push({ id: `oa-ok-${r.key}`, status: "ok", title: `${r.offer} (${r.market}): oferta completa en lo demás`, detail: good.join(" · ") });
  }
  return out;
}
