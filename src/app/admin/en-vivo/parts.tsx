import type { ReactNode } from "react";
import {
  ChevronRight, CircleCheck, CircleX, CreditCard, Download, Eye, Gift, Hourglass, LogOut, Mail, Megaphone, Monitor,
  MousePointerClick, PartyPopper, ShoppingCart, Smartphone, Tablet, TriangleAlert, type LucideIcon,
} from "lucide-react";
import type { LivePage, Source, Who } from "@/lib/live";
import type { Icon, Line, Tone } from "@/lib/event-labels";
import { PANEL_TZ } from "@/lib/admin/range";

/**
 * Piezas de «En vivo» y del recorrido de un visitante. Sin estado ni hooks:
 * sirven en la página del servidor y en el componente que se actualiza solo.
 * Lo privado (IP, emails, anuncios) va tapado en modo captura.
 */

export const PAGE_TONE: Record<LivePage, string> = { landing: "", checkout: "brand", oferta: "ok", gracias: "ok" };

let regions: Intl.DisplayNames | null = null;
export const countryName = (cc: string) => {
  try { regions ??= new Intl.DisplayNames(["es"], { type: "region" }); return regions.of(cc) ?? cc; } catch { return cc; }
};

/** Bandera como imagen: Windows no dibuja los emojis de banderas. */
export function Flag({ cc }: { cc: string | null }) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return null;
  const c = cc.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/20x15/${c}.png`} srcSet={`https://flagcdn.com/40x30/${c}.png 2x`} width={20} height={15} alt={cc.toUpperCase()}
      style={{ display: "inline-block", verticalAlign: "-2px", borderRadius: 2, boxShadow: "0 0 0 1px rgba(0,0,0,.06)", flexShrink: 0 }} />
  );
}

/** Lo que identifica al negocio o a la persona, tapado en modo captura (mismo marcado que Pv). */
export const Pv = ({ as, children }: { as: string; children: ReactNode }) => (
  <span className="pv" data-pv={as}><span className="pv-real">{children}</span></span>
);

export const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ });
export const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ });

/** «ahora», «hace 45 s», «hace 3 min», «hace 2 h», «hace 1 d». */
export function ago(now: string, at: string) {
  const s = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 1000));
  if (s < 10) return "ahora";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} d`;
}

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** «Rosario, S · Argentina». */
export function placeOf(w: Who) {
  const country = w.country ? countryName(w.country) : null;
  const city = [w.city, w.region && w.region !== w.city && /^[A-Z0-9]{1,3}$/i.test(w.region) ? w.region : null].filter(Boolean).join(", ");
  return [city, country].filter(Boolean).join(" · ") || "Ubicación desconocida";
}

export function DeviceIcon({ device, className = "h-3.5 w-3.5" }: { device: string | null; className?: string }) {
  if (device === "mobile") return <Smartphone className={className} aria-label="celular" />;
  if (device === "tablet") return <Tablet className={className} aria-label="tablet" />;
  return <Monitor className={className} aria-label="computadora" />;
}

/** Equipo · sistema · navegador. */
export function DeviceLine({ w }: { w: Who }) {
  const parts = [w.model, w.os && w.os !== w.model ? w.os : null, w.browser].filter(Boolean);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <DeviceIcon device={w.device} />
      <span className="truncate">{parts.length ? parts.join(" · ") : w.device === "mobile" ? "Celular" : w.device === "tablet" ? "Tablet" : "Computadora"}</span>
    </span>
  );
}

export function IpTag({ ip }: { ip: string | null }) {
  if (!ip) return null;
  return <span className="whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>IP <Pv as="oculta">{ip}</Pv></span>;
}

export function ReturnBadge({ returning }: { returning: boolean | null }) {
  if (returning === null) return null;
  return <span className={`ad-badge ${returning ? "brand" : ""}`}>{returning ? "Volvió" : "Nuevo"}</span>;
}

/** Anuncio y campaña (Meta), sitio que lo mandó o «Directo». */
export function SourceLine({ s }: { s: Source }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Megaphone className="h-3.5 w-3.5 shrink-0" />
      <b className="shrink-0">{s.label}</b>
      {s.ad && <span className="min-w-0 truncate" data-pv-blur title={s.ad}>{s.ad}</span>}
      {s.campaign && <span className="min-w-0 truncate ad-faint" data-pv-blur title={s.campaign}>{s.ad ? "· " : ""}{s.campaign}</span>}
      {s.kind === "meta" && <span className="ad-faint">sin UTM</span>}
    </span>
  );
}

const ICONS: Record<Icon, LucideIcon> = {
  landing: Eye, click: MousePointerClick, checkout: ShoppingCart, mail: Mail, card: CreditCard, error: TriangleAlert,
  ok: CircleCheck, no: CircleX, wait: Hourglass, offer: Gift, done: PartyPopper, download: Download, leave: LogOut,
};
const DOT: Record<Tone, string> = {
  "": "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  muted: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  bad: "bg-red-500/15 text-red-600 dark:text-red-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  brand: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
};
const INK: Record<Tone, string> = {
  "": "text-zinc-900 dark:text-white",
  muted: "text-zinc-500 dark:text-zinc-400",
  ok: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  brand: "text-zinc-900 dark:text-white",
};
const BADGE: Record<Tone, string> = { "": "", muted: "", ok: "ok", bad: "bad", warn: "warn", brand: "brand" };

/**
 * Un evento en una fila: hora, ícono de color, qué pasó (OTO 1 · producto),
 * el monto a la derecha y debajo el detalle (medio, motivo, email).
 */
export function LineRow({ l, time }: { l: Line; time?: string }) {
  const Ic = ICONS[l.icon] ?? Eye;
  return (
    <li className="flex min-w-0 items-start gap-2 py-[5px]">
      {time && <span className="ad-faint shrink-0 pt-[4px] text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>}
      <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${DOT[l.tone]}`}><Ic className="h-3 w-3" /></span>
      <div className="min-w-0 flex-1 pt-[2px]">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="m-0 min-w-0 flex-1 break-words text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300">
            <b className={INK[l.tone]}>{l.title}</b>
            {l.item && <> · <Pv as={l.itemAlias ?? "Producto"}>{l.item}</Pv></>}
          </p>
          {l.amount && <b className={`shrink-0 text-[12.5px] ${l.tone === "ok" ? INK.ok : "text-zinc-900 dark:text-white"}`} style={{ fontVariantNumeric: "tabular-nums" }}>{l.amount}</b>}
        </div>
        {l.detail && (
          <div className="ad-faint mt-0.5 break-words text-[11.5px] leading-snug">{l.personal ? <span data-pv-blur>{l.detail}</span> : l.detail}</div>
        )}
      </div>
    </li>
  );
}

/** Recorrido en una línea: páginas en negrita y lo que hizo en etiquetas. */
export function JourneyChips({ steps }: { steps: Line[] }) {
  if (!steps.length) return <span className="ad-faint">Sin eventos todavía.</span>;
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1.5 p-0 text-[11px]">
      {steps.map((s, i) => (
        <li key={s.key} className="inline-flex min-w-0 items-center gap-1" title={hhmmss(s.at)}>
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />}
          {s.event === "view"
            ? <b className="text-zinc-700 dark:text-zinc-200">{s.short}</b>
            : <span className={`ad-badge ${BADGE[s.tone]} max-w-full`}>{s.short}{s.personal && s.detail ? <>: <span data-pv-blur className="inline-block min-w-0 max-w-[170px] truncate">{s.detail}</span></> : null}</span>}
        </li>
      ))}
    </ol>
  );
}
