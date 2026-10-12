import { Activity } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { liveSnapshot } from "@/lib/live";
import Live from "./Live";

export const dynamic = "force-dynamic";

/** Quién está ahora en cada landing, checkout, post-pago y gracias (site_events). */
export default async function EnVivo() {
  // La primera foto viene con la página; después la pide el navegador cada 5 s.
  const initial = await liveSnapshot({ full: true }).catch(() => null);
  return (
    <Shell>
      <PageHead
        title="En vivo"
        icon={<Activity className="h-[18px] w-[18px]" />}
        color="#10b981"
        sub="Quién está ahora mismo en cada landing, checkout, post-pago y gracias: de dónde es, con qué equipo, de qué anuncio vino y qué hizo. Se actualiza cada 5 segundos."
      />
      <Live initial={initial} />
    </Shell>
  );
}
