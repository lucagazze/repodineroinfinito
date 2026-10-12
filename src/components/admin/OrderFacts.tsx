import type { Fact } from "@/lib/admin/order-facts";
import { fmtDate } from "@/lib/admin-data";

/** Un hecho del pedido (pago o entrega) como chip, con el detalle de los eventos al pasar el mouse. */

const CLS = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
  off: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
};
const DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", off: "bg-zinc-400" };

export function FactChip({ f, time = true }: { f: Fact; time?: boolean }) {
  if (f.label === "—") return null;
  return (
    <span title={f.title || undefined}
      className={`inline-flex max-w-[260px] items-center gap-1 truncate whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-bold ring-1 ring-inset ${CLS[f.tone]}`}>
      <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.tone]} ${f.label === "Enviando…" ? "animate-pulse" : ""}`} />
      <span className="truncate">{f.label}</span>
      {time && f.at && <span className="shrink-0 font-semibold opacity-60">· {fmtDate(f.at)}</span>}
    </span>
  );
}
