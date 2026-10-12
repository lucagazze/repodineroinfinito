import type { ReactNode } from "react";
import type { Flow, FlowNode } from "@/lib/admin/postcompra-flow";

/**
 * Diagrama del post-pago de un checkout, para leerlo sin saber nada técnico:
 * Compra → OTO 1 → OTO 2 → OTO 3 → Gracias, una columna por escalón (en el
 * teléfono, una debajo de la otra). Cada oferta dice qué trae, cuánto sale,
 * cuántos la compran y a dónde lleva «Compra» y «No, gracias». Las ramas
 * dicen en palabras a quién le toca cada una. Solo CSS.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Thumb({ src, dashed }: { src: string | null; dashed?: boolean }) {
  if (dashed || !src) return <span className="h-16 w-12 flex-none rounded-md border border-dashed border-zinc-300 bg-zinc-50 dark:border-white/15 dark:bg-white/5" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className="h-16 w-12 flex-none rounded-md object-cover shadow-sm ring-1 ring-black/5" />;
}

function Tag({ tone, children }: { tone: "violet" | "amber" | "blue" | "green" | "zinc"; children: ReactNode }) {
  const t = {
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    zinc: "bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${t}`}>{children}</span>;
}

function Route({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 items-start gap-1.5 rounded-lg px-2 py-1 text-[11.5px] leading-snug ${ok
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400"}`}>
      <b className="flex-none whitespace-nowrap font-black">{ok ? "Compra →" : "No, gracias →"}</b>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function OfferCard({ n }: { n: FlowNode }) {
  const ds = n.kind === "downsell";
  if (n.placeholder) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-zinc-300 p-3 dark:border-white/15">
        <div className="flex items-center gap-3">
          <Thumb src={null} dashed />
          <div className="min-w-0">
            <Tag tone="zinc">Próximamente</Tag>
            <div className="mt-1 text-[13.5px] font-bold text-zinc-700 dark:text-zinc-300">Libros nuevos</div>
            <div className="text-[12px] text-zinc-500 dark:text-zinc-400">{n.product.name}</div>
          </div>
        </div>
        <p className="mb-0 mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">Todavía no se ofrece: el comprador pasa directo al siguiente escalón.</p>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border bg-white p-3 shadow-sm dark:bg-zinc-900 ${ds ? "border-amber-200 dark:border-amber-500/25" : "border-zinc-200 dark:border-white/10"} ${n.reachable ? "" : "opacity-50"}`}>
      <div className="flex gap-3">
        <Thumb src={n.product.image} />
        <div className="min-w-0 flex-1">
          <Tag tone={ds ? "amber" : "violet"}>{ds ? "Si dice que no" : n.label}</Tag>
          <div className="mt-1 text-[13.5px] font-bold leading-tight text-zinc-900 dark:text-zinc-100">{n.product.name}</div>
          <div className="mt-0.5 text-[12.5px] font-bold text-zinc-800 dark:text-zinc-200">
            {n.compare && <s className="mr-1 font-medium text-zinc-400">{n.compare}</s>}
            {n.price ?? <span className="font-medium text-zinc-400">sin precio en esta moneda</span>}
          </div>
        </div>
      </div>
      {n.inside && <p className="mb-0 mt-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{n.inside}</p>}
      <div className="mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">
        {n.stats.views
          ? <>La compra el <b className="text-zinc-800 dark:text-zinc-200">{pct(n.stats.rate ?? 0)}</b> ({n.stats.accepts} de {n.stats.views})</>
          : "Todavía sin datos de compra"}
      </div>
      {!n.reachable && <div className="mt-1 text-[11.5px] font-semibold text-zinc-500">Hoy ningún comprador llega acá.</div>}
      <div className="mt-2 grid gap-1">
        <Route ok>{n.acceptTo}</Route>
        <Route ok={false}>{n.declineTo}</Route>
      </div>
      <div className="mt-2 flex gap-1.5">
        <a className="ad-btn sm flex-1" href={n.previewUrl} target="_blank" rel="noreferrer">Ver página</a>
        <a className="ad-btn sm flex-1" href={n.simUrl} target="_blank" rel="noreferrer">Simular desde acá</a>
      </div>
    </div>
  );
}

function Column({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex w-full flex-none flex-col gap-2 lg:w-[272px]">
      <div className="text-[11px] font-semibold text-zinc-400">{title}</div>
      {children}
    </section>
  );
}

function Arrow() {
  return (
    <div aria-hidden className="flex flex-none items-center justify-center text-xl text-zinc-300 dark:text-zinc-600 lg:pt-8">
      <span className="lg:hidden">↓</span><span className="hidden lg:inline">→</span>
    </div>
  );
}

export function PostcompraFlow({ flow }: { flow: Flow }) {
  const { checkout: c, levels, summary } = flow;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-zinc-50 px-3 py-2 text-[13px] text-zinc-700 dark:bg-white/[0.03] dark:text-zinc-300">
        <span>Ticket máximo posible: <b className="text-zinc-900 dark:text-zinc-100">{summary.maxTicket ?? "—"}</b></span>
        <span className="min-w-0">Camino más común: <b className="text-zinc-900 dark:text-zinc-100">{summary.commonPath ?? "todavía sin datos (se arma con las compras reales)"}</b></span>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-3 lg:overflow-x-auto lg:pb-2">
        <Column title="Compra">
          <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex gap-3">
              <Thumb src={c.image} />
              <div className="min-w-0">
                <Tag tone="blue">Checkout</Tag>
                <div className="mt-1 text-[13.5px] font-bold leading-tight text-zinc-900 dark:text-zinc-100">{c.name}</div>
                <div className="text-[12.5px] font-bold text-zinc-800 dark:text-zinc-200">{c.price ?? "—"}</div>
              </div>
            </div>
            {c.bumps.length > 0 && <p className="mb-0 mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">En el checkout se le puede agregar: {c.bumps.join(", ")}</p>}
            <div className="mt-2 flex gap-1.5">
              <a className="ad-btn sm flex-1" href={c.url} target="_blank" rel="noreferrer">Abrir checkout</a>
              <a className="ad-btn sm flex-1" href={c.simUrl} target="_blank" rel="noreferrer">Simular todo</a>
            </div>
          </div>
        </Column>

        {levels.map((L) => (
          <div key={L.level} className="contents">
            <Arrow />
            <Column title={L.level}>
              {L.branches.map((b) => (
                <div key={b.oto.index} className="flex flex-col gap-1.5">
                  {b.condition && (
                    <div className="rounded-lg bg-sky-50 px-2 py-1 text-[11.5px] font-semibold text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">{b.condition}</div>
                  )}
                  <OfferCard n={b.oto} />
                  {b.downsells.map((d) => (
                    <div key={d.index} className="flex flex-col gap-1.5 border-l-2 border-amber-200 pl-3 dark:border-amber-500/25">
                      <div className="text-[11px] font-bold text-zinc-400">↓ si dice «No, gracias»</div>
                      <OfferCard n={d} />
                    </div>
                  ))}
                </div>
              ))}
            </Column>
          </div>
        ))}

        <Arrow />
        <Column title="Fin">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
            <Tag tone="green">Gracias</Tag>
            <div className="mt-1 text-[13.5px] font-bold text-zinc-900 dark:text-zinc-100">Página de descargas</div>
            <p className="mb-0 mt-1 text-[11.5px] text-zinc-600 dark:text-zinc-400">Todo lo que compró, con sus botones de descarga, y el mail de entrega.</p>
            <a className="ad-btn sm mt-2 w-full" href={flow.endSimUrl} target="_blank" rel="noreferrer">Ver</a>
          </div>
        </Column>
      </div>

      <p className="ad-note mt-3">
        {flow.chainName ? `Cadena «${flow.chainName}». ` : ""}Nadie ve algo que ya tiene: lo del checkout, sus bonos o lo que compró antes en esta misma cadena.
        {" "}Compras: últimos {flow.days} días, pedidos de este checkout. «Simular» no cobra ni anota nada.
      </p>
    </div>
  );
}
