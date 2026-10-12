"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge, Card, EmptyState, Flag, Kpi } from "@/components/admin/ui";
import { IDownload, IUsers } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { BUYER, EMAIL, storeAlias } from "@/lib/admin/privacy";
import { PANEL_TZ } from "@/lib/admin/range";
import { toCsv, csvNum, csvDate } from "@/lib/admin/csv";

/** Lo que manda el servidor: un grupo por (email, tienda). La tabla los junta por email según el filtro. */
export type ClientGroup = {
  email: string; storeId: string; name: string | null; country: string | null;
  first: string; last: string; firstDay: string;
  orders: number; usd: number; refundedUsd: number; refunds: number; bumps: number; otos: number;
};
type Client = Omit<ClientGroup, "storeId"> & { stores: string[] };

const COLS = {
  cliente: "Cliente", pais: "País", tiendas: "Tiendas", primera: "Primera compra", ultima: "Última compra",
  pedidos: "Pedidos", total: "Total USD", bumps: "Bumps", otos: "OTOs", reembolso: "Reembolso",
} as const;
type Key = keyof typeof COLS;
type Dir = "asc" | "desc";
const TEXT: Key[] = ["cliente", "pais", "tiendas"];
const NUM: Key[] = ["pedidos", "total", "bumps", "otos", "reembolso"];
const HIDE_M: Key[] = ["pais", "tiendas", "primera", "bumps", "otos", "reembolso"];
const DEFAULT: { k: Key; d: Dir } = { k: "ultima", d: "desc" };
const STORAGE = "admin.clientes.sort";
const PAGE = 50;

const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: PANEL_TZ });

export default function ClientesTable({ groups, stores, countries, today }: {
  groups: ClientGroup[]; stores: { id: string; slug: string; name: string }[]; countries: Record<string, string>; today: string;
}) {
  const [q, setQ] = useState("");
  const [store, setStore] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState(DEFAULT);
  const [page, setPage] = useState(1);
  const sName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const cName = (cc: string | null) => (cc ? countries[cc] ?? cc : "—");

  // El orden elegido se recuerda en este navegador.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as { k?: string; d?: string } | null;
      if (s?.k && s.k in COLS) setSort({ k: s.k as Key, d: s.d === "asc" ? "asc" : "desc" });
    } catch { /* sin localStorage: el orden por defecto */ }
  }, []);
  const sortBy = (k: Key) => {
    const next = { k, d: (sort.k === k ? (sort.d === "asc" ? "desc" : "asc") : TEXT.includes(k) ? "asc" : "desc") as Dir };
    setSort(next); setPage(1);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* nada */ }
  };

  // Junta los grupos por email (con el filtro de tienda, solo los de esa tienda).
  const clients = useMemo(() => {
    const m = new Map<string, Client>();
    for (const g of groups) {
      if (store && g.storeId !== store) continue;
      const c = m.get(g.email);
      if (!c) { const { storeId, ...rest } = g; m.set(g.email, { ...rest, stores: [storeId] }); continue; }
      // Nombre y país: los de la compra más nueva.
      if (g.last > c.last) { c.name = g.name ?? c.name; c.country = g.country ?? c.country; c.last = g.last; }
      else { c.name ??= g.name; c.country ??= g.country; }
      if (g.first < c.first) { c.first = g.first; c.firstDay = g.firstDay; }
      c.orders += g.orders; c.usd += g.usd; c.refundedUsd += g.refundedUsd; c.refunds += g.refunds; c.bumps += g.bumps; c.otos += g.otos;
      if (!c.stores.includes(g.storeId)) c.stores.push(g.storeId);
    }
    return [...m.values()];
  }, [groups, store]);

  const countryOpts = useMemo(
    () => Object.keys(countries).sort((a, b) => (countries[a] ?? a).localeCompare(countries[b] ?? b, "es")),
    [countries],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = clients.filter((c) =>
      (!country || c.country === country) && (!needle || c.email.includes(needle) || (c.name ?? "").toLowerCase().includes(needle)));
    const storesText = (c: Client) => c.stores.map((id) => sName.get(id) ?? "").sort().join(", ");
    const val = (c: Client): string | number | null => {
      switch (sort.k) {
        case "cliente": return c.name || c.email;
        case "pais": return c.country ? countries[c.country] ?? c.country : null;
        case "tiendas": return storesText(c);
        case "primera": return c.first;
        case "ultima": return c.last;
        case "pedidos": return c.orders;
        case "total": return c.usd;
        case "bumps": return c.bumps;
        case "otos": return c.otos;
        case "reembolso": return c.refundedUsd;
      }
    };
    const m = sort.d === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { sensitivity: "base", numeric: true });
      return r * m || b.last.localeCompare(a.last);
    });
  }, [clients, q, country, sort, sName, countries]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const total = rows.reduce((a, c) => a + c.usd, 0);
  const repeat = rows.filter((c) => c.orders > 1).length;
  const filtered = !!(q.trim() || store || country);

  const exportCsv = () => {
    const csv = toCsv(
      ["nombre", "email", "pais", "tiendas", "primera_compra", "ultima_compra", "pedidos", "total_usd", "bumps", "otos", "reembolsos", "reembolsado_usd"],
      rows.map((c) => [
        c.name ?? "", c.email, c.country ?? "", c.stores.map((id) => sName.get(id) ?? "").join(" + "), csvDate(c.first), csvDate(c.last),
        c.orders, csvNum(c.usd), c.bumps, c.otos, c.refunds, c.refunds ? csvNum(c.refundedUsd) : "",
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes${store ? `-${stores.find((s) => s.id === store)?.slug ?? ""}` : ""}-${today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ventasLink = (c: Client) => {
    const u = new URLSearchParams({ q: c.email, desde: c.firstDay, hasta: today });
    if (store) { const s = stores.find((x) => x.id === store); if (s) u.set("tienda", s.slug); }
    return `/admin/ventas?${u}`;
  };

  return (
    <>
      <div className="ad-grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Clientes" value={rows.length} hint={filtered ? "con estos filtros" : "de siempre"} />
        <Kpi label="Volvieron a comprar" value={rows.length ? `${Math.round((repeat / rows.length) * 100)} %` : "—"} hint={`${repeat} con más de un pedido`} />
        <Kpi label="Total gastado" value={usd(total)} src="en USD, al cambio de hoy" />
        <Kpi label="Por cliente" value={rows.length ? usd(total / rows.length) : "—"} hint="promedio" />
      </div>

      <div className="ad-card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input className="ad-in" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Buscar por email o nombre" style={{ flex: "1 1 220px" }} aria-label="Buscar" />
        <select data-pv-blur className="ad-in" value={store} onChange={(e) => { setStore(e.target.value); setPage(1); }} style={{ flex: "1 1 160px" }} aria-label="Tienda">
          <option value="">Todas las tiendas</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="ad-in" value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} style={{ flex: "1 1 150px" }} aria-label="País">
          <option value="">Todos los países</option>
          {countryOpts.map((c) => <option key={c} value={c}>{countries[c]}</option>)}
        </select>
        <select className="ad-in" value={`${sort.k}:${sort.d}`} style={{ flex: "1 1 190px" }} aria-label="Ordenar por"
          onChange={(e) => {
            const [k, d] = e.target.value.split(":") as [Key, Dir];
            setSort({ k, d }); setPage(1);
            try { localStorage.setItem(STORAGE, JSON.stringify({ k, d })); } catch { /* nada */ }
          }}>
          {(Object.entries(COLS) as [Key, string][]).flatMap(([k, l]) => [
            <option key={`${k}:desc`} value={`${k}:desc`}>Orden: {l} ↓</option>,
            <option key={`${k}:asc`} value={`${k}:asc`}>Orden: {l} ↑</option>,
          ])}
        </select>
        <button type="button" className="ad-btn" onClick={exportCsv} disabled={!rows.length}><IDownload size={15} /> Exportar CSV</button>
        {filtered && <button type="button" className="ad-btn ghost" onClick={() => { setQ(""); setStore(""); setCountry(""); setPage(1); }}>Limpiar</button>}
      </div>

      <Card pad={false}>
        {shown.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  {(Object.keys(COLS) as Key[]).map((k) => {
                    const on = sort.k === k;
                    const Icon = on ? (sort.d === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                    return (
                      <th key={k} className={`${NUM.includes(k) ? "num" : ""} ${HIDE_M.includes(k) ? "hide-m" : ""}`}
                        aria-sort={on ? (sort.d === "asc" ? "ascending" : "descending") : undefined}>
                        <button type="button" onClick={() => sortBy(k)}
                          className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white ${on ? "text-zinc-900 dark:text-white" : ""}`}>
                          {COLS[k]}<Icon className={`h-3 w-3 ${on ? "" : "opacity-40"}`} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.email}>
                    <td>
                      <Link href={ventasLink(c)} style={{ textDecoration: "none" }} title="Ver sus compras">
                        <b style={{ fontWeight: 600 }}><Flag cc={c.country} /><Pv as={BUYER}>{c.name || "Sin nombre"}</Pv></b>
                        <span className="sub"><Pv as={EMAIL}>{c.email}</Pv></span>
                      </Link>
                    </td>
                    <td className="hide-m" style={{ whiteSpace: "nowrap" }}>{cName(c.country)}</td>
                    <td className="hide-m">
                      {c.stores.map((id, i) => (
                        <span key={id} style={{ whiteSpace: "nowrap" }}>{i > 0 && ", "}<Pv as={storeAlias(id)}>{sName.get(id) ?? "—"}</Pv></span>
                      ))}
                    </td>
                    <td className="hide-m" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{date(c.first)}</td>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{date(c.last)}</td>
                    <td className="num">{c.orders}</td>
                    <td className="num"><b style={{ fontWeight: 600 }}>{usd(c.usd)}</b></td>
                    <td className="num hide-m">{c.bumps || <span style={{ color: "var(--faint)" }}>0</span>}</td>
                    <td className="num hide-m">{c.otos || <span style={{ color: "var(--faint)" }}>0</span>}</td>
                    <td className="num hide-m">
                      {c.refunds ? <Badge tone="bad">{c.refunds === 1 ? "1 · " : `${c.refunds} · `}{usd(c.refundedUsd)}</Badge> : <span style={{ color: "var(--faint)" }}>No</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={filtered ? "Nadie con ese filtro" : "Todavía no hay clientes"} icon={<IUsers />}>
            Cada persona que paga aparece acá una sola vez, con todas sus compras.
          </EmptyState>
        )}
      </Card>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>Página {cur} de {pages} · {rows.length} clientes</span>
          <div className="ad-actions">
            {cur > 1 && <button type="button" className="ad-btn sm" onClick={() => { setPage(cur - 1); window.scrollTo({ top: 0 }); }}>Anterior</button>}
            {cur < pages && <button type="button" className="ad-btn sm" onClick={() => { setPage(cur + 1); window.scrollTo({ top: 0 }); }}>Siguiente</button>}
          </div>
        </div>
      )}
    </>
  );
}
