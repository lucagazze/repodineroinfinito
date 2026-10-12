"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Respuesta inmediata al tocar un link del panel: una barra arriba y la página
 * un poco atenuada hasta que llega la nueva. Sin esto, en un celular lento
 * algunas páginas tardaban segundos en reaccionar y parecía trabado (y se
 * volvía a tocar, o se refrescaba).
 */
export default function NavProgress() {
  const path = usePathname();
  const sp = useSearchParams();
  const [on, setOn] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith("/admin")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setOn(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Llegó la página nueva (o se canceló): se apaga. Por las dudas, nunca más de 20 s.
  useEffect(() => { setOn(false); }, [path, sp]);
  useEffect(() => {
    const main = document.querySelector(".ad-main");
    main?.toggleAttribute("data-nav", on);
    if (!on) return;
    const t = setTimeout(() => setOn(false), 20_000);
    return () => { clearTimeout(t); main?.removeAttribute("data-nav"); };
  }, [on]);

  if (!on) return null;
  return <div className="ad-navbar" role="progressbar" aria-label="Cargando la página" />;
}
