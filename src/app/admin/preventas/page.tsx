import { Package } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, EmptyState, PageHead } from "@/components/admin/ui";
import { presaleBoard } from "@/lib/admin/presale";
import PresaleList from "./PresaleList";

export const dynamic = "force-dynamic";

/**
 * Preventas: lo que ya se vende y todavía hay que escribir. Arriba lo que vence
 * primero; cada libro dice a cuántos compradores se les debe y para cuándo.
 */
export default async function Preventas() {
  const rows = await presaleBoard();
  // Pendientes arriba; lo que ya está hecho y avisado, aparte (deja de ser tarea).
  const pending = rows.filter((r) => r.state !== "entregado");
  const done = rows.filter((r) => r.state === "entregado");
  const owed = pending.filter((r) => r.state !== "sin_ventas" && r.state !== "listo_sin_avisar");
  return (
    <Shell>
      <PageHead
        title="Contenido pendiente"
        icon={<Package className="h-[18px] w-[18px]" />}
        color="#f59e0b"
        sub="Lo que ya se vende y todavía no tiene el contenido en su carpeta. Acá ves qué falta hacer, para cuándo (la primera compra + los días prometidos) y a cuántos compradores se lo debés. El comprador ve «te llega en N días»."
      />
      {rows.length ? (
        <>
          <Card title={owed.length ? `${owed.length} por escribir con compradores esperando` : pending.length ? "Nada vencido" : "No falta ningún contenido"} pad={false}>
            <PresaleList rows={pending} />
          </Card>
          {done.length > 0 && (
            <div className="mt-4">
              <Card title={`✅ Listos y avisados · ${done.length}`} sub="Hechos (el PDF del libro está verificado en su carpeta) y avisados a todos los que lo esperaban. Últimos 30 días." pad={false}>
                <PresaleList rows={done} done />
              </Card>
            </div>
          )}
        </>
      ) : (
        <EmptyState icon={<Package className="h-5 w-5" />} title="No falta ningún contenido">
          Cuando vendas algo que todavía no está hecho, pedile a Claude que lo marque como contenido pendiente con los días prometidos (por ejemplo, 3).
        </EmptyState>
      )}
    </Shell>
  );
}
