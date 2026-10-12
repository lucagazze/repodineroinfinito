import { db } from "../db";
import { getRates } from "../fx";
import { sendPush } from "../push";

/**
 * Resultados de una campaña (mkt_campaign_stats en la base): enviados,
 * entregados, aperturas, clics, bajas, rebotes y la plata de las ventas
 * atribuidas (pedido del destinatario dentro de los 7 días, con el
 * utm_campaign de la campaña o después de hacer clic).
 */

export type CampaignStats = {
  recipients: number; queued: number; sent: number; failed: number; skipped: number; delivered: number;
  opened: number; clicked: number; unsubscribed: number; bounced: number; complained: number;
  orders: number; revenue: Record<string, number>;
  by_locale: Record<string, { sent: number; opened: number; clicked: number }>;
  order_ids: string[];
};

export async function campaignStats(id: string): Promise<CampaignStats> {
  const { data, error } = await db.rpc("mkt_campaign_stats", { p_campaign: id });
  if (error) throw new Error(error.message);
  return data as CampaignStats;
}

/** La plata en una sola cifra: la moneda si hay una, si no el total en USD. */
export async function revenueText(rev: Record<string, number>) {
  const e = Object.entries(rev).filter(([, n]) => n > 0);
  if (!e.length) return null;
  const fmt = (n: number, cur: string) => `${cur} ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  if (e.length === 1) return fmt(e[0][1], e[0][0]);
  const rates = await getRates();
  const usd = e.reduce((a, [cur, n]) => a + n / (cur === "USD" ? 1 : rates[cur] || 1), 0);
  return fmt(Math.round(usd * 100) / 100, "USD");
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Push al terminar de salir (una vez). */
export async function pushFinished(id: string) {
  const { data: won } = await db.from("mkt_campaigns").update({ finish_pushed_at: new Date().toISOString() })
    .eq("id", id).is("finish_pushed_at", null).select("name");
  if (!won?.length) return;
  const s = await campaignStats(id);
  const title = `📧 Campaña «${won[0].name}» enviada`;
  const body = `${s.sent.toLocaleString("es-AR")} enviados${s.failed ? ` · ${s.failed} fallaron` : ""} · los resultados llegan en 24 h`;
  // Sin nombres por defecto (como las ventas); con la opción «names», el de la campaña.
  await sendPush("sale", { title: "📧 Campaña enviada", body, named: { title, body }, url: `/admin/email/campanas/${id}`, tag: `mkt:${id}` });
}

/** 24 h después de terminar: «Campaña X: 1.240 enviados · 38 % abrió · 3 ventas · EUR 74». */
export async function pushResultsDue() {
  const { data } = await db.from("mkt_campaigns").select("id,name").eq("status", "sent").is("results_pushed_at", null)
    .lte("finished_at", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(5);
  for (const c of data ?? []) {
    const { data: won } = await db.from("mkt_campaigns").update({ results_pushed_at: new Date().toISOString() }).eq("id", c.id).is("results_pushed_at", null).select("id");
    if (!won?.length) continue;
    const s = await campaignStats(c.id);
    const money = await revenueText(s.revenue);
    const body = [
      `${s.sent.toLocaleString("es-AR")} enviados`, `${pct(s.opened, s.sent)} % abrió`,
      `${s.orders} ${s.orders === 1 ? "venta" : "ventas"}`, ...(money ? [money] : []),
    ].join(" · ");
    await sendPush("sale", { title: "📧 Resultados de la campaña", body, named: { title: `📧 Campaña «${c.name}»`, body }, url: `/admin/email/campanas/${c.id}`, tag: `mkt-r:${c.id}` });
  }
}
