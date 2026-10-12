"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock } from "lucide-react";
import DateRangePicker from "./DateRangePicker";
import { PANEL_TZ_LABEL } from "@/lib/admin/range";

/**
 * El filtro de fechas de una página: siempre en el mismo lugar (debajo del
 * título, antes de todo lo demás) y pegado arriba al bajar, para cambiar el
 * período sin volver a subir. Pegado, toma fondo y una línea abajo.
 */
export default function RangeBar({ since, until, preset, label, children }: {
  since: string; until: string; preset: string | null; label: string;
  /** Algo más de la página que depende del período (va a la derecha). */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 0.5);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={ref} className="ad-rangebar" data-stuck={stuck || undefined}>
      <div className="min-w-0 flex-1 md:flex-none">
        <DateRangePicker since={since} until={until} preset={preset} label={label} align="left" />
      </div>
      <span className="hidden items-center gap-1.5 text-[11px] font-semibold text-zinc-400 lg:inline-flex">
        <Clock className="h-3.5 w-3.5" /> {PANEL_TZ_LABEL}
      </span>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
