"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, MailOpen, SquareArrowOutUpRight } from "lucide-react";
import { aiAnswerNowAction, markUnreadAction } from "@/lib/admin/mail-actions";

/**
 * Menú de un mail de la lista: clic derecho en la compu o mantener apretado en el celular.
 * «Marcar como no leído» y «Que responda la IA» (la manda si es de las que puede responder sola; si no,
 * avisa por qué y la sugerida queda lista al abrirlo). Envuelve la lista: los mails llevan data-mid.
 */
export default function MailMenu({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [menu, setMenu] = useState<{ id: string; href: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const opened = useRef(false);

  const open = (a: HTMLAnchorElement, x: number, y: number) => {
    const w = 230, h = 150;
    setMenu({ id: a.dataset.mid!, href: a.href, x: Math.min(x, window.innerWidth - w - 8), y: Math.min(y, window.innerHeight - h - 8) });
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (what: "unread" | "ai") => {
    if (!menu) return;
    const id = menu.id;
    setBusy(what);
    const r = what === "unread" ? await markUnreadAction(id) : await aiAnswerNowAction(id);
    setBusy(null);
    setMenu(null);
    setToast(r.error ? { ok: false, text: r.error } : { ok: true, text: r.ok ?? "Listo" });
    router.refresh();
  };

  const target = (el: EventTarget | null) => (el as Element | null)?.closest?.<HTMLAnchorElement>("a[data-mid]") ?? null;
  return (
    <div
      onContextMenu={(e) => { const a = target(e.target); if (!a) return; e.preventDefault(); open(a, e.clientX, e.clientY); }}
      // Celular: mantener apretado medio segundo (iPhone no tiene clic derecho).
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        const a = target(e.target);
        if (!a) return;
        const { clientX: x, clientY: y } = e;
        opened.current = false;
        press.current = { x, y, t: setTimeout(() => { opened.current = true; open(a, x, y); }, 550) };
      }}
      onPointerMove={(e) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.t); press.current = null; } }}
      onPointerUp={() => { if (press.current) clearTimeout(press.current.t); press.current = null; }}
      onPointerCancel={() => { if (press.current) clearTimeout(press.current.t); press.current = null; }}
      // Si se abrió el menú con la presión larga, ese toque no abre el mail.
      onClickCapture={(e) => { if (opened.current) { e.preventDefault(); e.stopPropagation(); opened.current = false; } }}
      style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
    >
      {children}
      {menu && (
        <>
          <div className="fixed inset-0 z-[500]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div role="menu" className="fixed z-[501] w-[230px] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-2xl dark:border-white/10 dark:bg-zinc-900" style={{ left: menu.x, top: menu.y }}>
            <a role="menuitem" href={menu.href} className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-zinc-700 no-underline hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/5">
              <SquareArrowOutUpRight className="h-4 w-4 text-zinc-400" /> Abrir
            </a>
            <button role="menuitem" type="button" disabled={!!busy} onClick={() => void run("unread")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-white/5">
              {busy === "unread" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailOpen className="h-4 w-4 text-zinc-400" />} Marcar como no leído
            </button>
            <button role="menuitem" type="button" disabled={!!busy} onClick={() => void run("ai")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60 dark:text-violet-300 dark:hover:bg-violet-500/10">
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} {busy === "ai" ? "La IA está respondiendo…" : "Que responda la IA"}
            </button>
          </div>
        </>
      )}
      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-[502] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 rounded-xl px-4 py-3 text-[13px] font-semibold shadow-2xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
