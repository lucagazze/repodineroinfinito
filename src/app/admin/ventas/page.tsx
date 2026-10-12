import Link from "next/link";
import { Receipt, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Badge, Card, EmptyState, Flag, Kpi, PageHead } from "@/components/admin/ui";
import { IDownload } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import RangeBar from "@/components/admin/RangeBar";
import { fmtDate, money, countryName } from "@/lib/admin-data";
import { usd2 } from "@/lib/admin/inicio";
import { offerList } from "@/lib/admin/offers";
import { resolveRange } from "@/lib/admin/range";
import { productAlias, storeAlias, BUYER, EMAIL } from "@/lib/admin/privacy";
import { stepTags } from "@/lib/postpurchase";
import {
  loadSales, parseSaleFilters, filterSales, sortSales, saleQuery, saleStatus, SALE_SORTS,
  type Sale, type SaleFilters, type SaleSort,
} from "@/lib/admin/all-sales";
import SortMemory from "./SortMemory";

export const dynamic = "force-dynamic";
const PAGE = 50;

/**
 * Ventas realizadas de TODAS las tiendas. Sin las tiendas excluidas (EXCLUDED_STORES). Filtros, orden y página
 * viven en la URL (se comparten y el CSV usa los mismos); el orden elegido se recuerda en el navegador.
 */
export default async function VentasTodas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseSaleFilters(sp);
  const R = resolveRange({ r: f.r, desde: f.desde, hasta: f.hasta });
  const [{ sales: all, stores }, offers] = await Promise.all([loadSales(R), offerList()]);

  const rows = sortSales(filterSales(all, f), f.o, f.d);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(f.p, pages);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  // «OTO 1», «DS 2» de las cadenas post-compra de esta página (como en Pedidos de cada oferta).
  const ppIds = [...new Set(shown.map((s) => s.ppFunnelId).filter(Boolean) as string[])];
  const tagsByPp = new Map(await Promise.all(ppIds.map(async (pp) => [pp, await stepTags(pp)] as const)));

  const storeIds = new Set(stores.map((s) => s.id));
  const storeSel = stores.find((s) => s.slug === f.tienda);
  const offerOpts = offers.filter((o) => storeIds.has(o.store.id) && (!storeSel || o.store.id === storeSel.id));
  const countries = [...new Set(all.map((s) => s.country).filter(Boolean) as string[])].sort((a, b) => countryName(a).localeCompare(countryName(b), "es"));

  const gross = rows.reduce((a, s) => a + s.usd, 0);
  const refunds = rows.filter((s) => s.refunded > 0);
  const withOto = rows.filter((s) => s.otos > 0).length;
  const filtered = !!(f.q || f.tienda || f.oferta || f.pais || f.estado || f.extra || f.min != null);
  const base = "/admin/ventas";

  return (
    <Shell>
      <PageHead
        title="Ventas realizadas"
        icon={<Receipt className="h-[18px] w-[18px]" />} color="#ec4899"
        sub={`${rows.length} ${rows.length === 1 ? "venta" : "ventas"} · ${R.label} · todas las tiendas`}
        actions={<><a className="ad-btn" href={`/api/admin/export/excel${saleQuery(f, { p: null })}`} title="Excel con el formato exacto de la plataforma anterior: una fila por cobro (cada OTO aparte), 27 columnas"><IDownload size={15} /> Exportar Excel</a><a className="ad-btn" href={`/api/admin/export/todas${saleQuery(f, { p: null })}`}><IDownload size={15} /> Exportar CSV</a></>}
      />
      <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
      <SortMemory storageKey="admin.ventas.sort" o={f.o} d={f.d} explicit={!!sp.o} />

      <div className="ad-grid g-kpi" style={{ marginBottom: 14 }}>
        <Kpi label="Ventas" value={rows.length} hint={filtered ? "con estos filtros" : "en el período"} />
        <Kpi label="Facturado" value={usd2(gross)} hint={rows.length ? `ticket ${usd2(gross / rows.length)}` : "—"} src="en USD, al cambio de hoy" />
        <Kpi label="Con OTO" value={rows.length ? `${Math.round((withOto / rows.length) * 100)} %` : "—"} hint={`${withOto} de ${rows.length}`} />
        <Kpi label="Reembolsos" value={refunds.length} hint={refunds.length ? usd2(refunds.reduce((a, s) => a + s.refundedUsd, 0)) : "ninguno"} />
      </div>

      <form className="ad-card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {/* El período y el orden siguen puestos al filtrar. */}
        {f.r && <input type="hidden" name="r" value={f.r} />}
        {f.desde && <input type="hidden" name="desde" value={f.desde} />}
        {f.hasta && <input type="hidden" name="hasta" value={f.hasta} />}
        <input className="ad-in" name="q" defaultValue={f.q} placeholder="Buscar por email, nombre o #pedido" style={{ flex: "1 1 220px" }} />
        <select data-pv-blur className="ad-in" name="tienda" defaultValue={f.tienda} style={{ flex: "1 1 150px" }} aria-label="Tienda">
          <option value="">Todas las tiendas</option>
          {stores.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
        </select>
        <select data-pv-blur className="ad-in" name="oferta" defaultValue={f.oferta} style={{ flex: "1 1 180px" }} aria-label="Oferta">
          <option value="">Todas las ofertas</option>
          {offerOpts.map((o) => <option key={o.id} value={o.id}>{o.name}{stores.length > 1 && !storeSel ? ` · ${o.store.display_name || o.store.name}` : ""}{o.active ? "" : " (inactiva)"}</option>)}
        </select>
        <select className="ad-in" name="pais" defaultValue={f.pais} style={{ flex: "1 1 140px" }} aria-label="País">
          <option value="">Todos los países</option>
          {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
        </select>
        <select className="ad-in" name="estado" defaultValue={f.estado} style={{ flex: "1 1 150px" }} aria-label="Estado">
          <option value="">Pagadas y reembolsadas</option>
          <option value="paid">Solo pagadas</option>
          <option value="refunded">Solo reembolsadas</option>
        </select>
        <select className="ad-in" name="extra" defaultValue={f.extra} style={{ flex: "1 1 150px" }} aria-label="Upsells">
          <option value="">Con y sin extras</option>
          <option value="oto">Con OTO (upsell)</option>
          <option value="bump">Con bump</option>
          <option value="alguno">Con bump u OTO</option>
          <option value="ninguno">Sin extras</option>
        </select>
        <input className="ad-in" name="min" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={f.min ?? ""} placeholder="Mínimo USD" style={{ flex: "0 1 130px" }} aria-label="Monto mínimo en USD" />
        <select className="ad-in" name="o" defaultValue={f.o} style={{ flex: "1 1 150px" }} aria-label="Ordenar por">
          {(Object.entries(SALE_SORTS) as [SaleSort, string][]).map(([k, l]) => <option key={k} value={k}>Orden: {l}</option>)}
        </select>
        <select className="ad-in" name="d" defaultValue={f.d} style={{ flex: "0 1 140px" }} aria-label="Sentido">
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
        <button className="ad-btn primary">Filtrar</button>
        {filtered && <Link className="ad-btn ghost" href={`${base}${saleQuery(f, { q: null, tienda: null, oferta: null, pais: null, estado: null, extra: null, min: null, p: null })}`}>Limpiar</Link>}
      </form>

      <Card pad={false}>
        {shown.length ? (
          <div className="ad-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <Th f={f} k="cliente" />
                  <Th f={f} k="fecha" hideM />
                  <Th f={f} k="pais" hideM />
                  <Th f={f} k="tienda" hideM />
                  <Th f={f} k="oferta" hideM />
                  <Th f={f} k="productos" hideM />
                  <Th f={f} k="total" num />
                  <Th f={f} k="usd" num hideM />
                  <Th f={f} k="estado" />
                  <Th f={f} k="entregado" hideM />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => <SaleRow key={s.id} s={s} tags={tagsByPp.get(s.ppFunnelId ?? "")} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={filtered ? "No hay ventas con ese filtro" : "No hay ventas en este período"} icon={<Receipt className="h-5 w-5" />}>
            Probá con otro período o sacá algún filtro.
          </EmptyState>
        )}
      </Card>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>Página {page} de {pages} · {rows.length} ventas</span>
          <div className="ad-actions">
            {page > 1 && <Link className="ad-btn sm" href={`${base}${saleQuery(f, { p: page - 1 })}`}>Anterior</Link>}
            {page < pages && <Link className="ad-btn sm" href={`${base}${saleQuery(f, { p: page + 1 })}`}>Siguiente</Link>}
          </div>
        </div>
      )}
      <p className="ad-note" style={{ marginTop: 12, fontSize: 12 }}>
        Total = lo cobrado en el checkout (principal + bumps) más los OTO, en la moneda del pedido. USD al tipo de cambio de hoy.
        Solo compras reales; sin las tiendas excluidas ni las de prueba.
      </p>
    </Shell>
  );
}

/** Encabezado que ordena: tocarlo ordena por esa columna; tocarlo otra vez da vuelta el sentido. */
function Th({ f, k, num, hideM }: { f: SaleFilters; k: SaleSort; num?: boolean; hideM?: boolean }) {
  const on = f.o === k;
  // Texto: A→Z primero; números y fechas: de mayor a menor primero.
  const first = ["cliente", "email", "pais", "tienda", "oferta", "productos", "moneda", "estado"].includes(k) ? "asc" : "desc";
  const d = on ? (f.d === "asc" ? "desc" : "asc") : first;
  const Icon = on ? (f.d === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`${num ? "num" : ""} ${hideM ? "hide-m" : ""}`} aria-sort={on ? (f.d === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`/admin/ventas${saleQuery(f, { o: k, d, p: null })}`} scroll={false}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white ${on ? "text-zinc-900 dark:text-white" : ""}`}
        style={{ textDecoration: "none" }}>
        {SALE_SORTS[k]}<Icon className={`h-3 w-3 ${on ? "" : "opacity-40"}`} />
      </Link>
    </th>
  );
}

const CHIP = "inline-flex max-w-full items-center truncate rounded-md px-1.5 py-[1px] text-[10px] font-bold ring-1 ring-inset";
const BUMP = "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/25";
const OTO = "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25";

function SaleRow({ s, tags }: { s: Sale; tags?: Map<string, string> }) {
  const href = s.offerKey ? `/admin/o/${s.offerKey}/ventas/${s.id}` : null;
  const who = (
    <>
      <b style={{ fontWeight: 550 }}><Flag cc={s.country} /><Pv as={BUYER}>{s.name || "Sin nombre"}</Pv></b>
      <span className="sub"><span className="font-mono">{s.ref}</span> · <Pv as={EMAIL}>{s.email ?? "—"}</Pv></span>
    </>
  );
  const main = s.items.filter((it) => it.kind === "main");
  const extras = s.items.filter((it) => it.kind !== "main");
  return (
    <tr>
      <td>{href ? <Link href={href} style={{ textDecoration: "none" }}>{who}</Link> : who}<Link href={`/admin/informe/${s.id}`} className="sub" title="Informe de actividad para una disputa (PDF)" style={{ fontSize: 11 }}>Informe de actividad</Link>{s.email && <a href={`/api/admin/biblioteca?store=${s.storeId}&email=${encodeURIComponent(s.email)}`} target="_blank" rel="noreferrer" className="sub" title="Su «Mi biblioteca» tal cual la ve" style={{ fontSize: 11 }}>Ver su biblioteca</a>}</td>
      <td className="hide-m" style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(s.createdAt)}</td>
      <td className="hide-m" style={{ whiteSpace: "nowrap" }}>{countryName(s.country)}</td>
      <td className="hide-m" style={{ whiteSpace: "nowrap" }}><Pv as={storeAlias(s.storeId)}>{s.storeName}</Pv></td>
      <td className="hide-m">
        {s.offerName ? (
          <>
            <Pv as={s.offerAlias ?? "Oferta"}>{s.offerName}</Pv>
            {s.market && <span className="sub">{s.market}</span>}
          </>
        ) : <span style={{ color: "var(--faint)" }}>—</span>}
      </td>
      <td className="hide-m">
        <div className="flex max-w-[280px] flex-wrap gap-1">
          {main.map((it, i) => (
            <span key={`m${i}`} className="text-[12px] font-semibold"><Pv as={it.productId ? productAlias(it.productId) : "Producto"}>{it.name}</Pv></span>
          ))}
          {extras.map((it, i) => (
            <span key={`x${i}`} className={`${CHIP} ${it.kind === "bump" ? BUMP : OTO}`}>
              {it.kind === "bump" ? "+ Bump" : `+ ${tags?.get(it.productId ?? "") ?? "OTO"}`} · <Pv as={it.productId ? productAlias(it.productId) : "Producto"}>{it.name}</Pv>
            </span>
          ))}
          {!s.items.length && <span style={{ color: "var(--faint)" }}>—</span>}
        </div>
      </td>
      <td className="num">
        <b style={{ fontWeight: 600 }}>{money(s.total, s.currency)}</b>
        <span className="sub">{s.currency}</span>
      </td>
      <td className="num hide-m">{usd2(s.usd)}</td>
      <td>
        <Badge tone={s.status === "refunded" ? "bad" : s.refunded > 0 ? "warn" : "ok"} dot>{saleStatus(s)}</Badge>
      </td>
      <td className="hide-m">
        {s.status === "refunded" ? <span style={{ color: "var(--faint)" }}>—</span>
          : s.deliveredAt ? <Badge tone="ok">Sí</Badge> : <Badge tone="warn">No</Badge>}
      </td>
    </tr>
  );
}
