import { Library } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "./ui";
import PortalLinkCopy from "./PortalLinkCopy";

/**
 * Inicio › «Portal de clientes»: el link de la biblioteca de cada tienda, para copiar y mandar.
 */
export default async function CustomerPortalCard() {
  const { data } = await db.from("stores").select("slug,name,display_name,domain,library_domain,is_test").eq("active", true).order("name");
  // Solo las tiendas con subdominio propio de biblioteca.
  const list = (data ?? []).filter((s) => !s.is_test && s.library_domain);
  if (!list.length) return null;
  return (
    <Card title={<><Library className="h-4 w-4 text-violet-500" /> Portal de clientes</>}
      sub="Pasales este link: entran con su email (sin contraseña), ven y descargan lo que compraron, sus pedidos, y compran lo que les falta.">
      <div className="grid gap-2">
        {list.map((s) => (
          <PortalLinkCopy key={s.slug as string} name={(s.display_name || s.name) as string}
            url={s.library_domain ? `https://${s.library_domain}` : `https://${s.domain}/biblioteca`} />
        ))}
      </div>
    </Card>
  );
}
