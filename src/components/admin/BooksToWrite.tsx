import Link from "next/link";
import { bookDoneAlertOn, presaleBoardCached, dueText } from "@/lib/admin/presale";
import { AlertToggle, BookDone, CopyPrompt, NotifyAll, ScanNow } from "./BooksToWriteClient";
import { bookPrompts } from "@/lib/admin/book-prompts";

/**
 * Libros para escribir. Los de «Contenido pendiente» que ya tienen compradores
 * esperando, del que vence primero al último; los que ya se subieron, como hechos, con «Ver cómo quedó» y «Avisar»;
 * y los avisados en las últimas 48 h, para poder abrirlos. No aparece si no hay nada.
 * El nombre del libro va siempre a la vista.
 */
export default async function BooksToWrite() {
  const [rows, alertOn] = await Promise.all([presaleBoardCached().catch(() => []), bookDoneAlertOn().catch(() => true)]);
  const write = rows.filter((r) => (r.state === "atrasado" || r.state === "vence_pronto" || r.state === "a_tiempo") && r.orders.length > 0);
  const notify = rows.filter((r) => r.state === "listo_sin_avisar");
  const since = Date.now() - 48 * 3600_000;
  // Las variantes (mitad de precio, packs de 2/3) comparten carpeta: un libro, una fila.
  const seen = new Set<string>();
  const recent = rows.filter((r) => {
    if (r.state !== "entregado" || !r.readyFiles.length || !(Date.parse(r.noticedAt ?? r.readyAt ?? "") > since)) return false;
    const k = r.readyFiles.map((f) => f.id).sort().join();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  // Solo cuando hay algo que hacer: libros por escribir o hechos sin avisar.
  if (!write.length && !notify.length) return null;
  // Prompts para la IA: uno por libro y uno para hacerlos todos con un agente por libro.
  const prompts = await bookPrompts(write, (r) => `vence ${dueText(r)}`).catch(() => ({ one: {} as Record<string, string>, all: null }));
  const tone = (s: string) => (s === "atrasado" ? "text-red-600 dark:text-red-400" : s === "vence_pronto" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400");
  const offerOf = (r: (typeof rows)[number]) => r.offers.map((o) => o.name).join(", ") || r.storeName;
  return (
    <section className="rounded-2xl border border-amber-300/60 bg-amber-50/50 p-4 sm:p-5 dark:border-amber-500/25 dark:bg-amber-500/[0.05]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-zinc-900 dark:text-white" title="Vendidos en preventa, con compradores esperando. Copiá el prompt y pegalo en Claude: lo escribe y lo sube a su carpeta.">
          📝 Libros para escribir · {write.length}{notify.length > 0 && <span className="font-semibold text-violet-600 dark:text-violet-300"> · {notify.length} hechos, falta avisar</span>}
        </h3>
        <Link href="/admin/preventas" className="shrink-0 text-[12px] font-semibold text-violet-600 hover:underline dark:text-violet-300">Ver todo →</Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <NotifyAll books={notify.filter((r) => !r.leftoverNotices.length && r.pendingNotice > 0).map((r) => ({ id: r.id, name: r.name, pending: r.pendingNotice }))} />
        {write.length > 0 && <CopyPrompt strong text={prompts.all ?? Object.values(prompts.one)[0] ?? ""} label={write.length > 1 ? `Prompt: hacer los ${write.length} (un agente por libro)` : "Prompt para hacer este libro"} />}
        <ScanNow />
        <AlertToggle on={alertOn} />
      </div>
      <ul className="mt-2.5 grid gap-1.5">
        {notify.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-violet-300/50 bg-white/80 px-3 py-2 text-[12.5px] dark:border-violet-400/20 dark:bg-white/[0.04]">
            <span className="font-bold text-emerald-600 dark:text-emerald-400">✓ hecho</span>
            <b className="text-zinc-900 dark:text-white">{r.name}</b>
            <span className="text-zinc-500 dark:text-zinc-400">{offerOf(r)}</span>
            <BookDone id={r.id} name={r.name} files={r.readyFiles} pending={r.leftoverNotices.length ? 0 : r.pendingNotice} />
            {r.leftoverNotices.length > 0 && (
              <span className="w-full text-[12px] font-semibold text-red-600 dark:text-red-400">
                🧹 Antes de avisar, borrá de la carpeta el aviso de preventa: {r.leftoverNotices.map((n) => (
                  <a key={n.id} href={`https://drive.google.com/file/d/${n.id}/view`} target="_blank" rel="noreferrer" className="underline">«{n.title}» </a>
                ))}
              </span>
            )}
          </li>
        ))}
        {write.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-white/80 px-3 py-2 text-[12.5px] dark:bg-white/[0.04]">
            <b className="text-zinc-900 dark:text-white">{r.name}</b>
            <span className="text-zinc-500 dark:text-zinc-400">{offerOf(r)}</span>
            <span className="text-zinc-600 dark:text-zinc-300">{r.orders.length} {r.orders.length === 1 ? "comprador" : "compradores"}</span>
            {r.plannedPages ? <span className="text-zinc-500 dark:text-zinc-400">{r.plannedPages} pág.</span> : null}
            <span className={`ml-auto font-bold ${tone(r.state)}`}>{dueText(r)}</span>
            {prompts.one[r.id] && write.length > 1 && <span className="w-full"><CopyPrompt text={prompts.one[r.id]} label="Prompt de este libro" /></span>}
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <details className="mt-2 text-[12.5px]">
          <summary className="cursor-pointer font-semibold text-emerald-700 dark:text-emerald-400">✓ Terminados y avisados en las últimas 48 h · {recent.length} (ver cómo quedaron)</summary>
          <ul className="mt-1.5 grid gap-1.5">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/60 px-3 py-2 dark:bg-white/[0.03]">
                <b className="text-zinc-900 dark:text-white">{r.name}</b>
                <span className="text-zinc-500 dark:text-zinc-400">{offerOf(r)}</span>
                <BookDone id={r.id} name={r.name} files={r.readyFiles} pending={0} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
