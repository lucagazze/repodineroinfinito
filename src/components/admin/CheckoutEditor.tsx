"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { DeviceSwitch, ScaledFrame, type Device } from "./DevicePreview";
import { DEFAULT_SETTINGS, resolveSettings, type CheckoutSettings } from "@/lib/checkout-settings";
import type { ActionResult } from "@/lib/admin/types";

/**
 * Editor del aspecto de un checkout, como el de Winnerfy: bloques a la
 * izquierda, vista previa en vivo a la derecha. Cada cambio viaja al iframe
 * por postMessage (no se guarda nada hasta tocar Guardar); la vista previa
 * es el checkout real con ?preview=1, que no crea pagos.
 */

type S = CheckoutSettings;
type Props = {
  saved: S;
  previewBase: string;
  /** El checkout público (en su dominio), para «Abrir el checkout». */
  liveUrl?: string;
  countries: string[];
  storePayColor: string;
  storeGuaranteeDays: number;
  save: (draft: S) => Promise<ActionResult>;
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const HEX = /^#[0-9a-fA-F]{6}$/;

// ------------------------------------------------------------------ campos

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="ad-field">
      <span className="lbl">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Sw({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ad-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ad-switch" />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

function Txt({ value, onChange, placeholder, max = 200, area }: { value: string; onChange: (v: string) => void; placeholder?: string; max?: number; area?: boolean }) {
  return area
    ? <textarea className="ad-in" rows={3} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    : <input className="ad-in" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Num({ value, onChange, min, max, placeholder, allowEmpty }: {
  value: number | null; onChange: (v: number | null) => void; min: number; max: number; placeholder?: string; allowEmpty?: boolean;
}) {
  return (
    <input className="ad-in" type="number" inputMode="numeric" min={min} max={max} placeholder={placeholder}
      value={value ?? ""} onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(allowEmpty ? null : min);
        const n = Math.round(Number(raw));
        if (Number.isFinite(n)) onChange(Math.min(Math.max(n, min), max));
      }} />
  );
}

function Clr({ value, onChange, fallback }: { value: string; onChange: (v: string) => void; fallback: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="ad-color">
      <input type="color" aria-label="Elegir color" value={HEX.test(value) ? value : fallback} onChange={(e) => onChange(e.target.value)} />
      <input className="ad-in" value={text} placeholder={`${fallback} (por defecto)`} maxLength={7}
        onChange={(e) => { const v = e.target.value.trim(); setText(v); if (v === "" || HEX.test(v)) onChange(v); }} />
      {value && <button type="button" className="ad-btn ghost sm" onClick={() => onChange("")} title="Volver al color por defecto"><RotateCcw size={13} /></button>}
    </div>
  );
}

function Block({ title, sub, on, children, open }: { title: string; sub?: string; on?: boolean; children: ReactNode; open?: boolean }) {
  return (
    <details className="cke group" open={open}>
      <summary>
        <span className="min-w-0 flex-1">
          <b>{title}</b>
          {sub && <small>{sub}</small>}
        </span>
        {on !== undefined && <span className={`ad-badge ${on ? "ok" : ""}`}>{on ? "Prendido" : "Apagado"}</span>}
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="cke-body">{children}</div>
    </details>
  );
}

function DesignPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opt = (v: string, label: string, sub: string, sketch: ReactNode) => (
    <button type="button" onClick={() => onChange(v)} aria-pressed={value === v}
      className={`flex flex-1 flex-col gap-2 rounded-xl border p-3 text-left transition-all ${value === v
        ? "border-zinc-900 bg-zinc-50 ring-2 ring-zinc-900/10 dark:border-white dark:bg-white/5"
        : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"}`}>
      <div className="flex h-20 gap-1 rounded-lg bg-zinc-100 p-1.5 dark:bg-zinc-800">{sketch}</div>
      <span className="text-[12px] font-bold text-zinc-900 dark:text-white">{label}</span>
      <span className="-mt-1.5 text-[11px] text-zinc-500">{sub}</span>
    </button>
  );
  const bar = (w: string, c = "bg-zinc-300 dark:bg-zinc-600") => <span className={`block h-1.5 rounded ${c}`} style={{ width: w }} />;
  return (
    <div className="flex gap-2.5">
      {opt("2", "Diseño 2 · Una columna", "El de la plataforma anterior (el que convierte hoy)",
        <div className="mx-auto flex w-1/2 flex-col gap-1 rounded bg-white p-1.5 dark:bg-zinc-900">
          {bar("100%", "bg-green-600")}{bar("80%")}{bar("90%")}{bar("70%")}{bar("100%", "bg-green-500")}
        </div>)}
      {opt("1", "Diseño 1 · Dos columnas", "Datos a la izquierda, resumen a la derecha",
        <>
          <div className="flex flex-1 flex-col gap-1 rounded bg-white p-1.5 dark:bg-zinc-900">{bar("80%")}{bar("100%")}{bar("60%")}{bar("100%", "bg-blue-600")}</div>
          <div className="flex w-2/5 flex-col gap-1 rounded bg-white p-1.5 dark:bg-zinc-900">{bar("90%")}{bar("70%")}{bar("100%")}</div>
        </>)}
    </div>
  );
}

// ------------------------------------------------------------------ editor

export default function CheckoutEditor({ saved: initial, previewBase, liveUrl, countries, storePayColor, storeGuaranteeDays, save }: Props) {
  const [saved, setSaved] = useState<S>(() => clone(initial));
  const [d, setD] = useState<S>(() => clone(initial));
  const [res, setRes] = useState<ActionResult | null>(null);
  // Sin useTransition: con una transición async en curso Next no termina ninguna navegación hasta que la acción vuelve.
  const [pending, setPending] = useState(false);
  const [pais, setPais] = useState("");
  const [device, setDevice] = useState<Device>("mobile");
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const dirty = !same(d, saved);

  /** Cambia una clave de un bloque: set("colors", "pay", "#fff"). */
  const set = <K extends keyof S>(section: K, key: keyof S[K] | null, value: unknown) => {
    setRes(null);
    setD((prev) => {
      const next = clone(prev);
      if (key === null) (next as Record<string, unknown>)[section as string] = value;
      else ((next[section] as unknown) as Record<string, unknown>)[key as string] = value;
      return next;
    });
  };

  const dRef = useRef(d);
  const send = useCallback((s: S) => {
    if (!ready.current) return;
    frame.current?.contentWindow?.postMessage({ type: "cp-settings", settings: resolveSettings(s) }, window.location.origin);
  }, []);

  // El iframe avisa cuando puede recibir (también después de cambiar de país, que lo recarga).
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow || e.data?.type !== "cp-ready") return;
      ready.current = true;
      send(dRef.current);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [send]);
  useEffect(() => { dRef.current = d; send(d); }, [d, send]);

  // Avisar antes de irse con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const H = 760;

  const src = `${previewBase}${pais ? `&pais=${pais}` : ""}`;
  const payFallback = d.design === "1" ? (HEX.test(storePayColor) ? storePayColor : "#005bd1") : "#16a34a";

  const onSave = async () => {
    if (pending) return;
    setPending(true);
    try {
      const r = await save(d);
      setRes(r);
      const fresh = r.data?.settings as S | undefined;
      if (r.ok && fresh) { setSaved(clone(fresh)); setD(clone(fresh)); }
    } catch (e) {
      setRes({ error: (e as Error).message || "No se pudo guardar" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="cke-wrap">
      <div className="cke-col">
        <div className="cke-bar">
          <div className="min-w-0">
            <b className="block text-[13px] font-bold text-zinc-900 dark:text-white">Diseño del checkout</b>
            <span className={`text-[11.5px] font-semibold ${dirty ? "text-amber-600 dark:text-amber-400" : res?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
              {res?.error ? <span className="text-red-600 dark:text-red-400">{res.error}</span>
                : dirty ? "● Cambios sin guardar" : res?.ok ? `✓ ${res.ok}` : "Todo guardado"}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className="ad-btn sm" disabled={!dirty || pending} onClick={() => { setD(clone(saved)); setRes(null); }}>Descartar</button>
            <button type="button" className="ad-btn sm primary" disabled={!dirty || pending} onClick={onSave}>{pending ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>

        <div className="cke-list">
          <Block title="Diseño" sub={d.design === "1" ? "Dos columnas" : "Una columna (referencia)"} open>
            <DesignPick value={d.design} onChange={(v) => set("design", null, v)} />
          </Block>

          <Block title="Color y marca" sub="Botón, acentos, fondo y logo">
            <Row label="Color del botón de pagar" hint="Vacío = el del diseño (verde en el 2) o el de la tienda.">
              <Clr value={d.colors.pay} fallback={payFallback} onChange={(v) => set("colors", "pay", v)} />
            </Row>
            <Row label="Color de acento" hint="Detalles: bordes elegidos, íconos, precios.">
              <Clr value={d.colors.accent} fallback="#2563eb" onChange={(v) => set("colors", "accent", v)} />
            </Row>
            <Row label="Color de fondo">
              <Clr value={d.colors.background} fallback="#f2f2f7" onChange={(v) => set("colors", "background", v)} />
            </Row>
            <Sw label="Mostrar el logo arriba" hint="El logo de la tienda (Configuración › General)." checked={d.logo.show} onChange={(v) => set("logo", "show", v)} />
          </Block>

          <Block title="Barra superior" sub="La franja de «Compra segura»" on={d.topBar.show}>
            <Sw label="Mostrar la barra" checked={d.topBar.show} onChange={(v) => set("topBar", "show", v)} />
            <Row label="Texto" hint="Vacío = «Compra segura» en el idioma del comprador.">
              <Txt value={d.topBar.text} onChange={(v) => set("topBar", "text", v)} max={120} />
            </Row>
          </Block>

          <Block title="Barra de compradores" sub="«X personas están comprando ahora»" on={d.buyersBar.show}>
            <Sw label="Mostrar la barra" hint="Cuenta real: gente con este checkout abierto en los últimos 30 minutos." checked={d.buyersBar.show} onChange={(v) => set("buyersBar", "show", v)} />
            <Row label="Mínimo para mostrarla" hint="Con menos personas que esto, no aparece. Nunca se inventa el número.">
              <Num value={d.buyersBar.min} min={1} max={50} onChange={(v) => set("buyersBar", "min", v ?? 1)} />
            </Row>
          </Block>

          <Block title="Cuenta regresiva" on={d.countdown.show}>
            <Sw label="Mostrar la cuenta regresiva" hint="El plazo se guarda en el navegador: recargar no lo reinicia." checked={d.countdown.show} onChange={(v) => set("countdown", "show", v)} />
            <Row label="Minutos"><Num value={d.countdown.minutes} min={1} max={120} onChange={(v) => set("countdown", "minutes", v ?? 15)} /></Row>
            <Row label="Texto" hint="Vacío = el de cada idioma.">
              <Txt value={d.countdown.text} onChange={(v) => set("countdown", "text", v)} max={120} placeholder="La oferta termina en" />
            </Row>
          </Block>

          <Block title="Oferta" sub="Título, precio tachado y ahorro">
            <Row label="Título" hint="Vacío = el nombre del producto."><Txt value={d.offer.title} onChange={(v) => set("offer", "title", v)} /></Row>
            <Row label="Subtítulo"><Txt value={d.offer.subtitle} onChange={(v) => set("offer", "subtitle", v)} /></Row>
            <Sw label="Precio tachado" checked={d.offer.showCompareAt} onChange={(v) => set("offer", "showCompareAt", v)} />
            <Sw label="Cuánto ahorra" checked={d.offer.showSavings} onChange={(v) => set("offer", "showSavings", v)} />
            <Sw label="Imagen del producto" checked={d.offer.showImage} onChange={(v) => set("offer", "showImage", v)} />
          </Block>

          <Block title="Bonos" on={d.bonuses.show}>
            <Sw label="Mostrar los bonos" checked={d.bonuses.show} onChange={(v) => set("bonuses", "show", v)} />
            <Row label="Título" hint="Vacío = el de cada idioma."><Txt value={d.bonuses.title} onChange={(v) => set("bonuses", "title", v)} /></Row>
          </Block>

          <Block title="Datos del comprador">
            <Sw label="Pedir apellido" checked={d.buyer.askLastName} onChange={(v) => set("buyer", "askLastName", v)} />
            <Sw label="Pedir teléfono" checked={d.buyer.askPhone} onChange={(v) => set("buyer", "askPhone", v)} />
            {d.buyer.askPhone && <Sw label="Teléfono obligatorio" checked={d.buyer.phoneRequired} onChange={(v) => set("buyer", "phoneRequired", v)} />}
          </Block>

          <Block title="Método de pago" on={d.payment.express}>
            <Sw label="Botones rápidos arriba de la tarjeta" hint="Apple Pay, Google Pay y Link, si el navegador los tiene." checked={d.payment.express} onChange={(v) => set("payment", "express", v)} />
          </Block>

          <Block title="Order bumps">
            <Row label="Título" hint="Vacío = el de cada idioma."><Txt value={d.bumps.title} onChange={(v) => set("bumps", "title", v)} /></Row>
            <Sw label="Marcados de entrada" hint="Ojo: en la UE se considera práctica engañosa." checked={d.bumps.preselect} onChange={(v) => set("bumps", "preselect", v)} />
          </Block>

          <Block title="Botón de pagar">
            <Row label="Texto" hint="{total} se reemplaza por el importe. Vacío = «Pagar {total}» en cada idioma.">
              <Txt value={d.payButton.text} onChange={(v) => set("payButton", "text", v)} max={80} placeholder="Comprar ahora · {total}" />
            </Row>
            <Row label="Color" hint="Si lo cargás, gana sobre el de Color y marca.">
              <Clr value={d.payButton.color} fallback={HEX.test(d.colors.pay) ? d.colors.pay : payFallback} onChange={(v) => set("payButton", "color", v)} />
            </Row>
          </Block>

          <Block title="Garantía y sellos" on={d.guarantee.show}>
            <Sw label="Mostrar la garantía" checked={d.guarantee.show} onChange={(v) => set("guarantee", "show", v)} />
            <Row label="Días" hint={`Vacío = los de la tienda (${storeGuaranteeDays}).`}>
              <Num value={d.guarantee.days} min={0} max={365} allowEmpty placeholder={String(storeGuaranteeDays)} onChange={(v) => set("guarantee", "days", v)} />
            </Row>
            <Row label="Texto" hint="Vacío = el de cada idioma."><Txt area value={d.guarantee.text} onChange={(v) => set("guarantee", "text", v)} max={400} /></Row>
            <Row label="Imagen (URL https)" hint="Vacío = la de la tienda.">
              <Txt value={d.guarantee.image} onChange={(v) => set("guarantee", "image", v)} max={500} placeholder="https://…" />
            </Row>
            <Sw label="Sellos de pago seguro" checked={d.guarantee.seals} onChange={(v) => set("guarantee", "seals", v)} />
          </Block>

          <Block title="Políticas" on={d.policies.show}>
            <Sw label="Links a términos, privacidad y reembolsos" checked={d.policies.show} onChange={(v) => set("policies", "show", v)} />
          </Block>

          <Block title="Oferta de salida" sub="Aparece una vez cuando el comprador se va sin pagar" on={d.exitOffer.show}>
            <Sw label="Mostrar la oferta de salida" checked={d.exitOffer.show} onChange={(v) => set("exitOffer", "show", v)} />
            <Row label="Título"><Txt value={d.exitOffer.title} onChange={(v) => set("exitOffer", "title", v)} placeholder="¡Esperá!" /></Row>
            <Row label="Texto"><Txt area value={d.exitOffer.text} onChange={(v) => set("exitOffer", "text", v)} max={400} /></Row>
            <Row label="Descuento (%)" hint="Si la acepta, se le cobra el producto principal con este descuento. 0 = sin descuento.">
              <Num value={d.exitOffer.discountPercent} min={0} max={90} onChange={(v) => set("exitOffer", "discountPercent", v ?? 0)} />
            </Row>
          </Block>

          <Block title="Idioma fijo" sub={d.locale ? d.locale : "Automático"}>
            <Row label="Idioma" hint="Automático = según el navegador y el país del comprador. En la vista previa se ve después de guardar.">
              <select className="ad-in" value={d.locale} onChange={(e) => set("locale", null, e.target.value)}>
                {[["", "Automático"], ["it", "Italiano"], ["en", "Inglés"], ["es", "Español"], ["pt-BR", "Portugués (Brasil)"], ["fr", "Francés"], ["de", "Alemán"]]
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
          </Block>

          <Block title="CSS propio" sub="Para ajustes puntuales">
            <Row label="CSS" hint="Se agrega al final de la página de pago. Sin etiquetas.">
              <textarea className="ad-in mono" rows={6} value={d.customCss} maxLength={8000} spellCheck={false}
                placeholder=".ck-pay { border-radius: 999px }" onChange={(e) => set("customCss", null, e.target.value)} />
            </Row>
          </Block>

          <button type="button" className="ad-link-a mt-1 self-start text-[12px]" onClick={() => { setD(clone(DEFAULT_SETTINGS)); setRes(null); }}>
            Volver todo a los valores por defecto
          </button>
        </div>
      </div>

      <div className="cke-prev">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <DeviceSwitch device={device} onChange={setDevice} />
          <select className="ad-in !h-8 !w-auto !py-0 text-[12px]" value={pais} onChange={(e) => { ready.current = false; setPais(e.target.value); }} aria-label="País del comprador">
            <option value="">País automático</option>
            {countries.map((c) => <option key={c} value={c}>Comprador de {c}</option>)}
          </select>
          <a className="ad-link-a ml-auto text-[12px]" href={liveUrl ?? src} target="_blank" rel="noreferrer">Abrir el checkout →</a>
        </div>
        {/* Fondo del checkout (#f0f0f0): si la página tarda un instante, no se ve un recuadro blanco. */}
        <ScaledFrame src={src} title="Vista previa del checkout" device={device} height={H} iframeRef={frame} bg="#f0f0f0" />
        <p className="ad-note mt-2 text-[11.5px]">Es el checkout real en modo vista previa: no cobra ni cuenta visitas. Los cambios se ven acá al instante y le llegan a los compradores al guardar.</p>
      </div>
    </div>
  );
}
