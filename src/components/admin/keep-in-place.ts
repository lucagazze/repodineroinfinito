"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

const scrolls = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
const rowOf = (list: HTMLElement, key: string) => list.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`);

/**
 * Con una fila abierta, lo que entra arriba (una compra nueva) no la corre de
 * lugar. Si el principio de la lista ya quedó fuera de la vista, se corrige el
 * scroll (de la lista si tiene el suyo, si no de la página) por lo que entró;
 * si se ve, la fila nueva entra a la vista y empuja: es lo que hay que ver.
 * Safari no hace esto solo (overflow-anchor), por eso va a mano.
 *
 * Uso: `const mark = useKeepInPlace(listRef, abierta, data)`; llamar a `mark()`
 * justo antes de `setData(...)`. Las filas llevan `data-row={clave}` y la lista
 * `[overflow-anchor:none]`, para que Chrome no corrija por su cuenta otra vez.
 */
export function useKeepInPlace(list: RefObject<HTMLElement | null>, openKey: string | null, dep: unknown) {
  const snap = useRef<{ key: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const s = snap.current;
    snap.current = null;
    const ul = list.current;
    if (!s || !ul) return;
    const el = rowOf(ul, s.key);
    if (!el) return;
    const d = el.getBoundingClientRect().top - s.top;
    if (Math.abs(d) < 1) return;
    if (scrolls(ul)) ul.scrollTop += d;
    else window.scrollBy(0, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return () => {
    const ul = list.current;
    snap.current = null;
    if (!openKey || !ul) return;
    const el = rowOf(ul, openKey);
    if (!el) return;
    const hidden = scrolls(ul) ? ul.scrollTop > 0 : ul.getBoundingClientRect().top < 0;
    if (hidden) snap.current = { key: openKey, top: el.getBoundingClientRect().top };
  };
}
