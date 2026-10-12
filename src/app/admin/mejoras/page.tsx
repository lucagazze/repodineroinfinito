import Shell from "@/components/admin/Shell";
import MejorasView from "@/components/admin/MejorasView";

export const dynamic = "force-dynamic";

/** «Mejoras» de todas las ofertas y la cuenta de anuncios (?o=tienda~oferta o ?o=cuenta para filtrar). */
export default async function Mejoras({ searchParams }: { searchParams: Promise<{ o?: string; estado?: string }> }) {
  const sp = await searchParams;
  const estado = sp.estado === "hechas" || sp.estado === "descartadas" ? sp.estado : "nuevas";
  const o = sp.o && /^[a-z0-9-]+~[a-z0-9-]+$|^cuenta$/.test(sp.o) ? sp.o : null;
  return (
    <Shell>
      <MejorasView offerKey={o} scoped={false} estado={estado} base="/admin/mejoras" />
    </Shell>
  );
}
