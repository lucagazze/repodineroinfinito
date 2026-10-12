"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

export type ConvItem = {
  id: string; in: boolean; at: string; when: string;
  /** Lo nuestro: «Entrega», «Respuesta»… (sin el «IA», que va aparte: no es parte del asunto). */
  kind: string | null; ai: boolean;
  subject: string; sub: string; link: string;
  /** Se ve como el mail armado (iframe) y no como texto: para reservar el alto antes de que llegue. */
  html: boolean;
};
type Body = { text?: string; html?: string; note?: string; error?: string };

/**
 * La conversación con una persona: cada fila se abre ahí mismo y muestra el
 * mail completo (lo que escribió, nuestra respuesta o el mail de entrega tal
 * como salió). El cuerpo se pide recién al abrir la fila, de a uno.
 */
export default function ConvTimeline({ items, current }: { items: ConvItem[]; current?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, Body>>({});
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  // La fila tocada queda donde estaba aunque se cierre otra más arriba (sin saltos).
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a) { const d = a.el.getBoundingClientRect().top - a.top; if (Math.abs(d) > 1) window.scrollBy(0, d); }
  }, [open]);

  const toggle = (it: ConvItem, e: MouseEvent<HTMLButtonElement>) => {
    anchor.current = { el: e.currentTarget, top: e.currentTarget.getBoundingClientRect().top };
    if (open === it.id) return setOpen(null);
    setOpen(it.id);
    if (bodies[it.id] && !bodies[it.id].error) return;
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setBodies((b) => { const n = { ...b }; delete n[it.id]; return n; });
    fetch(`/api/admin/mails/body?k=${it.in ? "in" : "out"}&id=${it.id}`, { signal: c.signal, cache: "no-store" })
      .then((r) => r.json() as Promise<Body>)
      .then((body) => setBodies((b) => ({ ...b, [it.id]: body })))
      .catch((e) => { if ((e as Error).name !== "AbortError") setBodies((b) => ({ ...b, [it.id]: { error: "No se pudo cargar. Tocá de nuevo." } })); });
  };

  return (
    <ul className="ad-timeline">
      {items.map((it) => {
        const isOpen = open === it.id;
        const body = bodies[it.id];
        return (
          <li key={it.id}>
            <button type="button" onClick={(e) => toggle(it, e)} aria-expanded={isOpen}
              className={`group flex w-full items-start gap-2 rounded-lg text-left ${it.id === current ? "font-bold" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className={`mr-1.5 text-[10px] font-black uppercase tracking-wider ${it.in ? "text-sky-600 dark:text-sky-400" : "text-violet-600 dark:text-violet-400"}`}>{it.in ? "Escribió" : "Le mandamos"}</span>
                {it.kind && <span className="mr-1 font-semibold text-zinc-500 dark:text-zinc-400">{it.kind}</span>}
                {it.ai && <span className="ad-badge brand mr-1 !px-1.5 !py-0 align-[1px] !text-[9.5px]">IA</span>}
                {it.kind && <span className="mr-1 text-zinc-300 dark:text-zinc-600">·</span>}
                <span data-pv-blur className="group-hover:underline">{it.subject}</span>
                <small data-pv-blur className="font-normal">{it.when}{it.sub ? ` · ${it.sub}` : ""}</small>
              </span>
              <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="mt-2 grid gap-2">
                {!body ? (
                  // El lugar ya reservado: al llegar el mail la página no salta.
                  <div className="grid content-start gap-2 rounded-xl border border-zinc-100 p-3 dark:border-white/[0.05]" style={{ height: it.html ? "min(60dvh, 520px)" : 96 }} aria-busy="true">
                    <span className="sk" style={{ width: "85%", height: 11 }} />
                    <span className="sk" style={{ width: "70%", height: 11 }} />
                    <span className="sk" style={{ width: "50%", height: 11 }} />
                  </div>
                ) : body.error ? (
                  <p className="ad-note">{body.error}</p>
                ) : (
                  <>
                    {body.note && <p className="ad-note">{body.note}</p>}
                    {body.html ? (
                      <iframe title="Mail de la conversación" srcDoc={body.html} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
                        className="ad-frame h-[min(60dvh,520px)] w-full border border-zinc-100 bg-white dark:border-white/[0.05]" />
                    ) : (
                      <div data-pv-blur className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-[12.5px] font-normal leading-relaxed text-zinc-800 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-zinc-200">
                        {body.text || "(vacío)"}
                      </div>
                    )}
                  </>
                )}
                <Link href={it.link} prefetch={false} scroll={false} data-mail="open" className="inline-flex w-fit items-center gap-1 text-[11.5px] font-bold text-violet-600 no-underline hover:underline dark:text-violet-400">
                  <ExternalLink className="h-3 w-3" /> {it.in ? "Abrir este mail" : "Ver con aperturas y clics"}
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
