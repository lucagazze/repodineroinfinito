import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { checkoutUrl } from "@/lib/checkout-url";
import { ADS_TAG } from "./ads";
import { adAccounts } from "./meta-report";
import { metaObjects, metaWindows, rangesKey, syncState } from "./meta-data";

/**
 * Meta sin vincular a mano: cada anuncio dice a qué link manda (su creativo).
 * Si ese link es la landing o el checkout de un mercado de una oferta, su
 * campaña queda vinculada sola a ese checkout (funnels.meta_campaign_ids,
 * anotada en meta_campaign_auto). Lo vinculado a mano gana siempre: no se
 * pisa ni se borra.
 *
 * También da las métricas por creativo de la sección «Ads»: gasto,
 * impresiones, CTR, CPC, hook rate (reproducciones de 3 s / impresiones),
 * hold rate (ThruPlays / impresiones), compras, CPA y ROAS según Meta.
 *
 * Nada de esto le pregunta a Meta: sale de lo que guarda el cron cada 15
 * minutos (meta_objects y meta_insights_daily, ver meta-sync.ts).
 */

export type MetaAd = {
  id: string; name: string; status: string; campaignId: string;
  videoId: string | null; thumb: string | null; links: string[];
};

/** host + ruta, sin www, sin consulta y sin barra final: lo que identifica una página. */
export function normUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch { return ""; }
}

/** Los anuncios de una cuenta con su destino, de lo guardado. */
export async function accountAds(act: string): Promise<MetaAd[]> {
  const { ads } = await metaObjects(act);
  return ads.map((a) => ({
    id: a.id, name: a.name, status: a.effective_status, campaignId: a.campaign_id ?? "",
    videoId: a.video_id ?? null, thumb: a.thumb ?? null, links: a.links ?? [],
  }));
}

type F = { id: string; slug: string; store_id: string; landing_url: string | null; checkout_host: string | null; checkout_path: string | null;
  meta_campaign_ids: string[] | null; meta_campaign_auto: string[] | null; stores: { slug: string } | null };

async function syncLinks(): Promise<Record<string, string[]>> {
  const accounts = await adAccounts();
  if (!accounts.length) return {};
  const { data, error } = await db.from("funnels")
    .select("id,slug,store_id,landing_url,checkout_host,checkout_path,meta_campaign_ids,meta_campaign_auto,stores!inner(slug)");
  if (error) return {}; // sin la migración 024: nada que anotar
  const funnels = (data ?? []) as unknown as F[];
  const manual = new Set(funnels.flatMap((f) => (f.meta_campaign_ids ?? []).filter((id) => !(f.meta_campaign_auto ?? []).includes(id))));

  // Las páginas de cada checkout: su landing y su checkout público.
  const pages: { url: string; funnel: string }[] = [];
  for (const f of funnels) {
    if (f.landing_url) pages.push({ url: normUrl(f.landing_url), funnel: f.id });
    if (f.checkout_host) pages.push({ url: normUrl(checkoutUrl(f, f.stores?.slug ?? "")), funnel: f.id });
  }
  const valid = pages.filter((p) => p.url);
  const match = (dest: string) => {
    const d = normUrl(dest);
    // La coincidencia más específica: igual, o la página y algo debajo (/en → /en/…).
    return valid.filter((p) => d === p.url || d.startsWith(`${p.url}/`)).sort((a, b) => b.url.length - a.url.length)[0]?.funnel ?? null;
  };

  const auto = new Map<string, Set<string>>();
  let anyData = false;
  for (const a of accounts) {
    const ads = await accountAds(a.id);
    if (ads.length) anyData = true;
    for (const ad of ads) {
      if (!ad.campaignId || manual.has(ad.campaignId)) continue;
      for (const l of ad.links) {
        const f = match(l);
        if (f) auto.set(f, (auto.get(f) ?? new Set()).add(ad.campaignId));
      }
    }
  }
  // Sin anuncios guardados todavía no se toca nada (no hay que «desvincular» por no tener datos). Se tira
  // un error para que la caché no guarde este «nada» y se vuelva a probar en el próximo pedido.
  if (!anyData) throw new Error("Todavía no se sincronizó Meta");
  const out: Record<string, string[]> = {};
  for (const f of funnels) {
    const mine = (f.meta_campaign_ids ?? []).filter((id) => !(f.meta_campaign_auto ?? []).includes(id));
    const want = [...(auto.get(f.id) ?? [])].sort();
    out[f.id] = want;
    const now = [...(f.meta_campaign_auto ?? [])].sort();
    if (want.join() !== now.join()) {
      await db.from("funnels").update({ meta_campaign_ids: [...new Set([...mine, ...want])], meta_campaign_auto: want }).eq("id", f.id);
    }
  }
  return out;
}

/** Vincula las campañas por destino y devuelve las automáticas de cada checkout. */
export const autoCampaigns = () =>
  unstable_cache(() => syncLinks(), ["meta-autolink-v5"], { tags: [ADS_TAG], revalidate: 600 })().catch(() => ({} as Record<string, string[]>));

/**
 * Vincula por destino DESPUÉS de responder (no frena la página): lo que
 * encuentra queda guardado en funnels.meta_campaign_ids y se ve en la
 * próxima actualización (la caché de ofertas dura 10 s).
 */
export function kickAutoLink() {
  try { after(() => autoCampaigns()); } catch { /* fuera de un request: nada */ }
}

/** Las campañas de un checkout: las que tiene guardadas más las vinculadas solas. */
export const campaignsOf = (f: { id: string; meta_campaign_ids: string[] }, auto: Record<string, string[]>) =>
  [...new Set([...f.meta_campaign_ids, ...(auto[f.id] ?? [])])];

// ------------------------------------------------------- métricas por creativo

export type CreativeStats = {
  ads: number; spend: number; impressions: number; clicks: number; plays3s: number; thruplays: number;
  purchases: number; value: number; matchedBy: "ids" | "nombre";
};

const norm = (s: string) => s.toLowerCase().replace(/\.(mp4|mov|m4v|webm|jpe?g|png|webp)$/i, "").normalize("NFD").replace(/[^a-z0-9]/g, "");

/**
 * Métricas de Meta de cada creativo de una oferta, en el período. Se cruzan
 * con sus anuncios por meta_ad_ids; si no tiene, por el nombre del archivo de
 * Drive (en las notas o el título) dentro del nombre del anuncio. Solo
 * anuncios de las campañas de la oferta.
 */
export async function creativeStats(
  act: string, campaigns: string[],
  creatives: { id: string; title: string; notes: string; metaAdIds: string[] }[],
  since: string, until: string,
): Promise<Record<string, CreativeStats>> {
  if (!campaigns.length) return {};
  const key = `${since}|${until}`;
  const [rates, sync, objs, win] = await Promise.all([getRates(), syncState(act), metaObjects(act), metaWindows(act, rangesKey([[since, until]]), campaigns.join(","))]);
  if (sync.fetchedAt == null) return {};
  const rows = win.ranges[key] ?? [];
  const usd = (n: number) => n / (rates[sync.currency] ?? 1);
  const camp = new Set(campaigns);
  // Los anuncios de la oferta: los guardados más los que gastaron en el período (aunque ya no estén listados).
  const pool = [...objs.ads.filter((a) => camp.has(a.campaign_id ?? "")).map((a) => ({ id: a.id, name: a.name })),
    ...rows.filter((r) => !objs.ads.some((a) => a.id === r[0])).map((r) => ({ id: r[0], name: win.names[r[0]] ?? "" }))];
  const matched = new Map<string, { ads: string[]; by: CreativeStats["matchedBy"] }>();
  for (const c of creatives) {
    if (c.metaAdIds.length) { matched.set(c.id, { ads: c.metaAdIds, by: "ids" }); continue; }
    const keys = [c.notes, c.title].map((k) => norm(k ?? "")).filter((k) => k.length >= 6);
    const byName = pool.filter((a) => keys.some((k) => norm(a.name).includes(k)));
    if (byName.length) matched.set(c.id, { ads: byName.map((a) => a.id), by: "nombre" });
  }
  const byAd = new Map<string, number[]>();
  for (const r of rows) {
    const t = byAd.get(r[0]) ?? [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) t[i] += Number(r[3 + i] ?? 0);
    byAd.set(r[0], t);
  }
  const out: Record<string, CreativeStats> = {};
  for (const [cid, m] of matched) {
    const s: CreativeStats = { ads: m.ads.length, spend: 0, impressions: 0, clicks: 0, plays3s: 0, thruplays: 0, purchases: 0, value: 0, matchedBy: m.by };
    for (const id of m.ads) {
      const r = byAd.get(id);
      if (!r) continue;
      s.spend += usd(r[0]); s.impressions += r[1]; s.clicks += r[2]; s.purchases += r[3]; s.value += usd(r[4]); s.plays3s += r[5]; s.thruplays += r[6];
    }
    out[cid] = s;
  }
  return out;
}
