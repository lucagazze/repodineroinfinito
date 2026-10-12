import { db } from "@/lib/db";
import { offerList } from "@/lib/admin/offers";
import { campaignsOf } from "@/lib/admin/meta-links";
import { todayIn } from "@/lib/admin/range";
import { addDays } from "@/lib/admin/tz";
import { getRates } from "@/lib/fx";
import OffersBoardClient, { type BoardCampaign, type BoardRow, type Hint, type Task } from "./OffersBoardClient";

/**
 * Ofertas en Meta + anotador. Una fila por oferta con
 * campañas vinculadas (o con tareas): campañas activas, gasto de hoy y de 7 días, compras, ROAS y
 * beneficio de 7 días según Meta. Al abrirla: sus campañas y sugerencias sacadas de los números
 * (pierde plata, viene cayendo, creativos cansados, escalar…), que se pueden anotar como tarea.
 */
type N = { s: number; b: number; v: number; imp: number; clk: number };
const z = (): N => ({ s: 0, b: 0, v: 0, imp: 0, clk: 0 });
const money = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const pct = (n: number) => `${(n * 100).toFixed(2)} %`;

function hintsFor(c: BoardCampaign & { d1: N; d3: N; d7: N; prev: N }): Hint[] {
  const out: Hint[] = [];
  const r7 = c.d7.s ? c.d7.v / c.d7.s : null, r3 = c.d3.s ? c.d3.v / c.d3.s : null;
  const on = c.status === "ACTIVE";
  if (on && c.d7.s >= 40 && r7 != null && r7 < 1) {
    out.push({ tone: "bad", text: `${c.name}: pierde plata (ROAS 7 d ${r7.toFixed(2)} con ${money(c.d7.s)} gastados). Bajá el presupuesto o apagala.` });
  } else if (on && c.d3.s >= 20 && r3 != null && r3 < 1 && (r7 ?? 0) >= 1) {
    out.push({ tone: "warn", text: `${c.name}: viene cayendo (ROAS 3 d ${r3.toFixed(2)} contra ${r7!.toFixed(2)} en 7 d). Mirá qué anuncio se cayó; si sigue así, bajá el presupuesto.` });
  }
  const ctr3 = c.d3.imp ? c.d3.clk / c.d3.imp : null, ctrP = c.prev.imp ? c.prev.clk / c.prev.imp : null;
  if (on && ctr3 != null && ctrP != null && c.d3.imp >= 3000 && c.prev.imp >= 3000 && ctr3 < ctrP * 0.75) {
    out.push({ tone: "warn", text: `${c.name}: el CTR bajó de ${pct(ctrP)} a ${pct(ctr3)} en los últimos 3 días. Los creativos se están cansando: renovalos (ganchos nuevos u otro formato).` });
  }
  if (on && r7 != null && r7 >= 2.5 && c.d7.b >= 10) {
    out.push({ tone: "good", text: `${c.name}: ROAS 7 d ${r7.toFixed(2)} con ${Math.round(c.d7.b)} compras. Para escalar: subí el presupuesto 20 % o pasá el mejor anuncio a BID CAP.` });
  }
  if (on && c.d1.s === 0 && c.d7.s > 0) {
    out.push({ tone: "warn", text: `${c.name}: hoy todavía no gastó nada. Revisá la entrega (puja, presupuesto o anuncios rechazados).` });
  }
  return out;
}

export default async function MetaOffersBoard() {
  const today = todayIn();
  const [offers, { data: tasks }, rates] = await Promise.all([
    offerList(),
    db.from("offer_tasks").select("id,offer_id,text,done,created_at").order("created_at"),
    getRates(),
  ]);
  const camps = new Map<string, string[]>();
  for (const o of offers) camps.set(o.id, [...new Set(o.funnels.flatMap((f) => campaignsOf(f, {})))]);
  const allIds = [...new Set([...camps.values()].flat())];
  const [{ data: objs }, { data: ins }, { data: sync }] = await Promise.all([
    allIds.length ? db.from("meta_objects").select("id,name,effective_status,daily_budget,account_id").eq("level", "campaign").in("id", allIds) : Promise.resolve({ data: [] as { id: string; name: string; effective_status: string | null; daily_budget: number | null; account_id: string }[] }),
    allIds.length ? db.from("meta_insights_daily").select("account_id,campaign_id,date,spend,purchases,purchase_value,impressions,inline_link_clicks").eq("level", "campaign").in("campaign_id", allIds).gte("date", addDays(today, -6)) : Promise.resolve({ data: [] as { account_id: string; campaign_id: string; date: string; spend: number; purchases: number; purchase_value: number; impressions: number; inline_link_clicks: number }[] }),
    db.from("meta_sync").select("account_id,currency"),
  ]);
  const obj = new Map((objs ?? []).map((o) => [o.id, o]));
  const curOf = new Map((sync ?? []).map((s) => [s.account_id as string, String(s.currency ?? "USD").toUpperCase()]));
  const usd = (n: unknown, acct: string) => (Number(n) || 0) / (rates[curOf.get(acct) ?? "USD"] ?? 1);
  const per = new Map<string, { d1: N; d3: N; d7: N; prev: N }>();
  for (const r of ins ?? []) {
    const p = per.get(r.campaign_id) ?? { d1: z(), d3: z(), d7: z(), prev: z() };
    const add = (n: N) => { n.s += usd(r.spend, r.account_id); n.b += Number(r.purchases ?? 0); n.v += usd(r.purchase_value, r.account_id); n.imp += Number(r.impressions ?? 0); n.clk += Number(r.inline_link_clicks ?? 0); };
    add(p.d7);
    if (r.date >= addDays(today, -2)) add(p.d3); else add(p.prev);
    if (r.date === today) add(p.d1);
    per.set(r.campaign_id, p);
  }
  const allTasks = (tasks ?? []) as Task[];
  const rows: BoardRow[] = offers.map((o) => {
    const ids = camps.get(o.id) ?? [];
    const cs = ids.map((id) => {
      const m = obj.get(id), p = per.get(id) ?? { d1: z(), d3: z(), d7: z(), prev: z() };
      const c = { id, name: m?.name ?? id, status: m?.effective_status ?? "—", budget: m?.daily_budget == null ? null : usd(Number(m.daily_budget), m.account_id), // meta_objects ya lo guarda en unidades mayores
        s1: p.d1.s, s7: p.d7.s, b7: p.d7.b, v7: p.d7.v, ...p };
      return { ...c, hints: hintsFor(c) };
    }).filter((c) => c.status === "ACTIVE" || c.s7 > 0)
      .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || b.s7 - a.s7);
    const sum = cs.reduce((a, c) => ({ s1: a.s1 + c.s1, s7: a.s7 + c.s7, b7: a.b7 + c.b7, v7: a.v7 + c.v7 }), { s1: 0, s7: 0, b7: 0, v7: 0 });
    const hints = cs.flatMap((c) => c.hints);
    const active = cs.filter((c) => c.status === "ACTIVE").length;
    if (!active && sum.s7 >= 30 && sum.v7 / sum.s7 >= 2) hints.push({ tone: "good", text: `ROAS ${(sum.v7 / sum.s7).toFixed(2)} en 7 días y ninguna campaña activa: ¿la volvés a prender?` });
    return {
      id: o.id, key: o.key, name: o.name, alias: o.alias, store: o.store.display_name || o.store.name, category: o.category,
      active, campaigns: ids.length, ...sum,
      list: cs.map(({ id, name, status, budget, s1, s7, b7, v7 }) => ({ id, name, status, budget, s1, s7, b7, v7 })), hints,
      tasks: allTasks.filter((t) => t.offer_id === o.id),
    };
  }).filter((r) => r.active > 0 || r.s7 > 0 || r.tasks.length > 0);
  return <OffersBoardClient rows={rows} general={allTasks.filter((t) => !t.offer_id)} />;
}
