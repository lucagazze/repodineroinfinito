"use client";

import { useEffect, useRef, useState } from "react";
import type { Money } from "@/lib/admin/money";
import { SALE_EVENT, usePoll } from "./poll";

/**
 * La fila de plata de Inicio (lo de «Ahora» está en la tarjeta del mapa, con los 4 pasos):
 *  - La plata del período del filtro: Facturado −
 *    Comisiones − Reembolsos = Neto; Neto − Gasto en anuncios = Beneficio.
 *    Si el período llega hasta hoy, se actualiza sola cuando entra una compra
 *    (el latido de Inicio) y lo que cambió se resalta un momento.
 */

/** «US$ 1.234», «US$ 12,50», «US$ 0» y, si es negativo, con el menos tipográfico: «−US$ 331». */
const usd = (n: number) => {
  const a = Math.abs(n), d = a > 0 && a < 100 ? 2 : 0;
  const s = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(a);
  return n < 0 && a >= 0.005 ? `−${s}` : s;
};
/** Lo que resta: «−US$ 12» (o «US$ 0» si no hubo). */
const minus = (n: number) => usd(-Math.abs(n));

type Cell = { key: keyof Money | "ticket"; label: string; value: string; hint: string; tone?: "good" | "bad" };

export function MoneyRow({ initial, label, query, live }: {
  initial: Money;
  /** «Últimos 7 días», «Hoy»… (el del filtro). */
  label: string;
  /** El filtro como query (r=… o desde=…&hasta=…), para volver a pedirla. */
  query: string;
  /** El período llega hasta hoy: se actualiza cuando entra una compra. */
  live: boolean;
}) {
  const [m, setM] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const freshT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  useEffect(() => { setM(initial); }, [initial]);
  useEffect(() => () => { if (freshT.current) clearTimeout(freshT.current); }, []);

  // Solo si el período incluye hoy: cada 2 min (por reembolsos) y al momento si el latido avisa una compra.
  usePoll(async (signal) => {
    if (!live) return;
    if (first.current) { first.current = false; return; } // lo primero ya vino del servidor
    const r = await fetch(`/api/admin/plata?${query}`, { cache: "no-store", signal }).catch(() => null);
    if (!r?.ok) return;
    const n = (await r.json()) as Money;
    setM((old) => {
      const changed = (["gross", "fees", "refunded", "net", "spend", "profit"] as const).filter((k) => old[k] !== n[k]);
      if (changed.length) {
        setFresh(new Set(changed));
        if (freshT.current) clearTimeout(freshT.current);
        freshT.current = setTimeout(() => setFresh(new Set()), 4000);
      }
      return n;
    });
  }, 120_000, [query, live], SALE_EVENT);

  const cells: Cell[] = [
    { key: "gross", label: `Facturado · ${label}`, value: usd(m.gross),
      hint: m.orders ? `${m.orders.toLocaleString("es-AR")} ${m.orders === 1 ? "compra" : "compras"} · AOV ${usd(m.gross / m.orders)}` : "Sin cobros" },
    { key: "fees", label: "Comisiones", value: minus(m.fees), hint: m.feesSource === "real" ? "de la pasarela, las cobradas" : m.feesSource === "mixed" ? "de la pasarela, alguna venta sin neto" : "de la pasarela, estimadas" },
    { key: "refunded", label: "Reembolsos", value: minus(m.refunded), hint: m.refunds ? `${m.refunds} ${m.refunds === 1 ? "pedido" : "pedidos"}` : "Ninguno" },
    { key: "net", label: "Neto", value: usd(m.net), hint: "lo que queda tras comisiones" },
    { key: "spend", label: "Gasto en anuncios", value: m.spend == null ? "—" : minus(m.spend),
      hint: m.spend == null ? "Sin campañas vinculadas"
        : (m.unlinkedSpend ?? 0) >= 1 ? `incluye ${usd(m.unlinkedSpend)} de ${m.unlinkedCampaigns} ${m.unlinkedCampaigns === 1 ? "campaña" : "campañas"} sin oferta`
        : m.idleSpend >= 1 ? `${usd(m.idleSpend)} de campañas sin ventas acá`
        : `según Meta · ${m.campaigns} ${m.campaigns === 1 ? "campaña" : "campañas"}` },
    { key: "profit", label: "Beneficio", value: usd(m.profit), tone: m.profit < 0 ? "bad" : m.profit > 0 ? "good" : undefined,
      // El margen solo si es positivo: «−851 %» no dice nada útil.
      hint: m.gross && m.profit > 0 ? `Margen ${Math.round((m.profit / m.gross) * 100)} %` : "Neto − gasto" },
  ];

  return (
    <section className="ad-card min-w-0 overflow-hidden" aria-label={`Plata · ${label}`}>
      <ul className="m-0 grid list-none grid-cols-2 gap-px bg-zinc-100 p-0 sm:grid-cols-3 xl:grid-cols-6 dark:bg-white/[0.05]">
        {cells.map((c) => (
          <li key={c.key} className={`flex min-w-0 flex-col gap-1.5 bg-white px-4 py-3.5 transition-colors duration-1000 sm:px-5 sm:py-4 dark:bg-zinc-900 ${fresh.has(c.key) ? "ad-fresh" : ""}`}>
            <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-zinc-500 dark:text-zinc-400">{c.label}</span>
            <b className={`block truncate text-[20px] font-semibold leading-none tracking-tight tabular-nums sm:text-[22px] ${c.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : c.tone === "bad" ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-white"}`}>{c.value}</b>
            <span className="line-clamp-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{c.hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MoneyRowSkeleton() {
  return <div data-skeleton className="sk h-[264px] rounded-2xl sm:h-[176px] xl:h-[96px]" />;
}
