import Link from "next/link";
import { scopeFor } from "@/lib/admin/offers";
import ConfigTabs from "@/components/admin/config/ConfigTabs";
import { IX } from "@/components/admin/icons";
import { Pv } from "@/components/admin/Priv";
import { storeAlias } from "@/lib/admin/privacy";

/**
 * Configuración a pantalla completa, como en Winnerfy: el menú del panel se
 * esconde (admin.css, .ad:has(.cfg)) y quedan las pestañas a la izquierda.
 * Es de la tienda de la oferta (la cuenta de Stripe, los pixels, el dominio).
 */
export default async function ConfigLayout({ children, params }: { children: React.ReactNode; params: Promise<{ offer: string }> }) {
  const sc = await scopeFor((await params).offer);
  return (
    <div className="cfg">
      <header className="cfg-top">
        <div style={{ minWidth: 0 }}>
          <h1>Configuración</h1>
          <p>De la tienda <b><Pv as={storeAlias(sc.store.id)}>{sc.store.display_name || sc.store.name}</Pv></b>, donde cobra <b><Pv as={sc.offer.alias}>{sc.offer.name}</Pv></b>.</p>
        </div>
        <Link href={sc.base} className="cfg-x" aria-label="Cerrar configuración"><IX size={18} /></Link>
      </header>
      <div className="cfg-wrap">
        <ConfigTabs base={`${sc.base}/configuracion`} />
        <div className="cfg-main">{children}</div>
      </div>
    </div>
  );
}
