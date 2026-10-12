import type { ReactNode } from "react";
import type { Flow, FlowNode, FlowSlot } from "@/lib/admin/postcompra-flow";

/**
 * Lo que se ofrece después de pagar, en 6 tarjetas como máximo: OTO 1, OTO 2,
 * OTO 3 y el downsell de cada uno. Las variantes según lo que agregó en el
 * checkout van dentro de la tarjeta de su nivel, no como pasos aparte.
 */

function Cover({ src }: { src: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className="h-20 w-14 flex-none rounded-md object-cover shadow-sm ring-1 ring-black/5" />
    : <span className="h-20 w-14 flex-none rounded-md border border-dashed border-zinc-300 dark:border-white/15" />;
}

function Shell({ dashed, tone, children }: { dashed?: boolean; tone?: "ds"; children: ReactNode }) {
  return (
    <div className={`flex-1 rounded-2xl p-3 ${dashed
      ? "border-2 border-dashed border-zinc-300 dark:border-white/15"
      : `border bg-white shadow-sm dark:bg-zinc-900 ${tone === "ds" ? "border-amber-200 dark:border-amber-500/25" : "border-zinc-200 dark:border-white/10"}`}`}>
      {children}
    </div>
  );
}

function Product({ n, kicker }: { n: FlowNode; kicker: string }) {
  return (
    <div className="flex gap-3">
      <Cover src={n.product.image} />
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold text-zinc-400">{kicker}</div>
        <div className="text-[14px] font-bold leading-tight text-zinc-900 dark:text-zinc-100">{n.product.name}</div>
        <div className="mt-0.5 text-[13px] font-bold text-zinc-800 dark:text-zinc-200">
          {n.compare && <s className="mr-1 font-medium text-zinc-400">{n.compare}</s>}{n.price ?? "sin precio"}
        </div>
        <div className="mt-0.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
          {n.stats.views ? `La compra el ${Math.round((n.stats.rate ?? 0) * 100)}% (${n.stats.accepts} de ${n.stats.views})` : "Sin datos de compra todavía"}
        </div>
      </div>
    </div>
  );
}

function Slot({ s }: { s: FlowSlot }) {
  const otoCard = s.placeholder || !s.oto ? (
    <Shell dashed>
      <div className="text-[11.5px] font-semibold text-zinc-400">OTO {s.level}</div>
      <div className="mt-1 text-[14px] font-bold text-zinc-700 dark:text-zinc-300">{s.placeholder ? "Próximamente: libros nuevos" : "Sin oferta"}</div>
      {s.placeholder && s.oto && <div className="text-[12px] text-zinc-500 dark:text-zinc-400">{s.oto.product.name}</div>}
      <p className="mb-0 mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">Hoy no se muestra: el comprador pasa al siguiente.</p>
    </Shell>
  ) : (
    <Shell>
      <Product n={s.oto} kicker={`OTO ${s.level}`} />
      {s.oto.inside && <p className="mb-0 mt-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{s.oto.inside}</p>}
      {s.alternatives.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {s.alternatives.map((a) => <li key={a} className="rounded-lg bg-sky-50 px-2 py-1 text-[11.5px] font-semibold text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">{a}</li>)}
        </ul>
      )}
      <div className="mt-2 flex gap-1.5">
        <a className="ad-btn sm flex-1" href={s.oto.previewUrl} target="_blank" rel="noreferrer">Ver página</a>
      </div>
    </Shell>
  );
  const dsCard = s.ds ? (
    <Shell tone="ds">
      <Product n={s.ds} kicker={`Downsell ${s.level} · si dice que no`} />
      {s.dsNote && <p className="mb-0 mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{s.dsNote}</p>}
      <div className="mt-2 flex gap-1.5">
        <a className="ad-btn sm flex-1" href={s.ds.previewUrl} target="_blank" rel="noreferrer">Ver página</a>
      </div>
    </Shell>
  ) : (
    <Shell dashed>
      <div className="text-[11.5px] font-semibold text-zinc-400">Downsell {s.level}</div>
      <p className="mb-0 mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        {s.placeholder ? "Llega con los libros nuevos." : s.oto ? "Sin downsell: si dice que no, pasa al siguiente." : "—"}
      </p>
    </Shell>
  );
  return (
    <div className="flex flex-col gap-2">
      {otoCard}
      <div aria-hidden className="text-center text-[11px] font-bold text-zinc-400">↓ si dice «No, gracias»</div>
      {dsCard}
    </div>
  );
}

export function PostcompraLevels({ flow, simUrl }: { flow: Flow; simUrl: string }) {
  return (
    <div>
      {flow.paused && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <b>Cadena pausada.</b> Los compradores reales van directo a las descargas. La simulación y la compra de prueba la muestran igual, para probarla antes de prenderla.
        </div>
      )}
      {flow.problems.length > 0 && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <b>Esta cadena no cumple las reglas:</b>
          <ul className="m-0 mt-1 list-disc pl-5">{flow.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-3">
        {flow.slots.map((s) => <Slot key={s.level} s={s} />)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="ad-btn primary" href={simUrl} target="_blank" rel="noreferrer">Ver simulación</a>
        <span className="ad-note">Ticket máximo posible: <b>{flow.summary.maxTicket ?? "—"}</b></span>
      </div>
    </div>
  );
}
