import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { syncIfStale } from "@/lib/mkt/contacts";
import { contactStats, countSegment } from "@/lib/mkt/segments";
import { storeCatalog, loadStore } from "@/lib/mkt/catalog";
import { writeCampaign } from "@/lib/mkt/ai";
import { campaignStats, revenueText } from "@/lib/mkt/stats";
import { loadCampaign } from "@/lib/mkt/send";
import { CAMPAIGN_COLS, LOCALES, LocaleZ, SegmentZ, VersionsZ, cleanSegment, type Versions } from "@/lib/mkt/types";
import { defineTool, getStore, storeArg, UserError } from "./util";

/**
 * Email marketing por MCP: leer contactos y segmentos, armar o cambiar un
 * BORRADOR de campaña (también con la IA) y leer resultados. NUNCA manda:
 * enviar (y las pruebas) solo desde el botón del panel, con la confirmación de
 * la cantidad exacta.
 */
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

export function registerMktTools(server: McpServer) {
  defineTool(server, "mkt_contacts_summary", {
    title: "Email marketing: contacts of a store",
    kind: "read",
    description:
      "Marketing contacts of a store (app buyers + buyers imported from la plataforma anterior): how many can receive campaigns, by language, and how many are excluded (unsubscribed, bounced, spam complaints, refunds, disputes) plus cart leads (never marketed by default). Optional `q` lists up to `limit` matching contacts (email/name search).",
    input: z.object({ store: storeArg, q: z.string().max(80).optional(), limit: z.number().int().min(1).max(100).default(20) }),
    handler: async ({ store, q, limit }) => {
      const s = await getStore(store);
      await syncIfStale(s.id).catch(() => null);
      const stats = await contactStats(s.id);
      let contacts: unknown[] | undefined;
      if (q) {
        const clean = q.replace(/[%,()]/g, "");
        const { data } = await db.from("mkt_contacts")
          .select("email,name,locale,country,kind,source,status,orders_count,spent_usd,last_purchase_at,refunded,disputed")
          .eq("store_id", s.id).or(`email.ilike.%${clean}%,name.ilike.%${clean}%`).limit(limit);
        contacts = data ?? [];
      }
      return { store: s.slug, ...stats, ...(contacts ? { contacts } : {}) };
    },
  });

  defineTool(server, "mkt_segment_count", {
    title: "Email marketing: count a segment",
    kind: "read",
    description:
      "How many contacts of a store match a segment, by language (exclusions always applied). Filters (all optional): offers_any / offers_none (offer ids from list_offers: bought any / owns none — what you want to sell), categories, categories_none, markets (checkout market labels), countries (ISO-2), locales (it,en,es,pt-BR,fr,de), from/to (YYYY-MM-DD, last purchase, Argentina time), spent_min (USD), exclude_recent_days, engaged {campaign, kind: opened|clicked|not_opened}, leads (add cart leads that have marketing permission).",
    input: z.object({ store: storeArg, segment: SegmentZ.default({}) }),
    handler: async ({ store, segment }) => {
      const s = await getStore(store);
      await syncIfStale(s.id).catch(() => null);
      return countSegment(s.id, segment);
    },
  });

  defineTool(server, "list_mkt_campaigns", {
    title: "Email marketing: list campaigns",
    kind: "read",
    description: "Campaigns (newest first) with status and headline results. Status: draft, scheduled, sending, paused, sent, cancelled.",
    input: z.object({ store: storeArg.optional(), limit: z.number().int().min(1).max(50).default(20) }),
    handler: async ({ store, limit }) => {
      let q = db.from("mkt_campaigns").select("id,store_id,name,status,total,discount_pct,created_at,started_at,finished_at,scheduled_at,last_error").order("created_at", { ascending: false }).limit(limit);
      if (store) q = q.eq("store_id", (await getStore(store)).id);
      const { data } = await q;
      return Promise.all((data ?? []).map(async (c) => {
        if (c.status === "draft") return c;
        const s = await campaignStats(c.id).catch(() => null);
        return { ...c, ...(s ? { sent: s.sent, opened: s.opened, clicked: s.clicked, orders: s.orders, revenue: s.revenue } : {}) };
      }));
    },
  });

  defineTool(server, "get_mkt_campaign", {
    title: "Email marketing: campaign detail and stats",
    kind: "read",
    description:
      "One campaign: segment, language versions (subject, preheader, blocks), discount, status and results (sent, delivered, opens, clicks, unsubscribes, bounces, attributed orders and revenue by currency — orders from recipients within 7 days that came with its utm_campaign or after clicking).",
    input: z.object({ id: uuid }),
    handler: async ({ id }) => {
      const { data } = await db.from("mkt_campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
      if (!data) throw new UserError("Campaign not found. Use list_mkt_campaigns.");
      const c = data as unknown as Record<string, unknown> & { status: string };
      const stats = c.status === "draft" ? null : await campaignStats(id);
      return { ...c, stats, revenue_text: stats ? await revenueText(stats.revenue) : null, panel: `/admin/email/campanas/${id}` };
    },
  });

  defineTool(server, "upsert_mkt_campaign_draft", {
    title: "Email marketing: create or update a campaign DRAFT",
    kind: "write",
    description:
      "Create a campaign draft (no `id`) or update one that is still a draft. This NEVER sends anything: sending (and test sends) only happen from the panel button, after el dueño confirms the exact recipient count. versions = { <locale>: { subject, preheader, blocks } }; blocks: {id, type:'heading'|'text', text} · {id, type:'product', funnel:<checkout uuid>, cta?, blurb?} (price, cover and link are filled per recipient; hidden if they own it) · {id, type:'recommend', count:1-3, categories?, title?, cta?} (products they do NOT own yet, in their language) · {id, type:'image', src, href?} · {id, type:'button', label, href}. Text supports **bold**, blank line = new paragraph, {nombre} = first name. Prices, links, discount and legal footer are added by the template. discount_pct (1-90) + discount_hours: signed discount valid only on each button's checkout.",
    input: z.object({
      id: uuid.optional(),
      store: storeArg.optional(),
      name: z.string().min(1).max(120).optional(),
      segment: SegmentZ.optional(),
      versions: VersionsZ.optional(),
      fallback_locale: LocaleZ.nullable().optional(),
      discount_pct: z.number().int().min(1).max(90).nullable().optional(),
      discount_hours: z.number().int().min(1).max(720).optional(),
      goal: z.string().max(2000).optional(),
    }),
    handler: async (a) => {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (a.name !== undefined) row.name = a.name;
      if (a.segment !== undefined) row.segment = cleanSegment(a.segment);
      if (a.versions !== undefined) row.versions = a.versions;
      if (a.fallback_locale !== undefined) row.fallback_locale = a.fallback_locale;
      if (a.discount_pct !== undefined) row.discount_pct = a.discount_pct;
      if (a.discount_hours !== undefined) row.discount_hours = a.discount_hours;
      if (a.goal !== undefined) row.goal = a.goal;
      if (!a.id) {
        if (!a.store) throw new UserError("To create a draft pass `store` (and a `name`).");
        const s = await getStore(a.store);
        const { data, error } = await db.from("mkt_campaigns").insert({ store_id: s.id, name: a.name ?? "Campaña (MCP)", versions: {}, ...row, created_via: "mcp" }).select("id").single();
        if (error) throw new Error(error.message);
        return { id: data.id, status: "draft", panel: `/admin/email/campanas/${data.id}`, note: "Draft only. el dueño reviews, sends a test and sends from the panel." };
      }
      const c = await loadCampaign(a.id);
      if (!c) throw new UserError("Campaign not found.");
      if (c.status !== "draft") throw new UserError(`The campaign is «${c.status}»: only drafts can be edited (duplicate it in the panel).`);
      const { error } = await db.from("mkt_campaigns").update(row).eq("id", c.id).eq("status", "draft");
      if (error) throw new Error(error.message);
      return { id: c.id, status: "draft", panel: `/admin/email/campanas/${c.id}` };
    },
  });

  defineTool(server, "write_mkt_campaign_with_ai", {
    title: "Email marketing: write a draft with the AI",
    kind: "write",
    external: true,
    description:
      "The panel's «Escribir con IA» on a DRAFT: give the goal (e.g. «offer the complete collection to those who bought Nails USA») and the languages; the AI writes each language with only the store's active products in that language. Saves the versions in the draft (never sends). Returns per-language errors if a version did not pass the checks (no invented numbers, no links).",
    input: z.object({ id: uuid, goal: z.string().min(5).max(1500), locales: z.array(LocaleZ).min(1).max(LOCALES.length) }),
    handler: async ({ id, goal, locales }) => {
      const c = await loadCampaign(id);
      if (!c) throw new UserError("Campaign not found.");
      if (c.status !== "draft") throw new UserError("Only drafts.");
      const [store, catalog] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id)]);
      if (!store) throw new Error("store missing");
      const r = await writeCampaign({ store, goal, locales, catalog, discountPct: c.discount_pct, owned: c.segment?.offers_any ?? [] });
      const versions: Versions = { ...(c.versions ?? {}), ...r.versions };
      await db.from("mkt_campaigns").update({ versions, goal, updated_at: new Date().toISOString() }).eq("id", c.id).eq("status", "draft");
      return { id, written: Object.keys(r.versions), errors: r.errors, panel: `/admin/email/campanas/${id}` };
    },
  });
}
