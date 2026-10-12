import { db } from "./db";
import { queuePush, type PushKind } from "./push";
import { isTestStore } from "./test-store";
import { revalidateTag } from "next/cache";
import { bookDoneAlertOn, dueText, presaleBoard, scanPresaleFolders, PRESALE_TAG } from "./admin/presale";

/**
 * Avisos del panel (campanita y /admin/avisos): lo que pasó con los mails, el
 * buzón y Stripe que merece mirarse. Uno por (kind, ref): el mismo problema no
 * se duplica; con `reopen` vuelve arriba aunque se haya resuelto.
 */

export type AlertKind =
  | "email_failed" | "email_bounced" | "not_opened_24h" | "new_inbox_message"
  | "stripe_dispute" | "webhook_error" | "delivery_error" | "broken_link" | "ai_autoreply"
  | "missing_link" | "order_unpaid" | "refund_decision" | "oto_errors" | "checkout_down" | "reconciled"
  | "offer_no_postpurchase" | "bid_pilot_error" | "mkt_error" | "meta_auto" | "presale_due" | "catalog_stripe" | "partner_change";
export type Severity = "info" | "warn" | "error";

export const ALERT_LABEL: Record<AlertKind, string> = {
  email_failed: "Mail que no salió",
  email_bounced: "Mail rebotado",
  not_opened_24h: "No abrió la entrega",
  new_inbox_message: "Mail nuevo",
  stripe_dispute: "Contracargo",
  webhook_error: "Error de webhook",
  delivery_error: "Entrega con error",
  broken_link: "Link de entrega roto",
  ai_autoreply: "Respondió la IA",
  missing_link: "Falta el link de entrega",
  order_unpaid: "Pedido sin pago en Stripe",
  refund_decision: "Decidí: reembolso",
  oto_errors: "Fallan los cobros de upsells",
  checkout_down: "Checkout o post-pago caído",
  reconciled: "Venta cobrada que no se había registrado",
  offer_no_postpurchase: "Oferta sin post-pago",
  bid_pilot_error: "Piloto de pujas",
  mkt_error: "Email marketing",
  meta_auto: "Piloto Meta Ads",
  presale_due: "Contenido pendiente",
  catalog_stripe: "Catálogo y Stripe",
  partner_change: "Cambio de un socio",
};

/**
 * Qué notificación dispara cada aviso (cada dispositivo elige cuáles recibe).
 * null = no avisa por acá: el mail nuevo, el pedido de reembolso y la
 * respuesta de la IA mandan su propio push, más claro, una vez por mail.
 * Los que no están: push «alert» solo si son errores.
 */
const PUSH_OF: Partial<Record<AlertKind, PushKind | null>> = {
  // meta_auto: solo los errores (los cambios mandan su propio push, más claro).
  bid_pilot_error: "bid", mkt_error: "alert", meta_auto: "meta_auto",
  stripe_dispute: "dispute", email_failed: "delivery", delivery_error: "delivery", email_bounced: "delivery",
  order_unpaid: "unpaid", oto_errors: "oto", checkout_down: "checkout_down", reconciled: "alert",
  new_inbox_message: null, refund_decision: null, ai_autoreply: null,
  presale_due: "alert", catalog_stripe: "alert",
};

/** Link a un pedido sin saber su oferta: la página resuelve a cuál pertenece. */
export const orderLink = (orderId: string) => `/admin/avisos/pedido/${orderId}`;

export async function raiseAlert(a: {
  kind: AlertKind; severity: Severity; title: string; body?: string | null; link?: string | null;
  ref?: string | null; storeId?: string | null; at?: string; reopen?: boolean;
}) {
  // Una tienda de prueba (llaves de test de Stripe) no genera avisos ni push.
  if (await isTestStore(a.storeId)) return;
  const row = {
    kind: a.kind, severity: a.severity, title: a.title.slice(0, 200), body: a.body?.slice(0, 1000) ?? null,
    link: a.link ?? null, ref_id: a.ref ?? null, store_id: a.storeId ?? null,
    ...(a.reopen || !a.ref ? { created_at: a.at ?? new Date().toISOString(), resolved_at: null } : a.at ? { created_at: a.at } : {}),
  };
  // Push solo de los avisos nuevos o que vuelven después de resueltos: el
  // repaso cada 5 min y los reintentos repiten el mismo aviso sin sumar nada.
  const pushKind = a.kind in PUSH_OF ? PUSH_OF[a.kind] ?? null : a.severity === "error" ? "alert" : null;
  const pushable = !!pushKind && (a.severity === "error" || a.kind === "order_unpaid" || a.kind === "presale_due");
  let fresh = pushable && !a.ref;
  if (pushable && a.ref && a.reopen) {
    const { data: prev } = await db.from("alerts").select("resolved_at").eq("kind", a.kind).eq("ref_id", a.ref).maybeSingle();
    fresh = !prev || !!prev.resolved_at;
  }
  const { data, error } = a.ref
    ? await db.from("alerts").upsert(row, { onConflict: "kind,ref_id", ignoreDuplicates: !a.reopen }).select("id")
    : await db.from("alerts").insert(row).select("id");
  if (error) console.error("[alerts]", error.message);
  // Sin reopen, el upsert ignora los repetidos: si devolvió la fila, es nueva.
  if (pushable && a.ref && !a.reopen) fresh = !!data?.length;
  if (!error && fresh && pushKind) {
    queuePush(pushKind, {
      title: `⚠️ ${ALERT_LABEL[a.kind] ?? "Aviso"}`,
      body: a.title.slice(0, 180),
      url: a.link ?? "/admin/avisos",
      tag: `alert:${a.kind}:${a.ref ?? Date.now()}`,
    });
  }
}

export async function resolveAlerts(kind: AlertKind, refs: string[]) {
  if (!refs.length) return;
  await db.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("kind", kind).in("ref_id", refs).is("resolved_at", null);
}

/**
 * Los avisos que piden contestar un mail («Mail nuevo» y «Decidí: reembolso»): se cierran
 * solos apenas el mail está respondido, desde donde sea (panel, celular, la IA o el webmail).
 * «Respondió la IA» no: avisa de una respuesta que ya salió.
 */
export const MAIL_ALERT_KINDS: AlertKind[] = ["new_inbox_message", "refund_decision"];

export async function resolveMailAlerts(messageIds: string[]) {
  if (!messageIds.length) return;
  await db.from("alerts").update({ resolved_at: new Date().toISOString() })
    .in("kind", MAIL_ALERT_KINDS).in("ref_id", messageIds).is("resolved_at", null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cierra los avisos de mails ya respondidos: el mail tiene replied_at (marcado al responder
 * o por la marca \Answered del webmail), o salió una respuesta nuestra a esa persona después
 * de ese mail. «Mail nuevo» también se cierra si ya se leyó. Corre al abrir Avisos y en el
 * repaso de cada 5 min, así un aviso respondido nunca queda colgado.
 */
export async function closeAnsweredMailAlerts() {
  const { data: open } = await db.from("alerts").select("id,kind,ref_id").is("resolved_at", null)
    .in("kind", MAIL_ALERT_KINDS).not("ref_id", "is", null).limit(500);
  const ids = [...new Set((open ?? []).map((a) => a.ref_id as string).filter((r) => UUID.test(r)))];
  if (!ids.length) return 0;
  const { data: msgs } = await db.from("inbox_messages").select("id,store_id,date,from_email,reply_to,read_at,replied_at").in("id", ids);
  const byId = new Map((msgs ?? []).map((m) => [m.id as string, m]));
  const addr = (m: { reply_to: string | null; from_email: string | null }) => (m.reply_to || m.from_email || "").toLowerCase();
  const waiting = (msgs ?? []).filter((m) => !m.replied_at && addr(m));
  const oldest = waiting.reduce((a, m) => (m.date && (!a || m.date < a) ? m.date : a), "" as string);
  const { data: outs } = waiting.length
    ? await db.from("inbox_messages").select("store_id,to_email,date").eq("direction", "out")
      .in("to_email", [...new Set(waiting.map(addr))]).gte("date", oldest || new Date(0).toISOString())
    : { data: [] as { store_id: string; to_email: string | null; date: string | null }[] };
  const answered = (m: NonNullable<ReturnType<typeof byId.get>>) => !!m.replied_at
    || (outs ?? []).some((o) => o.store_id === m.store_id && (o.to_email ?? "").toLowerCase() === addr(m) && !!o.date && !!m.date && o.date > m.date);
  const close = (open ?? []).filter((a) => {
    const m = byId.get(a.ref_id as string);
    return !!m && (answered(m) || (a.kind === "new_inbox_message" && !!m.read_at));
  }).map((a) => a.id);
  if (close.length) await db.from("alerts").update({ resolved_at: new Date().toISOString() }).in("id", close).is("resolved_at", null);
  return close.length;
}

/**
 * Repaso periódico (cron del buzón, cada 5 min): entregas con error, webhooks
 * trabados y entregas que nadie abrió en 24 h. También cierra solos los
 * avisos cuyo problema ya se arregló.
 */
export async function scanAlerts() {
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const H = 3600_000;
  let raised = 0;

  // Pedidos pagados sin entregar con error (lo que no es del mail: sin producto, sin email…).
  const { data: bad } = await db.from("orders")
    .select("id,store_id,email,delivery_error,created_at")
    .eq("status", "paid").eq("is_test", false).is("delivered_at", null).not("delivery_error", "is", null)
    .gte("created_at", iso(7 * 24 * H)).limit(100);
  if (bad?.length) {
    const { data: mailAl } = await db.from("alerts").select("ref_id").eq("kind", "email_failed").in("ref_id", bad.map((o) => `delivery:${o.id}`));
    const covered = new Set((mailAl ?? []).map((a) => a.ref_id));
    for (const o of bad) {
      if (covered.has(`delivery:${o.id}`)) continue;
      await raiseAlert({
        kind: "delivery_error", severity: "error", storeId: o.store_id, ref: o.id, link: orderLink(o.id), at: o.created_at,
        title: `Pedido pagado sin entregar${o.email ? ` · ${o.email}` : ""}`, body: o.delivery_error,
      });
      raised++;
    }
  }

  // Webhooks de Stripe que fallaron y siguen sin procesarse después de 15 min (los de carrera se arreglan solos).
  const { data: hooks } = await db.from("stripe_events")
    .select("id,store_id,type,error,received_at")
    .is("processed_at", null).not("error", "is", null)
    .gte("received_at", iso(3 * 24 * H)).lte("received_at", iso(15 * 60_000)).limit(50);
  for (const e of hooks ?? []) {
    // «Entrega en curso en otro intento»: la página de gracias y el webhook llegaron
    // juntos; Stripe reintenta solo y se resuelve. Solo es un problema si sigue así a las 2 h.
    if (/entrega en curso/.test(String(e.error)) && Date.now() - +new Date(e.received_at) < 2 * H) continue;
    await raiseAlert({
      kind: "webhook_error", severity: "error", storeId: e.store_id, ref: e.id, at: e.received_at, link: "/admin/avisos?kind=webhook_error",
      title: `Webhook de Stripe con error · ${e.type}`, body: `${e.id}: ${e.error}`,
    });
    raised++;
  }

  // Preventas que vencen en 24 h o ya vencieron: un aviso por libro y estado, con push.
  // Antes, mirar las carpetas: lo que ya tiene el PDF pasa solo a «listo».
  // Catálogos y Stripe (lo que revisa Stripe y lo que hay que cambiar a mano en su panel): una vez por hora.
  try {
    const cs = await import("./admin/catalog-status");
    const last = await cs.readCatalogStatus();
    if (!last || Date.now() - last.at > 60 * 60_000) await cs.runCatalogStatus();
  } catch (e) { console.error("[catálogos]", (e as Error).message); }
  const scan = await scanPresaleFolders().catch((e) => { console.error("[preventa] carpetas:", (e as Error).message); return null; });
  // Libro terminado:
  // un aviso por libro con su PDF verificado (nombre y peso) y el link para abrirlo.
  if (scan?.ready.length) { try { revalidateTag(PRESALE_TAG); } catch { /* fuera de una petición */ } }
  const doneOn = scan?.ready.length ? await bookDoneAlertOn() : false;
  for (const b of doneOn ? scan?.ready ?? [] : []) {
    const { data: p } = await db.from("products").select("ready_files").eq("id", b.id).maybeSingle();
    const files = ((p?.ready_files ?? []) as { id: string; title: string; bytes: number | null }[]);
    await raiseAlert({
      kind: "presale_due", severity: "info", storeId: b.storeId, ref: `${b.id}:terminado`, link: "/admin/preventas",
      title: `📗 Libro terminado · ${b.name}`,
      body: files.length
        ? `${files.map((f) => `${f.title}${f.bytes ? ` (${Math.round(f.bytes / 1e5) / 10} MB)` : ""}: https://drive.google.com/file/d/${f.id}/view`).join(" · ")}. Abrilo para ver cómo quedó; si alguien lo esperaba, en «Contenido pendiente» tocá «Avisar».`
        : "El PDF ya está en su carpeta. Abrilo desde «Contenido pendiente» para ver cómo quedó.",
    }).catch(() => {});
  }
  // Libro terminado con el aviso de preventa todavía en la carpeta.
  for (const l of scan?.leftovers ?? []) {
    await raiseAlert({
      kind: "presale_due", severity: "warn", storeId: l.storeId, ref: `${l.id}:aviso`, link: "/admin/preventas",
      title: `🧹 Borrar el aviso de preventa · ${l.name}`,
      body: `El libro ya está en la carpeta, pero sigue el documento que dice que todavía no llegó: ${l.files.map((f) => `«${f.title}» https://drive.google.com/file/d/${f.id}/view`).join(" · ")}. Borralo; hasta entonces no se avisa a los compradores.`,
    }).catch(() => {});
  }
  if (scan?.cleared.length) await resolveAlerts("presale_due", scan.cleared.map((c) => `${c}:aviso`)).catch(() => {});
  const pre = await presaleBoard().catch(() => [] as Awaited<ReturnType<typeof presaleBoard>>);
  const preRefs: string[] = [];
  for (const r of pre.filter((x) => x.state === "listo_sin_avisar")) {
    const ref = `${r.id}:listo`;
    preRefs.push(ref);
    await raiseAlert({
      kind: "presale_due", severity: "info", storeId: r.storeId, ref, link: "/admin/preventas",
      title: `✅ Ya está el contenido · ${r.name}: listo para avisar a ${r.pendingNotice} ${r.pendingNotice === 1 ? "comprador" : "compradores"}`,
      body: "El PDF ya está en su carpeta. En «Contenido pendiente» tocá «Avisar» y les llega de nuevo el mail de entrega.",
    });
  }
  for (const r of pre) {
    if (r.state !== "vence_pronto" && r.state !== "atrasado") continue;
    const ref = `${r.id}:${r.state}`;
    preRefs.push(ref);
    await raiseAlert({
      kind: "presale_due", severity: r.state === "atrasado" ? "error" : "warn", storeId: r.storeId, ref, link: "/admin/preventas",
      title: `📦 ${r.state === "atrasado" ? "Contenido atrasado" : "Contenido pendiente vence en menos de 24 h"} · ${r.name} · ${r.orders.length} ${r.orders.length === 1 ? "comprador" : "compradores"}`,
      body: `Prometido en ${r.days} días desde la primera compra: ${dueText(r)}. Cuando el contenido esté en su carpeta, marcalo listo en «Contenido pendiente» y avisá a los compradores.`,
    });
    raised++;
  }
  {
    const { data: open } = await db.from("alerts").select("ref_id").eq("kind", "presale_due").is("resolved_at", null);
    await resolveAlerts("presale_due", (open ?? []).map((a) => a.ref_id as string).filter((r) => r && !preRefs.includes(r)));
  }

  // «No abrió la entrega en 24 h» ya no se avisa. Los rebotes y
  // las entregas que fallan siguen avisando.

  // Cobros de upsell (OTO) que fallan: 3 o más en la última hora es un problema (Stripe, tarjeta, 3DS), no mala suerte.
  const { data: fails } = await db.from("upsell_events").select("store_id,created_at").eq("event", "fail").gte("created_at", iso(H)).limit(200);
  if ((fails?.length ?? 0) >= 3) {
    const hour = new Date(now).toISOString().slice(0, 13);
    await raiseAlert({
      kind: "oto_errors", severity: "error", storeId: fails![0].store_id, ref: `oto:${hour}`, link: "/admin/avisos?kind=oto_errors",
      title: `${fails!.length} cobros de upsell fallaron en la última hora`,
      body: "Revisá Stripe (pagos fallidos / 3DS) y la página de post-pago: si sigue, los compradores no pueden sumar el upsell.",
    });
    raised++;
  }

  // Cierre automático de lo que ya se arregló.
  const { data: open } = await db.from("alerts").select("id,kind,ref_id")
    .is("resolved_at", null).in("kind", ["delivery_error", "webhook_error", "email_failed"]).not("ref_id", "is", null).limit(300);
  const orderRefs = (open ?? []).filter((a) => a.kind === "delivery_error" || a.ref_id!.startsWith("delivery:"))
    .map((a) => a.ref_id!.replace(/^delivery:/, ""));
  const fixed: string[] = [];
  if (orderRefs.length) {
    const { data: delivered } = await db.from("orders").select("id").in("id", orderRefs).not("delivered_at", "is", null);
    const d = new Set((delivered ?? []).map((o) => o.id));
    for (const a of open ?? []) {
      const oid = a.ref_id!.replace(/^delivery:/, "");
      if ((a.kind === "delivery_error" || a.ref_id!.startsWith("delivery:")) && d.has(oid)) fixed.push(a.id);
    }
  }
  const hookRefs = (open ?? []).filter((a) => a.kind === "webhook_error").map((a) => a.ref_id!);
  if (hookRefs.length) {
    const { data: done } = await db.from("stripe_events").select("id").in("id", hookRefs).not("processed_at", "is", null);
    const d = new Set((done ?? []).map((e) => e.id));
    for (const a of open ?? []) if (a.kind === "webhook_error" && d.has(a.ref_id!)) fixed.push(a.id);
  }
  if (fixed.length) await db.from("alerts").update({ resolved_at: new Date().toISOString() }).in("id", fixed);
  // Y los de mails que ya se respondieron.
  const answered = await closeAnsweredMailAlerts().catch(() => 0);

  return { raised, resolved: fixed.length + answered };
}
