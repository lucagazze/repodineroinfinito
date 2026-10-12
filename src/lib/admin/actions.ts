"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { decrypt } from "@/lib/secrets";
import { clearToken, metaError, metaGet, saveToken } from "./meta-conn";
import { adAccounts } from "./meta-report";
import { syncMeta } from "./meta-sync";
import { ADS_TAG } from "./ads";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { uploadImage } from "@/lib/media";
import { checkoutUrl } from "@/lib/checkout-url";
import { offerList, SOLO_SUFFIX } from "./offers";
import { db, getProductById, STORE_COLS, type Product, type Store } from "@/lib/db";
import { sendDelivery } from "@/lib/email";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { mergeSettings } from "@/lib/checkout-settings";
import { invalidateEverything } from "@/lib/cache-bust";
import { runDiagnostics } from "./diagnostico";
import type { ActionResult } from "./types";
import { orderRef } from "@/lib/order-ref";

/**
 * Server actions del panel. El panel es para mirar: crear y configurar lo
 * hace Claude por el MCP. Quedan solo operaciones seguras, y todas empiezan
 * con requireAdmin(): una server action se puede llamar por POST directo,
 * sin pasar por el layout que pide sesión.
 */

export async function diagnosticsAction(slug: string, base: string) {
  await requireAdmin();
  return runDiagnostics(slug, base);
}

/**
 * Diagnóstico › «Probar pixel ahora»: manda UN evento de prueba (PageView con
 * test_event_code) por la API de Conversiones con el token de ese pixel y
 * devuelve lo que contesta Meta. Prueba que token y pixel están conectados.
 * Los eventos de prueba no cuentan para los anuncios: solo se ven en
 * «Probar eventos» del Administrador de eventos.
 */
export async function testPixelAction(pixelId: string, url: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!/^\d{8,20}$/.test(pixelId) || !/^https:\/\/\S+$/.test(url)) return { error: "Pixel o dirección inválidos." };
    const { data: rows } = await db.from("pixels").select("pixel_id,capi_token_enc,test_event_code").eq("pixel_id", pixelId);
    const row = (rows ?? []).find((r) => r.capi_token_enc) ?? rows?.[0];
    if (!row) return { error: `El pixel ${pixelId} no está cargado en ninguna tienda.` };
    const token = row.capi_token_enc ? decrypt(row.capi_token_enc) : process.env.META_CAPI_TOKEN;
    if (!token) return { error: "Ese pixel no tiene token de la API de Conversiones." };
    const code = row.test_event_code || `TEST${Math.floor(10000 + Math.random() * 90000)}`;
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "127.0.0.1";
    const body = {
      data: [{
        event_name: "PageView", event_time: Math.floor(Date.now() / 1000), event_id: `diag-${Date.now().toString(36)}`,
        action_source: "website", event_source_url: url,
        user_data: { client_ip_address: ip, client_user_agent: h.get("user-agent") ?? "checkout-panel", external_id: [createHash("sha256").update("checkout-diagnostico").digest("hex")] },
      }],
      test_event_code: code,
    };
    const r = await fetch(`https://graph.facebook.com/v23.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json()) as { events_received?: number; fbtrace_id?: string; messages?: string[]; error?: { message: string; error_user_msg?: string; fbtrace_id?: string } };
    if (j.error) return { error: `Meta rechazó el evento: ${j.error.error_user_msg || j.error.message}`, details: j.error.fbtrace_id ? [`fbtrace ${j.error.fbtrace_id}`] : [] };
    return {
      ok: `Meta recibió ${j.events_received ?? 0} evento${j.events_received === 1 ? "" : "s"} ✓`,
      details: [`Código de prueba ${code} (Administrador de eventos › Probar eventos)`, ...(j.fbtrace_id ? [`fbtrace ${j.fbtrace_id}`] : []), ...(j.messages ?? [])],
    };
  } catch (e) {
    return { error: (e as Error).name === "TimeoutError" ? "Meta no contestó en 15 s." : (e as Error).message };
  }
}

// ------------------------------------------------- Conexión con Meta (global)

/** Configuración › Conexión con Meta: guarda un token nuevo (probado contra las cuentas de las tiendas). */
export async function saveMetaTokenAction(fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const token = String(fd.get("token") ?? "").trim();
    const label = String(fd.get("label") ?? "").slice(0, 80);
    const accounts = (await adAccounts()).map((a) => a.id);
    const r = await saveToken(token, label, accounts);
    revalidatePath("/admin", "layout");
    return "ok" in r ? { ok: r.ok } : { error: r.error };
  } catch (e) {
    return { error: (e as Error).message || "No se pudo guardar el token" };
  }
}

/** Vuelve al token de entorno (META_ADS_TOKEN). */
export async function clearMetaTokenAction(): Promise<ActionResult> {
  try {
    await requireAdmin();
    await clearToken();
    revalidatePath("/admin", "layout");
    return { ok: "Listo: se usa el token de entorno (META_ADS_TOKEN)." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** «Probar conexión»: quién es el token y si ve cada cuenta publicitaria de las tiendas (3 consultas livianas). */
export async function testMetaConnectionAction(): Promise<ActionResult> {
  try {
    await requireAdmin();
    const me = await metaGet<{ id: string; name: string }>("me", { fields: "id,name" });
    const details: string[] = [];
    let bad = 0;
    for (const a of await adAccounts()) {
      try {
        const acc = await metaGet<{ name: string; account_status: number }>(a.id, { fields: "name,account_status" });
        details.push(`${acc.name} (${a.id}): ${acc.account_status === 1 ? "activa ✓" : `estado ${acc.account_status}`}`);
      } catch (e) {
        bad++;
        details.push(`${a.id}: ${metaError(e)}`);
      }
    }
    revalidatePath("/admin", "layout");
    return bad ? { error: `Conecta como ${me.name}, pero ${bad === 1 ? "una cuenta no responde" : `${bad} cuentas no responden`}.`, details }
      : { ok: `Conectado como ${me.name} ✓`, details };
  } catch (e) {
    return { error: metaError(e) };
  }
}

/** Configuración › Conexión con Meta › Sincronizar ahora: lo mismo que el cron de cada 15 min, sin esperar el turno. */
export async function syncMetaNowAction(): Promise<ActionResult> {
  try {
    await requireAdmin();
    const res = await syncMeta({ force: true, budgetMs: 50_000 });
    revalidateTag(ADS_TAG);
    revalidatePath("/admin", "layout");
    const bad = res.filter((r) => !r.ok);
    const details = res.map((r) => `${r.account}: ${r.ok ? (r.skipped ?? `${r.rows ?? 0} filas guardadas${r.backfilledFrom ? ` · hay datos desde el ${r.backfilledFrom}` : ""}`) : (r.error ?? r.skipped ?? "falló")}`);
    return bad.length ? { error: bad[0].error ?? bad[0].skipped ?? "Meta no contestó", details } : { ok: "Meta sincronizado ✓", details };
  } catch (e) {
    return { error: metaError(e) };
  }
}

/** Pedidos › Reenviar mail de entrega: el mismo mail que salió al pagar, con lo que tiene el pedido hoy. */
export async function resendDeliveryAction(slug: string, orderId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: st } = await db.from("stores").select(STORE_COLS).eq("slug", slug).single();
    const store = st as unknown as Store | null;
    if (!store) return { error: "No existe esa tienda." };
    const { data: order } = await db.from("orders")
      .select("id,number,email,name,locale,currency,amount_total,status")
      .eq("id", orderId).eq("store_id", store.id).maybeSingle();
    if (!order) return { error: "No encontré el pedido." };
    if (order.status !== "paid") return { error: "Solo se reenvía la entrega de un pedido pagado." };
    if (!order.email) return { error: "El pedido no tiene email." };

    const { data: items } = await db.from("order_items").select("kind,amount,product_id").eq("order_id", orderId);
    const main = (items ?? []).find((i) => i.kind === "main");
    const [mainP, ...extras] = await Promise.all([
      main?.product_id ? getProductById(main.product_id) : Promise.resolve(null),
      ...(items ?? []).filter((i) => i.kind !== "main" && i.product_id).map((i) => getProductById(i.product_id!)),
    ]);
    if (!mainP) return { error: "El pedido no tiene producto principal." };
    const total = (items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(order.amount_total ?? 0);

    const r = await sendDelivery({
      to: order.email, name: order.name, store, locale: (order.locale as Locale) ?? DEFAULT_LOCALE,
      main: mainP, extras: extras.filter((p): p is Product => !!p), currency: order.currency ?? "USD",
      orderRef: orderRef(order), total, orderId,
    });
    if ("skipped" in r) return { error: "No hay proveedor de mail configurado (POSTMARK_TOKEN o BREVO_API_KEY)." };
    await db.from("orders").update({ delivered_at: new Date().toISOString(), delivery_error: null }).eq("id", orderId);
    revalidatePath("/admin", "layout");
    return { ok: `Mail de entrega reenviado a ${order.email}` };
  } catch (e) {
    return { error: (e as Error).message || "No se pudo reenviar" };
  }
}

// ------------------------------------------------- productos: edición rápida

/** «19,90», «19.90», «1.299,50» o «$ 27» → número; vacío → null. */
const priceText = z.string().max(30).transform((s, ctx) => {
  let t = s.replace(/[^\d.,]/g, "");
  if (!t) return null;
  // Con coma, la coma es el decimal y los puntos son de miles (como se escribe en Argentina).
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    ctx.addIssue({ code: "custom", message: "Precio inválido" });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

const productEdit = z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), value: z.string().trim().min(1, "El título no puede quedar vacío").max(200, "Máximo 200 caracteres") }),
  z.object({ field: z.literal("short_name"), value: z.string().trim().min(1, "El nombre corto no puede quedar vacío").max(80, "Máximo 80 caracteres") }),
  z.object({ field: z.literal("description"), value: z.string().trim().max(600, "Máximo 600 caracteres") }),
  z.object({
    field: z.literal("delivery_url"),
    value: z.string().trim().max(2000).refine((v) => !v || /^https?:\/\/\S+$/.test(v), "Tiene que ser un link que empiece con https://"),
  }),
  z.object({ field: z.enum(["amount", "compare_at"]), currency: z.string().regex(/^[A-Z]{3}$/), value: priceText }),
]);

async function productOfStore(slug: string, productId: string) {
  if (!z.uuid().safeParse(productId).success) return null;
  const { data } = await db.from("products").select("id,kind,stores!inner(slug)").eq("id", productId).eq("stores.slug", slug).maybeSingle();
  return data;
}

/**
 * Productos › edición rápida de una celda: título, nombre corto, descripción,
 * link de entrega o un precio en una moneda. Lo ve el comprador al momento
 * (checkout, mails), por eso después se invalida todo.
 */
export async function updateProductField(slug: string, productId: string, input: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = productEdit.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dato inválido" };
    const e = parsed.data;
    const p = await productOfStore(slug, productId);
    if (!p) return { error: "No encontré ese producto en esta tienda." };
    const now = new Date().toISOString();
    const details: string[] = [];

    if (e.field === "amount" || e.field === "compare_at") {
      if (e.field === "amount" && e.value == null && e.currency === "USD") {
        return { error: "El precio en USD no puede quedar vacío: las monedas sin precio fijo se calculan desde él." };
      }
      const { data: cur } = await db.from("product_prices").select("amount,compare_at").eq("product_id", productId).eq("currency", e.currency).maybeSingle();
      // Una fila de moneda sin precio deja al producto sin precio en esa moneda
      // (priceFor usa la fila tal cual): vaciar el precio borra la fila y vuelve
      // a calcularse desde USD; el tachado solo va sobre un precio fijo.
      if (e.field === "amount" && e.value == null) {
        const { error } = await db.from("product_prices").delete().eq("product_id", productId).eq("currency", e.currency);
        if (error) return { error: error.message };
        await db.from("products").update({ updated_by_admin_at: now }).eq("id", productId);
        await invalidateEverything();
        revalidatePath("/admin", "layout");
        return { ok: "Guardado ✓", details: [`${e.currency} vuelve a calcularse desde el precio en USD.`], data: { value: null, removed: true } };
      }
      if (e.field === "compare_at" && (cur?.amount == null)) {
        return { error: e.currency === "USD" ? "Primero poné el precio con descuento."
          : `Primero poné el precio con descuento en ${e.currency}: sin precio fijo, ${e.currency} se calcula desde USD.` };
      }
      const { error } = await db.from("product_prices")
        .upsert({ product_id: productId, currency: e.currency, [e.field]: e.value }, { onConflict: "product_id,currency" });
      if (error) return { error: error.message };
      await db.from("products").update({ updated_by_admin_at: now }).eq("id", productId);
      const amount = e.field === "amount" ? e.value : cur?.amount == null ? null : Number(cur.amount);
      const compare = e.field === "compare_at" ? e.value : cur?.compare_at == null ? null : Number(cur.compare_at);
      if (amount != null && compare != null && compare <= amount) details.push("El precio sin descuento no es mayor que el precio: no se va a ver tachado.");
    } else {
      const value = e.field === "delivery_url" ? e.value || null : e.value;
      const { error } = await db.from("products").update({ [e.field]: value, updated_by_admin_at: now }).eq("id", productId);
      if (error) return { error: error.message };
    }
    await invalidateEverything();
    revalidatePath("/admin", "layout");
    return { ok: "Guardado ✓", details, data: { value: e.value } };
  } catch (err) {
    return { error: (err as Error).message || "No se pudo guardar" };
  }
}

/** Productos › tapa nueva: la misma subida que usa el MCP (WebP para la web + JPG para el mail). */
export async function uploadProductCover(slug: string, productId: string, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Elegí una imagen." };
    const p = await productOfStore(slug, productId);
    if (!p) return { error: "No encontré ese producto en esta tienda." };
    const { web, email } = await uploadImage(file, `${slug}/products/${productId}`);
    const { error } = await db.from("products")
      .update({ image_url: web, email_image_url: email, updated_by_admin_at: new Date().toISOString() }).eq("id", productId);
    if (error) return { error: error.message };
    await invalidateEverything();
    revalidatePath("/admin", "layout");
    return { ok: "Tapa actualizada ✓", data: { image: web } };
  } catch (err) {
    return { error: (err as Error).message || "No se pudo subir la imagen" };
  }
}

/**
 * Productos › «Crear link»: un checkout para comprar ese producto solo (para
 * venderlo por separado). Copia el aspecto, los pixels, el mercado y el host
 * del checkout de la oferta, sin bumps, sin post compra y sin oferta de
 * salida. Si ya hay uno así, devuelve ese.
 */
export async function createSoloLink(slug: string, offerKey: string, productId: string, marketSlug?: string | null, currency?: string | null): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!z.uuid().safeParse(productId).success) return { error: "Producto inválido." };
    const { data: p } = await db.from("products").select("id,slug,short_name,store_id,product_prices(currency,amount),stores!inner(slug,domain)")
      .eq("id", productId).eq("stores.slug", slug).maybeSingle();
    if (!p) return { error: "No encontré ese producto en esta tienda." };
    const offer = (await offerList()).find((o) => o.key === offerKey && o.store.slug === slug);
    if (!offer) return { error: "No encontré la oferta." };

    // ¿Ya existe un checkout de este producto solo (sin bumps ni post compra)?
    const { data: same } = await db.from("funnels").select("id,slug,checkout_host,checkout_path").eq("store_id", p.store_id).eq("main_product_id", productId).eq("active", true);
    const sids = (same ?? []).map((f) => f.id);
    if (sids.length) {
      const [{ data: its }, { data: pps }] = await Promise.all([
        db.from("funnel_items").select("funnel_id").in("funnel_id", sids).in("role", ["bump", "upsell"]),
        db.from("pp_funnels").select("checkout_funnel_id").in("checkout_funnel_id", sids),
      ]);
      const busy = new Set([...(its ?? []).map((x) => x.funnel_id), ...(pps ?? []).map((x) => x.checkout_funnel_id)]);
      const clean = (same ?? []).find((f) => !busy.has(f.id));
      if (clean) return { ok: "Ya tenía su link ✓", data: { url: checkoutUrl(clean, slug), funnelId: clean.id } };
    }

    const src = offer.markets.find((f) => f.slug === marketSlug) ?? offer.markets.find((f) => f.active) ?? offer.markets[0];
    if (!src) return { error: "La oferta no tiene un checkout del que copiar el aspecto." };
    const { data: sf } = await db.from("funnels").select("settings,pixel_ids,market_label,checkout_host").eq("id", src.id).single();
    const settings = mergeSettings(sf?.settings, { exitOffer: { show: false } });
    // Tiene que tener precio en la moneda en que cobra el checkout (la fija, como EUR en la oferta alemana) o en USD (el resto se convierte).
    const cur = settings.currency || (currency ?? "").toUpperCase() || "USD";
    const priced = (p.product_prices ?? []).some((x) => (x.currency === cur || x.currency === "USD") && Number(x.amount) > 0);
    if (!priced) return { error: `Ponele un precio en ${cur} antes de crear su link.` };

    // El slug termina en -solo: así el panel sabe que no es un mercado de la oferta.
    const { data: taken } = await db.from("funnels").select("slug").eq("store_id", p.store_id).like("slug", `${p.slug}%`);
    const used = new Set((taken ?? []).map((f) => f.slug));
    let fslug = `${p.slug}${SOLO_SUFFIX}`;
    for (let i = 2; used.has(fslug); i++) fslug = `${p.slug}-${i}${SOLO_SUFFIX}`;

    const { data: nf, error } = await db.from("funnels").insert({
      store_id: p.store_id, offer_id: offer.id, slug: fslug, name: p.short_name, main_product_id: productId, active: true, sort_order: 900,
      // En el dominio de pago de la tienda: el host de la oferta (www…) sin su ruta da un link que no abre.
      settings, pixel_ids: sf?.pixel_ids ?? [], market_label: sf?.market_label ?? "",
      checkout_host: (p.stores as unknown as { domain: string | null }).domain ?? sf?.checkout_host ?? null, checkout_path: null,
    }).select("id,slug,checkout_host,checkout_path").single();
    if (error || !nf) return { error: error?.message ?? "No se pudo crear el link" };
    await invalidateEverything();
    revalidatePath("/admin", "layout");
    return { ok: "Link creado ✓", data: { url: checkoutUrl(nf, slug), funnelId: nf.id } };
  } catch (e) {
    return { error: (e as Error).message || "No se pudo crear el link" };
  }
}

/**
 * La única edición desde el panel: el aspecto de un checkout.
 * Se mezcla con lo guardado y se valida con el mismo esquema que usa la
 * página de pago y el MCP: lo que no tiene el tipo correcto se descarta.
 */
export async function saveCheckoutSettings(slug: string, funnelId: string, draft: unknown): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: f } = await db.from("funnels").select("id,settings,stores!inner(slug)").eq("id", funnelId).eq("stores.slug", slug).maybeSingle();
    if (!f) return { error: "No encontré ese checkout en esta tienda." };
    const settings = mergeSettings(f.settings, draft);
    const { error } = await db.from("funnels").update({ settings }).eq("id", funnelId);
    if (error) return { error: error.message };
    await invalidateEverything();
    revalidatePath("/admin", "layout");
    return { ok: "Guardado. Los compradores ya lo ven así.", data: { settings } };
  } catch (e) {
    return { error: (e as Error).message || "No se pudo guardar" };
  }
}
