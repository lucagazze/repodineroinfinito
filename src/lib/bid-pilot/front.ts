import { db, type Product } from "@/lib/db";
import { getRates, priceFor } from "@/lib/fx";
import { currencyOf, type Market } from "@/lib/admin/structure";
import { CEILING_FACTOR, ceilingFromFront, landingKeys, linkKey } from "./rules";

/**
 * El precio del producto principal (el «front», «el libro») de la oferta de
 * cada campaña, en el mercado al que vende, en USD a los tipos del día, y el
 * tope de puja que sale de él (el 70 % del precio; 06/10). El freno y
 * el aviso de «CPA caro» usan el precio entero (`usd`). Solo de la base (lo
 * que guarda la sincronización de Meta), sin preguntarle a Meta.
 *
 * Campaña → checkout, en este orden:
 *  1. «vinculo»: el vínculo de siempre (funnels.meta_campaign_ids, a mano o
 *     por el link de sus anuncios).
 *  2. «video»: las BID CAP casi nunca tienen link guardado (su anuncio es un
 *     posteo), así que se busca la campaña de donde salió: otra con un anuncio
 *     del MISMO video que sí esté vinculada (su CBO).
 *  3. «landing»: el link de sus anuncios (o los de su mismo video) es la
 *     landing de la oferta sin el idioma (p. ej. /oferta ↔ /it/oferta).
 *     Solo para el precio: no vincula la campaña (no cambia el gasto de la
 *     oferta en Métricas).
 * Si llega a varios checkouts, el precio más bajo. Sin ninguno: «sin oferta
 * vinculada» (queda el tope de 1,5 × objetivo).
 */
export type Ceiling = {
  usd: number; max: number; amount: number; currency: string;
  funnelId: string; funnel: string; via: "vinculo" | "video" | "landing";
};

type F = {
  id: string; slug: string; store_id: string; settings: unknown; market_label: string | null; meta_campaign_ids: string[] | null; landing_url: string | null;
  main: { product_prices: { currency: string; amount: number | null; compare_at: number | null; display_value: number | null }[] } | null;
};

/** `factor`: qué parte del precio es el tope de puja (0,7 = 70 %, el de la página del piloto). */
export async function frontCeilings(campaignIds: string[], factor = CEILING_FACTOR): Promise<Map<string, Ceiling>> {
  const out = new Map<string, Ceiling>();
  if (!campaignIds.length) return out;
  const [{ data: fs }, rates] = await Promise.all([
    db.from("funnels").select("id,slug,store_id,settings,market_label,meta_campaign_ids,landing_url,main:products!funnels_main_product_id_fkey(product_prices(currency,amount,compare_at,display_value))"),
    getRates(),
  ]);
  const funnels = ((fs ?? []) as unknown as F[]).filter((f) => f.main);
  if (!funnels.length) return out;
  const storeIds = [...new Set(funnels.map((f) => f.store_id))];
  const { data: mk } = await db.from("markets").select("store_id,currency,countries").in("store_id", storeIds);

  // El precio del front de cada checkout, en su moneda y en USD.
  const front = new Map<string, Omit<Ceiling, "via">>();
  for (const f of funnels) {
    const currency = currencyOf(f, (mk ?? []) as Market[], rates);
    const pr = priceFor({ product_prices: f.main!.product_prices } as unknown as Product, currency, rates);
    const amount = Number(pr?.amount ?? 0);
    const perUsd = currency === "USD" ? 1 : rates[currency];
    if (!(amount > 0) || !perUsd) continue;
    const usd = amount / perUsd;
    front.set(f.id, { usd, max: ceilingFromFront(usd, factor), amount, currency, funnelId: f.id, funnel: f.slug });
  }
  const byCampaign = new Map<string, string[]>();
  for (const f of funnels) for (const c of f.meta_campaign_ids ?? []) if (front.has(f.id)) byCampaign.set(c, [...(byCampaign.get(c) ?? []), f.id]);
  const byLanding = new Map<string, string[]>();
  for (const f of funnels) if (front.has(f.id) && f.landing_url) for (const k of landingKeys(f.landing_url)) byLanding.set(k, [...(byLanding.get(k) ?? []), f.id]);
  const cheapest = (ids: string[]) => ids.map((id) => front.get(id)!).sort((a, b) => a.usd - b.usd)[0];

  let missing: string[] = [];
  for (const c of campaignIds) {
    const ids = byCampaign.get(c);
    if (ids?.length) out.set(c, { ...cheapest(ids), via: "vinculo" });
    else missing.push(c);
  }
  if (!missing.length) return out;

  // Los anuncios de las que faltan y los de su mismo video (de lo que guarda la sincronización).
  type A = { campaign_id: string | null; video_id: string | null; links: string[] | null };
  const { data: mine } = await db.from("meta_objects").select("campaign_id,video_id,links").eq("level", "ad").in("campaign_id", missing);
  const vids = [...new Set(((mine ?? []) as A[]).map((a) => a.video_id).filter(Boolean) as string[])];
  const { data: twins } = vids.length ? await db.from("meta_objects").select("campaign_id,video_id,links").eq("level", "ad").in("video_id", vids) : { data: [] as A[] };
  const twinsOf = new Map<string, A[]>();
  for (const t of (twins ?? []) as A[]) twinsOf.set(t.video_id!, [...(twinsOf.get(t.video_id!) ?? []), t]);
  const adsOf = (c: string) => ((mine ?? []) as A[]).filter((x) => x.campaign_id === c);

  // 2) Por el video: una campaña vinculada con el mismo video.
  for (const c of missing) {
    const fids = new Set<string>();
    for (const a of adsOf(c)) for (const t of twinsOf.get(a.video_id ?? "") ?? []) byCampaign.get(t.campaign_id ?? "")?.forEach((x) => fids.add(x));
    if (fids.size) out.set(c, { ...cheapest([...fids]), via: "video" });
  }
  missing = missing.filter((c) => !out.has(c));

  // 3) Por la landing: el link de sus anuncios (o los del mismo video) sin el idioma.
  for (const c of missing) {
    const fids = new Set<string>();
    const links = adsOf(c).flatMap((a) => [...(a.links ?? []), ...(twinsOf.get(a.video_id ?? "") ?? []).flatMap((t) => t.links ?? [])]);
    for (const l of links) byLanding.get(linkKey(l))?.forEach((x) => fids.add(x));
    if (fids.size) out.set(c, { ...cheapest([...fids]), via: "landing" });
  }
  return out;
}

/** «USD 27», «EUR 19,90». */
export const frontLabel = (c: { amount: number; currency: string }) =>
  `${c.currency} ${c.amount.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(c.amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
