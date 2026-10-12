import Link from "next/link";
import { after } from "next/server";
import { catalogFixPrompt, readCatalogStatus, runCatalogStatus } from "@/lib/admin/catalog-status";
import { CopyPrompt } from "./BooksToWriteClient";
import { CopyText, RecheckNow } from "./CatalogStripeClient";

/**
 * Catálogos y Stripe en el Inicio. Muestra lo último revisado al instante y,
 * si tiene más de 2 minutos, lo vuelve a revisar en segundo plano (la próxima vez que entres ya está nuevo).
 * Lo que hay que cambiar a mano en Stripe sale con el texto exacto para copiar.
 */
export default async function CatalogStripeCard() {
  const st = await readCatalogStatus().catch(() => null);
  if (!st || Date.now() - st.at > 2 * 60_000) after(() => runCatalogStatus().then(() => undefined).catch(() => undefined));
  const mins = st ? Math.max(0, Math.round((Date.now() - st.at) / 60_000)) : null;
  const when = mins == null ? "revisando por primera vez…" : mins < 1 ? "revisado recién" : mins < 60 ? `revisado hace ${mins} min` : `revisado hace ${Math.round(mins / 60)} h`;
  const stores = st?.stores ?? [];
  const allOk = stores.length > 0 && stores.every((s) => !s.catalogProblems.length && s.stripeOk);
  if (allOk) {
    return (
      <section className="rounded-2xl border border-emerald-300/60 bg-emerald-50/40 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/[0.05]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-bold text-zinc-900 dark:text-white">✅ Catálogos y Stripe</h3>
          <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">todo en regla</span>
        </div>
        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">{stores.map((s) => s.name).join(" · ")} · {when}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
          <RecheckNow />
          <Link href="/admin/catalogos" className="font-semibold text-violet-600 hover:underline dark:text-violet-300">Ver detalle →</Link>
        </div>
      </section>
    );
  }
  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${allOk ? "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/25 dark:bg-emerald-500/[0.05]" : "border-red-300/60 bg-red-50/40 dark:border-red-500/25 dark:bg-red-500/[0.05]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-zinc-900 dark:text-white">
          {allOk ? "✅" : "⚠️"} Catálogos y Stripe {allOk ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">· todo en regla</span> : stores.length ? <span className="font-semibold text-red-600 dark:text-red-300">· hay cosas para hacer</span> : null}
        </h3>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-zinc-500 dark:text-zinc-400">{when}</span>
          <RecheckNow />
          <Link href="/admin/catalogos" className="font-semibold text-violet-600 hover:underline dark:text-violet-300">Ver detalle →</Link>
        </div>
      </div>
      {st && catalogFixPrompt(st) && (
        <div className="mt-2"><CopyPrompt strong text={catalogFixPrompt(st)!} label="Copiar prompt para arreglarlo (pegalo en cualquier IA)" /></div>
      )}
      <ul className="mt-2.5 grid gap-2">
        {stores.map((s) => {
          const ok = !s.catalogProblems.length && s.stripeOk;
          return (
            <li key={s.slug} className="rounded-xl bg-white/80 px-3 py-2.5 text-[12.5px] dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <b className="text-zinc-900 dark:text-white">{s.name}</b>
                {s.url && <a className="text-zinc-500 hover:underline dark:text-zinc-400" href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https:\/\//, "").replace(/\/$/, "")}</a>}
                <span className={`ml-auto font-semibold ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {s.catalogProblems.length ? `Catálogo: ${s.catalogProblems.length} para arreglar` : "Catálogo ✓"} · {s.stripeOk ? "Stripe ✓" : `Stripe: ${s.stripeTasks.length} cambio${s.stripeTasks.length === 1 ? "" : "s"} a mano`}
                </span>
              </div>
              {s.catalogProblems.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-red-600 dark:text-red-400">{s.catalogProblems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              {s.stripeTasks.length > 0 && (
                <div className="mt-2 grid gap-1.5">
                  <p className="text-[12px] text-zinc-600 dark:text-zinc-300">
                    Cambialo a mano en Stripe (cuenta {s.account ?? "—"}): <a className="font-semibold text-violet-600 hover:underline dark:text-violet-300" href={`https://dashboard.stripe.com/${s.account ? `${s.account}/` : ""}settings`} target="_blank" rel="noreferrer">abrir la configuración de Stripe →</a> «Empresa» (datos públicos y detalles de la empresa).
                  </p>
                  {s.stripeTasks.map((t) => (
                    <div key={t.label} className={`rounded-lg border px-2.5 py-2 ${t.severity === "error" ? "border-red-300/70 dark:border-red-500/30" : "border-amber-300/70 dark:border-amber-500/30"}`}>
                      <p className="font-semibold text-zinc-900 dark:text-white">{t.severity === "error" ? "🔴" : "🟠"} {t.label}</p>
                      <p className="text-zinc-600 dark:text-zinc-300">{t.detail}</p>
                      {t.current !== undefined && (
                        <div className="mt-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Hoy en Stripe dice</p>
                          <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-red-50 p-2 font-sans text-[11.5px] leading-snug text-zinc-700 dark:bg-red-500/[0.07] dark:text-zinc-200">{t.current || "(vacío)"}</pre>
                        </div>
                      )}
                      {t.diff && t.diff.length > 0 && (
                        <ul className="mt-1.5 grid gap-0.5 text-[11.5px]">
                          {t.diff.map((d, i) => (
                            <li key={i}><s className="text-red-600 dark:text-red-400">{d.have || "—"}</s> → <b className="text-emerald-700 dark:text-emerald-400">{d.want || "(sacar)"}</b></li>
                          ))}
                        </ul>
                      )}
                      {t.copy && <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Tiene que decir</p>}
                      {t.copy && <CopyText text={t.copy} />}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {!stores.length && <li className="text-[12.5px] text-zinc-500">Revisando los catálogos y las cuentas de Stripe… aparece acá en un minuto.</li>}
      </ul>
    </section>
  );
}
