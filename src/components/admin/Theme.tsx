"use client";

import { useLayoutEffect, useState } from "react";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";

/**
 * El panel (y /entrar) es SIEMPRE oscuro: la clase «dark» ya viene del
 * servidor en el contenedor (sin destello) y acá nunca se saca. ThemeToggle
 * queda por compatibilidad pero el panel ya no lo muestra. Las páginas del
 * comprador (checkout, oferta, gracias, catálogo) no usan esto.
 */

const KEY = "ad-theme";
const PKEY = "ad-privacy";
const root = () => document.querySelector(".ad-root");

/** Los <script> que React agrega al navegar no se ejecutan: esto aplica el tema igual, antes de pintar. */
export function ThemeSync() {
  useLayoutEffect(() => {
    try {
      root()?.classList.add("dark");
      root()?.classList.toggle("privacy", localStorage.getItem(PKEY) === "1");
    } catch { /* sin almacenamiento: queda claro y sin modo captura */ }
  }, []);
  return null;
}

export function ThemeToggle({ className = "", label }: { className?: string; label?: boolean }) {
  const [dark, setDark] = useState(false);
  useLayoutEffect(() => { setDark(!!root()?.classList.contains("dark")); }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        root()?.classList.toggle("dark", next);
        try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* modo privado */ }
      }}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-xl text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white ${label ? "px-2.5" : "w-9"} ${className}`}
      title="Cambiar apariencia"
      aria-label="Cambiar apariencia"
    >
      {dark ? <Sun className="h-[17px] w-[17px] text-amber-400" /> : <Moon className="h-[17px] w-[17px]" />}
      {label && <span className="text-[11px] font-black">{dark ? "Claro" : "Oscuro"}</span>}
    </button>
  );
}

/**
 * Modo captura: oculta nombres de ofertas, productos, tiendas, links y
 * compradores (quedan los números) para poder mostrar resultados en público.
 */
export function PrivacyToggle({ className = "", label }: { className?: string; label?: boolean }) {
  const [on, setOn] = useState(false);
  useLayoutEffect(() => { setOn(!!root()?.classList.contains("privacy")); }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setOn(next);
        root()?.classList.toggle("privacy", next);
        try { localStorage.setItem(PKEY, next ? "1" : "0"); } catch { /* modo privado */ }
      }}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-xl transition-all ${label ? "px-2.5" : "w-9"} ${on
        ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white"} ${className}`}
      title={on ? "Modo captura activado: se ocultan nombres y clientes" : "Modo captura: ocultar nombres y clientes"}
      aria-label="Modo captura"
      aria-pressed={on}
    >
      {on ? <EyeOff className="h-[17px] w-[17px]" /> : <Eye className="h-[17px] w-[17px]" />}
      {label && <span className="text-[11px] font-black">Captura</span>}
    </button>
  );
}
