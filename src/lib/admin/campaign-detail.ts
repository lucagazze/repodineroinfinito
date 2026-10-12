import "server-only";
import { db } from "@/lib/db";
import { BUSY_PCT, metaBatch, metaError, metaGet, metaPressure } from "./meta-conn";
import { offerList } from "./offers";

/**
 * Cómo está hecha una campaña: sus conjuntos (presupuesto, puja, optimización, cuándo arrancan,
 * a quién le apuntan) y sus anuncios (textos, títulos, botón, destino y la vista previa real de Meta, que
 * reproduce el video). Se pide a Meta solo al abrirla y queda guardado 30 min (meta_objects.details):
 * el token del panel tiene poco cupo. Más los creativos que se subieron a la sección Ads de su oferta.
 */

export type DetailAdset = {
  id: string; name: string; status: string; start: string | null; end: string | null; budget: number | null; bid: number | null;
  optimization: string | null; event: string | null; countries: string[]; ages: string | null; genders: string | null;
  excluded: string[]; included: string[]; placements: string[]; advantage: boolean;
};
export type DetailAd = {
  id: string; name: string; status: string; effective: string; thumb: string | null; bodies: string[]; titles: string[];
  cta: string | null; link: string | null; preview: string | null; issues: string | null;
};
export type DetailCreative = { id: string; title: string; angle: string | null; status: string; driveId: string | null; thumb: string | null; kind: string };
export type CampaignDetail = {
  id: string; name: string; objective: string | null; status: string; effective: string; start: string | null; budget: number | null;
  strategy: string | null; adsets: DetailAdset[]; ads: DetailAd[]; fetchedAt: string;
  offer: { name: string; key: string; folder: string | null; linked: boolean } | null; creatives: DetailCreative[];
};

const TTL = 30 * 60_000;
const money = (v: unknown) => (v == null || v === "" ? null : Number(v) / 100);
const when = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const uniq = (a: (string | null | undefined)[]) => [...new Set(a.filter((x): x is string => !!x && !!x.trim()))];

type Raw = Record<string, unknown>;
const ADSET_F = "id,name,effective_status,start_time,end_time,daily_budget,bid_amount,optimization_goal,promoted_object,targeting";
const AD_F = "id,name,status,effective_status,issues_info,creative{thumbnail_url,body,title,call_to_action_type,object_story_spec,asset_feed_spec}";

function adOf(a: Raw, preview: string | null): DetailAd {
  const c = (a.creative ?? {}) as Raw;
  const oss = (c.object_story_spec ?? {}) as { link_data?: Raw; video_data?: Raw };
  const afs = (c.asset_feed_spec ?? {}) as { bodies?: { text?: string }[]; titles?: { text?: string }[]; link_urls?: { website_url?: string }[]; call_to_action_types?: string[] };
  const ld = (oss.link_data ?? {}) as { message?: string; name?: string; link?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  const vd = (oss.video_data ?? {}) as { message?: string; title?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  const issues = (a.issues_info as { error_message?: string }[] | undefined)?.map((i) => i.error_message).filter(Boolean).join(" · ") || null;
  return {
    id: String(a.id), name: String(a.name ?? ""), status: String(a.status ?? ""), effective: String(a.effective_status ?? ""),
    thumb: (c.thumbnail_url as string | undefined) ?? null,
    bodies: uniq([...(afs.bodies ?? []).map((b) => b.text), ld.message, vd.message, c.body as string | undefined]),
    titles: uniq([...(afs.titles ?? []).map((t) => t.text), ld.name, vd.title, c.title as string | undefined]),
    cta: (afs.call_to_action_types?.[0] ?? vd.call_to_action?.type ?? ld.call_to_action?.type ?? (c.call_to_action_type as string | undefined)) ?? null,
    link: afs.link_urls?.[0]?.website_url ?? vd.call_to_action?.value?.link ?? ld.call_to_action?.value?.link ?? ld.link ?? null,
    preview, issues,
  };
}

function adsetOf(s: Raw): DetailAdset {
  const t = (s.targeting ?? {}) as {
    geo_locations?: { countries?: string[] }; age_min?: number; age_max?: number; genders?: number[];
    excluded_custom_audiences?: { name?: string }[]; custom_audiences?: { name?: string }[];
    publisher_platforms?: string[]; targeting_automation?: { advantage_audience?: number };
  };
  return {
    id: String(s.id), name: String(s.name ?? ""), status: String(s.effective_status ?? ""), start: when(s.start_time), end: when(s.end_time),
    budget: money(s.daily_budget), bid: money(s.bid_amount), optimization: (s.optimization_goal as string | undefined) ?? null,
    event: ((s.promoted_object as { custom_event_type?: string } | undefined)?.custom_event_type) ?? null,
    countries: t.geo_locations?.countries ?? [], ages: t.age_min || t.age_max ? `${t.age_min ?? 18}–${t.age_max ?? 65}` : null,
    genders: !t.genders?.length ? null : t.genders.length === 2 ? null : t.genders[0] === 1 ? "hombres" : "mujeres",
    excluded: uniq((t.excluded_custom_audiences ?? []).map((a) => a.name)), included: uniq((t.custom_audiences ?? []).map((a) => a.name)),
    placements: t.publisher_platforms ?? ["automáticas"], advantage: t.targeting_automation?.advantage_audience === 1,
  };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["italia", "usa", "uk", "ww", "francia", "espana", "alemania", "cbo", "bid", "cap", "broad", "test", "new", "the", "kit", "and", "con", "per"]);

/** La oferta de una campaña: la vinculada en su checkout; si no, la que coincide por nombre («Mi oferta» → mi-oferta). */
export async function offerOfCampaign(id: string, name: string) {
  const offers = await offerList();
  const linked = offers.find((o) => o.funnels.some((f) => (f.meta_campaign_ids ?? []).includes(id)));
  if (linked) return { o: linked, linked: true };
  const words = norm(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const hit = offers.filter((o) => o.active).find((o) => { const h = norm(`${o.name} ${o.slug} ${o.category ?? ""}`); return words.some((w) => h.includes(w)); });
  return hit ? { o: hit, linked: false } : null;
}

export async function campaignDetail(id: string, force = false): Promise<CampaignDetail> {
  const { data: row } = await db.from("meta_objects").select("id,name,details,details_at").eq("level", "campaign").eq("id", id).maybeSingle();
  const fresh = row?.details && row.details_at && Date.now() - Date.parse(row.details_at as string) < TTL;
  let base = fresh && !force ? (row!.details as CampaignDetail) : null;

  if (!base) {
    if ((await metaPressure()).pct >= BUSY_PCT) {
      if (row?.details) base = row.details as CampaignDetail;
      else throw new Error("Meta está cerca del límite de consultas: probá en unos minutos.");
    } else {
      try {
        const c = await metaGet<Raw>(id, {
          fields: `id,name,objective,status,effective_status,start_time,daily_budget,bid_strategy,adsets.limit(20){${ADSET_F}},ads.limit(12){${AD_F}}`,
        }, 25_000);
        const ads = ((c.ads as { data?: Raw[] } | undefined)?.data ?? []);
        // La vista previa real de Meta (reproduce el video): una parte del pedido por anuncio, todo junto.
        const previews = new Map<string, string>();
        if (ads.length) {
          const res = await metaBatch(ads.slice(0, 8).map((a) => `${a.id}/previews?ad_format=MOBILE_FEED_STANDARD`)).catch(() => [] as unknown[]);
          res.forEach((r, i) => {
            const body = ((r as { data?: { body?: string }[] } | null)?.data?.[0]?.body) ?? "";
            const src = body.match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
            if (src) previews.set(String(ads[i].id), src);
          });
        }
        base = {
          id: String(c.id), name: String(c.name ?? ""), objective: (c.objective as string | undefined) ?? null, status: String(c.status ?? ""),
          effective: String(c.effective_status ?? ""), start: when(c.start_time), budget: money(c.daily_budget), strategy: (c.bid_strategy as string | undefined) ?? null,
          adsets: ((c.adsets as { data?: Raw[] } | undefined)?.data ?? []).map(adsetOf),
          ads: ads.map((a) => adOf(a, previews.get(String(a.id)) ?? null)),
          fetchedAt: new Date().toISOString(), offer: null, creatives: [],
        };
        await db.from("meta_objects").update({ details: base, details_at: base.fetchedAt }).eq("level", "campaign").eq("id", id);
      } catch (e) {
        if (row?.details) base = row.details as CampaignDetail;
        else throw new Error(metaError(e));
      }
    }
  }

  // La oferta y sus creativos subidos (de la base: sin gastar consultas de Meta).
  const m = await offerOfCampaign(id, base.name);
  let creatives: DetailCreative[] = [];
  let folder: string | null = null;
  if (m) {
    const [{ data: cr }, { data: of }] = await Promise.all([
      db.from("ad_creatives").select("id,title,angle,status,drive_file_id,thumbnail_url,kind").eq("offer_id", m.o.id).order("sort_order").order("created_at"),
      db.from("offers").select("ads_folder_url").eq("id", m.o.id).maybeSingle(),
    ]);
    creatives = (cr ?? []).map((r) => ({ id: r.id, title: r.title, angle: r.angle, status: r.status, driveId: r.drive_file_id, thumb: r.thumbnail_url, kind: r.kind }));
    folder = (of as { ads_folder_url?: string | null } | null)?.ads_folder_url ?? null;
  }
  return { ...base, offer: m ? { name: m.o.name, key: m.o.key, folder, linked: m.linked } : null, creatives };
}
