import { Repeat } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, PageHead } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { resumen, suscripcionDe, todos, type Suscriptor } from "@/lib/suscripcion";

export const dynamic = "force-dynamic";

/**
 * Suscripciones.
 *
 * Lo que esta pagina tiene que contestar de un vistazo, en este orden:
 *   1. cuanto entra por mes (MRR) -- el unico numero que dice si esto funciona
 *   2. a quien se le cayo la tarjeta -- plata que todavia se puede salvar
 *   3. quien se fue y cuando -- la retencion, que es el otro numero que importa
 *
 * El MRR cuenta solo a los que estan al dia. La mora NO suma: es justamente
 * plata que no entro, y sumarla seria mirar un numero inventado.
 */

const COLORES: Record<string, { fondo: string; texto: string; nombre: string }> = {
  active:   { fondo: "bg-emerald-500/15", texto: "text-emerald-600 dark:text-emerald-400", nombre: "Al día" },
  past_due: { fondo: "bg-amber-500/15",   texto: "text-amber-600 dark:text-amber-400",     nombre: "Tarjeta rechazada" },
  canceled: { fondo: "bg-zinc-500/15",    texto: "text-zinc-500",                          nombre: "Dado de baja" },
  expired:  { fondo: "bg-red-500/15",     texto: "text-red-600 dark:text-red-400",         nombre: "Terminada" },
};

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "short", year: "2-digit" }) : "—";

const plata = (n: number) => `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function Numero({ label, valor, nota, tono }: { label: string; valor: string; nota?: string; tono?: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-1 text-[26px] font-bold leading-none ${tono ?? "text-zinc-900 dark:text-white"}`}>{valor}</p>
      {nota && <p className="mt-1.5 text-[11.5px] text-zinc-500">{nota}</p>}
    </div>
  );
}

export default async function Suscripciones() {
  const { data: tiendas } = await db.from("stores").select("id,slug,name,display_name").order("slug");
  const lista = (tiendas ?? []) as { id: string; slug: string; name: string; display_name: string | null }[];

  const porTienda = await Promise.all(lista.map(async (t) => ({
    tienda: t,
    producto: await suscripcionDe(t.id),
    r: await resumen(t.id),
    subs: await todos(t.id),
  })));
  const conSuscripcion = porTienda.filter((x) => x.producto || x.subs.length);

  return (
    <Shell>
      <PageHead title="Suscripciones" icon={<Repeat className="h-[18px] w-[18px]" />} color="#8a6f2e"
        sub="El cobro que se repite todos los meses. El MRR cuenta solo a los que están al día: la mora no suma, porque es plata que todavía no entró." />

      {!conSuscripcion.length && (
        <Card title="Todavía no hay ninguna suscripción"
          sub="El cobro recurrente está construido y probado. Falta crear el plan en Whop con su precio y marcar el producto como suscripción.">
          <p className="text-[12.5px] leading-relaxed text-zinc-500">
            Desde la terminal del proyecto:{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] dark:bg-white/10">python3 plan-suscripcion.py --precio 19 --fundador 9 --crear</code>
            {" "}crea los dos planes (el normal y el de fundador), los enlaza al producto y
            fija la fecha de corte de fundador en ese momento.
          </p>
        </Card>
      )}

      {conSuscripcion.map(({ tienda, producto, r, subs }) => {
        const mora = subs.filter((s) => s.status === "past_due");
        return (
          <div key={tienda.id} className="mb-6 grid gap-4">
            <Card
              title={producto ? (producto.short_name || producto.name) : (tienda.display_name || tienda.name)}
              sub={producto
                ? <>{tienda.display_name || tienda.name} · cada {producto.billing_period_days ?? 30} días · {producto.whop_plan_id ? "plan en Whop conectado" : "SIN plan en Whop: todavía no puede cobrar"}{producto.founder_cutoff ? ` · fundadores: compras anteriores al ${fecha(producto.founder_cutoff)}` : " · sin fecha de corte de fundador"}</>
                : <>{tienda.display_name || tienda.name} · hay suscriptores pero ningún producto marcado como suscripción</>}>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Numero label="MRR" valor={plata(r.mrr)} nota="por mes, de los que están al día" tono="text-emerald-600 dark:text-emerald-400" />
                <Numero label="Al día" valor={String(r.activos)} nota={r.fundadores ? `${r.fundadores} fundadores` : undefined} />
                <Numero label="Tarjeta rechazada" valor={String(r.mora)} nota={r.mora ? "conservan el acceso" : "ninguna"} tono={r.mora ? "text-amber-600 dark:text-amber-400" : undefined} />
                <Numero label="Dados de baja" valor={String(r.bajas + r.idos)} nota={r.bajas ? `${r.bajas} con acceso hasta fin de período` : undefined} />
                <Numero label="Cobrado en total" valor={plata(r.cobrado)} nota={`${r.total} ${r.total === 1 ? "suscripción" : "suscripciones"} en la historia`} />
              </div>
            </Card>

            {mora.length > 0 && (
              <Card title={`${mora.length} ${mora.length === 1 ? "tarjeta rechazada" : "tarjetas rechazadas"}`}
                sub="Conservan el acceso mientras Whop reintenta. Se les avisó por mail; el corte llega a los 14 días del primer rechazo.">
                <div className="grid gap-1.5">
                  {mora.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[12.5px]">
                      <span className="font-semibold">{s.email}</span>
                      <span className="text-zinc-500">{s.failed_count} {s.failed_count === 1 ? "intento" : "intentos"}</span>
                      <span className="ml-auto text-zinc-500">desde {fecha(s.started_at)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {subs.length > 0 && (
              <Card title="Todos los suscriptores" sub={`${subs.length} en total, del más nuevo al más viejo.`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:border-white/[0.06]">
                        <th className="pb-2 pr-3">Suscriptor</th>
                        <th className="pb-2 pr-3">Estado</th>
                        <th className="pb-2 pr-3">Precio</th>
                        <th className="pb-2 pr-3 text-right">Pagos</th>
                        <th className="pb-2 pr-3 text-right">Cobrado</th>
                        <th className="pb-2 pr-3">Desde</th>
                        <th className="pb-2">Renueva</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((s) => {
                        const c = COLORES[s.status] ?? COLORES.expired;
                        return (
                          <tr key={s.id} className="border-b border-zinc-50 last:border-0 dark:border-white/[0.03]">
                            <td className="py-2 pr-3">
                              <span className="font-semibold">{s.email}</span>
                              {s.founder && <span className="ml-2 rounded-full bg-[#8a6f2e]/15 px-2 py-0.5 text-[10.5px] font-bold text-[#8a6f2e]">fundador</span>}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.fondo} ${c.texto}`}>{c.nombre}</span>
                            </td>
                            <td className="py-2 pr-3 text-zinc-500">{s.amount == null ? "—" : plata(Number(s.amount))}</td>
                            <td className="py-2 pr-3 text-right font-semibold">{s.payments_count}</td>
                            <td className="py-2 pr-3 text-right">{plata(Number(s.paid_total) || 0)}</td>
                            <td className="py-2 pr-3 text-zinc-500">{fecha(s.started_at)}</td>
                            <td className="py-2 text-zinc-500">{fecha(s.current_period_end)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Ultimos storeId={tienda.id} subs={subs} />
          </div>
        );
      })}
    </Shell>
  );
}

/** Lo ultimo que paso: renovaciones, rechazos y bajas, en orden. */
async function Ultimos({ storeId, subs }: { storeId: string; subs: Suscriptor[] }) {
  if (!subs.length) return null;
  const { data } = await db
    .from("subscription_events")
    .select("kind,email,amount,detail,at")
    .eq("store_id", storeId).order("at", { ascending: false }).limit(25);
  const evs = (data ?? []) as { kind: string; email: string | null; amount: number | null; detail: string | null; at: string }[];
  if (!evs.length) return null;

  const NOMBRE: Record<string, string> = {
    created: "Alta", renewed: "Renovación", payment_failed: "Tarjeta rechazada",
    past_due: "Pasó a mora", recovered: "Se recuperó", canceled: "Baja",
    reactivated: "Volvió", expired: "Terminó", dunning_mail: "Aviso por mail",
    access_revoked: "Acceso cortado", desconocido: "Para revisar",
  };
  const cuando = (s: string) =>
    new Date(s).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Card title="Lo último que pasó" sub="Cada renovación, rechazo y baja, con su motivo.">
      <div className="grid gap-1">
        {evs.map((e, i) => (
          <div key={i} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-zinc-50 py-1.5 text-[12.5px] last:border-0 dark:border-white/[0.03]">
            <span className="w-[112px] shrink-0 text-[11.5px] text-zinc-400">{cuando(e.at)}</span>
            <span className={`font-semibold ${e.kind === "payment_failed" || e.kind === "access_revoked" || e.kind === "desconocido" ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {NOMBRE[e.kind] ?? e.kind}
            </span>
            {e.amount != null && <span className="text-zinc-500">{plata(Number(e.amount))}</span>}
            <span className="min-w-0 truncate text-zinc-500">{e.email}</span>
            {e.detail && <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-400">{e.detail}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
