import Link from "next/link";
import { Suspense } from "react";
import { ShoppingCart } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, Kpi, PageHead } from "@/components/admin/ui";
import RangeBar from "@/components/admin/RangeBar";
import { SkCard } from "@/components/admin/Skeleton";
import { Pv } from "@/components/admin/Priv";
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";
import { usdFmt } from "@/lib/metrics";
import { offerList } from "@/lib/admin/offers";
import { resolveRange, RANGE_TZ, type Range } from "@/lib/admin/range";
import { addDays, startOfDay } from "@/lib/admin/tz";

export const dynamic = "force-dynamic";

type Cart = {
  id: string; store_id: string; funnel_id: string | null; email: string | null; created_at: string; status: string;
  amount: number | null; currency: string | null; recovery_sent_at: string | null; recovery_email_log_id: string | null;
  recovery_skip: string | null; recovered_order_id: string | null;
};
type Row = {
  key: string; name: string; alias: string; store: string; carts: number; withEmail: number; sent: number; opened: number; clicked: number;
  recovered: number; recoveredValue: number; boughtAfter: number; afterValue: number; skipped: number;
};

/**
 * Recuperación de carritos de TODAS las tiendas: por oferta, cuántos carritos quedaron,
 * cuántos dejaron el email, a cuántos les salió el mail, cuántos lo abrieron o tocaron, cuántos
 * pagaron con el link del mail (recuperados) y cuántos compraron igual después del mail.
 */
export default async function CarritosTodas({ searchParams }: { searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const R = resolveRange(await searchParams);
  return (
    <Shell>
      <PageHead
        title="Recuperación de carritos"
        icon={<ShoppingCart className="h-[18px] w-[18px]" />} color="#f97316"
        sub="Todas las tiendas: cuántos carritos quedaron sin pagar, a cuántos les salió el mail con el 20 % y cuántos volvieron a comprar."
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <Suspense key={`${R.since}-${R.until}`} fallback={<div data-skeleton className="grid gap-4"><div className="ad-grid g-kpi">{[0, 1, 2, 3].map((i) => <SkCard key={i} rows={1} title={false} />)}</div><SkCard rows={8} h={360} /></div>}>
        <Body R={R} />
      </Suspense>
    </Shell>
  );
}

async function Body({ R }: { R: Range }) {
  const since = startOfDay(R.since, RANGE_TZ).toISOString();
  const end = startOfDay(addDays(R.until, 1), RANGE_TZ).getTime();
  // Un carrito recién abierto todavía no es abandonado: 30 minutos de margen.
  const cutoff = new Date(Math.min(end, Date.now() - 30 * 60_000)).toISOString();
  const [offers, rates] = await Promise.all([offerList(), getRates()]);
  const usd = (n: number, c: string | null) => n / (rates[(c ?? "USD").toUpperCase()] ?? 1);

  const carts: Cart[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from("checkouts")
      .select("id,store_id,funnel_id,email,created_at,status,amount,currency,recovery_sent_at,recovery_email_log_id,recovery_skip,recovered_order_id")
      .or("status.eq.open,recovered_order_id.not.is.null")
      .gte("created_at", since).lte("created_at", cutoff).order("created_at").range(i, i + 999);
    carts.push(...((data ?? []) as Cart[]));
    if (!data || data.length < 1000) break;
  }
  const sentCarts = carts.filter((c) => c.recovery_sent_at);
  const logIds = sentCarts.map((c) => c.recovery_email_log_id).filter(Boolean) as string[];
  const recIds = carts.map((c) => c.recovered_order_id).filter(Boolean) as string[];
  const emails = [...new Set(sentCarts.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean))];
  const [logs, recOrders, later] = await Promise.all([
    logIds.length ? db.from("email_log").select("id,opened_at,clicked_at").in("id", logIds).then((r) => r.data ?? []) : [],
    recIds.length ? db.from("orders").select("id,amount_total,currency,is_test").in("id", recIds).then((r) => r.data ?? []) : [],
    emails.length ? db.from("orders").select("email,store_id,created_at,amount_total,currency").eq("status", "paid").eq("is_test", false).in("email", emails).gte("created_at", since).then((r) => r.data ?? []) : [],
  ]);
  const logOf = new Map(logs.map((l) => [l.id as string, l]));
  const orderOf = new Map(recOrders.filter((o) => !o.is_test).map((o) => [o.id as string, o]));

  // Cada checkout → su oferta (y si no tiene, la tienda sola).
  const offerOfFunnel = new Map<string, { key: string; name: string; alias: string; store: string }>();
  for (const o of offers) for (const f of o.funnels) offerOfFunnel.set(f.id, { key: o.key, name: o.name, alias: o.alias, store: o.store.display_name || o.store.name });
  const rows = new Map<string, Row>();
  for (const c of carts) {
    const of = (c.funnel_id && offerOfFunnel.get(c.funnel_id)) || { key: "", name: "Sin oferta", alias: "Sin oferta", store: "" };
    const r = rows.get(of.key) ?? { key: of.key, name: of.name, alias: of.alias, store: of.store, carts: 0, withEmail: 0, sent: 0, opened: 0, clicked: 0, recovered: 0, recoveredValue: 0, boughtAfter: 0, afterValue: 0, skipped: 0 };
    r.carts++;
    if (c.email) r.withEmail++;
    if (c.recovery_skip && !c.recovery_sent_at) r.skipped++;
    if (c.recovery_sent_at) {
      r.sent++;
      const l = c.recovery_email_log_id ? logOf.get(c.recovery_email_log_id) : null;
      if (l?.opened_at) r.opened++;
      if (l?.clicked_at) r.clicked++;
      const o = c.recovered_order_id ? orderOf.get(c.recovered_order_id) : null;
      if (o) { r.recovered++; r.recoveredValue += usd(Number(o.amount_total ?? 0), o.currency as string | null); }
      else {
        // La primera compra de esa persona en esa tienda después del mail.
        const buy = later.filter((x) => (x.email as string).toLowerCase() === (c.email ?? "").toLowerCase() && x.store_id === c.store_id && (x.created_at as string) > c.recovery_sent_at!)
          .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
        if (buy) { r.boughtAfter++; r.afterValue += usd(Number(buy.amount_total ?? 0), buy.currency as string | null); }
      }
    }
    rows.set(of.key, r);
  }
  const list = [...rows.values()].sort((a, b) => b.sent - a.sent || b.carts - a.carts);
  const t = list.reduce((a, r) => ({ carts: a.carts + r.carts, withEmail: a.withEmail + r.withEmail, sent: a.sent + r.sent, opened: a.opened + r.opened, clicked: a.clicked + r.clicked, recovered: a.recovered + r.recovered, value: a.value + r.recoveredValue + r.afterValue, after: a.after + r.boughtAfter }),
    { carts: 0, withEmail: 0, sent: 0, opened: 0, clicked: 0, recovered: 0, value: 0, after: 0 });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

  return (
    <>
      <div className="ad-grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Carritos sin pagar" value={String(t.carts)} hint={`${t.withEmail} dejaron el email`} />
        <Kpi label="Mails de recuperación" value={String(t.sent)} hint={`${pct(t.opened, t.sent)} abiertos · ${pct(t.clicked, t.sent)} con clic`} />
        <Kpi label="Recuperados" value={String(t.recovered + t.after)} hint={`${t.recovered} con el link del mail · ${t.after} compraron después`} />
        <Kpi label="Recuperado" value={usdFmt(t.value)} hint="con el link del mail + los que compraron después" />
      </div>
      <Card title="Por oferta" sub="Sin email no se le puede mandar nada: la mayoría de los carritos sin pagar no llegaron a escribirlo." pad={false}>
        <div className="ad-scroll">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-zinc-500">
                {["Oferta", "Carritos", "Con email", "Mails", "Abiertos", "Clic", "Con el link", "Compraron después", "Recuperado"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key || "none"} className="border-t border-zinc-100 dark:border-white/[0.05]">
                  <td className="px-3 py-2">
                    {r.key ? <Link href={`/admin/o/${r.key}/carritos`} className="font-semibold text-zinc-900 hover:underline dark:text-white"><Pv as={r.alias}>{r.name}</Pv></Link> : <span className="text-zinc-500">{r.name}</span>}
                    {r.store && <span className="block text-[11px] text-zinc-500">{r.store}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.carts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.withEmail}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.sent}{r.skipped ? <span className="block text-[11px] font-normal text-zinc-500">{r.skipped} sin mandar</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.opened} <span className="text-zinc-500">{pct(r.opened, r.sent)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.clicked}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{r.recovered}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.boughtAfter}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usdFmt(r.recoveredValue + r.afterValue)}{r.afterValue > 0 && r.recoveredValue > 0 ? <span className="block text-[11px] text-zinc-500">{usdFmt(r.recoveredValue)} con el link</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
