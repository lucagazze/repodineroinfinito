import "server-only";
import type Stripe from "stripe";
import { db, legalOf, type Store } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";
import { orderRef } from "@/lib/order-ref";

/**
 * Informe de actividad de un pedido: la evidencia para contestar una disputa, como el
 * «Order activity report» de la plataforma anterior. Todo sale de los registros automáticos de la app (IP y
 * dispositivo con que pagó, mails enviados/abiertos/clicados con IP, descargas, visitas antes de
 * comprar, ofertas post-pago mostradas/aceptadas/rechazadas) y del cobro en Stripe (tarjeta,
 * chequeos CVC/dirección, 3D Secure, riesgo). Más las otras compras de la misma persona (mismo
 * mail, misma IP o mismo dispositivo): que vuelva a comprar después es lo que más pesa.
 * Solo lectura. Nada se inventa: lo que no hay registrado se dice que no está.
 */

export type ReportEvent = { at: string; kind: string; ip?: string | null; place?: string | null; client?: string | null; detail?: string | null };
export type OtherOrder = { ref: string; at: string; status: string; total: string; products: string; disputed: boolean | null; match: string[] };
export type PaymentInfo = {
  pi: string; charge: string | null; amount: string; at: string; status: string; method: string;
  card: string | null; cardCountry: string | null; wallet: string | null;
  cvc: string | null; address: string | null; postal: string | null; threeDS: string | null;
  risk: string | null; network: string | null; billingName: string | null; billingEmail: string | null; billingCountry: string | null;
  disputed: boolean; refunded: boolean; descriptor: string | null; product: string;
};
export type ActivityReport = {
  ref: string; generatedAt: string; tz: string;
  seller: { store: string; website: string | null; legalName: string; address: string; supportEmail: string; descriptor: string };
  buyer: { email: string | null; name: string | null; phone: string | null; location: string | null };
  order: { at: string; status: string; currency: string; total: string; funnel: string | null };
  items: { name: string; type: string; amount: string; at: string }[];
  payments: PaymentInfo[];
  technical: { ip: string | null; location: string | null; device: string | null; ua: string | null; page: string | null; metaCookies: boolean };
  path: { checkoutUrl: string | null; publicCheckout: string | null; landing: string | null; referrer: string | null; campaign: string | null; ad: string | null; source: string | null; utm: Record<string, string>; openedAt: string | null };
  mails: { kind: string; to: string; subject: string | null; sentAt: string; status: string; events: ReportEvent[] }[];
  downloads: ReportEvent[];
  browsing: ReportEvent[];
  offers: ReportEvent[];
  others: OtherOrder[];
  checks: string[];
  facts: string[];
};

const KIND_EN: Record<string, string> = { main: "Main product", bump: "Order bump", upsell: "Post-purchase offer", bonus: "Free bonus", included: "Included" };
const PAGE_EN: Record<string, string> = { landing: "Landing page", checkout: "Checkout", oferta: "Post-purchase offer page", gracias: "Thank-you page" };

const fmtMoney = (n: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "USD").toUpperCase() }).format(n);
/** «Oct 7, 2026, 10:57 PM UTC»: así se leen las fechas en el informe. */
const W = (iso?: string | null) => (iso ? `${new Date(iso).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC` : "—");
const isProxy = (ua?: string | null) => !!ua && /GoogleImageProxy|ggpht|YahooMailProxy|Outlook-Proxy/i.test(ua);

/** «Chrome · Android 16 · SM-G990U» a partir del user-agent (lo justo para leerlo). */
export function deviceOf(ua?: string | null): string | null {
  if (!ua) return null;
  if (/GoogleImageProxy|ggpht/i.test(ua)) return "Gmail image proxy";
  if (/YahooMailProxy/i.test(ua)) return "Yahoo Mail proxy";
  const app = /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook in-app browser" : /Instagram/.test(ua) ? "Instagram in-app browser"
    : /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = ua.match(/Android [\d.]+/)?.[0] ?? (ua.match(/iPhone OS ([\d_]+)/) ? `iOS ${ua.match(/iPhone OS ([\d_]+)/)![1].replace(/_/g, ".")}` : null)
    ?? (/Windows NT/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : null);
  const model = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim() ?? (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : null);
  return [app, os, model && model !== "K" ? model : null].filter(Boolean).join(" · ") || null;
}

export async function activityReport(orderId: string): Promise<ActivityReport | null> {
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return null;
  const { data: store } = await db.from("stores").select("*").eq("id", order.store_id).single();
  const st = store as Store;
  const tz = "UTC";

  const [{ data: items }, { data: ups }, { data: logs }, { data: dls }, { data: site }, { data: checkout }, { data: funnel }] = await Promise.all([
    db.from("order_items").select("kind,amount,currency,product_id,stripe_payment_intent,created_at").eq("order_id", orderId).order("created_at"),
    db.from("upsell_events").select("event,product_id,created_at").eq("order_id", orderId).order("created_at"),
    db.from("email_log").select("id,kind,to_email,subject,status,created_at").eq("order_id", orderId).order("created_at"),
    db.from("downloads").select("product_id,ip,at").eq("order_id", orderId).order("at"),
    db.from("site_events").select("at,event,page,visitor_id,city,region,country,browser,os,device_model,ip_masked,referrer,path,host").eq("order_id", orderId).neq("event", "heartbeat").order("at"),
    db.from("checkouts").select("created_at,tracking,utm").eq("order_id", orderId).maybeSingle(),
    order.funnel_id ? db.from("funnels").select("name,market_label,checkout_host,checkout_path,slug").eq("id", order.funnel_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const logIds = (logs ?? []).map((l) => l.id as string);
  const { data: mailEv } = logIds.length
    ? await db.from("email_events").select("email_log_id,kind,url,ip,ua,at").in("email_log_id", logIds).order("at")
    : { data: [] as { email_log_id: string; kind: string; url: string | null; ip: string | null; ua: string | null; at: string }[] };

  const pids = [...new Set([...(items ?? []).map((i) => i.product_id), ...(ups ?? []).map((u) => u.product_id), ...(dls ?? []).map((d) => d.product_id)].filter(Boolean) as string[])];
  const { data: prods } = pids.length ? await db.from("products").select("id,name,short_name").in("id", pids) : { data: [] as { id: string; name: string; short_name: string | null }[] };
  const pname = new Map((prods ?? []).map((p) => [p.id as string, (p.name as string) || (p.short_name as string)]));

  const tr = { ...((checkout?.tracking ?? {}) as Record<string, string>), ...((order.tracking ?? {}) as Record<string, string>) };
  const ip = tr.ip || null, ua = tr.ua || null;
  const siteRows = (site ?? []) as { at: string; event: string; page: string; visitor_id: string | null; city: string | null; region: string | null; country: string | null; browser: string | null; os: string | null; device_model: string | null; ip_masked: string | null; referrer: string | null; path: string | null; host: string | null }[];
  const placeOf = (r: { city: string | null; region: string | null; country: string | null }) => [r.city, r.region, r.country].filter(Boolean).join(", ") || null;
  const payRow = siteRows.find((r) => r.page === "checkout") ?? siteRows[0];
  const location = payRow ? placeOf(payRow) : order.country || null;

  // ---- Stripe: cada cobro (el del checkout y cada OTO), con su tarjeta y sus chequeos.
  const pis = [...new Set([order.stripe_payment_intent, ...(items ?? []).map((i) => i.stripe_payment_intent)].filter(Boolean) as string[])];
  const payments: PaymentInfo[] = [];
  const conn = await stripeForStore(st.id).catch(() => null);
  if (conn?.connected) {
    for (const pi of pis) {
      try {
        const p = await conn.stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] });
        const ch = (typeof p.latest_charge === "object" ? p.latest_charge : null) as Stripe.Charge | null;
        const pm = ch?.payment_method_details;
        const card = pm?.card;
        const prod = (items ?? []).filter((i) => i.stripe_payment_intent === pi).map((i) => pname.get(i.product_id ?? "") ?? "—").join(" + ") || (pi === order.stripe_payment_intent ? "Checkout" : "—");
        payments.push({
          pi, charge: ch?.id ?? null, amount: fmtMoney(p.amount / 100, p.currency), at: new Date((ch?.created ?? p.created) * 1000).toISOString(),
          status: p.status, method: pm?.type ?? "—",
          card: card ? `${card.brand?.toUpperCase()} •••• ${card.last4} (${card.funding})` : null, cardCountry: card?.country ?? null, wallet: card?.wallet?.type ?? null,
          cvc: card?.checks?.cvc_check ?? null, address: card?.checks?.address_line1_check ?? null, postal: card?.checks?.address_postal_code_check ?? null,
          threeDS: card?.three_d_secure ? `${card.three_d_secure.result ?? "attempted"}${card.three_d_secure.version ? ` (v${card.three_d_secure.version})` : ""}` : null,
          risk: ch?.outcome ? `${ch.outcome.risk_level ?? "—"}${ch.outcome.risk_score != null ? ` (score ${ch.outcome.risk_score})` : ""}` : null,
          network: ch?.outcome?.seller_message ?? ch?.outcome?.network_status ?? null,
          billingName: ch?.billing_details?.name ?? null, billingEmail: ch?.billing_details?.email ?? ch?.receipt_email ?? null, billingCountry: ch?.billing_details?.address?.country ?? null,
          disputed: !!ch?.disputed, refunded: !!ch?.refunded, descriptor: ch?.calculated_statement_descriptor ?? null, product: prod,
        });
      } catch { /* un cobro que Stripe no devuelve: queda afuera, el resto sigue */ }
    }
  }

  // ---- Mails, con cada apertura y clic.
  const mails = (logs ?? []).map((l) => ({
    kind: l.kind === "delivery" ? "Delivery email (access to the content)" : l.kind === "upsell" ? "Post-purchase delivery email" : l.kind === "recovery" ? "Cart recovery email" : String(l.kind),
    to: l.to_email as string, subject: (l.subject as string | null) ?? null, sentAt: l.created_at as string, status: l.status === "sent" ? "Sent" : "Failed",
    events: (mailEv ?? []).filter((e) => e.email_log_id === l.id).map((e) => ({
      at: e.at, kind: e.kind === "open" ? "Opened" : e.kind === "click" ? (/drive\.google|\/d\//.test(e.url ?? "") ? "Clicked the download link" : "Clicked a link") : e.kind === "bounce" ? "Bounced" : e.kind,
      ip: e.ip, client: deviceOf(e.ua), detail: e.kind === "click" ? e.url : isProxy(e.ua) ? "Image loaded through the mail provider's proxy" : null,
    })),
  }));
  const downloads: ReportEvent[] = (dls ?? []).map((d) => ({ at: d.at, kind: "Download", ip: d.ip, detail: pname.get(d.product_id ?? "") ?? null }));

  // ---- Lo que hizo antes de pagar: la misma visita (visitor_id) en las 72 h previas.
  const visitor = siteRows.find((r) => r.visitor_id)?.visitor_id ?? null;
  let prior: typeof siteRows = [];
  if (visitor) {
    const from = new Date(new Date(order.created_at).getTime() - 72 * 3600_000).toISOString();
    const { data } = await db.from("site_events").select("at,event,page,visitor_id,city,region,country,browser,os,device_model,ip_masked,referrer,path,host")
      .eq("visitor_id", visitor).gte("at", from).lte("at", order.created_at).in("event", ["view", "lead", "pay_attempt", "cta_click"]).order("at").limit(60);
    prior = (data ?? []) as typeof siteRows;
  }
  const browsing: ReportEvent[] = prior.map((r) => ({
    at: r.at, kind: `${PAGE_EN[r.page] ?? r.page}${r.event === "view" ? "" : ` · ${r.event.replace("_", " ")}`}`, ip: r.ip_masked, place: placeOf(r),
    client: [r.browser, r.os, r.device_model].filter(Boolean).join(" · ") || null, detail: r.host ? `${r.host}${r.path ?? ""}` : r.referrer,
  }));

  const offers: ReportEvent[] = (ups ?? []).map((u) => ({
    at: u.created_at, kind: { view: "Offer shown", accept: "Offer ACCEPTED (separate one-click payment)", decline: "Offer declined", fail: "Offer payment failed" }[u.event as "view"] ?? u.event,
    detail: pname.get(u.product_id ?? "") ?? null,
  }));

  // ---- Otras compras de la misma persona: mismo mail, misma IP o mismo dispositivo.
  const email = (order.email as string | null)?.toLowerCase() ?? null;
  const [byMail, byIp, byUa] = await Promise.all([
    email ? db.from("orders").select("id,number,status,created_at,email,amount_total,currency,tracking,stripe_payment_intent").ilike("email", email).neq("id", orderId).limit(30) : Promise.resolve({ data: [] }),
    ip ? db.from("orders").select("id,number,status,created_at,email,amount_total,currency,tracking,stripe_payment_intent").eq("tracking->>ip", ip).neq("id", orderId).limit(30) : Promise.resolve({ data: [] }),
    ua ? db.from("orders").select("id,number,status,created_at,email,amount_total,currency,tracking,stripe_payment_intent").eq("tracking->>ua", ua).neq("id", orderId).limit(30) : Promise.resolve({ data: [] }),
  ]);
  type O = { id: string; number: number | null; status: string; created_at: string; email: string | null; amount_total: number | null; currency: string; tracking: Record<string, string> | null; stripe_payment_intent: string | null };
  const all = new Map<string, { o: O; match: Set<string> }>();
  const add = (rows: unknown, why: string) => { for (const o of (rows ?? []) as O[]) { const e = all.get(o.id) ?? { o, match: new Set<string>() }; e.match.add(why); all.set(o.id, e); } };
  add(byMail.data, "same email"); add(byIp.data, "same IP address");
  // El mismo user-agent SOLO no prueba nada (todos los iPhone con Safari al día dicen exactamente lo mismo):
  // se anota como dato extra cuando ya coincide el mail o la IP, nunca trae una compra por sí solo.
  const uaIds = new Set(((byUa.data ?? []) as { id: string }[]).map((o) => o.id));
  for (const [id, e] of all) if (uaIds.has(id)) e.match.add("same browser and device");
  const otherIds = [...all.keys()];
  const { data: otherItems } = otherIds.length ? await db.from("order_items").select("order_id,product_id,amount").in("order_id", otherIds) : { data: [] as { order_id: string; product_id: string | null; amount: number }[] };
  const otherPids = [...new Set((otherItems ?? []).map((i) => i.product_id).filter((x): x is string => !!x && !pname.has(x)))];
  if (otherPids.length) for (const p of (await db.from("products").select("id,name,short_name").in("id", otherPids)).data ?? []) pname.set(p.id as string, (p.name as string) || (p.short_name as string));
  const others: OtherOrder[] = [];
  for (const { o, match } of [...all.values()].sort((a, b) => a.o.created_at.localeCompare(b.o.created_at))) {
    let disputed: boolean | null = null;
    if (conn?.connected && o.stripe_payment_intent) {
      try { const p = await conn.stripe.paymentIntents.retrieve(o.stripe_payment_intent, { expand: ["latest_charge"] }); disputed = typeof p.latest_charge === "object" && p.latest_charge ? !!p.latest_charge.disputed : null; } catch { /* sin dato */ }
    }
    const its = (otherItems ?? []).filter((i) => i.order_id === o.id);
    const tot = its.reduce((a, i) => a + Number(i.amount), 0) || Number(o.amount_total ?? 0);
    others.push({
      ref: orderRef(o as never), at: o.created_at, status: o.status === "paid" ? "Paid" : o.status === "refunded" ? "Refunded" : o.status,
      total: fmtMoney(tot, o.currency), products: its.map((i) => pname.get(i.product_id ?? "") ?? "—").join(" + ") || "—", disputed, match: [...match],
    });
  }

  // ---- Coincidencias (solo las que se cumplen de verdad).
  const checks: string[] = [];
  const clicks = mails.flatMap((m) => m.events).filter((e) => e.kind.startsWith("Clicked"));
  if (ip && clicks.some((c) => c.ip === ip)) checks.push(`The delivery email link was clicked from ${ip}, the same IP address used to pay.`);
  if (ip && downloads.some((d) => d.ip === ip)) checks.push(`The content was downloaded from ${ip}, the same IP address used to pay.`);
  const card = payments.find((p) => p.cardCountry);
  if (card && location && payRow?.country && card.cardCountry === payRow.country) checks.push(`The card was issued in ${card.cardCountry}, the same country the purchase was made from.`);
  if (payments.filter((p) => p.pi !== order.stripe_payment_intent && p.status === "succeeded").length) checks.push("After the first payment the buyer made at least one additional, separate payment by accepting a post-purchase offer with a deliberate click.");
  const later = others.filter((o) => o.at > order.created_at && o.status === "Paid");
  if (later.length) checks.push(`The same person (same email or IP address) bought again later (${later.length} more order${later.length > 1 ? "s" : ""}: ${later.map((o) => `${o.ref} ${o.total} on ${W(o.at)}`).join(", ")}), which a victim of card theft does not do.`);
  if (payments.some((p) => p.cvc === "pass")) checks.push("The card security code (CVC) was verified by the issuer.");
  if (payments.some((p) => p.threeDS && /authenticated|succeeded/.test(p.threeDS))) checks.push("The payment was authenticated with 3D Secure.");

  // ---- Conclusión: hechos numerados.
  const first = (arr: ReportEvent[]) => arr[0]?.at;
  const facts: string[] = [];
  const total = (items ?? []).reduce((a, i) => a + Number(i.amount), 0) || Number(order.amount_total ?? 0);
  if (browsing.length) facts.push(`In the 72 hours before the purchase the same browser visited the store ${browsing.length} time${browsing.length > 1 ? "s" : ""} (${[...new Set(browsing.map((b) => b.kind))].join(", ")}).`);
  facts.push(`The purchase was completed on ${W(order.created_at)}${ip ? ` from IP address ${ip}` : ""}${location ? ` (${location})` : ""}${ua ? ` using ${deviceOf(ua)}` : ""}.`);
  const del = mails.find((m) => m.kind.startsWith("Delivery") && m.status === "Sent");
  if (del) facts.push(`The email with access to the content was sent to ${del.to} on ${W(del.sentAt)}.`);
  const opened = mails.flatMap((m) => m.events).filter((e) => e.kind === "Opened");
  if (opened.length) facts.push(`The email was opened ${opened.length} time${opened.length > 1 ? "s" : ""} (first on ${W(first(opened))}).`);
  if (clicks.length) facts.push(`The access link in the email was clicked ${clicks.length} time${clicks.length > 1 ? "s" : ""} (first on ${W(clicks[0].at)}${clicks[0].ip ? ` from ${clicks[0].ip}` : ""}).`);
  if (downloads.length) facts.push(`The content was downloaded ${downloads.length} time${downloads.length > 1 ? "s" : ""}.`);
  const acc = offers.filter((o) => o.kind.startsWith("Offer ACCEPTED")), dec = offers.filter((o) => o.kind === "Offer declined");
  if (acc.length || dec.length) facts.push(`After paying, the buyer was shown post-purchase offers and made ${acc.length + dec.length} separate decision${acc.length + dec.length > 1 ? "s" : ""}: accepted ${acc.length}, declined ${dec.length}.`);
  if (later.length) facts.push(`The same person placed ${later.length} further order${later.length > 1 ? "s" : ""} after this one.`);
  if (st.guarantee_days) facts.push(`A ${st.guarantee_days}-day money-back guarantee is published on the checkout page, giving the buyer a direct way to get a refund from the store.`);

  // ---- Cómo llegó: landing, de dónde venía, campaña y anuncio (UTM de Meta), y el checkout exacto.
  const utm = { ...((checkout?.utm ?? {}) as Record<string, string>), ...((order.utm ?? {}) as Record<string, string>) };
  const firstLanding = [...prior, ...siteRows].find((r) => r.page === "landing");
  const firstAny = prior[0] ?? siteRows[0];
  const path = {
    checkoutUrl: tr.url || null,
    publicCheckout: funnel?.checkout_host ? `https://${funnel.checkout_host}${funnel.checkout_path ?? ""}` : null,
    landing: firstLanding?.host ? `https://${firstLanding.host}${firstLanding.path ?? ""}` : (order.landing_url as string | null) ?? null,
    referrer: firstAny?.referrer || null,
    campaign: utm.utm_campaign || null, ad: utm.utm_content || null, source: [utm.utm_source, utm.utm_medium].filter(Boolean).join(" / ") || null,
    utm, openedAt: (checkout?.created_at as string | null) ?? null,
  };
  if (path.checkoutUrl) facts.splice(browsing.length ? 1 : 0, 0, `The buyer paid on the store's own checkout page ${path.checkoutUrl}${path.landing ? `, reached from the product page ${path.landing}` : ""}${path.campaign || path.source ? ` (${[path.source && `source «${path.source}»`, path.campaign && `campaign «${path.campaign}»`].filter(Boolean).join(", ")})` : ""}.`);

  const site0 = funnel?.checkout_host ? `https://${funnel.checkout_host}${funnel.checkout_path ?? ""}` : st.domain ? `https://${st.domain}` : null;
  const legal = legalOf(st);
  return {
    ref: orderRef(order), generatedAt: new Date().toISOString(), tz,
    seller: { store: st.display_name || st.name, website: st.domain ? `https://${st.domain}` : site0, legalName: legal.name, address: legal.address, supportEmail: st.support_email, descriptor: payments.find((p) => p.descriptor)?.descriptor ?? legal.statement },
    buyer: { email: order.email, name: order.name, phone: order.phone ?? null, location },
    order: { at: order.created_at, status: order.status === "paid" ? "Paid (payment settled)" : order.status, currency: order.currency, total: fmtMoney(total, order.currency), funnel: funnel ? (funnel.market_label || funnel.name) : null },
    items: (items ?? []).map((i) => ({ name: pname.get(i.product_id ?? "") ?? "—", type: KIND_EN[i.kind] ?? i.kind, amount: fmtMoney(Number(i.amount), i.currency || order.currency), at: i.created_at })),
    payments,
    technical: { ip, location, device: deviceOf(ua), ua, page: tr.url || site0, metaCookies: !!(tr.fbp || tr.fbc) },
    path,
    mails, downloads, browsing, offers, others, checks, facts,
  };
}
