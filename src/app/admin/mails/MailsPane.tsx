"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

/**
 * Respuesta al instante (en un celular lento el servidor tarda 1–2 s): al
 * tocar un mail aparece su lugar en gris sin esperar; al tocar una pestaña,
 * «Ver más» o «Lista», la lista vuelve o se atenúa enseguida. Los links llevan
 * data-mail="open" (abre un mail) o data-mail="list" (cambia la lista) y
 * scroll={false}: en el celular el mail queda arriba de la pantalla (antes
 * Next subía al encabezado y el mail abierto quedaba abajo, fuera de la vista).
 */
export default function MailsPane({ head, list, detail, hasDetail }: { head: ReactNode; list: ReactNode; detail: ReactNode; hasDetail: boolean }) {
  const key = useSearchParams().toString();
  const [nav, setNav] = useState<null | "open" | "list">(null);
  const top = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  // Llegó la página nueva: se apaga. Por las dudas (navegación cancelada), nunca más de 20 s.
  useEffect(() => setNav(null), [key]);
  useEffect(() => {
    if (!nav) return;
    const t = setTimeout(() => setNav(null), 20_000);
    return () => clearTimeout(t);
  }, [nav]);
  // Un mail abierto (tocado acá, o desde un aviso o una notificación): en el celular, a la vista.
  // Al volver a la lista: las pestañas arriba (Next arma la página de nuevo y quedaba en el encabezado).
  // Antes de pintar, para que no se vea un salto.
  useLayoutEffect(() => {
    if (!mobile()) return;
    const el = !hasDetail && nav !== "open" && Date.now() - backAt < 20_000 ? top.current
      : nav === "open" || (hasDetail && !nav) ? side.current : null;
    if (!el) return;
    // Llegó la lista: queda con las pestañas arriba. Otra vez en el cuadro siguiente: Next a veces
    // sube la página al llegar (aunque el link diga scroll={false}) y se vería un salto.
    if (el === top.current && nav === null) backAt = 0;
    el.scrollIntoView({ block: "start" });
    const r = requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(r);
  }, [nav, hasDetail, key]);

  const showDetail = nav === "open" || (hasDetail && nav !== "list");

  // En captura: el Link de Next corta el evento antes de que suba.
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-mail]");
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname && url.search === location.search) return;
    const open = a.dataset.mail === "open";
    // «Lista» desde un mail: vuelven las pestañas y la lista a la vista.
    if (!open && showDetail && mobile()) { top.current?.scrollIntoView({ block: "start" }); backAt = Date.now(); }
    setNav(open ? "open" : "list");
  };

  return (
    <div ref={top} onClickCapture={onClick} style={{ scrollMarginTop: 68 }}>
      {head}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
        <div className={showDetail ? "hide-m" : ""} style={nav === "list" ? { opacity: 0.55, transition: "opacity .15s" } : undefined}>{list}</div>
        {/* Alto mínimo en el celular: si el mail todavía está llegando, igual se puede subir hasta arriba. */}
        <div ref={side} className={showDetail ? "max-lg:min-h-[calc(100dvh-80px)]" : "hide-m"} style={{ scrollMarginTop: 68 }}>{nav === "open" ? <DetailSkeleton /> : detail}</div>
      </div>
    </div>
  );
}

const mobile = () => window.matchMedia("(max-width: 1023px)").matches;
/** Cuándo se tocó «Lista» desde un mail (sobrevive si Next vuelve a montar la página). */
let backAt = 0;

/** El lugar de un mail mientras llega (también el fallback del servidor). */
export function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Abriendo el mail">
      <div className="ad-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <span className="sk" style={{ width: "70%", height: 18 }} />
        <span className="sk" style={{ width: "45%", height: 12 }} />
        <span className="sk" style={{ width: "100%", height: 200, borderRadius: 12 }} />
      </div>
      <div className="ad-card" style={{ padding: 20, display: "grid", gap: 10 }}>
        <span className="sk" style={{ width: "35%", height: 14 }} />
        <span className="sk" style={{ width: "90%", height: 12 }} />
        <span className="sk" style={{ width: "75%", height: 12 }} />
      </div>
    </div>
  );
}
