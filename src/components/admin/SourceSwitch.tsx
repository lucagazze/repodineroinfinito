"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SOURCE_COOKIE, type Source } from "@/lib/admin/source-shared";

/**
 * «Meta Ads» | «Real (Stripe)»: de dónde salen las métricas del Inicio. Se
 * guarda en una cookie (el servidor arma la página con eso) y se aplica con
 * un toque, como el filtro de fechas: sin recargar ni mover el scroll.
 */
const OPTS: [Source, string, string][] = [["meta", "Meta Ads", "Meta"], ["real", "Real (Stripe)", "Stripe"]];

export default function SourceSwitch({ source }: { source: Source }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [want, setWant] = useState<Source | null>(null);
  const tries = useRef(0);
  const busy = pending || !!want;
  useEffect(() => {
    const main = document.querySelector(".ad-main");
    if (busy) main?.setAttribute("data-range-loading", "");
    else main?.removeAttribute("data-range-loading");
  }, [busy]);
  // Un toque tiene que alcanzar: si la página volvió con la otra fuente (se cruzó una actualización), se pide de nuevo.
  useEffect(() => {
    if (pending || !want) return;
    if (source === want) { setWant(null); return; }
    if (tries.current >= 2) { setWant(null); return; }
    tries.current++;
    start(() => router.refresh());
  }, [pending, want, source, router]);

  const cur = want ?? source;
  const pick = (s: Source) => {
    if (s === cur) return;
    document.cookie = `${SOURCE_COOKIE}=${s}; path=/admin; max-age=31536000; samesite=lax`;
    tries.current = 0;
    setWant(s);
    start(() => router.refresh());
  };
  return (
    <div role="group" aria-label="Fuente de las métricas" title="De dónde salen los números de esta página"
      className="inline-flex shrink-0 rounded-full border border-black/[0.06] bg-white p-0.5 shadow-sm dark:border-white/[0.06] dark:bg-zinc-900">
      {OPTS.map(([k, l, short]) => (
        <button key={k} type="button" aria-pressed={cur === k} onClick={() => pick(k)}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors md:text-[12px] ${cur === k
            ? k === "meta" ? "bg-[#1877f2] text-white" : "bg-emerald-600 text-white"
            : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>
          <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{l}</span>
        </button>
      ))}
    </div>
  );
}
