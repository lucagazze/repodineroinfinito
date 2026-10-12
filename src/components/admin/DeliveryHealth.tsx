import Link from "next/link";
import { db } from "@/lib/db";
import { deliveryData, deliveryFact } from "@/lib/admin/order-facts";
import { orderRef } from "@/lib/order-ref";
import { fmtDate } from "@/lib/admin-data";
import ResendButton from "./ResendButton";
import { Pv } from "./Priv";
import { EMAIL } from "@/lib/admin/privacy";

/**
 * ¿Le llegó el contenido a TODOS? Los pedidos pagados de los últimos 7 días: cuántos tienen el mail de
 * entrega enviado, cuántos lo abrieron o bajaron el contenido, y la lista de los que tienen un problema
 * (no salió, rebotó, error) con «Reenviar» al lado. Reenviar manda el mail real: solo con un toque del dueño.
 */
export default async function DeliveryHealth() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await db.from("orders")
    .select("id,number,status,is_test,email,name,currency,amount_total,amount_refunded,created_at,delivered_at,fulfill_claimed_at,delivery_error,store_id,stores(slug)")
    .eq("status", "paid").eq("is_test", false).gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
  const orders = (data ?? []) as unknown as ({ id: string; number: number | null; status: string; email: string | null; name: string | null; currency: string; amount_total: number; created_at: string; delivered_at: string | null; delivery_error: string | null; stores: { slug: string } | null })[];
  if (!orders.length) return null;
  const facts = await deliveryData(orders.map((o) => o.id));
  let sent = 0, opened = 0, got = 0;
  const bad: { o: (typeof orders)[number]; why: string }[] = [];
  for (const o of orders) {
    const logs = facts.logs.get(o.id) ?? [], dls = facts.downloads.get(o.id) ?? [];
    const f = deliveryFact(o, logs, dls);
    if (logs.some((l) => l.status === "sent") || o.delivered_at) sent++;
    if (logs.some((l) => l.opened_at)) opened++;
    if (dls.length || logs.some((l) => l.clicked_at || l.downloaded_at)) got++;
    // Recién pagado (menos de 10 min): todavía se está mandando, no es un problema.
    if (f.problem && Date.now() - +new Date(o.created_at) > 10 * 60_000) bad.push({ o, why: f.title || f.label });
  }
  const pct = (n: number) => `${Math.round((n / orders.length) * 100)} %`;
  return (
    <section className={`mb-4 rounded-2xl border p-4 sm:p-5 ${bad.length ? "border-red-300/60 bg-red-50/50 dark:border-red-500/25 dark:bg-red-500/[0.05]" : "border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/[0.04]"}`}>
      <h3 className="text-[14px] font-bold text-zinc-900 dark:text-white">
        {bad.length ? `⚠️ ${bad.length} ${bad.length === 1 ? "pedido sin entrega confirmada" : "pedidos sin entrega confirmada"}` : "✅ El contenido le llegó a todos"} <span className="font-semibold text-zinc-500">· últimos 7 días</span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-zinc-600 dark:text-zinc-400">
        <span><b className="text-zinc-900 dark:text-white">{orders.length}</b> pedidos pagados</span>
        <span><b className="text-zinc-900 dark:text-white">{sent}</b> con el mail de entrega enviado ({pct(sent)})</span>
        <span><b className="text-zinc-900 dark:text-white">{opened}</b> lo abrieron ({pct(opened)})</span>
        <span><b className="text-zinc-900 dark:text-white">{got}</b> entraron al contenido ({pct(got)})</span>
      </div>
      {bad.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {bad.slice(0, 40).map(({ o, why }) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[12.5px] dark:bg-white/[0.04]">
              <Link href={`/admin/avisos/pedido/${o.id}`} className="font-mono font-bold text-violet-600 dark:text-violet-400">{orderRef(o)}</Link>
              <span className="text-zinc-500">{fmtDate(o.created_at)}</span>
              <Pv as={EMAIL}>{o.email ?? "sin email"}</Pv>
              <span className="min-w-0 flex-1 text-[11.5px] text-red-700 dark:text-red-300">{why}</span>
              {o.stores?.slug && <ResendButton store={o.stores.slug} orderId={o.id} />}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-zinc-500">«Abrieron» depende de que el programa de mail cargue las imágenes; «entraron al contenido» = tocaron el link o descargaron. Reenviar manda el mail de entrega real a ese comprador.</p>
    </section>
  );
}
