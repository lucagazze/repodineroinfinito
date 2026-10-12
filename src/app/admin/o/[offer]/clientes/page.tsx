import Link from "next/link";
import { scopeFor, idsOrNone } from "@/lib/admin/offers";
import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { HAS_STRIPE } from "@/lib/real-sale";
import { getRates } from "@/lib/fx";
import { fmtDate, countryName } from "@/lib/admin-data";
import { usd2 } from "@/lib/admin/inicio";
import { Card, EmptyState, Flag, PageHead, Table } from "@/components/admin/ui";
import { IUsers } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { productAlias, checkoutAlias, BUYER, EMAIL, HIDDEN } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

/** Compradores de la tienda, agrupados por email. Versión simple: la rehace la próxima etapa del panel. */
export default async function Clientes({ params, searchParams }: { params: Promise<{ offer: string }>; searchParams: Promise<{ q?: string }> }) {
  const sc = await scopeFor((await params).offer);
  const { q } = await searchParams;
  const s = sc.store;
  const [rates, { data: orders }] = await Promise.all([
    getRates(),
    db.from("orders").select("id,email,name,country,currency,amount_total,created_at")
      .eq("store_id", s.id).in("funnel_id", idsOrNone(sc.funnelIds)).eq("status", "paid").or(HAS_STRIPE).gt("amount_total", 0).not("email", "is", null)
      .order("created_at", { ascending: false }).limit(2000),
  ]);

  const map = new Map<string, { email: string; name: string | null; country: string | null; orders: number; usd: number; last: string; lastId: string }>();
  for (const o of orders ?? []) {
    const k = o.email!.toLowerCase();
    const e = map.get(k) ?? { email: o.email!, name: o.name, country: o.country, orders: 0, usd: 0, last: o.created_at, lastId: o.id };
    e.orders++;
    e.usd += Number(o.amount_total ?? 0) / (rates[(o.currency ?? "USD").toUpperCase()] ?? 1);
    e.name ??= o.name; e.country ??= o.country;
    map.set(k, e);
  }
  const needle = (q ?? "").trim().toLowerCase();
  const rows = [...map.values()].filter((c) => !needle || c.email.toLowerCase().includes(needle) || (c.name ?? "").toLowerCase().includes(needle));

  return (
    <>
      <PageHead title="Clientes" sub={`${map.size} ${map.size === 1 ? "comprador" : "compradores"}`} icon={<Users className="h-[18px] w-[18px]" />} color="#0ea5e9" />
      <form className="ad-card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input className="ad-in" name="q" defaultValue={q} placeholder="Buscar por email o nombre" style={{ flex: "1 1 220px" }} />
        <button className="ad-btn primary">Buscar</button>
      </form>
      <Card pad={false}>
        {rows.length ? (
          <Table head={["Cliente", { label: "País", hideM: true }, { label: "Pedidos", num: true }, { label: "Total", num: true }, { label: "Última compra", hideM: true }]}>
            {rows.slice(0, 300).map((c) => (
              <tr key={c.email}>
                <td>
                  <Link href={`${sc.base}/ventas?q=${encodeURIComponent(c.email)}`} style={{ textDecoration: "none" }}>
                    <b style={{ fontWeight: 600 }}><Pv as={BUYER}>{c.name || "Sin nombre"}</Pv></b>
                    <span className="sub"><Pv as={EMAIL}>{c.email}</Pv></span>
                  </Link>
                </td>
                <td className="hide-m"><Flag cc={c.country} />{countryName(c.country)}</td>
                <td className="num">{c.orders}</td>
                <td className="num"><b style={{ fontWeight: 600 }}>{usd2(c.usd)}</b></td>
                <td className="hide-m" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(c.last)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title={needle ? "Nadie con ese email o nombre" : "Todavía no hay compradores"} icon={<IUsers />}>
            Cada persona que paga aparece acá una sola vez, con todas sus compras.
          </EmptyState>
        )}
      </Card>
      <p className="ad-note" style={{ marginTop: 12, fontSize: 12 }}>Totales en dólares al tipo de cambio de hoy, sin los upsells. Cada pedido, en su moneda, está en Pedidos.</p>
    </>
  );
}
