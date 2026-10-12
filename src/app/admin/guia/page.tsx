import { BookOpen } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { GUIDE } from "@/lib/guia";
import GuideView from "./GuideView";
import CopyPrompt from "./CopyPrompt";

/**
 * Centro de información de la app: qué es cada sección, cómo se carga cada cosa y
 * sus reglas. La misma guía la lee una IA por MCP (get_guide). Fuente: docs/guia.md.
 */
export default function Guia() {
  return (
    <Shell>
      <PageHead
        title="Guía de la app"
        icon={<BookOpen className="h-[18px] w-[18px]" />}
        color="#6d35e8"
        sub="Todo lo que hay que saber para usar y cargar la app: cada sección, cómo subir una oferta, el Drive, el contenido pendiente, el post-pago y los anuncios. Una IA conectada por MCP la lee con get_guide."
      />
      <CopyPrompt />
      <GuideView sections={GUIDE} />
    </Shell>
  );
}
