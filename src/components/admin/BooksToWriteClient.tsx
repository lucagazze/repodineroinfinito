"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Bot, Check, Eye, Loader2, RefreshCw, Send } from "lucide-react";
import type { ReadyFile } from "@/lib/admin/presale-shared";

async function post(body: unknown) {
  const r = await fetch("/api/admin/preventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
const mb = (b: number | null) => (b == null ? "" : ` · ${(b / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`);

/** Un libro ya subido: «Ver cómo quedó» (el PDF en Drive) y, si alguien lo esperaba, «Avisar a N». */
export function BookDone({ id, name, files, pending }: { id: string; name: string; files: ReadyFile[]; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const notify = async () => {
    const list = files.map((f) => `• ${f.title}${mb(f.bytes)}`).join("\n");
    if (!window.confirm(`¿Avisar a ${pending} ${pending === 1 ? "comprador" : "compradores"} de «${name}» que ya está?\n\nEn la carpeta está:\n${list || "(se vuelve a verificar al mandar)"}\n\nLes llega el mail de entrega de su pedido con el link a la carpeta.`)) return;
    setBusy(true);
    try {
      const j = await post({ action: "notify", productId: id });
      setMsg(`Avisados: ${j.sent}${j.failed?.length ? ` · fallaron ${j.failed.length}` : ""}`);
      router.refresh();
    } catch (e) { window.alert((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2">
      {files.map((f, i) => (
        <a key={f.id} href={`https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer" title={`${f.title}${mb(f.bytes)}`}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 font-semibold text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-200">
          <Eye className="h-3.5 w-3.5" /> {files.length > 1 ? `Ver PDF ${i + 1}` : "Ver cómo quedó"}
        </a>
      ))}
      {pending > 0 && (
        <button type="button" onClick={notify} disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-violet-600 px-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Avisar a {pending}
        </button>
      )}
      {msg && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{msg}</span>}
    </span>
  );
}

/**
 * «Avisar a todos»: todos los libros hechos que tienen compradores esperando, de una. Uno por uno
 * (cada aviso verifica su carpeta y manda sus mails), así un libro lento no corta a los demás.
 */
export function NotifyAll({ books }: { books: { id: string; name: string; pending: number }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const total = books.reduce((s, b) => s + b.pending, 0);
  if (books.length < 2 && !msg) return null;
  const run = async () => {
    const list = books.map((b) => `• ${b.name} · ${b.pending} ${b.pending === 1 ? "comprador" : "compradores"}`).join("\n");
    if (!window.confirm(`¿Avisar a ${total} ${total === 1 ? "comprador" : "compradores"} que sus libros ya están?\n\n${list}\n\nA cada uno le llega el mail de entrega de su pedido con el link a la carpeta.`)) return;
    let sent = 0;
    const failed: string[] = [];
    for (const [i, b] of books.entries()) {
      setBusy(`Avisando ${i + 1}/${books.length}…`);
      try {
        const j = await post({ action: "notify", productId: b.id });
        sent += Number(j.sent ?? 0);
        if (j.failed?.length) failed.push(`${b.name} (${j.failed.length})`);
      } catch (e) { failed.push(`${b.name}: ${(e as Error).message}`); }
    }
    setBusy(null);
    setMsg(`Avisados: ${sent}${failed.length ? ` · fallaron: ${failed.join(", ")}` : ""}`);
    router.refresh();
  };
  return (
    <span className="flex items-center gap-2 text-[12px]">
      <button type="button" onClick={run} disabled={!!busy || !books.length}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-violet-600 px-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {busy ?? `Avisar a todos (${books.length} libros · ${total})`}
      </button>
      {msg && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{msg}</span>}
    </span>
  );
}

/** «Avisarme cuando un libro está hecho»: prende o apaga la notificación «📗 Libro terminado». */
export function AlertToggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await post({ action: "alert_pref", on: !on }); setOn(!on); }
    catch (e) { window.alert((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200"
      title="Te llega una notificación cuando aparece el PDF de un libro en su carpeta">
      <input type="checkbox" checked={on} disabled={busy} onChange={toggle} className="h-3.5 w-3.5 accent-violet-600" />
      {on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5 text-zinc-400" />} Avisarme al terminar
    </label>
  );
}

/** «Copiar prompt»: el pedido completo para que una IA escriba el libro (o todos, con un agente por libro). */
export function CopyPrompt({ text, label, strong }: { text: string; label: string; strong?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2200); } catch { window.prompt("Copiá el prompt:", text); }
  };
  return (
    <button type="button" onClick={copy} title="Copia un prompt completo para pegarle a Claude (u otra IA con acceso a esta computadora)"
      className={`inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold ${strong ? "bg-violet-600 text-white hover:bg-violet-700" : "border border-zinc-200 bg-white text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-200"}`}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />} {done ? "Copiado: pegalo en la IA" : label}
    </button>
  );
}

/** Revisar las carpetas ya, sin esperar el repaso de cada 15 min. */
export function ScanNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const scan = async () => {
    setBusy(true);
    try {
      const j = await post({ action: "scan" });
      setMsg(j.ready?.length ? `Ya están: ${j.ready.join(", ")}` : "Nada nuevo todavía");
      router.refresh();
    } catch (e) { window.alert((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <span className="flex items-center gap-2 text-[12px]">
      {msg && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{msg}</span>}
      <button type="button" onClick={scan} disabled={busy}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 px-3 font-semibold text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Revisar carpetas
      </button>
    </span>
  );
}
