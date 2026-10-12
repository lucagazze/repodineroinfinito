"use client";

/**
 * Piezas del kit del panel que necesitan JavaScript en el navegador. Se usan
 * desde ui.tsx o directo; ver la documentación del kit arriba de ui.tsx.
 */

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { ICheck, ICopy, ILeft, IRight } from "./icons";

export function CopyButton({ value, label = "Copiar", className = "ad-btn" }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Sin permiso de portapapeles (http, iframe): se selecciona a mano.
          const ta = document.createElement("textarea");
          ta.value = value; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <ICheck size={15} /> : <ICopy size={15} />} {done ? "Copiado" : label}
    </button>
  );
}

/** Un valor para copiar: dirección, comando, parámetros de URL. */
export function CopyField({ value, label, wrap }: { value: string; label?: string; wrap?: boolean }) {
  return (
    <div className={`ad-copyfield${wrap ? " wrap" : ""}`}>
      <div className="ad-copy" title={value}>{value}</div>
      <CopyButton value={value} label={label} className="ad-btn primary" />
    </div>
  );
}

/**
 * Formulario que guarda con una server action sin recargar ni vaciar los
 * campos. React 19 resetea los <form action={…}> al terminar: si la acción
 * falla, se perdía lo que la persona había escrito. Acá la acción se llama a
 * mano y el resultado queda al lado del botón. Sin useTransition: con una
 * transición async en curso Next no termina ninguna navegación hasta que la
 * acción vuelve (un «Sincronizar» de 40 s dejaba el celular sin poder tocar nada).
 */
export function SaveForm({
  action, children, submit = "Guardar cambios", pendingText = "Guardando…", className = "ad-form", variant = "primary",
  size = "lg", confirm, resetOnOk, hideSubmit,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children?: ReactNode;
  submit?: ReactNode;
  pendingText?: string;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  /** Texto de confirmación del navegador antes de mandar. */
  confirm?: string;
  resetOnOk?: boolean;
  hideSubmit?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [res, setRes] = useState<ActionResult | null>(null);
  const router = useRouter();
  const btn = `ad-btn ${variant === "primary" ? "primary" : variant === "danger" ? "danger" : ""} ${size === "md" ? "" : size}`;
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending || (confirm && !window.confirm(confirm))) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        setRes(null);
        setPending(true);
        try {
          const r = await action(fd);
          setRes(r);
          if (r.ok) {
            if (resetOnOk) form.reset();
            router.refresh();
          }
        } catch (err) {
          setRes({ error: (err as Error).message || "No se pudo guardar. Probá de nuevo." });
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {(!hideSubmit || res) && (
        <div className="ad-formfoot">
          {!hideSubmit && <button className={btn} disabled={pending}>{pending ? pendingText : submit}</button>}
          <Result res={res} />
        </div>
      )}
    </form>
  );
}

export function Result({ res }: { res: ActionResult | null }) {
  if (!res || (!res.ok && !res.error)) return null;
  return (
    <div className={`ad-res ${res.error ? "bad" : "ok"}`} role="status">
      {res.error ?? <>✓ {res.ok}</>}
      {!!res.details?.length && <ul>{res.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </div>
  );
}

/** Color con selector y texto hex sincronizados. Vacío = valor por defecto. */
export function ColorField({ name, defaultValue, fallback = "#18181b", onChange }: {
  name: string; defaultValue?: string | null; fallback?: string; onChange?: (v: string) => void;
}) {
  const [v, setV] = useState(defaultValue ?? "");
  const valid = /^#[0-9a-f]{6}$/i.test(v);
  const set = (x: string) => { setV(x); onChange?.(x); };
  return (
    <div className="ad-color">
      <input type="color" aria-label="Elegir color" value={valid ? v : fallback} onChange={(e) => set(e.target.value)} />
      <input className="ad-in" name={name} value={v} placeholder={fallback} maxLength={7} onChange={(e) => set(e.target.value.trim())} />
    </div>
  );
}

/** Selector de día del Inicio: flechas para el día anterior/siguiente y un calendario. */
export function DayPicker({ base, value, today }: { base: string; value: string; today: string }) {
  const router = useRouter();
  const shift = (d: number) => {
    const t = new Date(`${value}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + d);
    return t.toISOString().slice(0, 10);
  };
  const go = (d: string) => router.push(d === today ? base : `${base}?dia=${d}`);
  const next = shift(1);
  return (
    <div className="ad-daynav">
      <a href={`${base}?dia=${shift(-1)}`} onClick={(e) => { e.preventDefault(); go(shift(-1)); }} aria-label="Día anterior"><ILeft size={16} /></a>
      <input type="date" value={value} max={today} aria-label="Elegir día" onChange={(e) => e.target.value && go(e.target.value)} />
      {next <= today
        ? <a href={`${base}?dia=${next}`} onClick={(e) => { e.preventDefault(); go(next); }} aria-label="Día siguiente"><IRight size={16} /></a>
        : <a aria-disabled="true" style={{ opacity: 0.3, pointerEvents: "none" }}><IRight size={16} /></a>}
    </div>
  );
}
