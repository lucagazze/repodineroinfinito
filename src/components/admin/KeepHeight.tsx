"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Mientras un bloque muestra su esqueleto (al cambiar el período), conserva
 * la altura que tenía: si se achicara, el navegador movería el scroll y la
 * página «saltaría». Se traba apenas se elige el período nuevo (el selector
 * marca .ad-main con data-range-loading) y se suelta cuando llegan los datos.
 * Los esqueletos van envueltos en un elemento con data-skeleton.
 */
export default function KeepHeight({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const main = el?.closest(".ad-main");
    if (!el || !main) return;
    const loading = () => !!el.querySelector("[data-skeleton]");
    const release = () => { if (!main.hasAttribute("data-range-loading") && !loading()) el.style.minHeight = ""; };
    const mo = new MutationObserver(() => {
      if (main.hasAttribute("data-range-loading")) {
        if (!el.style.minHeight) el.style.minHeight = `${el.getBoundingClientRect().height}px`;
      } else release();
    });
    mo.observe(main, { attributes: true, attributeFilter: ["data-range-loading"] });
    // Llegó el contenido (aunque el alto no cambie): se suelta.
    const content = new MutationObserver(release);
    content.observe(el, { childList: true, subtree: true });
    return () => { mo.disconnect(); content.disconnect(); };
  }, []);
  return <div ref={box}>{children}</div>;
}
