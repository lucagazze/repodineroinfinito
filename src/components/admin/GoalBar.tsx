import { moneyDetail } from "@/lib/admin/money";
import { todayIn } from "@/lib/admin/range";

/**
 * La barra del mes hacia 100.000 US$ de facturación neta (lo cobrado en
 * Stripe − comisiones − reembolsos, como «Neto» en Métricas), siempre del mes en curso, sin importar el
 * filtro de fechas. Con el ritmo: a cuánto se llega a fin de mes si sigue igual y cuánto falta por día.
 */
const GOAL = 100_000;
const usd = (n: number) => `US$ ${Math.round(n).toLocaleString("es-AR")}`;

export default async function GoalBar() {
  const today = todayIn();
  const [y, m, d] = today.split("-").map(Number);
  const start = `${today.slice(0, 7)}-01`;
  const { money } = await moneyDetail(start, today);
  const net = money.net;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // El día de hoy cuenta como medio (va por la mitad): el ritmo no se dispara a la mañana.
  const elapsed = Math.max(0.5, d - 0.5);
  const pace = (net / elapsed) * daysIn;
  const left = Math.max(0, GOAL - net);
  const perDay = left / Math.max(1, daysIn - d + 1);
  const pct = Math.min(100, (net / GOAL) * 100);
  const pacePct = Math.min(100, (pace / GOAL) * 100);
  const month = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  const ok = pace >= GOAL;
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Meta del mes · {month}</p>
          <p className="mt-0.5 text-[22px] font-black tracking-tight text-zinc-900 tabular-nums dark:text-white">
            {usd(net)} <span className="text-[13px] font-semibold text-zinc-400">de {usd(GOAL)} netos · {pct.toFixed(1)} %</span>
          </p>
        </div>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          A este ritmo: <b className={ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{usd(pace)}</b> a fin de mes
          {left > 0 && <> · faltan <b className="text-zinc-800 dark:text-zinc-200">{usd(left)}</b> ({usd(perDay)} por día)</>}
        </p>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={GOAL} aria-valuenow={Math.round(net)} aria-label="Facturación neta del mes">
        <div className="absolute inset-y-0 left-0 rounded-full bg-violet-500/25" style={{ width: `${pacePct}%` }} title="Proyección a fin de mes" />
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500" style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-px bg-zinc-400/60" style={{ left: `${(d / daysIn) * 100}%` }} title="Hoy" />
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-400">Neto = cobrado en Stripe − comisiones − reembolsos (antes del gasto en Meta). La franja clara es la proyección; la línea, el día del mes.</p>
    </div>
  );
}
