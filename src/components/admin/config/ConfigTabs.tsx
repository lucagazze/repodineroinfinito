"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const CONFIG_TABS = [
  { key: "general", label: "General", sub: "Datos, marca y contacto" },
  { key: "negocio", label: "Negocio y catálogo", sub: "Lo que revisa Stripe" },
  { key: "entrega", label: "Entrega", sub: "La página de gracias y el mail" },
  { key: "pagos", label: "Pagos", sub: "Tu cuenta de Stripe" },
  { key: "dominios", label: "Dominios", sub: "Tu dominio y su verificación" },
  { key: "tracking", label: "Tracking", sub: "Pixel y API de Conversiones" },
  { key: "webhooks", label: "Webhooks", sub: "Avisarle a otro sistema cada venta" },
  { key: "api", label: "Acceso API", sub: "Tokens para Claude y scripts" },
  { key: "meta", label: "Conexión con Meta", sub: "Token y límites (todas las tiendas)" },
] as const;

export default function ConfigTabs({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav className="cfg-tabs" aria-label="Secciones de configuración">
      <div>
        {CONFIG_TABS.map((t) => {
          const href = `${base}/${t.key}`;
          const on = path === href;
          return (
            <Link key={t.key} href={href} className={`ad-tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}
              ref={(el) => { if (on && el) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }}>
              <b>{t.label}</b><small>{t.sub}</small>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
