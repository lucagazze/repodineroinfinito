"use client";

import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { Eye, Monitor, Smartphone } from "lucide-react";

export type Device = "mobile" | "desktop";

/**
 * Una página real dibujada al ancho de un celular (390 px) o de una
 * computadora (1280 px) y achicada para entrar, sin bordes blancos: el marco
 * mide exactamente lo que ocupa la página. En celular el marco tiene 390 px
 * (o menos si no entra) y se centra; en computadora ocupa todo el ancho.
 * El borde es un ring (sombra), no un border: así no le resta ancho al marco.
 */
export function ScaledFrame({ src, title, device, height, iframeRef, bg = "#ffffff", lazy }: {
  src: string; title: string; device: Device; height: number; iframeRef?: Ref<HTMLIFrameElement>; bg?: string; lazy?: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const vw = device === "desktop" ? 1280 : 390;
  const frameW = avail ? Math.floor(device === "desktop" ? avail : Math.min(vw, avail)) : 0;
  const scale = frameW ? frameW / vw : 1;
  return (
    <div ref={outer} className="w-full min-w-0">
      <div className="relative mx-auto overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-700"
        style={{ width: frameW || "100%", height, background: bg }}>
        {frameW > 0 && (
          <iframe
            ref={iframeRef}
            title={title}
            src={src}
            loading={lazy ? "lazy" : undefined}
            referrerPolicy="no-referrer"
            style={{
              position: "absolute", left: 0, top: 0, width: vw, height: Math.ceil(height / scale), border: 0, display: "block",
              background: bg, transform: `scale(${scale})`, transformOrigin: "0 0",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function DeviceSwitch({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  return (
    <div className="ad-seg">
      <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => onChange("mobile")}><Smartphone size={13} className="mr-1 inline" />Celular</button>
      <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => onChange("desktop")}><Monitor size={13} className="mr-1 inline" />Computadora</button>
    </div>
  );
}

/**
 * Vista previa de una página con el selector Celular / Computadora.
 *
 * `deferred`: no carga hasta que se toca. Una landing ajena ejecuta sus
 * scripts al abrirse (pixel de Meta incluido): cada vez que se abre el panel
 * sumaría una visita falsa a las estadísticas de la campaña.
 */
export default function DevicePreview({ src, title, height = 620, deferred, note }: { src: string; title: string; height?: number; deferred?: boolean; note?: string }) {
  const [device, setDevice] = useState<Device>("mobile");
  const [on, setOn] = useState(!deferred);
  if (!on) {
    return (
      <div className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-10 text-center dark:border-zinc-700 dark:bg-white/[0.03]">
        <button type="button" className="ad-btn" onClick={() => setOn(true)}><Eye size={14} /> Ver la vista previa acá</button>
        {note && <p className="ad-note max-w-[340px] text-[11.5px]">{note}</p>}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="mb-2.5"><DeviceSwitch device={device} onChange={setDevice} /></div>
      <ScaledFrame src={src} title={title} device={device} height={height} />
    </div>
  );
}
