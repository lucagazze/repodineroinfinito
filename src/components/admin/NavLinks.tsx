"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { rangeQuery } from "@/lib/admin/range";
import type { ReactNode } from "react";

export type NavItem =
  | { href: string; label: string; icon: ReactNode; badge?: ReactNode; exact?: boolean; /** Prefijo que la marca activa si difiere de href. */ match?: string }
  | { group: ReactNode }
  | { sep: true };

/** Solo esto es cliente: saber qué sección está abierta para resaltarla. */
export default function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  // El rango de fechas elegido pasa de una sección a otra.
  const rq = rangeQuery(useSearchParams());
  return (
    <nav className="flex flex-col gap-1">
      {items.map((it, i) => {
        if ("sep" in it) return <div key={`s${i}`} className="h-4" />;
        if ("group" in it) {
          return (
            <p key={`g${i}`} className={`mb-1.5 select-none truncate px-3.5 text-[11.5px] font-semibold text-zinc-400 dark:text-zinc-500 ${i ? "mt-5" : ""}`}>
              {it.group}
            </p>
          );
        }
        const m = it.match ?? it.href;
        const on = it.exact ? path === it.href : path === m || path.startsWith(m + "/");
        return (
          <Link
            key={it.href}
            href={rq ? `${it.href}?${rq}` : it.href}
            // En el celular el menú es un panel superpuesto: al elegir una
            // sección hay que cerrarlo, si no queda tapando la página nueva.
            onClick={() => { const el = document.getElementById("ad-menu") as HTMLInputElement | null; if (el) el.checked = false; }}
            aria-current={on ? "page" : undefined}
            className={`ad-link group flex items-center gap-2.5 rounded-xl px-3 py-[7px] text-[12px] font-bold transition-all duration-150 active:scale-[0.98] ${
              on
                ? "bg-zinc-950 text-white shadow-md shadow-black/10 dark:bg-white dark:text-zinc-950 dark:shadow-white/5"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
            }`}
          >
            <span className={`flex shrink-0 transition-transform duration-150 ${on ? "" : "text-zinc-400 group-hover:scale-110 group-hover:text-zinc-800 dark:text-zinc-500 dark:group-hover:text-zinc-100"}`}>{it.icon}</span>
            {/* Siempre en una línea: la burbuja nunca empuja el texto a un segundo renglón. */}
            <span className="min-w-0 flex-1 truncate whitespace-nowrap tracking-tight" title={it.label}>{it.label}</span>
            {it.badge}
            {on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500 dark:bg-violet-400" />}
          </Link>
        );
      })}
    </nav>
  );
}
