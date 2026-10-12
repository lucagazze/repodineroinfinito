"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DiagCheck } from "@/lib/admin/diagnostico";
import { IShield, IX } from "./icons";
import { testPixelAction } from "@/lib/admin/actions";

/**
 * Botón flotante «Diagnóstico de tienda». Cada vez que se toca revisa todo de
 * nuevo (Stripe, mails, entregas, tracking), sin usar lo de la vez anterior:
 * «Revisando…» mientras tanto y después «Revisado recién» / «hace X min».
 */
/** «Probar pixel ahora»: un evento de prueba por la API de Conversiones y la respuesta de Meta. */
function PixelTest({ pixelId, url }: { pixelId: string; url: string }) {
  // Sin useTransition: con una transición async en curso Next no termina ninguna navegación hasta que vuelve.
  const [pending, setPending] = useState(false);
  const [res, setRes] = useState<{ ok?: string; error?: string; details?: string[] } | null>(null);
  return (
    <div className="fix" style={{ display: "grid", gap: 4, justifyItems: "end" }}>
      <button type="button" className="ad-btn sm" disabled={pending} onClick={() => {
        if (pending) return;
        setPending(true);
        testPixelAction(pixelId, url).then(setRes).catch((e) => setRes({ error: (e as Error).message || "No se pudo probar" })).finally(() => setPending(false));
      }}>
        {pending ? "Probando…" : "Probar pixel ahora"}
      </button>
      {res && (
        <small style={{ maxWidth: 240, textAlign: "right", fontWeight: 700, color: res.error ? "#dc2626" : "#059669" }} title={(res.details ?? []).join("\n")}>
          {res.error ?? res.ok}{res.details?.length ? <span style={{ display: "block", fontWeight: 500, color: "#a1a1aa" }}>{res.details[0]}</span> : null}
        </small>
      )}
    </div>
  );
}

export default function Diagnostico({ load }: { load: () => Promise<{ store: string; checks: DiagCheck[] }> }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ store: string; checks: DiagCheck[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sin useTransition: con una transición async en curso Next no termina ninguna navegación hasta que vuelve.
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [at, setAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try { setData(await load()); setAt(Date.now()); setNow(Date.now()); } catch (e) { setError((e as Error).message || "No se pudo calcular"); }
    finally { busy.current = false; setPending(false); }
  };

  useEffect(() => {
    if (!open || !at) return;
    // Cada 30 s alcanza («hace 2 min»): un reloj por segundo redibujaba el panel abierto sin parar.
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open, at]);
  const ago = at ? Math.max(0, Math.round((now - at) / 1000)) : null;
  const agoText = ago == null ? "" : ago < 60 ? "Revisado recién" : `Revisado hace ${Math.floor(ago / 60)} min`;

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const bad = data?.checks.filter((c) => c.status === "bad").length ?? 0;
  const warn = data?.checks.filter((c) => c.status === "warn").length ?? 0;

  return (
    <>
      <button
        type="button"
        className="ad-fab"
        aria-expanded={open}
        onClick={() => { setOpen(true); run(); }}
      >
        <IShield size={18} /> <span className="l">Diagnóstico de tienda</span>
        {!!(bad || warn) && <em style={{ background: bad ? "#dc2626" : "#f59e0b" }}>{bad || warn}</em>}
      </button>
      {open && (
        <section className="ad-diag" role="dialog" aria-label="Diagnóstico de tienda">
          <header>
            <div>
              <b>Diagnóstico de tienda</b>
              <p>{pending ? "Revisando…" : data ? `${bad || warn ? `${bad} para arreglar · ${warn} para mirar` : "Todo en orden"} · ${agoText}` : data === null && !error ? "Revisando…" : ""}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="ad-btn sm" onClick={run} disabled={pending}>{pending ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> Revisando…</> : "Revisar de nuevo"}</button>
              <button type="button" className="ad-btn sm ghost" onClick={() => setOpen(false)} aria-label="Cerrar"><IX size={16} /></button>
            </div>
          </header>
          <div className="body">
            {error && <p className="ad-res bad" style={{ padding: "12px 0" }}>{error}</p>}
            {!data && !error && <p className="ad-note" style={{ padding: "14px 0" }}>Mirando Stripe, los mails, las entregas y el tracking…</p>}
            {data && (
              <ul className="ad-checklist" style={{ opacity: pending ? 0.5 : 1 }}>
                {data.checks.map((c) => (
                  <li key={c.id}>
                    <span className={`st ${c.status}`}>{c.status === "ok" ? "✓" : c.status === "bad" ? "✕" : "!"}</span>
                    <div style={{ minWidth: 0 }}>
                      <b>{c.title}</b>
                      {c.detail && <p>{c.detail}</p>}
                    </div>
                    {c.href && c.status !== "ok" && (
                      <Link className="fix ad-link-a" href={c.href} onClick={() => setOpen(false)}>{c.fix ?? "Arreglar"} →</Link>
                    )}
                    {c.action?.kind === "pixel-test" && <PixelTest pixelId={c.action.pixelId} url={c.action.url} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </>
  );
}
