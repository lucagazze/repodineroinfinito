import { db } from "@/lib/db";
import { fmtDate } from "@/lib/admin-data";

/**
 * Lo que el panel dice de cada pedido, en castellano: dos hechos, el PAGO y
 * la ENTREGA, con el motivo real cuando algo falló. Sirve a Pedidos, la ficha
 * del pedido y «Últimas compras».
 *
 * Solo cuentan las compras de verdad: pagadas o reembolsadas. Las de prueba
 * (status test) no aparecen nunca y los intentos sin pagar (pending) son
 * carritos, no pedidos.
 */

export const REAL_STATUSES = ["paid", "refunded"] as const;

export type Tone = "ok" | "warn" | "bad" | "off";
export type Fact = { label: string; tone: Tone; at: string | null; title: string; problem: boolean };

type OrderLike = {
  id: string; created_at: string; status: string; currency: string | null; amount_total: number | string | null;
  amount_refunded?: number | string | null; delivered_at?: string | null; fulfill_claimed_at?: string | null; delivery_error?: string | null;
};
export type MailLog = {
  order_id: string; status: string; error: string | null; created_at: string; to_email?: string | null;
  opened_at?: string | null; open_count?: number | null; clicked_at?: string | null; click_count?: number | null;
  downloaded_at?: string | null; bounced_at?: string | null; bounce_reason?: string | null;
};
export type Download = { order_id: string; at: string };

const money = (n: number, c: string | null) => {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: (c ?? "USD").toUpperCase() }).format(n); } catch { return `${n} ${c ?? ""}`; }
};

export function payFact(o: OrderLike): Fact {
  const total = Number(o.amount_total ?? 0);
  const back = Number(o.amount_refunded ?? 0);
  if (o.status === "refunded") return { label: "Reembolsado", tone: "bad", at: null, title: `Se devolvió el pago (${money(back || total, o.currency)}).`, problem: false };
  if (o.status === "paid" && back > 0) return { label: `Reembolso parcial (${money(back, o.currency)})`, tone: "warn", at: null, title: `Se devolvieron ${money(back, o.currency)} de ${money(total, o.currency)}.`, problem: false };
  if (o.status === "paid") return { label: "Pagado", tone: "ok", at: null, title: "Stripe confirmó el pago.", problem: false };
  if (o.status === "pending") return { label: "Sin pagar", tone: "off", at: null, title: "Intento de pago que no se completó.", problem: false };
  return { label: o.status, tone: "off", at: null, title: o.status, problem: false };
}

/**
 * La entrega: el último mail de entrega y lo que pasó después (aperturas,
 * clics, descargas, rebotes). «Enviando…» solo mientras de verdad se está
 * mandando (menos de 2 minutos desde el pago).
 */
export function deliveryFact(o: OrderLike, logs: MailLog[], downloads: Download[]): Fact & { events: string[] } {
  // [cuándo, qué]: se ordena por fecha real y se muestra con la hora del panel.
  const ev: [string, string][] = [];
  const t = (iso: string) => fmtDate(iso);
  const sorted = [...logs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const l of sorted) {
    ev.push([l.created_at, l.status === "failed" ? `no se pudo enviar${l.error ? `: ${l.error}` : ""}` : `enviado${l.to_email ? ` a ${l.to_email}` : ""}`]);
    if (l.opened_at) ev.push([l.opened_at, `abierto${l.open_count && l.open_count > 1 ? ` (${l.open_count} veces)` : ""}`]);
    if (l.clicked_at) ev.push([l.clicked_at, `clic en el mail${l.click_count && l.click_count > 1 ? ` (${l.click_count})` : ""}`]);
    if (l.downloaded_at) ev.push([l.downloaded_at, "descargó desde el mail"]);
    if (l.bounced_at) ev.push([l.bounced_at, `rebotó${l.bounce_reason ? `: ${l.bounce_reason}` : ""}`]);
  }
  const dls = [...downloads].sort((a, b) => a.at.localeCompare(b.at));
  for (const d of dls) ev.push([d.at, "descarga"]);
  const events = ev.sort((a, b) => a[0].localeCompare(b[0])).map(([at, what]) => `${t(at)} · ${what}`);

  if (o.status !== "paid") return { label: "—", tone: "off", at: null, title: "", problem: false, events };
  const last = sorted.at(-1);
  const sentOk = sorted.filter((l) => l.status !== "failed");
  const lastOk = sentOk.at(-1);
  const recent = Date.now() - new Date(o.fulfill_claimed_at ?? o.created_at).getTime() < 2 * 60_000;
  const tip = events.join("\n");

  if (!last) {
    if (o.delivered_at) return { label: "Enviado", tone: "ok", at: o.delivered_at, title: tip || "Entregado (sin registro del mail).", problem: false, events };
    if (recent) return { label: "Enviando…", tone: "off", at: null, title: "Se está mandando el mail de entrega.", problem: false, events };
    if (o.delivery_error) return { label: `No se pudo enviar: ${o.delivery_error}`, tone: "bad", at: null, title: o.delivery_error, problem: true, events };
    return { label: "Sin mail de entrega", tone: "bad", at: null, title: "No hay ningún mail de entrega registrado para este pedido.", problem: true, events };
  }
  const bounced = [...sorted].reverse().find((l) => l.bounced_at);
  if (bounced && (!lastOk || bounced === lastOk)) {
    return { label: `Rebotó${bounced.bounce_reason ? `: ${bounced.bounce_reason}` : ""}`, tone: "bad", at: bounced.bounced_at ?? null, title: tip, problem: true, events };
  }
  if (!lastOk) {
    const err = last.error ?? o.delivery_error ?? "error del proveedor";
    return { label: `No se pudo enviar: ${err}`, tone: "bad", at: last.created_at, title: tip, problem: true, events };
  }
  const dl = dls.at(-1)?.at ?? sentOk.map((l) => l.downloaded_at).filter(Boolean).sort().at(-1) ?? null;
  if (dl) return { label: "Descargó", tone: "ok", at: dl, title: tip, problem: false, events };
  const opens = sentOk.reduce((a, l) => a + (l.open_count ?? (l.opened_at ? 1 : 0)), 0);
  const openedAt = sentOk.map((l) => l.opened_at).filter(Boolean).sort().at(-1) ?? null;
  if (opens > 0 || openedAt) return { label: `Abierto${opens > 1 ? ` (${opens})` : ""}`, tone: "ok", at: openedAt, title: tip, problem: false, events };
  return { label: "Enviado", tone: "ok", at: lastOk.created_at, title: tip, problem: false, events };
}

/** Mails de entrega y descargas de varios pedidos, en dos consultas. Sin las columnas nuevas (migración 023), con lo que haya. */
export async function deliveryData(orderIds: string[]) {
  const logs = new Map<string, MailLog[]>();
  const downloads = new Map<string, Download[]>();
  if (!orderIds.length) return { logs, downloads };
  const [l, d] = await Promise.all([
    db.from("email_log").select("*").in("order_id", orderIds).eq("kind", "delivery"),
    db.from("downloads").select("order_id,at").in("order_id", orderIds),
  ]);
  for (const r of (l.data ?? []) as MailLog[]) logs.set(r.order_id, [...(logs.get(r.order_id) ?? []), r]);
  for (const r of (d.data ?? []) as Download[]) downloads.set(r.order_id, [...(downloads.get(r.order_id) ?? []), r]);
  return { logs, downloads };
}
