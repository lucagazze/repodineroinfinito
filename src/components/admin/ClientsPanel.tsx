"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt, Search as SearchIcon, X } from "lucide-react";
import type { PulseOrder } from "@/lib/admin/pulse";
import { Flag } from "./RecentOrders";
import { Pv } from "./Priv";
import { PANEL_TZ } from "@/lib/admin/range";
import { usePoll, SALE_EVENT } from "./poll";
import OrderDrawer, { PayChip } from "./OrderDrawer";
import NetChip from "./NetChip";

/**
 * «Últimos pagos» de Inicio, como «Clientes» de la plataforma anterior: una tabla limpia
 * (Pedido · Fecha · Cliente · Oferta · Total · Estado del pago · Artículos),
 * de a 10 con «1–10 de N» y ‹ ›, y un buscador por correo, nombre, teléfono o
 * número de pedido. La primera página sin búsqueda se actualiza sola (cada
 * 5 s y al momento si entra una compra) y lo nuevo entra resaltado. Tocar una
 * fila abre el cajón del pedido (OrderDrawer).
 */

const POLL_MS = 5000;
const PAGE = 10;
type Data = { day: string; total: number; orders: PulseOrder[] };

const money = (n: number, cur: string | null) => {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${cur} ${n}`; }
};
const dayIn = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: PANEL_TZ }).format(new Date(iso));
const hm = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ });
/** «hoy 12:02» o «5 oct 10:10» (hora de Argentina). */
const when = (iso: string, today: string) =>
  dayIn(iso) === today ? `hoy ${hm(iso)}` : `${new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: PANEL_TZ }).replace(".", "")} ${hm(iso)}`;
const arts = (n: number) => `${n} ${n === 1 ? "artículo" : "artículos"}`;

export default function ClientsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<PulseOrder | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string> | null>(null);
  const busy = useRef(false);
  const last = useRef<string | null>(null);
  const key = `${page}|${query}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Buscar mientras se escribe, con 300 ms de pausa; vuelve a la primera página.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // El reloj compartido del panel: la primera página sin búsqueda, cada 5 s y al momento si entra una
  // compra; las demás, solo al cambiar de página o de búsqueda. busy queda en true después de un 401.
  usePoll(async (signal) => {
    if (busy.current) return;
    const k = keyRef.current;
    const [pg, qq] = [page, query];
    const live = pg === 0 && !qq;
    if (!live && last.current?.startsWith(`${k}#`)) return;
    try {
      setLoading(true);
      const r = await fetch(`/api/admin/compras?desde=2020-01-01&hasta=2100-01-01&limit=${PAGE}&offset=${pg * PAGE}${qq ? `&q=${encodeURIComponent(qq)}` : ""}`, { cache: "no-store", signal });
      if (r.status === 401) { busy.current = true; setErr("Se cerró la sesión del panel: volvé a entrar."); return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const text = await r.text();
      if (keyRef.current !== k) return; // llegó tarde: ya se pidió otra página
      if (last.current === `${k}#${text}`) { setErr(null); return; }
      last.current = `${k}#${text}`;
      const d = JSON.parse(text) as Data;
      setErr(null);
      // Lo que llega mientras se mira la primera página: pedido nuevo, que pasó a pagado o que sumó un OTO.
      const sig = (o: PulseOrder) => `${o.status}:${o.items.length}`;
      if (live && seen.current) {
        const nu = d.orders.filter((o) => seen.current!.get(o.id) !== sig(o)).map((o) => o.id);
        if (nu.length) { setFresh(new Set(nu)); setTimeout(() => setFresh(new Set()), 4000); }
      }
      if (live) seen.current = new Map(d.orders.map((o) => [o.id, sig(o)]));
      setData(d);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(`No se pudo actualizar (${(e as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }, POLL_MS, [page, query], SALE_EVENT);

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);

  return (
    <section className="ad-card flex min-w-0 flex-col">
      <div className="ad-card-h">
        <div className="min-w-0">
          <h3><Receipt className="h-4 w-4 text-zinc-400" /> Últimos pagos</h3>
          <p>De todas las ofertas, lo más nuevo arriba. Tocá uno para ver el pedido.</p>
        </div>
      </div>
      <div className="px-4 pb-3 sm:px-5">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por correo, nombre, teléfono o #pedido…"
            className="ad-in h-10 w-full pl-9 pr-9 text-[13px]" aria-label="Buscar pagos" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>}
        </label>
      </div>

      {err && <p className="ad-note px-4 py-2 text-amber-600">{err}</p>}

      {/* Escritorio: tabla. Celular: filas compactas de dos renglones. */}
      <div className="hidden min-w-0 border-t border-white/[0.05] md:block">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[80px]" /><col className="w-[108px]" /><col /><col className="w-[22%]" /><col className="w-[104px]" /><col className="w-[124px]" /><col className="w-[112px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[12px] font-medium text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Pedido</th><th className="px-2 py-2.5 font-medium">Fecha</th><th className="px-2 py-2.5 font-medium">Cliente</th>
              <th className="px-2 py-2.5 font-medium">Oferta</th><th className="px-2 py-2.5 text-right font-medium">Total</th>
              <th className="px-2 py-2.5 font-medium">Estado del pago</th><th className="px-4 py-2.5 text-right font-medium">Artículos</th>
            </tr>
          </thead>
          <tbody className={loading && !data ? "" : loading ? "opacity-70" : ""}>
            {orders.map((o) => (
              <tr key={o.id} tabIndex={0} onClick={() => setSel(o)} onKeyDown={(e) => { if (e.key === "Enter") setSel(o); }}
                className={`cursor-pointer border-t border-white/[0.05] transition-colors duration-1000 hover:bg-white/[0.03] focus:bg-white/[0.04] focus:outline-none ${fresh.has(o.id) ? "ad-fresh" : ""}`}>
                <td className="px-4 py-3 font-mono font-semibold text-violet-400">{o.ref}</td>
                <td className="truncate px-2 py-3 text-zinc-400" suppressHydrationWarning>{data && when(o.at, data.day)}</td>
                <td className="truncate px-2 py-3 font-medium text-zinc-100">{o.buyer ? <Pv as="Cliente ••••">{o.buyer}</Pv> : <span className="text-zinc-500">Sin nombre</span>}</td>
                <td className="px-2 py-3"><span className="flex min-w-0 items-center gap-1.5 text-zinc-300"><Flag cc={o.flags[0] ?? o.country} w={16} /><span className="truncate">{o.offer ? <Pv as={o.alias ?? "Oferta"}>{o.offer}</Pv> : "Sin oferta"}</span><NetChip n={o.network} /></span></td>
                <td className={`px-2 py-3 text-right font-semibold tabular-nums ${o.status === "refunded" ? "text-zinc-500 line-through" : "text-white"}`}>{money(o.amount, o.currency)}</td>
                <td className="px-2 py-3"><PayChip o={o} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-400">{arts(o.items.length)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 list-none divide-y divide-white/[0.05] border-t border-white/[0.05] p-0 md:hidden">
        {orders.map((o) => (
          <li key={o.id} className={`transition-colors duration-1000 ${fresh.has(o.id) ? "ad-fresh" : ""}`}>
            <button type="button" onClick={() => setSel(o)} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left active:bg-white/[0.04]">
              <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <b className="font-mono font-semibold text-violet-400">{o.ref}</b>
                <span className="truncate text-zinc-500" suppressHydrationWarning>{data && when(o.at, data.day)}</span>
              </span>
              <b className={`text-right text-[13.5px] tabular-nums ${o.status === "refunded" ? "text-zinc-500 line-through" : "text-white"}`}>{money(o.amount, o.currency)}</b>
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-zinc-300">
                <Flag cc={o.flags[0] ?? o.country} w={14} />
                <span className="truncate"><span className="font-medium text-zinc-100">{o.buyer ? <Pv as="Cliente ••••">{o.buyer}</Pv> : "Sin nombre"}</span>{o.offer ? <> · <Pv as={o.alias ?? "Oferta"}>{o.offer}</Pv></> : null}</span>
              </span>
              <span className="flex items-center justify-end gap-2"><NetChip n={o.network} /><PayChip o={o} /></span>
            </button>
          </li>
        ))}
      </ul>

      {!data && !err && <p className="ad-note border-t border-white/[0.05] px-4 py-4">Cargando…</p>}
      {data && !orders.length && <p className="ad-note border-t border-white/[0.05] px-4 py-4">{query ? `Nada coincide con «${query}».` : "Todavía no hay pagos."}</p>}

      {data && total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] px-4 py-2.5 text-[12.5px] text-zinc-400 sm:px-5">
          <span className="tabular-nums">{from}–{to} de {total.toLocaleString("es-AR")}</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-zinc-500">{page + 1} / {pages}</span>
            <button type="button" className="ad-btn sm h-8 w-8 px-0" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="ad-btn sm h-8 w-8 px-0" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      )}

      {sel && <OrderDrawer order={sel} onClose={() => setSel(null)} />}
    </section>
  );
}
