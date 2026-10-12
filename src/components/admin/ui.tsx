import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { CopyField, CopyButton, SaveForm, ColorField, Result } from "./ui-client";

/**
 * Kit del panel: (Tailwind + admin.css). Las
 * clases .ad-* están definidas en admin.css con @apply: usá estos componentes
 * o esas clases; para lo que falte, utilidades de Tailwind (con su variante
 * dark:, el panel tiene modo oscuro). Íconos: lucide-react.
 * Server components salvo los marcados (cliente).
 *
 *  PageHead   { title, sub?, crumb?: {href,label}[], actions?, icon?: <Icono/>, color?: "#hex" }  título (con ícono en cuadrado de color)
 *  Card       { title?, sub?, action?, pad?=true, tone?: brand|warn|bad, className? }
 *  Button     { href?, variant?: primary|secondary|ghost|danger, size?: sm|md|lg, block?, ...<button> }
 *             primary = negro en mayúsculas (blanco en modo oscuro). Con href renderiza <Link> (o <a target=_blank> si es http…)
 *  Field      { label, hint?, children }        etiqueta mayúscula chica + ayuda
 *  Input / Textarea / Select { ...nativos }  Select acepta options: [value,label][]
 *  Toggle     { name, defaultChecked?, label, hint? }  checkbox con forma de interruptor; manda "on"
 *  Badge      { tone?: ok|bad|warn|brand|solid, dot?, caps? }
 *  Table      { head: (string | {label,num?,hideM?})[], children: <tr>… }   con scroll horizontal propio
 *  Stat       { label, value, hint?, size?: sm|md|lg }      número (lg = el grande del Inicio)
 *  EmptyState { title, children?, action?, icon? }    (Empty = alias viejo)
 *  Tabs       { items: {href,label,sub?}[], current, variant?: side|seg }
 *  Checks     { items: {status: ok|warn|bad|na, title, detail?, href?, fix?}[] }  lista ✓/!/✕
 *  Progress   { value, max }
 *  Flash      { ok?, bad?, warn? }                  aviso arriba de la página
 *  Kpi, Delta, Period, Thumb, Flag                  (los de antes; Flag = bandera como imagen)
 *
 *  Cliente (ui-client.tsx, reexportados acá):
 *  SaveForm   { action: (fd) => Promise<ActionResult>, submit?, confirm?, resetOnOk?, variant?, size?, hideSubmit? }
 *             guarda con una server action sin vaciar los campos y muestra el resultado al lado del botón.
 *             La acción tiene que llamar requireAdmin(), devolver { ok } o { error } (src/lib/admin/types.ts),
 *             y después de guardar: revalidateStore(slug) (src/lib/admin/store.ts) e invalidateCheckouts(slug)
 *             (src/lib/checkout-data.ts) si cambia algo que ve el comprador.
 *  CopyField  { value, label?, wrap? }   CopyButton { value, label? }
 *  ColorField { name, defaultValue?, fallback? }   selector + hex
 *  Result     { res }                     el mensaje ✓/error de una ActionResult
 *
 *  Carga: Skeleton.tsx (Sk, SkCard, SkPage, SkInicio, SkShell). Cada ruta tiene su loading.tsx y lo
 *  que depende de un servicio externo (Stripe, Vercel, Meta) va en <Suspense> con un esqueleto.
 *  Datos en caché: adminStore / storeList / pixelList (src/lib/admin/store.ts).
 *
 *  Editor de Checkouts (segunda etapa): la vista previa en vivo es un iframe a
 *  /c/{tienda}/{checkout}?preview=1 (opcional &pais=IT). Esperar el postMessage {type:"cp-ready"} y
 *  mandarle {type:"cp-settings", settings} (mismo origen) en cada cambio; nunca crea pagos. El formato
 *  de settings es src/lib/checkout-settings.ts (resolveSettings / mergeSettings / DEFAULT_SETTINGS).
 */

export { CopyField, CopyButton, SaveForm, ColorField, Result };

export function PageHead({
  title, sub, crumb, actions, icon, color = "#8b5cf6",
}: { title: ReactNode; sub?: ReactNode; crumb?: { href: string; label: string }[]; actions?: ReactNode; icon?: ReactNode; color?: string }) {
  return (
    <div className="ad-head">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="ad-head-ic" style={{ background: `${color}1f`, color }}>{icon}</div>}
        <div className="min-w-0">
          {crumb && (
            <div className="ad-crumb">
              {crumb.map((c, i) => (
                <span key={c.href}>{i > 0 && " / "}<Link href={c.href}>{c.label}</Link></span>
              ))}
            </div>
          )}
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {actions && <div className="ad-actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title, sub, action, children, pad = true, className = "", tone, id,
}: {
  title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; pad?: boolean; className?: string;
  tone?: "brand" | "warn" | "bad"; id?: string;
}) {
  return (
    <section id={id} className={`ad-card ${tone ? `tone-${tone}` : ""} ${className}`}>
      {(title || action) && (
        <div className="ad-card-h">
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {sub && <p>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {pad ? <div className="ad-card-b">{children}</div> : children}
    </section>
  );
}

type BtnProps = {
  href?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; block?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ href, variant = "secondary", size = "md", block, className = "", children, ...rest }: BtnProps) {
  const cls = `ad-btn ${variant === "secondary" ? "" : variant} ${size === "md" ? "" : size} ${block ? "block" : ""} ${className}`.trim();
  if (href) {
    return /^https?:\/\//.test(href)
      ? <a className={cls} href={href} target="_blank" rel="noreferrer">{children}</a>
      : <Link className={cls} href={href}>{children}</Link>;
  }
  return <button className={cls} {...rest}>{children}</button>;
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ad-field">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="lbl">{label}</span>}
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export const Input = ({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={`ad-in ${className}`} {...p} />;
export const Textarea = ({ className = "", ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`ad-in ${className}`} {...p} />;
export function Select({ options, className = "", ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: [string, string][] }) {
  return <select className={`ad-in ${className}`} {...p}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

export function Toggle({ name, defaultChecked, label, hint, value = "on" }: { name: string; defaultChecked?: boolean; label: ReactNode; hint?: ReactNode; value?: string }) {
  return (
    <label className="ad-toggle">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} />
      <span className="ad-switch" />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Badge({ tone, dot, caps, children }: { tone?: "ok" | "bad" | "warn" | "brand" | "solid"; dot?: boolean; caps?: boolean; children: ReactNode }) {
  return <span className={`ad-badge ${tone ?? ""} ${caps ? "caps" : ""}`}>{dot && <i />}{children}</span>;
}

type Col = string | { label: string; num?: boolean; hideM?: boolean };
export function Table({ head, children }: { head: Col[]; children: ReactNode }) {
  return (
    <div className="ad-scroll">
      <table className="ad-table">
        <thead>
          <tr>
            {head.map((c, i) => typeof c === "string"
              ? <th key={i}>{c}</th>
              : <th key={i} className={`${c.num ? "num" : ""} ${c.hideM ? "hide-m" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, hint, size = "sm" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`ad-stat ${size}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ad-empty">
      {icon && <div className="ic">{icon}</div>}
      <b>{title}</b>
      {children}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
export const Empty = EmptyState;

export function Tabs({ items, current, variant = "seg" }: {
  items: { href: string; label: string; sub?: string; key?: string }[]; current: string; variant?: "side" | "seg";
}) {
  if (variant === "side") {
    return (
      <div>
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`ad-tab${(it.key ?? it.href) === current ? " on" : ""}`}
            aria-current={(it.key ?? it.href) === current ? "page" : undefined}>
            <b>{it.label}</b>{it.sub && <small>{it.sub}</small>}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="ad-seg">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={(it.key ?? it.href) === current ? "on" : ""}>{it.label}</Link>
      ))}
    </div>
  );
}

export type CheckItem = { status: "ok" | "warn" | "bad" | "na"; title: ReactNode; detail?: ReactNode; href?: string; fix?: string };
export function Checks({ items }: { items: CheckItem[] }) {
  return (
    <ul className="ad-checklist">
      {items.map((c, i) => (
        <li key={i}>
          <span className={`st ${c.status}`} aria-label={c.status}>{c.status === "ok" ? "✓" : c.status === "bad" ? "✕" : c.status === "warn" ? "!" : "–"}</span>
          <div style={{ minWidth: 0 }}>
            <b>{c.title}</b>
            {c.detail && <p>{c.detail}</p>}
          </div>
          {c.href && c.status !== "ok" && <Link className="fix ad-link-a" href={c.href}>{c.fix ?? "Arreglar"} →</Link>}
        </li>
      ))}
    </ul>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  return <div className="ad-progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}><i style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>;
}

export function Flash({ ok, bad, warn }: { ok?: string; bad?: string; warn?: string }) {
  if (bad) return <div className="ad-flash bad">{bad}</div>;
  if (warn) return <div className="ad-flash warn">{warn}</div>;
  if (ok) return <div className="ad-flash ok">{ok}</div>;
  return null;
}

/** Variación contra el período anterior. null = no hay con qué comparar. */
/** `invert`: para lo que conviene que baje (CPA, reembolsos), subir se pinta en rojo. */
export function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (!before && !now) return null;
  if (!before) return <span className={`ad-delta ${invert ? "down" : "up"}`}>nuevo</span>;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const cls = Math.abs(pct) < 0.5 ? "flat" : (pct > 0) !== !!invert ? "up" : "down";
  return <span className={`ad-delta ${cls}`}>{pct > 0 ? "+" : ""}{pct.toFixed(0)}%</span>;
}

export function Kpi({
  label, value, hint, now, before, invert, src,
}: { label: string; value: ReactNode; hint?: ReactNode; now?: number; before?: number; invert?: boolean;
  /** De dónde sale el número, en chiquito («según Meta», «cobrado en Stripe»). */
  src?: string }) {
  return (
    <div className="ad-card ad-kpi">
      <span>{label}{now != null && before != null && <Delta now={now} before={before} invert={invert} />}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
      {src && <em className="ad-kpi-src">{src}</em>}
    </div>
  );
}

/** Selector de período que se arma con links: no necesita JS. */
export function Period({ base, days, extra = "" }: { base: string; days: number; extra?: string }) {
  const opts = [[7, "7 días"], [30, "30 días"], [90, "90 días"], [365, "12 meses"]] as const;
  return (
    <div className="ad-seg">
      {opts.map(([d, l]) => (
        <Link key={d} href={`${base}?d=${d}${extra}`} className={d === days ? "on" : ""}>{l}</Link>
      ))}
    </div>
  );
}

export function Thumb({ src }: { src: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="ad-thumb" src={src} alt="" loading="lazy" /> : <span className="ad-thumb" />;
}

/** Bandera como imagen: Windows no dibuja los emojis de banderas y muestra "IT". */
export function Flag({ cc }: { cc: string | null }) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return null;
  const c = cc.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/20x15/${c}.png`} srcSet={`https://flagcdn.com/40x30/${c}.png 2x`} width={20} height={15} alt={cc.toUpperCase()}
      style={{ display: "inline-block", verticalAlign: "-2px", borderRadius: 2, marginRight: 6, boxShadow: "0 0 0 1px rgba(0,0,0,.06)" }} />
  );
}
