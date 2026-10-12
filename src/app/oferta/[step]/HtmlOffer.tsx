"use client";

import { useEffect, useMemo, useRef } from "react";
import type { OfferUi } from "@/lib/postcompra-page";
import { useOffer, type OfferMode } from "./useOffer";
import { PreviewPill } from "./PreviewPill";
import { PaySheet, PAY_COPY } from "./PaySheet";

/**
 * La OTO como landing propia (products.postcompra_html). El HTML ya viene sin
 * scripts y con las etiquetas reemplazadas; acá solo se conectan los ganchos
 * data-oto="accept" / "decline" / "error" al mismo flujo de cobro que la
 * plantilla. Contrato completo en src/lib/postcompra-html.ts.
 */

// Estilos mínimos de los estados, que la página puede pisar con los suyos.
const STATE_CSS = `
[data-oto="accept"][data-oto-state="loading"]{opacity:.7;cursor:wait;pointer-events:none}
[data-oto="accept"][data-oto-state="done"]{background:#12a150 !important;border-color:#12a150 !important;color:#fff !important;pointer-events:none}
[data-oto="error"]:empty{display:none}
.oto-msg{margin:10px 0 0;text-align:center;font:600 13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
.oto-msg.err{color:#b42318;font-weight:500}
.oto-msg.err a{color:#2645a0;font-weight:700}
.oto-msg.ok{color:#067647}
.oto-msg.pv{padding:9px 12px;border-radius:10px;background:#eff4fd;color:#1c3479}
`;
const STATE = { __html: STATE_CSS };

export default function HtmlOffer({
  html, title, locale, ui, mode, pillDetail,
}: { html: string; title: string | null; locale: string; ui: OfferUi; mode: OfferMode; pillDetail?: string }) {
  const offer = useOffer(mode);
  const { state } = offer;
  const root = useRef<HTMLDivElement>(null);
  const clicked = useRef<HTMLElement | null>(null);
  const original = useRef(new WeakMap<HTMLElement, string>());
  // Mismo objeto en cada render: si cambia, React 19 vuelve a escribir el
  // innerHTML entero y se pierde todo (el video que corría, los avisos).
  const inner = useMemo(() => ({ __html: html }), [html]);
  // Las funciones del hook cambian en cada render; los listeners leen la última.
  const actions = useRef(offer);
  actions.current = offer;
  const pay = PAY_COPY[locale as keyof typeof PAY_COPY] ?? PAY_COPY.en;

  useEffect(() => {
    if (title) document.title = title;
    document.documentElement.lang = locale;
  }, [title, locale]);

  // Ganchos: delegación en la raíz, así sirven aunque el HTML tenga cualquier forma.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const yes = t?.closest<HTMLElement>('[data-oto="accept"]');
      if (yes && el.contains(yes)) {
        e.preventDefault();
        clicked.current = yes;
        actions.current.accept();
        return;
      }
      const no = t?.closest<HTMLElement>('[data-oto="decline"]');
      if (no && el.contains(no)) {
        clicked.current = no;
        const follow = actions.current.decline();
        const href = no.getAttribute("href");
        // Un <a href> sigue solo; cualquier otro elemento hay que llevarlo.
        if (!follow) e.preventDefault();
        else if (!href || href === "#") {
          e.preventDefault();
          if (actions.current.next) window.location.href = actions.current.next;
        }
      }
    };
    el.addEventListener("click", onClick);
    // "No, gracias" como enlace real: funciona aunque el JS tarde en cargar.
    if (offer.next) {
      el.querySelectorAll<HTMLAnchorElement>('a[data-oto="decline"]').forEach((a) => (a.href = offer.next!));
    }
    return () => el.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El estado del cobro, reflejado en el HTML de la página.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll(".oto-msg").forEach((m) => m.remove());
    el.querySelectorAll<HTMLElement>('[data-oto="error"]').forEach((s) => (s.textContent = ""));

    for (const b of el.querySelectorAll<HTMLElement>('[data-oto="accept"]')) {
      if (state === "idle") b.removeAttribute("data-oto-state");
      else b.setAttribute("data-oto-state", state);
      if (b instanceof HTMLButtonElement) b.disabled = state === "loading" || state === "done";
      b.setAttribute("aria-busy", String(state === "loading"));
      const isText = b.tagName === "BUTTON" || b.tagName === "A";
      if (!isText) continue;
      if (!original.current.has(b)) original.current.set(b, b.innerHTML);
      if (state === "done") b.textContent = `✓ ${ui.added}`;
      else if (state === "loading") b.textContent = pay.processing;
      else b.innerHTML = original.current.get(b)!;
    }

    const after = (cls: string, build: (p: HTMLElement) => void) => {
      const p = document.createElement("p");
      p.className = `oto-msg ${cls}`;
      build(p);
      (clicked.current ?? el.querySelector('[data-oto="accept"]'))?.insertAdjacentElement("afterend", p);
    };

    if (offer.previewNote) {
      after("pv", (p) => (p.textContent = ui.preview));
    } else if (state === "done") {
      after("ok", (p) => (p.textContent = `${ui.cont}…`));
    } else if (state === "error") {
      const fill = (p: HTMLElement) => {
        p.textContent = `${offer.pending ? pay.pending : ui.failed} `;
        if (offer.continueHref) {
          const a = document.createElement("a");
          a.href = offer.continueHref;
          a.textContent = ui.cont;
          p.appendChild(a);
        }
      };
      const slots = el.querySelectorAll<HTMLElement>('[data-oto="error"]');
      if (slots.length) slots.forEach(fill);
      else after("err", fill);
    }
  }, [state, offer.previewNote, offer.continueHref, offer.pending, ui, pay]);

  return (
    <>
      <style dangerouslySetInnerHTML={STATE} />
      {offer.isPreview && <PreviewPill label={ui.pill} detail={pillDetail} />}
      <div ref={root} dangerouslySetInnerHTML={inner} />
      {offer.sheetProps && <PaySheet {...offer.sheetProps} />}
    </>
  );
}
