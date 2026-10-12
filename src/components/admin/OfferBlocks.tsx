import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import type { OfferFunnel, Scope } from "@/lib/admin/offers";
import type { PPLevel, SP, Structure } from "@/lib/admin/structure";
import { canFrame } from "@/lib/admin/landing";
import { checkoutUrls } from "@/lib/admin/links";
import { money } from "@/lib/admin-data";
import { Flags } from "./OfferSwitcher";
import DevicePreview from "./DevicePreview";
import { Badge, Thumb } from "./ui";
import { Pv } from "./Priv";
import { productAlias, HIDDEN } from "@/lib/admin/privacy";

/** Piezas de oferta compartidas por el Inicio, Checkouts y su detalle. */

/** «Oferta · Mercado», con el nombre de la oferta oculto en modo captura. */
export function ScopeName({ sc }: { sc: Pick<Scope, "offer" | "market"> }) {
  return <><Pv as={sc.offer.alias}>{sc.offer.name}</Pv>{sc.market ? ` · ${sc.market.market_label || sc.market.name}` : ""}</>;
}

/** Dónde se sirve el checkout: su host propio, o la dirección de la app. Solo lectura. */
export function HostChip({ f }: { f: Pick<OfferFunnel, "checkout_host" | "checkout_path"> }) {
  return f.checkout_host
    ? <span title="Host del checkout" className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-[2px] font-mono text-[10.5px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-white/5 dark:text-zinc-300"><Pv as="pay.dominio.com">{f.checkout_host}{f.checkout_path ?? ""}</Pv></span>
    : <span className="inline-flex items-center rounded-md border border-dashed border-zinc-200 px-1.5 py-[2px] text-[10.5px] font-semibold text-zinc-400 dark:border-zinc-700">Sin host propio</span>;
}

export function MarketChip({ f }: { f: Pick<OfferFunnel, "market_label" | "flags" | "name"> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-[3px] text-[10.5px] font-bold text-violet-700 dark:text-violet-300">
      <Flags codes={f.flags} size={11} />{f.market_label || "Sin mercado"}
    </span>
  );
}

const STEPS: [Exclude<keyof Structure, "main" | "levels">, string][] = [["upsells", "Upsells en el checkout"], ["bonus", "Bonos"]];

// En la moneda del mercado del checkout (euros en Italia), como la ve el comprador de ahí.
const price = (p: SP) => (Number(p.amount) > 0 ? money(p.amount, p.currency) : p.kind === "bonus" ? "gratis" : "");

/** Tapa chica de un upsell, OTO, variante o bono (la del principal es más grande); sin imagen, un libro gris. */
function Mini({ p }: { p: SP }) {
  return p.image
    // eslint-disable-next-line @next/next/no-img-element
    ? <img data-pv-img src={p.image} alt="" loading="lazy" className="h-8 w-6 shrink-0 rounded border border-zinc-100 bg-zinc-50 object-contain dark:border-white/5 dark:bg-zinc-800" />
    : <span aria-hidden className="flex h-8 w-6 shrink-0 items-center justify-center rounded border border-dashed border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"><BookOpen className="h-3 w-3" /></span>;
}

/** «+2 variantes»: chip que se abre con lo que cambia en ese nivel (si agregó X…, downsell…). */
function Variants({ l }: { l: PPLevel }) {
  if (!l.variants.length) return null;
  return (
    <details className="group relative shrink-0">
      <summary title={l.variants.map((v) => `${v.label}: ${v.p.short_name}`).join("\n")}
        className="cursor-pointer list-none rounded-full bg-zinc-100 px-1.5 py-[1px] text-[10px] font-bold text-zinc-500 hover:bg-zinc-200 dark:bg-white/[0.06] dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
        +{l.variants.length} {l.variants.length === 1 ? "variante" : "variantes"}
      </summary>
      <ul className="absolute right-0 z-20 mt-1 grid w-[min(300px,80vw)] list-none gap-1 rounded-xl border border-zinc-200 bg-white p-2.5 text-[11.5px] shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {l.variants.map((v, i) => (
          <li key={i} className="min-w-0">
            <span className="block text-[10px] font-bold text-zinc-400">{v.label}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2"><Mini p={v.p} /><b className="min-w-0 flex-1 truncate font-semibold text-zinc-700 dark:text-zinc-200"><Pv as={productAlias(v.p.id)}>{v.p.short_name}</Pv></b><span className="shrink-0 font-bold text-zinc-500">{price(v.p)}</span></span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** El post-pago en una línea por nivel: «OTO 1 · producto · US$ X» y sus variantes plegadas. */
function LevelRows({ levels, productHref, compact }: { levels: PPLevel[]; productHref?: (id: string) => string; compact?: boolean }) {
  return (
    <ul className={`m-0 grid list-none p-0 ${compact ? "gap-0.5" : "mt-1.5 gap-1.5"}`}>
      {levels.map((l) => (
        <li key={l.level} className={`flex min-w-0 items-center gap-2 ${compact ? "text-[11.5px]" : "text-[12.5px]"}`}>
          {!compact && <Mini p={l.main} />}
          <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-[1px] text-[10px] font-black text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25">OTO {l.level}</span>
          {productHref
            ? <Link href={productHref(l.main.id)} className="min-w-0 flex-1 truncate font-semibold hover:underline"><Pv as={productAlias(l.main.id)}>{l.main.short_name}</Pv></Link>
            : <span className="min-w-0 flex-1 truncate font-semibold"><Pv as={productAlias(l.main.id)}>{l.main.short_name}</Pv></span>}
          <span className="shrink-0 text-[11.5px] font-bold text-zinc-500">{price(l.main)}</span>
          <Variants l={l} />
        </li>
      ))}
    </ul>
  );
}

/**
 * La estructura de la oferta: Principal → Upsells en el checkout → Post-pago (OTO 1, 2, 3) → Bonos.
 * `compact`: una línea por paso (para las tarjetas).
 */
export function StructureView({ s, mains, productHref, compact }: {
  s: Structure; mains?: SP[]; productHref?: (id: string) => string; compact?: boolean;
}) {
  const main = mains?.length ? mains : s.main ? [s.main] : [];
  const steps: { label: string; list?: SP[]; levels?: PPLevel[] }[] = [
    { label: "Principal", list: main },
    { label: STEPS[0][1], list: s.upsells },
    { label: "Post-pago", levels: s.levels },
    { label: STEPS[1][1], list: s.bonus },
  ];
  if (compact) {
    return (
      <div className="grid gap-1 text-[11.5px]">
        {steps.map(({ label, list, levels }) => (
          <div key={label} className="flex min-w-0 gap-2">
            <span className="w-[128px] shrink-0 pt-px text-[11.5px] font-medium text-zinc-400">{label}</span>
            <span className="min-w-0 flex-1 font-semibold text-zinc-700 dark:text-zinc-200">
              {levels
                ? (levels.length ? <LevelRows levels={levels} compact /> : <span className="font-medium text-zinc-400">—</span>)
                : list?.length ? <span className="block truncate">{list.map((p, i) => <span key={p.id}>{i > 0 && " · "}<Pv as={productAlias(p.id)}>{p.short_name}</Pv></span>)}</span>
                  : <span className="font-medium text-zinc-400">—</span>}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {steps.map(({ label, list, levels }, i) => (
        <li key={label} className={`flex gap-3 py-3 first:pt-0 ${i ? "border-t border-zinc-100 dark:border-white/[0.05]" : ""}`}>
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${i
            ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100" : "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"}`}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">{label}{i > 0 && <span className="text-zinc-400 dark:text-zinc-500"> · {levels ? levels.length : list?.length ?? 0}</span>}</div>
            {levels ? (levels.length ? <LevelRows levels={levels} productHref={productHref} /> : <p className="ad-note mt-0.5">Sin post-pago</p>)
              : list?.length ? (
                <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
                  {list.map((p) => (
                    <li key={p.id} className="flex items-center gap-2.5 text-[12.5px]">
                      {i === 0 ? <Thumb src={p.image} /> : <Mini p={p} />}
                      {productHref
                        ? <Link href={productHref(p.id)} className={`min-w-0 flex-1 truncate hover:underline ${i ? "font-semibold" : "font-bold"}`}><Pv as={productAlias(p.id)}>{p.short_name}</Pv></Link>
                        : <span className={`min-w-0 flex-1 truncate ${i ? "font-semibold" : "font-bold"}`}><Pv as={productAlias(p.id)}>{p.short_name}</Pv></span>}
                      <span className="shrink-0 text-[11.5px] font-bold text-zinc-500">{price(p)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="ad-note mt-0.5">{i ? "Ninguno" : "Sin producto principal"}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** La landing de un checkout: vista previa (si el sitio deja), «Abrir landing» e «Ir al checkout». */
export async function LandingBlock({ f, store, preview = true }: { f: OfferFunnel; store: { slug: string; domain: string | null }; preview?: boolean }) {
  const checkout = checkoutUrls(store, f).primary;
  const buttons = (
    <div className="flex flex-wrap gap-2">
      {f.landing_url && <a className="ad-btn sm primary" href={f.landing_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir landing</a>}
      <a className="ad-btn sm" href={checkout} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ir al checkout</a>
    </div>
  );
  if (!f.landing_url) {
    return (
      <div className="grid gap-3">
        <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-3 text-[12.5px] font-semibold text-zinc-500 dark:border-zinc-700">
          Sin landing cargada — pedile a Claude que la cargue.
        </p>
        {buttons}
      </div>
    );
  }
  const host = f.landing_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const link = <a href={f.landing_url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-[11.5px] text-violet-600 hover:underline dark:text-violet-400"><Pv as={`${HIDDEN}.com/${HIDDEN}`}>{host}</Pv></a>;
  if (!preview) return <div className="grid gap-2.5 [&>*]:min-w-0">{link}{buttons}</div>;
  const ok = await canFrame(f.landing_url);
  return (
    <div className="grid gap-3 [&>*]:min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">{link}{buttons}</div>
      {ok
        ? <DevicePreview src={f.landing_url} title={`Landing de ${f.market_label || f.name}`} deferred
            note="Se carga recién al tocar: la landing corre sus scripts (pixel incluido) y cada apertura contaría como una visita en Meta." />
        : (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-white/[0.03]">
            <Badge tone="warn">Sin vista previa</Badge>
            <p className="ad-note mt-2">Ese sitio no deja mostrarse dentro de otra página. Abrila en una pestaña nueva.</p>
          </div>
        )}
    </div>
  );
}
