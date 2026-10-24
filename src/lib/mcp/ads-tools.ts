import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { metaGet, metaPost } from "@/lib/admin/meta-conn";
import { defineTool, getStore, storeArg, UserError } from "./util";

/**
 * Anuncios de cada oferta (sección «Ads» del panel, migración 022): la ficha
 * de cada creativo, que vive en Google Drive, y la carpeta de Drive de la oferta.
 */

const offerArg = z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).describe("Offer slug (see list_offers), e.g. 'my-offer'.");
const driveId = z.string().regex(/^[A-Za-z0-9_-]{10,}$/, "Google Drive file/folder id");

/** Acepta el id o cualquier link de Drive (…/file/d/{id}/view, …/folders/{id}, ?id={id}). */
function driveIdOf(s: string | null | undefined) {
  if (!s) return null;
  const m = s.match(/\/(?:file\/d|folders)\/([A-Za-z0-9_-]{10,})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

async function offerOf(store: string, slug: string) {
  const s = await getStore(store);
  const { data } = await db.from("offers").select("id,slug,name").eq("store_id", s.id).eq("slug", slug).maybeSingle();
  if (!data) throw new UserError(`Offer "${slug}" not found in ${store}. Use list_offers (include_inactive: true).`);
  return { store: s, offer: data as { id: string; slug: string; name: string } };
}

const COLS = "id,title,kind,drive_file_id,url,thumbnail_url,language,angle,status,meta_ad_ids,notes,sort_order,funnel_id,created_at";

/**
 * Las campañas de Meta enganchadas a los embudos de una oferta.
 *
 * Es el limite de todo lo que sigue: una campaña que no esta declarada acá no
 * existe para estas herramientas, asi que no se puede apagar por error un
 * anuncio de otra marca de la misma cuenta publicitaria. Physics y Finance
 * comparten cuenta, con lo cual esto no es teorico.
 */
async function campaignsOf(offerId: string): Promise<string[]> {
  const { data } = await db.from("funnels").select("meta_campaign_ids").eq("offer_id", offerId);
  const ids = new Set<string>();
  for (const f of (data ?? []) as { meta_campaign_ids: string[] | null }[]) {
    for (const id of f.meta_campaign_ids ?? []) if (id) ids.add(String(id));
  }
  return [...ids];
}

type AdLive = {
  id: string; name: string; status: string; effective_status: string; campaign_id: string;
  spend?: number; purchases?: number; cpa?: number | null; ctr?: number;
};

/**
 * Los anuncios de una campaña. Con `conNumeros` suma el rendimiento de los
 * ultimos 7 dias; sin el es una sola llamada, que es lo que necesita
 * set_ad_status para resolver nombres.
 */
async function adsDe(campaignId: string, conNumeros = true): Promise<AdLive[]> {
  const base = await metaGet<{ data?: { id: string; name: string; status: string; effective_status: string }[] }>(
    `${campaignId}/ads`, { fields: "id,name,status,effective_status", limit: "100" },
  );
  const filas: AdLive[] = (base.data ?? []).map((a) => ({ ...a, campaign_id: campaignId }));
  if (!conNumeros || !filas.length) return filas;

  const ins = await metaGet<{ data?: Record<string, unknown>[] }>(`${campaignId}/insights`, {
    level: "ad", date_preset: "last_7d", limit: "100",
    fields: "ad_id,spend,ctr,actions,cost_per_action_type",
  }).catch(() => ({ data: [] as Record<string, unknown>[] }));

  const ESCOMPRA = (t: unknown) => t === "purchase" || t === "omni_purchase";
  for (const r of ins.data ?? []) {
    const fila = filas.find((f) => f.id === r.ad_id);
    if (!fila) continue;
    const acciones = (r.actions ?? []) as { action_type: string; value: string }[];
    const costos = (r.cost_per_action_type ?? []) as { action_type: string; value: string }[];
    fila.spend = Number(r.spend) || 0;
    fila.ctr = Number(r.ctr) || 0;
    fila.purchases = Number(acciones.find((a) => ESCOMPRA(a.action_type))?.value ?? 0);
    const cpa = costos.find((a) => ESCOMPRA(a.action_type))?.value;
    // Preferir el CPA de Meta; si no viene, derivarlo. Nunca dividir por cero.
    fila.cpa = cpa != null ? Number(cpa) : fila.purchases ? fila.spend / fila.purchases : null;
  }
  // Sin gasto no hay numeros: dejarlos en 0 miente menos que dejarlos sin definir.
  for (const f of filas) { f.spend ??= 0; f.purchases ??= 0; f.ctr ??= 0; f.cpa ??= null; }
  return filas;
}

export function registerAdsTools(server: McpServer) {
  defineTool(server, "list_ad_creatives", {
    title: "List ad creatives of an offer",
    kind: "read",
    description: "Ad creatives (videos/images in Google Drive) of an offer, as shown in the panel's «Ads» section, plus the offer's Drive folder (ads_folder_url).",
    input: z.object({ store: storeArg, offer: offerArg }),
    handler: async ({ store, offer }) => {
      const { offer: o } = await offerOf(store, offer);
      const [{ data: folder }, { data, error }] = await Promise.all([
        db.from("offers").select("ads_folder_url").eq("id", o.id).single(),
        db.from("ad_creatives").select(COLS).eq("offer_id", o.id).order("sort_order").order("created_at"),
      ]);
      if (error) throw new Error(error.message);
      return { offer: o.slug, ads_folder_url: folder?.ads_folder_url ?? null, creatives: data ?? [] };
    },
  });

  defineTool(server, "set_offer_ads_folder", {
    title: "Set the Drive folder of an offer's ads",
    kind: "write",
    idempotent: true,
    description: "Set (or clear with null) the Google Drive folder with the offer's ads: the «Abrir carpeta de Drive» button of the panel's «Ads» section. Accepts a folder URL or id. The folder must be shared «anyone with the link» for the owner's team to open it.",
    input: z.object({ store: storeArg, offer: offerArg, folder: z.string().max(500).nullable() }),
    handler: async ({ store, offer, folder }) => {
      const { offer: o } = await offerOf(store, offer);
      let url: string | null = null;
      if (folder) {
        const id = driveIdOf(folder);
        url = id ? `https://drive.google.com/drive/folders/${id}` : /^https:\/\/\S+$/.test(folder) ? folder : null;
        if (!url) throw new UserError("folder must be a Google Drive folder URL/id or an https URL.");
      }
      const { error } = await db.from("offers").update({ ads_folder_url: url }).eq("id", o.id);
      if (error) throw new Error(error.message);
      return { offer: o.slug, ads_folder_url: url };
    },
  });

  defineTool(server, "upsert_ad_creative", {
    title: "Create or update an ad creative",
    kind: "write",
    idempotent: true,
    description:
      "Create or update one ad creative of an offer (panel «Ads»). Matched by `id`, else by `drive_file_id` within the offer (the same Drive file is never listed twice), else created. "
      + "`drive_file_id` accepts the id or a Drive link; `url` defaults to the Drive view link. kind: video (9:16 preview) | image | folder. angle: free text like tapa / problema / hojeo. status: activo | pausado | borrador. "
      + "meta_ad_ids: Meta AD ids (not campaign ids) to show spend and ROAS on the card. `market`: checkout slug when the creative is for one market only. Omitted fields keep their value. "
      + "The Drive file must be shared «anyone with the link» or the preview will not play: say so in notes if it isn't.",
    input: z.object({
      store: storeArg,
      offer: offerArg,
      id: z.string().uuid().optional(),
      drive_file_id: z.string().max(300).nullable().optional(),
      title: z.string().min(1).max(160).optional(),
      kind: z.enum(["video", "image", "folder"]).optional(),
      url: z.string().regex(/^https:\/\/\S+$/).max(1000).nullable().optional(),
      thumbnail_url: z.string().regex(/^https:\/\/\S+$/).max(1000).nullable().optional(),
      language: z.string().max(10).optional(),
      angle: z.string().max(40).nullable().optional(),
      status: z.enum(["activo", "pausado", "borrador"]).optional(),
      meta_ad_ids: z.array(z.string().regex(/^\d{5,25}$/)).max(50).optional(),
      notes: z.string().max(2000).optional(),
      sort_order: z.number().int().min(0).max(9999).optional(),
      market: z.string().max(80).nullable().optional().describe("Checkout slug of the market this creative is for; null = whole offer."),
    }),
    handler: async ({ store, offer, id, drive_file_id, market, ...patch }) => {
      const { store: s, offer: o } = await offerOf(store, offer);
      const row: Record<string, unknown> = { ...patch };
      let did: string | null | undefined = undefined;
      if (drive_file_id !== undefined) {
        did = drive_file_id === null ? null : driveIdOf(drive_file_id);
        if (drive_file_id && !did) throw new UserError("drive_file_id must be a Drive id or link.");
        driveId.nullable().parse(did);
        row.drive_file_id = did;
      }
      if (market !== undefined) {
        if (market === null) row.funnel_id = null;
        else {
          const { data: f } = await db.from("funnels").select("id").eq("store_id", s.id).eq("offer_id", o.id).eq("slug", market).maybeSingle();
          if (!f) throw new UserError(`Checkout "${market}" is not a market of offer ${offer}.`);
          row.funnel_id = f.id;
        }
      }

      let existing: { id: string; kind: string; url: string | null } | null = null;
      if (id) {
        const { data } = await db.from("ad_creatives").select("id,kind,url").eq("id", id).eq("offer_id", o.id).maybeSingle();
        if (!data) throw new UserError(`Creative ${id} not found in offer ${offer}.`);
        existing = data;
      } else if (did) {
        const { data } = await db.from("ad_creatives").select("id,kind,url").eq("offer_id", o.id).eq("drive_file_id", did).maybeSingle();
        existing = data;
      }
      const kind = (patch.kind ?? existing?.kind ?? "video") as string;
      if (did && patch.url === undefined && !existing?.url) {
        row.url = kind === "folder" ? `https://drive.google.com/drive/folders/${did}` : `https://drive.google.com/file/d/${did}/view`;
      }

      if (existing) {
        const { error } = await db.from("ad_creatives").update(row).eq("id", existing.id);
        if (error) throw new Error(error.message);
        const { data } = await db.from("ad_creatives").select(COLS).eq("id", existing.id).single();
        return { updated: data };
      }
      if (!patch.title) throw new UserError("New creative: pass `title`.");
      if (!did && !patch.url) throw new UserError("New creative: pass `drive_file_id` or `url`.");
      const { data, error } = await db.from("ad_creatives").insert({ ...row, offer_id: o.id }).select(COLS).single();
      if (error) throw new Error(error.message);
      return { created: data };
    },
  });

  defineTool(server, "delete_ad_creative", {
    title: "Delete an ad creative",
    kind: "destructive",
    description: "Remove one creative card from the offer's «Ads» section (the Drive file is not touched). Needs confirm=true, only after the owner approved it.",
    input: z.object({ store: storeArg, offer: offerArg, id: z.string().uuid(), confirm: z.boolean() }),
    handler: async ({ store, offer, id, confirm }) => {
      if (!confirm) throw new UserError("Pass confirm=true (only after the owner approved deleting this creative).");
      const { offer: o } = await offerOf(store, offer);
      const { data, error } = await db.from("ad_creatives").delete().eq("id", id).eq("offer_id", o.id).select("id,title");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new UserError(`Creative ${id} not found in offer ${offer}.`);
      return { deleted: data[0] };
    },
  });

  // ---------------------------------------------------------------- Meta vivo
  //
  // Las dos de abajo hablan con Meta, no con la base. Existen porque apagar un
  // anuncio que gasta sin vender era lo unico del circuito que seguia saliendo
  // del panel: habia que entrar a Ads Manager a mano. Un anuncio con buen CTR
  // y cero compras quema presupuesto en silencio, y el dueño se entera al
  // final de la semana.
  //
  // El limite que las hace seguras: SOLO tocan anuncios que estan dentro de las
  // campañas enganchadas a los embudos de esa oferta (funnels.meta_campaign_ids).
  // Una campaña que no esta declarada en la app no existe para estas tools.

  defineTool(server, "list_ads", {
    title: "List the live Meta ads of an offer",
    kind: "read",
    external: true,
    description:
      "Ads of the Meta campaigns linked to this offer's funnels, with their status and last-7-days spend, purchases, CPA and CTR. Use it before set_ad_status to see the exact ad names.",
    input: z.object({ store: storeArg, offer: offerArg }),
    handler: async ({ store, offer }) => {
      const { offer: o } = await offerOf(store, offer);
      const campañas = await campaignsOf(o.id);
      if (!campañas.length) {
        throw new UserError(
          `Offer "${offer}" has no Meta campaign linked to its funnels (funnels.meta_campaign_ids is empty), so there are no ads to list.`,
        );
      }
      const filas = await Promise.all(campañas.map((c) => adsDe(c)));
      return { offer: o.slug, campaigns: campañas, ads: filas.flat() };
    },
  });

  defineTool(server, "set_ad_status", {
    title: "Pause or re-activate Meta ads",
    kind: "write",
    external: true,
    description:
      "Set ACTIVE/PAUSED on one or more ads of this offer's linked campaigns. Each entry must be an ad id or an EXACT ad name (as returned by list_ads): a name that matches no ad, or more than one, aborts the whole call without changing anything. Pausing is reversible; re-activating an ad restarts its learning.",
    input: z.object({
      store: storeArg,
      offer: offerArg,
      ads: z.array(z.string().min(1).max(200)).min(1).max(20)
        .describe("Ad ids or exact ad names, as shown by list_ads."),
      status: z.enum(["ACTIVE", "PAUSED"]),
    }),
    handler: async ({ store, offer, ads, status }) => {
      const { offer: o } = await offerOf(store, offer);
      const campañas = await campaignsOf(o.id);
      if (!campañas.length) {
        throw new UserError(`Offer "${offer}" has no Meta campaign linked to its funnels.`);
      }
      const todos = (await Promise.all(campañas.map((c) => adsDe(c, false)))).flat();

      // Resolver TODO antes de escribir nada: media tanda aplicada es peor que
      // ninguna, porque el que lee el resultado cree que paso lo que pidio.
      const elegidos: { id: string; name: string; status: string }[] = [];
      for (const pedido of ads) {
        const coinciden = todos.filter((a) => a.id === pedido || a.name === pedido);
        if (!coinciden.length) {
          throw new UserError(
            `"${pedido}" is not an ad of offer ${offer}. Names must match exactly — run list_ads and copy the name.`,
          );
        }
        if (coinciden.length > 1) {
          throw new UserError(
            `"${pedido}" matches ${coinciden.length} ads (${coinciden.map((a) => a.id).join(", ")}). Pass the ad id instead.`,
          );
        }
        if (!elegidos.some((e) => e.id === coinciden[0].id)) elegidos.push(coinciden[0]);
      }

      for (const a of elegidos) await metaPost(a.id, { status });

      // Releer de Meta: un 200 del POST no prueba que el anuncio quedo asi.
      const despues = (await Promise.all(campañas.map((c) => adsDe(c, false)))).flat();
      const cambios = elegidos.map((a) => {
        const ahora = despues.find((d) => d.id === a.id);
        return { id: a.id, name: a.name, before: a.status, after: ahora?.status ?? "?", ok: ahora?.status === status };
      });
      const fallaron = cambios.filter((c) => !c.ok);
      return {
        offer: o.slug,
        applied: cambios,
        ...(fallaron.length ? { warning: `Meta did not confirm ${fallaron.length} of ${cambios.length}: ${fallaron.map((f) => f.name).join(", ")}` } : {}),
      };
    },
  });
}
