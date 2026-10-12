import { randomUUID } from "crypto";
import { db } from "../db";
import { brandFor } from "../brand";
import { checkLink } from "../link-check";
import { publicOrigin } from "../public-url";
import { raiseAlert } from "../alerts";
import { getRates } from "../fx";
import { loadStore, storeCatalog, type CatalogItem, type StoreRow } from "./catalog";
import { ownsProduct } from "../postpurchase";
import { newCtx, renderCampaign, type RenderCtx, type Recipient } from "./render";
import { brevoAccount, brevoSend, BrevoError, noCreditsReason, senderReady } from "./brevo";
import { liveMktBase, withMktTracking } from "./track";
import { mktSettings, sentLast24h, storeSender, type StoreSender } from "./settings";
import { countSegment } from "./segments";
import { syncContacts } from "./contacts";
import { COUNTRY_OF } from "./texts";
import { CAMPAIGN_COLS, LOCALE_ES, TEST_TO, type Campaign, type Locale, type Version } from "./types";

/**
 * Envío de campañas.
 *
 * REGLAS (no se relajan):
 *  · Una prueba va SOLO a el email de TEST_EMAIL (TEST_TO), lo pida quien lo pida.
 *  · Un envío real sale solo si: el dueño confirmó en el panel la cantidad exacta,
 *    el interruptor general está prendido, hay cupo en el tope diario, el
 *    remitente es de un subdominio autenticado en Brevo y la baja ya está
 *    publicada en el dominio de la tienda. El MCP no puede mandar.
 *  · Nunca por la casilla de la tienda ni por sendMail (entregas).
 */

export async function loadCampaign(id: string): Promise<Campaign | null> {
  const { data } = await db.from("mkt_campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  return (data as unknown as Campaign) ?? null;
}

const versionLocales = (c: Campaign) =>
  (Object.entries(c.versions ?? {}) as [Locale, Version][]).filter(([, v]) => v?.subject?.trim() && v.blocks?.length).map(([l]) => l);

function discountOf(c: Campaign, at = new Date()) {
  if (!c.discount_pct || c.discount_revoked_at) return null;
  const exp = c.discount_expires_at ? new Date(c.discount_expires_at) : new Date(at.getTime() + c.discount_hours * 3600_000);
  return { pct: c.discount_pct, expiresAt: exp };
}

async function baseFor(store: StoreRow, ctx: RenderCtx) {
  const hosts = [store.domain, ...ctx.catalog.filter((c) => c.active).map((c) => c.url)];
  return liveMktBase(hosts);
}

function headersFor(unsubUrl: string, store: StoreRow, sendId: string) {
  return {
    "List-Unsubscribe": `<${unsubUrl}>, <mailto:${store.support_email}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-Mailin-custom": sendId,
  };
}

/** Cada botón de producto abre su checkout (200, mismo dominio) con el descuento entero. Una vez por checkout y pasada. */
const linkMemo = new Map<string, { at: number; bad: string | null }>();
async function badLink(url: string, token: string | null): Promise<string | null> {
  const k = url.split("?")[0] + (token ? "#r" : "");
  const hit = linkMemo.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bad;
  let bad: string | null = null;
  if (!publicOrigin(url)) bad = "no es un link público";
  else {
    const chk = await checkLink(url);
    if (!chk.ok) bad = chk.reason ?? "no abre";
    else if (chk.status !== 200) bad = `responde ${chk.status}`;
    else if (token && new URL(chk.final ?? url).searchParams.get("r") !== token) bad = "el descuento (r=) se pierde en el camino";
  }
  linkMemo.set(k, { at: Date.now(), bad });
  return bad;
}

// ------------------------------------------------------------------ vista previa

export async function previewCampaign(c: Campaign, locale: Locale, as?: { contactId?: string | null }) {
  const [store, catalog] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id)]);
  if (!store) throw new Error("La tienda no existe");
  const v = c.versions?.[locale];
  if (!v) throw new Error(`No hay versión en ${LOCALE_ES[locale]}`);
  let to: Recipient = { email: TEST_TO, name: "el dueño", country: COUNTRY_OF[locale], products: [] };
  if (as?.contactId) {
    const { data } = await db.from("mkt_contacts").select("email,name,country,products").eq("id", as.contactId).eq("store_id", c.store_id).maybeSingle();
    if (data) to = { email: data.email, name: data.name, country: data.country, products: data.products ?? [] };
  }
  const r = await renderCampaign({
    campaignId: c.id, discount: discountOf(c), version: v, locale, store, to, sendId: null,
    base: publicOrigin(store.domain), test: true, ctx: newCtx(catalog),
  });
  return { ...r, from: (await storeSender(store)).from, brand: brandFor(store, locale) };
}

// ------------------------------------------------------------------ prueba

export type TestResult = { locale: Locale; ok: boolean; subject?: string; error?: string; notes?: string[] };

/** «Enviar prueba»: cada idioma (o los elegidos) a TEST_TO y a nadie más. */
export async function sendTest(campaignId: string, locales?: Locale[]): Promise<TestResult[]> {
  const c = await loadCampaign(campaignId);
  if (!c) throw new Error("La campaña no existe");
  const [store, catalog] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id)]);
  if (!store) throw new Error("La tienda no existe");
  const sender = await storeSender(store);
  const why = await senderReady(sender.from);
  if (why) throw new Error(`No puedo mandar desde ${sender.from}: ${why}. Revisalo en Email marketing › Ajustes.`);
  const broke = await noCreditsReason();
  if (broke) throw new Error(`${broke}. Pasá Brevo a un plan con envíos y probá de nuevo.`);
  const ctx = newCtx(catalog);
  const live = await baseFor(store, ctx);
  const base = live ?? publicOrigin(store.domain);
  const list = (locales?.length ? locales : versionLocales(c)).filter((l) => c.versions?.[l]);
  if (!list.length) throw new Error("La campaña no tiene ninguna versión con asunto y contenido");
  const out: TestResult[] = [];
  for (const locale of list) {
    const id = randomUUID();
    const to: Recipient = { email: TEST_TO, name: "el dueño", country: COUNTRY_OF[locale], products: [] };
    try {
      const r = await renderCampaign({ campaignId: c.id, discount: discountOf(c), version: c.versions[locale]!, locale, store, to, sendId: id, base, test: true, ctx });
      const notes = [...r.notes];
      if (!live) notes.push("la baja y el seguimiento todavía no están publicados en el dominio de la tienda: en esta prueba no andan (hace falta el deploy)");
      for (const p of r.productLinks) {
        const bad = await badLink(p.url, p.token);
        if (bad) notes.push(`el botón de un producto no pasa: ${bad} (${p.url.split("?")[0]})`);
      }
      const html = live ? withMktTracking(r.html, live, id) : r.html;
      if (to.email !== TEST_TO) throw new Error("prueba bloqueada: solo a la casilla de prueba");
      await db.from("mkt_sends").insert({ id, campaign_id: c.id, store_id: c.store_id, email: TEST_TO, locale, is_test: true, status: "sending", subject: r.subject, claimed_at: new Date().toISOString() });
      const msgId = await brevoSend({
        from: { email: sender.from, name: brandFor(store, locale) }, replyTo: sender.replyTo, to: TEST_TO, toName: "el dueño",
        subject: `[Prueba] ${r.subject}`, html, headers: r.unsubUrl ? headersFor(r.unsubUrl, store, id) : { "X-Mailin-custom": id },
        tags: ["mkt", "mkt-test"],
      });
      await db.from("mkt_sends").update({ status: "sent", provider_id: msgId, sent_at: new Date().toISOString() }).eq("id", id);
      out.push({ locale, ok: true, subject: r.subject, notes });
    } catch (e) {
      const msg = (e as Error).message;
      await db.from("mkt_sends").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", id);
      out.push({ locale, ok: false, error: e instanceof BrevoError && e.noCredits ? "Brevo no tiene créditos para mandar (plan sin envíos disponibles)" : msg.slice(0, 300) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ confirmar y encolar

export type SendPlan = {
  total: number;
  split: { locale: string; n: number; as: Locale | null }[];
  problems: string[]; warnings: string[];
  sender: string; enabled: boolean; dailyCap: number; usedToday: number;
};

/** Lo que muestra el paso de confirmación: cuántos exactos, en qué idioma y qué falta. */
export async function planSend(campaignId: string): Promise<SendPlan> {
  const c = await loadCampaign(campaignId);
  if (!c) throw new Error("La campaña no existe");
  const [store, catalog, settings, used] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id), mktSettings(), sentLast24h()]);
  if (!store) throw new Error("La tienda no existe");
  await syncContacts(c.store_id);
  const problems: string[] = [], warnings: string[] = [];
  if (!["draft", "paused"].includes(c.status)) problems.push(`la campaña está «${c.status}»`);
  const vl = versionLocales(c);
  if (!vl.length) problems.push("no hay ninguna versión con asunto y contenido");
  if (c.fallback_locale && !vl.includes(c.fallback_locale)) problems.push(`el idioma de respaldo (${LOCALE_ES[c.fallback_locale]}) no tiene versión`);
  const sender = await storeSender(store);
  const why = await senderReady(sender.from);
  if (why) problems.push(`remitente ${sender.from}: ${why}`);
  const ctx = newCtx(catalog);
  const base = await baseFor(store, ctx);
  if (!base) problems.push("la baja de un clic todavía no está publicada en el dominio de la tienda (falta el deploy)");
  const acct = await brevoAccount();
  if (acct.error) warnings.push(`Brevo: ${acct.error}`);
  else if (acct.credits === 0) problems.push(`Brevo no tiene créditos (plan ${acct.plan}): no saldría ningún mail`);
  // Cada versión se arma una vez (como a alguien que no tiene nada) para revisar los botones.
  for (const l of vl) {
    const r = await renderCampaign({
      campaignId: c.id, discount: discountOf(c), version: c.versions[l]!, locale: l, store,
      to: { email: TEST_TO, name: null, country: COUNTRY_OF[l], products: [] }, sendId: null, base, ctx,
    });
    for (const n of r.notes) warnings.push(`${LOCALE_ES[l]}: ${n}`);
    for (const p of r.productLinks) {
      const bad = await badLink(p.url, p.token);
      if (bad) problems.push(`${LOCALE_ES[l]}: un botón de producto no abre bien (${bad}) · ${p.url.split("?")[0]}`);
    }
  }
  const count = await countSegment(c.store_id, c.segment ?? {});
  const split = Object.entries(count.by_locale).map(([locale, n]) => ({
    locale, n, as: (vl as string[]).includes(locale) ? (locale as Locale) : c.fallback_locale && vl.includes(c.fallback_locale) ? c.fallback_locale : null,
  })).sort((a, b) => b.n - a.n);
  const total = split.filter((s) => s.as).reduce((a, s) => a + s.n, 0);
  if (!total) problems.push("no hay nadie a quien mandarle (segmento vacío o sin versión en su idioma)");
  if (!settings.enabled) warnings.push("el interruptor general de envíos está APAGADO: la campaña queda en cola y sale cuando lo prendas en Ajustes");
  if (total > settings.daily_cap) warnings.push(`son más que el tope diario (${settings.daily_cap}): sale en ${Math.ceil(total / Math.max(1, settings.daily_cap))} días`);
  if (c.discount_pct && !c.discount_revoked_at) warnings.push(`descuento −${c.discount_pct}% durante ${c.discount_hours} h desde que empieza a salir`);
  const owns = total ? await ownsEverything(c, catalog, split).catch(() => null) : null;
  if (owns) for (const [l, n] of Object.entries(owns)) {
    if (n) warnings.push(`${LOCALE_ES[l as Locale] ?? l}: ${n} ya ${n === 1 ? "tiene" : "tienen"} todo lo que ofrece su versión: quedan en la cola pero no se les manda`);
  }
  return { total, split, problems, warnings, sender: sender.from, enabled: settings.enabled, dailyCap: settings.daily_cap, usedToday: used };
}

/**
 * Cuántos del segmento ya tienen todos los productos que les mostraría su
 * versión (a esos no se les manda: el render los saltea). Igual que el
 * post-pago: tener un pack o la base de una variante cuenta como tenerlo.
 */
async function ownsEverything(c: Campaign, catalog: CatalogItem[], split: SendPlan["split"]) {
  const asOf = new Map(split.map((s) => [s.locale, s.as]));
  const rows: { id: string; locale: string | null }[] = [];
  for (let a = 0; a < 20_000; a += 1000) {
    const { data, error } = await db.rpc("mkt_segment_ids", { p_store: c.store_id, f: c.segment ?? {} }).range(a, a + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { id: string; locale: string | null }[]));
    if ((data ?? []).length < 1000) break;
  }
  const owned = new Map<string, Set<string>>();
  for (let i = 0; i < rows.length; i += 300) {
    const { data } = await db.from("mkt_contacts").select("id,products").in("id", rows.slice(i, i + 300).map((r) => r.id));
    for (const r of data ?? []) owned.set(r.id, new Set((r.products ?? []) as string[]));
  }
  const asProduct = (it: CatalogItem) => ({ id: it.productId, variant_of: it.variantOf, includes: it.includes });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const as = asOf.get(r.locale ?? "?");
    const v = as ? c.versions?.[as] : null;
    if (!as || !v) continue;
    const have = owned.get(r.id) ?? new Set<string>();
    let offers = 0, shows = false;
    for (const b of v.blocks) {
      if (b.type === "product") {
        offers++;
        const it = catalog.find((x) => x.funnelId === b.funnel);
        if (it?.active && !ownsProduct(have, asProduct(it))) { shows = true; break; }
      } else if (b.type === "recommend") {
        offers++;
        const cats = new Set(b.categories ?? []);
        if (catalog.some((x) => x.active && !x.solo && x.locale === as && (!cats.size || (x.category && cats.has(x.category))) && !ownsProduct(have, asProduct(x)))) { shows = true; break; }
      }
    }
    if (offers && !shows) out[as] = (out[as] ?? 0) + 1;
  }
  return out;
}

/**
 * El botón «Enviar» después de confirmar: vuelve a contar y, si la cantidad
 * no es exactamente la que vio el dueño, no encola nada.
 */
export async function confirmSend(campaignId: string, expected: number, at: Date | null) {
  const plan = await planSend(campaignId);
  if (plan.problems.length) throw new Error(`No se puede enviar: ${plan.problems.join(" · ")}`);
  if (plan.total !== expected) throw new Error(`La cantidad cambió (ahora son ${plan.total}, viste ${expected}): revisá de nuevo antes de enviar`);
  const c = (await loadCampaign(campaignId))!;
  const vl = versionLocales(c);
  const { data: n, error } = await db.rpc("mkt_enqueue", { p_campaign: c.id, p_versions: vl, p_fallback: c.fallback_locale });
  if (error) throw new Error(`No se pudo armar la cola: ${error.message}`);
  if (Number(n) !== expected) {
    await db.from("mkt_sends").delete().eq("campaign_id", c.id).eq("status", "queued").eq("is_test", false);
    throw new Error(`La cola quedó con ${n} y confirmaste ${expected}: no se envió nada, revisá de nuevo`);
  }
  const now = new Date();
  const later = at && at.getTime() > now.getTime() + 60_000;
  await db.from("mkt_campaigns").update({
    status: later ? "scheduled" : "sending", total: expected, confirmed_at: now.toISOString(), last_error: null,
    scheduled_at: later ? at!.toISOString() : null, started_at: later ? null : now.toISOString(),
    ...(c.discount_pct && !later ? { discount_expires_at: new Date(now.getTime() + c.discount_hours * 3600_000).toISOString() } : {}),
    updated_at: now.toISOString(),
  }).eq("id", c.id);
  return { queued: expected, scheduled: later ? at!.toISOString() : null, enabled: plan.enabled };
}

export async function setCampaignState(campaignId: string, action: "pause" | "resume" | "cancel" | "revoke_discount") {
  const c = await loadCampaign(campaignId);
  if (!c) throw new Error("La campaña no existe");
  const now = new Date().toISOString();
  if (action === "revoke_discount") {
    await db.from("mkt_campaigns").update({ discount_revoked_at: now, updated_at: now }).eq("id", c.id);
    return "Descuento cortado: los links del mail ya no lo aplican";
  }
  if (action === "pause") {
    if (!["sending", "scheduled"].includes(c.status)) throw new Error("Solo se pausa una campaña que está saliendo o programada");
    await db.from("mkt_campaigns").update({ status: "paused", updated_at: now }).eq("id", c.id);
    return "Pausada";
  }
  if (action === "resume") {
    if (c.status !== "paused") throw new Error("La campaña no está pausada");
    const { count } = await db.from("mkt_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
    if (!count) throw new Error("No queda nadie en la cola: usá «Enviar…» para armarla");
    const future = c.scheduled_at && +new Date(c.scheduled_at) > Date.now();
    await db.from("mkt_campaigns").update({
      status: future ? "scheduled" : "sending", started_at: c.started_at ?? (future ? null : now), last_error: null, updated_at: now,
      ...(c.discount_pct && !c.discount_expires_at && !future ? { discount_expires_at: new Date(Date.now() + c.discount_hours * 3600_000).toISOString() } : {}),
    }).eq("id", c.id);
    return "Sigue saliendo";
  }
  if (["sent", "cancelled"].includes(c.status)) throw new Error("La campaña ya terminó");
  await db.from("mkt_campaigns").update({ status: c.status === "draft" ? "draft" : "cancelled", updated_at: now }).eq("id", c.id);
  await db.from("mkt_sends").update({ status: "skipped", error: "campaña cancelada" }).eq("campaign_id", c.id).eq("status", "queued");
  return "Cancelada: no sale nada más";
}

// ------------------------------------------------------------------ cron

type Run = { campaign: Campaign; store: StoreRow; ctx: RenderCtx; sender: StoreSender; base: string };

async function pauseWith(c: Campaign, why: string, alert = true) {
  await db.from("mkt_campaigns").update({ status: "paused", last_error: why.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", c.id);
  if (alert) {
    await raiseAlert({
      kind: "mkt_error", severity: "error", storeId: c.store_id, ref: `mkt:${c.id}`, reopen: true,
      link: `/admin/email/campanas/${c.id}`, title: `Campaña «${c.name}» pausada`, body: why,
    }).catch(() => {});
  }
}

async function deliver(send: { id: string; campaign_id: string; contact_id: string | null; email: string; locale: string | null }, run: Run): Promise<"sent" | "skipped"> {
  const c = run.campaign;
  const locale = (send.locale ?? c.fallback_locale) as Locale | null;
  const v = locale ? c.versions?.[locale] : null;
  const skip = async (why: string) => { await db.from("mkt_sends").update({ status: "skipped", error: why }).eq("id", send.id); return "skipped" as const; };
  if (!locale || !v) return skip("sin versión en su idioma");
  // Justo antes de mandar: sigue suscripto, sin reembolso ni contracargo, y no se dio de baja recién.
  const [{ data: ct }, { count: unsub }] = await Promise.all([
    db.from("mkt_contacts").select("name,country,products,status,marketing_ok,refunded,disputed").eq("id", send.contact_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
    db.from("mail_unsubscribes").select("email", { count: "exact", head: true }).eq("store_id", c.store_id).eq("email", send.email),
  ]);
  if (!ct) return skip("el contacto ya no existe");
  if (ct.status !== "subscribed" || !ct.marketing_ok || ct.refunded || ct.disputed || unsub) {
    return skip(`ya no corresponde (${ct.status !== "subscribed" ? ct.status : unsub ? "baja" : ct.refunded ? "reembolso" : ct.disputed ? "contracargo" : "sin permiso"})`);
  }
  const r = await renderCampaign({
    campaignId: c.id, discount: discountOf(c), version: v, locale, store: run.store,
    to: { email: send.email, name: ct.name, country: ct.country, products: ct.products ?? [] }, sendId: send.id, base: run.base, ctx: run.ctx,
  });
  if (r.skip) return skip(r.skip);
  if (!r.unsubUrl || !publicOrigin(r.unsubUrl)) throw new Error("sin link de baja público");
  for (const p of r.productLinks) {
    const bad = await badLink(p.url, p.token);
    if (bad) throw new LinkError(`un botón de producto no abre bien (${bad}): ${p.url.split("?")[0]}`);
  }
  const html = withMktTracking(r.html, run.base, send.id);
  const msgId = await brevoSend({
    from: { email: run.sender.from, name: brandFor(run.store, locale) }, replyTo: run.sender.replyTo, to: send.email, toName: ct.name,
    subject: r.subject, html, headers: headersFor(r.unsubUrl, run.store, send.id), tags: ["mkt", `mkt-${c.id.slice(0, 8)}`],
  });
  const now = new Date().toISOString();
  await Promise.all([
    db.from("mkt_sends").update({ status: "sent", provider_id: msgId, subject: r.subject.slice(0, 300), sent_at: now, error: null }).eq("id", send.id),
    send.contact_id ? db.from("mkt_contacts").update({ last_sent_at: now }).eq("id", send.contact_id) : Promise.resolve(),
  ]);
  return "sent";
}
class LinkError extends Error {}

/** Cada minuto (pg_cron «email-marketing» → /api/cron/mkt). */
export async function runMkt(budgetMs = 45_000) {
  const t0 = Date.now();
  const settings = await mktSettings();
  const out: Record<string, unknown> = { enabled: settings.enabled };
  await pushResults().catch((e) => { out.results_error = (e as Error).message; });
  if (!settings.enabled) return { ...out, skipped: "interruptor general apagado" };

  // Programadas que ya llegaron a su hora.
  const nowIso = new Date().toISOString();
  const { data: due } = await db.from("mkt_campaigns").select(CAMPAIGN_COLS).eq("status", "scheduled").lte("scheduled_at", nowIso);
  for (const c of (due ?? []) as unknown as Campaign[]) {
    await db.from("mkt_campaigns").update({
      status: "sending", started_at: nowIso, updated_at: nowIso,
      ...(c.discount_pct && !c.discount_expires_at ? { discount_expires_at: new Date(Date.now() + c.discount_hours * 3600_000).toISOString() } : {}),
    }).eq("id", c.id).eq("status", "scheduled");
  }
  // Un envío tomado hace más de 15 min sin respuesta: no se reintenta (podría duplicarse).
  await db.from("mkt_sends").update({ status: "failed", error: "se cortó el envío; no se reintenta para no duplicar" })
    .eq("status", "sending").eq("is_test", false).lt("claimed_at", new Date(Date.now() - 15 * 60_000).toISOString());

  const room = settings.daily_cap - (await sentLast24h());
  out.room = room;
  let sent = 0, failed = 0, skipped = 0;
  if (room > 0) {
    const { data: claimed, error } = await db.rpc("mkt_claim", { p_limit: Math.min(settings.batch, room) });
    if (error) throw new Error(error.message);
    const list = (claimed ?? []) as { id: string; campaign_id: string; contact_id: string | null; email: string; locale: string | null }[];
    const runs = new Map<string, Run | { error: string }>();
    const prep = async (campaignId: string): Promise<Run | { error: string }> => {
      const c = await loadCampaign(campaignId);
      if (!c || c.status !== "sending") return { error: "la campaña ya no está saliendo" };
      const [store, catalog] = await Promise.all([loadStore(c.store_id), storeCatalog(c.store_id)]);
      if (!store) return { error: "la tienda no existe" };
      const sender = await storeSender(store);
      const why = await senderReady(sender.from);
      if (why) { await pauseWith(c, `Remitente ${sender.from}: ${why}`); return { error: why }; }
      const broke = await noCreditsReason();
      if (broke) { await pauseWith(c, broke); return { error: broke }; }
      const ctx = newCtx(catalog);
      ctx.rates = await getRates();
      const base = await baseFor(store, ctx);
      if (!base) { await pauseWith(c, "La baja de un clic no responde en el dominio de la tienda"); return { error: "sin dominio con la baja publicada" }; }
      return { campaign: c, store, ctx, sender, base };
    };
    const back = (ids: string[]) => ids.length ? db.from("mkt_sends").update({ status: "queued" }).in("id", ids).eq("status", "sending") : Promise.resolve();
    let stop: string | null = null;
    const queue = [...list];
    const worker = async () => {
      while (queue.length && !stop && Date.now() - t0 < budgetMs) {
        const s = queue.shift()!;
        if (!runs.has(s.campaign_id)) runs.set(s.campaign_id, await prep(s.campaign_id));
        const run = runs.get(s.campaign_id)!;
        if ("error" in run) { await back([s.id]); continue; }
        try {
          if ((await deliver(s, run)) === "sent") sent++; else skipped++;
        } catch (e) {
          if (e instanceof BrevoError && (e.noCredits || e.status === 401 || e.status === 403)) {
            stop = e.noCredits ? "Brevo no tiene créditos para mandar" : `Brevo rechazó la clave (${e.status})`;
            await back([s.id]);
            await pauseWith(run.campaign, stop);
          } else if (e instanceof LinkError) {
            stop = e.message;
            await back([s.id]);
            await pauseWith(run.campaign, e.message);
          } else {
            failed++;
            await db.from("mkt_sends").update({ status: "failed", error: (e as Error).message.slice(0, 500) }).eq("id", s.id);
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // Lo que no llegó a salir (tiempo agotado o freno): vuelve a la cola.
    await back(queue.map((s) => s.id));
    if (stop) out.stopped = stop;
  }
  out.sent = sent; out.failed = failed; out.skipped = skipped;
  out.finished = await finishCampaigns();
  return out;
}

/** Las que ya no tienen a nadie en cola: «Enviada», con un push del total. */
async function finishCampaigns() {
  const { data: live } = await db.from("mkt_campaigns").select("id,name,store_id").eq("status", "sending");
  let n = 0;
  for (const c of live ?? []) {
    const { count } = await db.from("mkt_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["queued", "sending"]);
    if (count) continue;
    const now = new Date().toISOString();
    const { data: won } = await db.from("mkt_campaigns").update({ status: "sent", finished_at: now, updated_at: now }).eq("id", c.id).eq("status", "sending").select("id");
    if (!won?.length) continue;
    n++;
    const { pushFinished } = await import("./stats");
    await pushFinished(c.id).catch(() => {});
  }
  return n;
}

async function pushResults() {
  const { pushResultsDue } = await import("./stats");
  await pushResultsDue();
}

