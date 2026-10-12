"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";

/** La parte de la guía que explica la página donde estás. */
const MAP: [RegExp, string][] = [
  [/^\/admin$/, "panel-inicio"],
  [/^\/admin\/en-vivo/, "panel-en-vivo"],
  [/^\/admin\/metricas/, "panel-metricas"],
  [/^\/admin\/(ventas|clientes)/, "panel-ventas"],
  [/^\/admin\/carritos/, "panel-carritos"],
  [/^\/admin\/preventas/, "panel-contenido-pendiente"],
  [/^\/admin\/mejoras/, "panel-mejoras"],
  [/^\/admin\/(piloto|pujas)/, "panel-piloto"],
  [/^\/admin\/(mails|email|avisos)/, "panel-mails"],
  [/^\/admin\/o\/[^/]+\/ads/, "anuncios"],
  [/^\/admin\/o\/[^/]+\/post-compra/, "post-pago"],
  [/^\/admin\/o\/[^/]+\/(productos|embudos)/, "oferta-nueva"],
  [/^\/admin\/o\/[^/]+\/compra-prueba/, "verificar"],
  [/^\/admin\/o\/[^/]+\/(ventas|clientes)/, "panel-ventas"],
  [/^\/admin\/o\/[^/]+\/carritos/, "panel-carritos"],
  [/^\/admin\/o\/[^/]+\/mejoras/, "panel-mejoras"],
  [/^\/admin\/o\/[^/]+$/, "panel-inicio"],
  [/^\/admin\/o\//, "panel-oferta"],
];

/** «?» de la barra de arriba: abre la guía en la sección de esta página. */
export default function HelpButton({ label }: { label?: boolean }) {
  const path = usePathname();
  const id = MAP.find(([re]) => re.test(path))?.[1] ?? "empezar";
  return (
    <Link href={`/admin/guia#${id}`} title="Guía: qué es esta página y cómo se usa" aria-label="Guía de la app"
      className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white ${label ? "px-2.5 text-[11.5px] font-semibold" : "w-8"}`}>
      <CircleHelp className="h-4 w-4" />{label && "Guía"}
    </Link>
  );
}
