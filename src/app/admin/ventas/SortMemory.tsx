"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Recuerda el orden elegido en Ventas (localStorage de este navegador): si se
 * entra sin ?o= y había uno guardado, lo vuelve a poner; si viene en la URL,
 * lo guarda. El orden por defecto (fecha, más nuevas primero) no se guarda.
 */
export default function SortMemory({ storageKey, o, d, explicit }: { storageKey: string; o: string; d: string; explicit: boolean }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (explicit) {
        if (o === "fecha" && d === "desc") localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify({ o, d }));
        return;
      }
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { o?: string; d?: string } | null;
      if (saved?.o && (saved.o !== o || saved.d !== d)) {
        const u = new URL(window.location.href);
        u.searchParams.set("o", saved.o);
        u.searchParams.set("d", saved.d === "asc" ? "asc" : "desc");
        router.replace(`${u.pathname}${u.search}`, { scroll: false });
      }
    } catch { /* sin localStorage (modo privado): queda el orden por defecto */ }
  }, [storageKey, o, d, explicit, router]);
  return null;
}
