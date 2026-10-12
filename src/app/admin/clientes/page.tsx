import { Users } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { countryName } from "@/lib/admin-data";
import { loadSales } from "@/lib/admin/all-sales";
import { PANEL_TZ, todayIn } from "@/lib/admin/range";
import { dayOf } from "@/lib/admin/tz";
import ClientesTable, { type ClientGroup } from "./ClientesTable";

export const dynamic = "force-dynamic";

/**
 * Clientes de TODAS las tiendas. Sin las tiendas excluidas (EXCLUDED_STORES).
 *
 * Qué es un cliente: un EMAIL (en minúsculas), GLOBAL entre tiendas. La misma persona que compró en
 * dos tiendas es un solo cliente (lo que vale para el dueño es cuánto dejó en total),
 * con las tiendas listadas en su fila. Para que el filtro por tienda dé números de esa tienda, el
 * servidor manda un grupo por (email, tienda) y la tabla los junta según el filtro: con «Todas» suma
 * todo; con una tienda, solo lo de esa tienda.
 *
 * Todas las compras de siempre (no hay período): el volumen es chico y así el orden, la búsqueda y el
 * CSV son instantáneos en el navegador.
 */
export default async function ClientesTodas() {
  const { sales, stores } = await loadSales(null);

  const groups = new Map<string, ClientGroup>();
  // Las ventas vienen de la más nueva a la más vieja: el primer nombre y país que aparecen son los últimos.
  for (const s of sales) {
    if (!s.email) continue;
    const email = s.email.trim().toLowerCase();
    const k = `${email}|${s.storeId}`;
    const day = dayOf(new Date(s.createdAt), PANEL_TZ);
    const g = groups.get(k) ?? {
      email, storeId: s.storeId, name: null, country: null, first: s.createdAt, last: s.createdAt, firstDay: day,
      orders: 0, usd: 0, refundedUsd: 0, refunds: 0, bumps: 0, otos: 0,
    };
    g.name ??= s.name?.trim() || null;
    g.country ??= s.country;
    if (s.createdAt < g.first) { g.first = s.createdAt; g.firstDay = day; }
    if (s.createdAt > g.last) g.last = s.createdAt;
    g.orders++;
    g.usd += s.usd;
    g.refundedUsd += s.refundedUsd;
    if (s.refunded > 0) g.refunds++;
    g.bumps += s.bumps;
    g.otos += s.otos;
    groups.set(k, g);
  }

  const list = [...groups.values()];
  const codes = [...new Set(list.map((g) => g.country).filter(Boolean) as string[])];
  const countries = Object.fromEntries(codes.map((c) => [c, countryName(c)]));
  const people = new Set(list.map((g) => g.email)).size;

  return (
    <Shell>
      <PageHead
        title="Clientes"
        icon={<Users className="h-[18px] w-[18px]" />} color="#0ea5e9"
        sub={`${people} ${people === 1 ? "cliente" : "clientes"} · todas las tiendas, desde la primera venta`}
      />
      <ClientesTable groups={list} stores={stores} countries={countries} today={todayIn()} />
      <p className="ad-note" style={{ marginTop: 12, fontSize: 12 }}>
        Un cliente = un email, sumando todas las tiendas (con el filtro de tienda, solo lo de esa tienda). Total gastado en USD al tipo de cambio
        de hoy: checkout (principal + bumps) más los OTO, sin descontar reembolsos (van aparte). Solo compras reales; sin las tiendas excluidas ni las de prueba.
      </p>
    </Shell>
  );
}
