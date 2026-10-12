"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, ShoppingBag } from "lucide-react";
import type { PulseOrder } from "@/lib/admin/pulse";
import { countryName } from "./WorldMap";
import { Pv } from "./Priv";
import { PANEL_TZ, rangeQuery, todayIn } from "@/lib/admin/range";
import { readIfChanged, usePoll } from "./poll";

/**
 * «Últimas compras», una fila por pedido: hora de Londres, país, oferta, lo
 * que compró en una línea, un punto con el pago y la entrega, y el total
 * (principal + bumps + OTOs). Tocando la fila se abre el detalle con cada
 * ítem y su precio. Sigue al filtro de fechas: trae 25 y «Ver más» suma de a
 * 25. Se actualiza cada 5 s; las compras nuevas entran arriba resaltadas.
 *
 * side = columna angosta al lado del mapa (Inicio general, pantallas anchas):
 * cada pedido en dos renglones y la lista con el alto del mapa (se desplaza adentro).
 */

const POLL_MS = 5000;
const STEP = 25;
type Data = { day: string; total: number; orders: PulseOrder[] };

const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
const money = (n: number, cur: string) => {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${cur} ${n}`; }
};
const dayIn = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: PANEL_TZ }).format(new Date(iso));
const when = (iso: string, today: string) => {
  const t = new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ });
  if (dayIn(iso) === today) return `hoy ${t}`;
  return `${new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: PANEL_TZ }).replace(".", "")} ${t}`;
};

/** Bandera como imagen: Windows no dibuja los emojis de banderas. */
export function Flag({ cc, w = 18 }: { cc: string | null; w?: number }) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return null;
  const c = cc.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/20x15/${c}.png`} srcSet={`https://flagcdn.com/40x30/${c}.png 2x`} alt={cc.toUpperCase()} title={countryName(cc)}
      width={w} height={Math.round(w * 0.75)} className="inline-block shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,.06)]" />
  );
}

const FACT_CLS = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
  off: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
};
function MiniFact({ f }: { f: PulseOrder["pay"] }) {
  if (!f || f.label === "—") return null;
  return <span title={f.title || undefined} className={`inline-flex max-w-full items-center truncate rounded-md px-1.5 py-[1px] text-[10px] font-bold ring-1 ring-inset ${FACT_CLS[f.tone]}`}>{f.label}</span>;
}

const ITEM_CLS = {
  main: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  bump: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  oto: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  downsell: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300",
};

/** El punto de estado: rojo = reembolsado; ámbar = la entrega falló o reembolso parcial; verde = pagado y entregado; celeste = entregando. */
function status(o: PulseOrder) {
  const tip = `${o.pay.label} · ${o.delivery.label}`;
  if (o.pay.tone === "bad") return { cls: "bg-red-500", tip: `${tip}. ${o.pay.title}` };
  if (o.delivery.problem || o.delivery.tone === "bad") return { cls: "bg-amber-500", tip: `${tip}. ${o.delivery.title}` };
  if (o.pay.tone === "warn") return { cls: "bg-amber-500", tip: `${tip}. ${o.pay.title}` };
  if (o.delivery.tone === "ok") return { cls: "bg-emerald-500", tip };
  return { cls: "bg-sky-400", tip: `${tip}. ${o.delivery.title}` };
}

// Clases literales (Tailwind no ve clases armadas): en la columna angosta (xl) vuelve a dos renglones.
const ROW = {
  wide: {
    btn: "flex w-full min-w-0 items-start gap-2 px-4 py-2 text-left hover:bg-zinc-50 md:min-h-[38px] md:items-center md:gap-3 md:py-1.5 dark:hover:bg-white/[0.03]",
    main: "min-w-0 flex-1 md:flex md:items-center md:gap-3",
    head: "flex min-w-0 items-center gap-1.5 md:max-w-[62%] md:shrink-0",
    items: "mt-0.5 block truncate text-[11.5px] font-medium text-zinc-500 md:mt-0 md:min-w-0 md:flex-1 dark:text-zinc-400",
    buyer: "hidden text-zinc-400 2xl:inline dark:text-zinc-500",
    end: "flex shrink-0 items-center gap-2 pt-0.5 md:pt-0",
  },
  side: {
    btn: "flex w-full min-w-0 items-start gap-2 px-4 py-2 text-left hover:bg-zinc-50 md:min-h-[38px] md:items-center md:gap-3 md:py-1.5 xl:items-start xl:gap-2 xl:py-2 dark:hover:bg-white/[0.03]",
    main: "min-w-0 flex-1 md:flex md:items-center md:gap-3 xl:block",
    head: "flex min-w-0 items-center gap-1.5 md:w-[48%] md:max-w-[340px] md:shrink-0 xl:w-auto xl:max-w-none",
    items: "mt-0.5 block truncate text-[11.5px] font-medium text-zinc-500 md:mt-0 md:min-w-0 md:flex-1 xl:mt-0.5 dark:text-zinc-400",
    buyer: "hidden text-zinc-400 md:inline xl:hidden dark:text-zinc-500",
    end: "flex shrink-0 items-center gap-2 pt-0.5 md:pt-0 xl:pt-0.5",
  },
};

function Row({ o, today, open, fresh, onToggle, side }: { o: PulseOrder; today: string; open: boolean; fresh: boolean; onToggle: () => void; side?: boolean }) {
  const st = status(o);
  const c = side ? ROW.side : ROW.wide;
  return (
    <li className={`transition-colors duration-1000 ${fresh ? "ad-fresh" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={c.btn}>
        <span className={c.main}>
          <span className={c.head}>
            <span className="w-[72px] shrink-0 whitespace-nowrap text-[11px] font-bold tabular-nums text-zinc-400" suppressHydrationWarning>{when(o.at, today)}</span>
            <Flag cc={o.country} w={16} />
            <b className="truncate text-[12.5px] text-zinc-900 dark:text-white">{o.offer ? <Pv as={o.alias ?? "Oferta"}>{o.offer}</Pv> : "Sin oferta"}</b>
          </span>
          <span className={c.items}>
            {/* El comprador en la fila solo si hay lugar; siempre en el detalle. */}
            {o.buyer && <span className={c.buyer}><Pv as="Cliente ••••">{o.buyer}</Pv> · </span>}
            {o.items.length ? o.items.map((x, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="text-zinc-300 dark:text-zinc-600"> + </span>}
                <span className={x.refunded ? "line-through" : ""}>{x.kind === "oto" || x.kind === "downsell" ? `${x.label} ✓` : <Pv as={x.alias}>{x.name}</Pv>}</span>
              </Fragment>
            )) : "—"}
          </span>
        </span>
        <span className={c.end}>
          <i title={st.tip} aria-label={st.tip} className={`block h-2 w-2 shrink-0 rounded-full ${st.cls}`} />
          <b className={`min-w-[56px] text-right text-[12.5px] tabular-nums ${o.status === "refunded" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-white"}`}>{money(o.amount, o.currency)}</b>
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-300 transition-transform dark:text-zinc-600 ${open ? "rotate-90" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-medium text-zinc-500">
            <span className="min-w-0 truncate">{o.buyer ? <Pv as="Cliente ••••">{o.buyer}</Pv> : "Sin nombre"}{o.country ? ` · ${countryName(o.country)}` : ""}{o.market ? ` · ${o.market}` : ""}</span>
            <MiniFact f={o.pay} />
            <MiniFact f={o.delivery} />
            <Link href={`/admin/avisos/pedido/${o.id}`} className="ml-auto font-bold text-violet-600 hover:underline dark:text-violet-400">Ver pedido {o.ref} →</Link>
          </div>
          <ul className="grid gap-1">
            {o.items.map((x, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2 text-[11.5px]">
                <span className={`w-[74px] shrink-0 rounded px-1 py-[1px] text-center text-[10.5px] font-semibold ${ITEM_CLS[x.kind]}`}>{x.label}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-zinc-700 dark:text-zinc-200"><Pv as={x.alias}>{x.name}</Pv></span>
                <span className={`shrink-0 font-bold tabular-nums ${x.refunded ? "text-red-500 line-through" : "text-zinc-600 dark:text-zinc-300"}`}>{x.amount ? money(x.amount, x.currency) : "gratis"}</span>
              </li>
            ))}
          </ul>
          {o.currency !== "USD" && <span className="text-right text-[11px] font-semibold text-zinc-400">≈ {usd(o.usd)}</span>}
        </div>
      )}
    </li>
  );
}

export default function RecentOrders({ since, until, label, funnelIds, pedidosHref, side }: {
  since: string; until: string; label: string; side?: boolean;
  /** Solo estos checkouts (el Inicio de una oferta); sin esto, todas las ofertas. */
  funnelIds?: string[];
  /** Link a Pedidos de la oferta; en el Inicio general sale de las ofertas de la lista. */
  pedidosHref?: string;
}) {
  const rq = rangeQuery(useSearchParams());
  const key = `${since}|${until}|${(funnelIds ?? []).join(",")}`;
  const [limit, setLimit] = useState(STEP);
  const [data, setData] = useState<(Data & { key: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // Lo más nuevo que ya se vio con este filtro: solo lo posterior se resalta (no lo que trae «Ver más»).
  const seen = useRef<{ key: string; newest: string } | null>(null);

  useEffect(() => { setLimit(STEP); }, [key]);
  const lastText = useRef<string | null>(null);
  const stopped = useRef(false);
  // Reloj compartido (poll.ts): sin pedidos superpuestos, nada con la pestaña oculta ni navegando.
  usePoll(async (signal) => {
    if (stopped.current) return;
    const qs = new URLSearchParams({ desde: since, hasta: until, limit: String(limit) });
    if (funnelIds) qs.set("checkouts", funnelIds.join(","));
    {
      try {
        const r = await fetch(`/api/admin/compras?${qs}`, { cache: "no-store", signal });
        if (r.status === 401) { stopped.current = true; setErr("Se cerró la sesión del panel: volvé a entrar."); return; }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        const j = await readIfChanged<Data>(r, lastText);
        // Nada cambió desde la última vez: no se vuelve a dibujar.
        if (!j) { setErr(null); return; }
        const d = j;
        const prev = seen.current;
        if (prev && prev.key === key) {
          const nu = d.orders.filter((o) => o.at > prev.newest).map((o) => o.id);
          if (nu.length) { setFresh(new Set(nu)); setTimeout(() => setFresh(new Set()), 4000); }
        }
        const newest = d.orders[0]?.at ?? "";
        seen.current = { key, newest: prev && prev.key === key && prev.newest > newest ? prev.newest : newest };
        setData({ ...d, key });
        setErr(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr(`No se pudieron traer las compras (${(e as Error).message}). Reintentando…`);
      }
    }
  }, POLL_MS, [since, until, limit, key]);

  const today = data?.day ?? todayIn(PANEL_TZ);
  const live = until >= today;
  const loading = !data || data.key !== key;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Inicio general: los Pedidos de las ofertas que aparecen en la lista.
  const offers = pedidosHref ? [] : [...new Map((data?.orders ?? []).filter((o) => o.offerKey).map((o) => [o.offerKey!, o])).values()].slice(0, 3);
  const withRange = (href: string) => (rq ? `${href}?${rq}` : href);

  return (
    // De lado: alto 0 + mínimo 100 % = toma el alto de la fila (el del mapa) sin estirarla.
    <section className={side ? "ad-card flex min-w-0 flex-col xl:h-0 xl:min-h-full" : "ad-card flex min-w-0 flex-col"}>
      <div className="ad-card-h">
        <div className="min-w-0">
          <h3><ShoppingBag className="h-4 w-4 text-zinc-400" /> Últimas compras</h3>
          <p>{data ? `${data.total} ${data.total === 1 ? "compra" : "compras"} · ${label.toLowerCase()}` : label}. Tocá una para ver qué compró y a qué precio.</p>
        </div>
        {live && <span className="ad-livedot shrink-0 pt-1">En vivo</span>}
      </div>
      {err && <p className="ad-flash warn mx-4 mb-3">{err}</p>}
      {!data ? (
        <div className="grid gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-white/[0.05]">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="sk block h-[30px] rounded-lg" />)}
        </div>
      ) : data.orders.length ? (
        <ul className={`max-h-[600px] min-h-0 flex-1 ${side ? "xl:max-h-none" : ""} divide-y divide-zinc-100 overflow-y-auto border-t border-zinc-100 transition-opacity dark:divide-white/[0.05] dark:border-white/[0.05] ${loading ? "opacity-50" : ""}`}>
          {data.orders.map((o) => <Row key={o.id} o={o} today={today} open={open.has(o.id)} fresh={fresh.has(o.id)} onToggle={() => toggle(o.id)} side={side} />)}
        </ul>
      ) : <p className={`ad-note border-t border-zinc-100 px-4 py-4 dark:border-white/[0.05] ${loading ? "opacity-50" : ""}`}>Sin compras en {label.toLowerCase()}.</p>}
      {data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-100 px-4 py-2.5 text-[11.5px] font-semibold text-zinc-400 dark:border-white/[0.05]">
          {data.total > 0 && <span className="tabular-nums">{Math.min(data.orders.length, data.total)} de {data.total}</span>}
          {data.total > data.orders.length && (
            <button type="button" onClick={() => setLimit((l) => l + STEP)} disabled={loading}
              className="rounded-full border border-zinc-200 px-3 py-1 font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-white/[0.04]">
              Ver {Math.min(STEP, data.total - data.orders.length)} más
            </button>
          )}
          <span className="ml-auto flex min-w-0 flex-wrap items-center gap-x-2">
            {pedidosHref ? <Link href={withRange(pedidosHref)} className="font-bold text-violet-600 hover:underline dark:text-violet-400">Ver en Pedidos →</Link>
              : offers.length > 0 && <>Pedidos: {offers.map((o, i) => (
                <Fragment key={o.offerKey}>
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                  <Link href={withRange(`/admin/o/${o.offerKey}/ventas`)} className="truncate font-bold text-violet-600 hover:underline dark:text-violet-400"><Pv as={o.alias ?? "Oferta"}>{o.offer}</Pv></Link>
                </Fragment>
              ))}</>}
          </span>
        </div>
      )}
    </section>
  );
}
