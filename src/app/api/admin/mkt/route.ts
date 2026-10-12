import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncContacts } from "@/lib/mkt/contacts";
import { countSegment } from "@/lib/mkt/segments";
import { loadStore, storeCatalog } from "@/lib/mkt/catalog";
import { writeCampaign } from "@/lib/mkt/ai";
import { confirmSend, loadCampaign, planSend, sendTest, setCampaignState } from "@/lib/mkt/send";
import { saveMktSettings, saveStoreSender } from "@/lib/mkt/settings";
import { brevoAuthenticate, ensureWebhook } from "@/lib/mkt/brevo";
import { campaignStats } from "@/lib/mkt/stats";
import { LocaleZ, SegmentZ, VersionsZ, cleanSegment, CAMPAIGN_COLS, type Versions } from "@/lib/mkt/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Email marketing desde el panel (fetch común, no server actions). Una sola
 * ruta con `action`. Mandar a clientes reales solo pasa por «send», que exige
 * la cantidad exacta que el dueño vio en la confirmación.
 */
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), store: uuid.nullable().optional() }),
  z.object({ action: z.literal("count"), store: uuid, segment: SegmentZ }),
  z.object({ action: z.literal("segment_save"), id: uuid.optional(), store: uuid, name: z.string().trim().min(1).max(80), filters: SegmentZ }),
  z.object({ action: z.literal("segment_delete"), id: uuid }),
  z.object({ action: z.literal("campaign_create"), store: uuid, name: z.string().trim().min(1).max(120) }),
  z.object({
    action: z.literal("campaign_save"), id: uuid,
    patch: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      segment: SegmentZ.optional(), segment_id: uuid.nullable().optional(),
      versions: VersionsZ.optional(), fallback_locale: LocaleZ.nullable().optional(), goal: z.string().max(2000).optional(),
      discount_pct: z.number().int().min(1).max(90).nullable().optional(), discount_hours: z.number().int().min(1).max(720).optional(),
    }),
  }),
  z.object({ action: z.literal("campaign_delete"), id: uuid }),
  z.object({ action: z.literal("campaign_duplicate"), id: uuid }),
  z.object({ action: z.literal("ai_write"), id: uuid, goal: z.string().trim().min(5).max(1500), locales: z.array(LocaleZ).min(1).max(6) }),
  z.object({ action: z.literal("test"), id: uuid, locales: z.array(LocaleZ).max(6).optional() }),
  z.object({ action: z.literal("plan"), id: uuid }),
  z.object({ action: z.literal("send"), id: uuid, expected: z.number().int().min(1), at: z.string().datetime({ offset: true }).nullable().optional(), confirm: z.literal(true) }),
  z.object({ action: z.literal("state"), id: uuid, op: z.enum(["pause", "resume", "cancel", "revoke_discount"]) }),
  z.object({ action: z.literal("stats"), id: uuid }),
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), daily_cap: z.number().int().min(0).max(100000).optional(), batch: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal("sender"), store: uuid, from: z.string().trim().email().max(120), reply_to: z.string().trim().email().max(120) }),
  z.object({ action: z.literal("brevo_auth"), domain: z.string().trim().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i) }),
  z.object({ action: z.literal("brevo_webhook") }),
  z.object({ action: z.literal("contact_ok"), id: uuid, marketing_ok: z.boolean() }),
  z.object({ action: z.literal("contact_unsub"), id: uuid }),
]);

const NO_STORE = { "cache-control": "no-store" };
const ok = (j: unknown) => NextResponse.json(j, { headers: NO_STORE });
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status, headers: NO_STORE });

async function editable(id: string) {
  const c = await loadCampaign(id);
  if (!c) throw new Error("La campaña no existe");
  return c;
}

export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch { return bad("No autorizado", 401); }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(`Datos inválidos: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const b = parsed.data;
  try {
    switch (b.action) {
      case "sync":
        return ok(await syncContacts(b.store ?? null));
      case "count":
        return ok(await countSegment(b.store, b.segment));
      case "segment_save": {
        const row = { store_id: b.store, name: b.name, filters: cleanSegment(b.filters), updated_at: new Date().toISOString() };
        const { data, error } = b.id
          ? await db.from("mkt_segments").update(row).eq("id", b.id).select("id").single()
          : await db.from("mkt_segments").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        return ok({ id: data.id });
      }
      case "segment_delete": {
        await db.from("mkt_segments").delete().eq("id", b.id);
        return ok({ ok: true });
      }
      case "campaign_create": {
        const store = await loadStore(b.store);
        if (!store) return bad("La tienda no existe");
        const { data, error } = await db.from("mkt_campaigns").insert({ store_id: b.store, name: b.name, versions: {} }).select("id").single();
        if (error) throw new Error(error.message);
        return ok({ id: data.id });
      }
      case "campaign_save": {
        const c = await editable(b.id);
        const p = b.patch;
        const content = p.versions !== undefined || p.segment !== undefined || p.segment_id !== undefined || p.fallback_locale !== undefined || p.discount_pct !== undefined || p.discount_hours !== undefined;
        if (content && c.status !== "draft") return bad("Solo se edita el contenido de un borrador (duplicala para cambiarla)");
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (p.name !== undefined) row.name = p.name;
        if (p.segment !== undefined) row.segment = cleanSegment(p.segment);
        if (p.segment_id !== undefined) row.segment_id = p.segment_id;
        if (p.versions !== undefined) row.versions = p.versions;
        if (p.fallback_locale !== undefined) row.fallback_locale = p.fallback_locale;
        if (p.goal !== undefined) row.goal = p.goal;
        if (p.discount_pct !== undefined) row.discount_pct = p.discount_pct;
        if (p.discount_hours !== undefined) row.discount_hours = p.discount_hours;
        const { error } = await db.from("mkt_campaigns").update(row).eq("id", c.id);
        if (error) throw new Error(error.message);
        return ok({ ok: true, updated_at: row.updated_at });
      }
      case "campaign_delete": {
        const c = await editable(b.id);
        if (!["draft", "cancelled"].includes(c.status)) return bad("Solo se borra un borrador o una campaña cancelada");
        await db.from("mkt_campaigns").delete().eq("id", c.id);
        return ok({ ok: true });
      }
      case "campaign_duplicate": {
        const c = await editable(b.id);
        const { data, error } = await db.from("mkt_campaigns").insert({
          store_id: c.store_id, name: `${c.name} (copia)`.slice(0, 120), segment: c.segment, segment_id: c.segment_id, versions: c.versions,
          fallback_locale: c.fallback_locale, goal: c.goal, discount_pct: c.discount_pct, discount_hours: c.discount_hours,
        }).select("id").single();
        if (error) throw new Error(error.message);
        return ok({ id: data.id });
      }
      case "ai_write": {
        const c = await editable(b.id);
        if (c.status !== "draft") return bad("Solo en un borrador");
        const [store, catalog] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id)]);
        if (!store) return bad("La tienda no existe");
        const r = await writeCampaign({ store, goal: b.goal, locales: b.locales, catalog, discountPct: c.discount_pct, owned: c.segment?.offers_any ?? [] });
        // Guarda lo que salió bien (sin pisar los idiomas que fallaron) y el objetivo.
        const versions: Versions = { ...(c.versions ?? {}), ...r.versions };
        await db.from("mkt_campaigns").update({ versions, goal: b.goal, updated_at: new Date().toISOString() }).eq("id", c.id);
        return ok({ versions, errors: r.errors });
      }
      case "test":
        return ok({ results: await sendTest(b.id, b.locales) });
      case "plan":
        return ok(await planSend(b.id));
      case "send":
        return ok(await confirmSend(b.id, b.expected, b.at ? new Date(b.at) : null));
      case "state":
        return ok({ message: await setCampaignState(b.id, b.op) });
      case "stats":
        return ok(await campaignStats(b.id));
      case "settings":
        return ok(await saveMktSettings({ ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.daily_cap !== undefined ? { daily_cap: b.daily_cap } : {}), ...(b.batch !== undefined ? { batch: b.batch } : {}) }));
      case "sender":
        await saveStoreSender(b.store, b.from, b.reply_to);
        return ok({ ok: true });
      case "brevo_auth":
        return ok(await brevoAuthenticate(b.domain.toLowerCase()));
      case "brevo_webhook": {
        const base = process.env.PUBLIC_BASE_URL?.trim();
        if (!base || !/^https:\/\//.test(base)) return bad("Falta PUBLIC_BASE_URL (https) para el webhook");
        return ok(await ensureWebhook(base));
      }
      case "contact_ok": {
        const { error } = await db.from("mkt_contacts").update({ marketing_ok: b.marketing_ok, updated_at: new Date().toISOString() }).eq("id", b.id).eq("kind", "lead");
        if (error) throw new Error(error.message);
        return ok({ ok: true });
      }
      case "contact_unsub": {
        const { data: c } = await db.from("mkt_contacts").select("store_id,email").eq("id", b.id).maybeSingle();
        if (!c) return bad("No existe");
        await Promise.all([
          db.from("mkt_contacts").update({ status: "unsubscribed", status_at: new Date().toISOString(), status_reason: "baja a mano desde el panel" }).eq("id", b.id),
          db.from("mail_unsubscribes").upsert({ store_id: c.store_id, email: c.email, source: "panel" }, { onConflict: "store_id,email", ignoreDuplicates: true }),
        ]);
        return ok({ ok: true });
      }
    }
  } catch (e) {
    return bad((e as Error).message, 409);
  }
}

/** GET ?id=… → la campaña (para recargar el editor sin recargar la página). */
export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return bad("No autorizado", 401); }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Falta ?id");
  const { data } = await db.from("mkt_campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  return data ? ok(data) : bad("No existe", 404);
}
