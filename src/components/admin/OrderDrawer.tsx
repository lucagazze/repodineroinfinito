"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, CreditCard, ExternalLink, Loader2, Pencil, Send, Smartphone, Wallet, X } from "lucide-react";
import type { PulseOrder } from "@/lib/admin/pulse";
import type { DrawerData } from "@/app/api/admin/pedido/[id]/route";
import { PANEL_TZ } from "@/lib/admin/range";
import { countryName } from "./WorldMap";
import { Flag } from "./RecentOrders";
import { Pv } from "./Priv";
import NetChip from "./NetChip";

/**
 * El cajón de un pedido (Inicio › Últimos pagos), como la orden de la plataforma anterior:
 * número, estado y fecha; el cliente (con «Editar» del email y «Reenviar»); lo
 * que compró; el pago (medio, Stripe, ID copiable) y el seguimiento del mail
 * de entrega. Lo de la fila se ve al instante; el resto se pide al abrir.
 * Se cierra con ×, Esc o «atrás» del navegador/celular.
 */

const money = (n: number, cur: string | null) => {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${cur} ${n}`; }
};
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PANEL_TZ }).replace(".", "");
const ROLE = {
  main: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  bump: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  oto: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  downsell: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300",
};

export function PayChip({ o }: { o: Pick<PulseOrder, "status" | "pay"> }) {
  const refunded = o.status === "refunded";
  const partial = !refunded && /parcial/i.test(o.pay.label);
  const ok = !refunded && !partial && o.pay.tone === "ok";
  const cls = ok ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300"
    : refunded || partial ? "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-300"
      : o.pay.tone === "bad" ? "bg-red-500/10 text-red-600 ring-red-500/25 dark:text-red-300" : "bg-white/5 text-zinc-500 ring-white/10 dark:text-zinc-300";
  return (
    <span title={o.pay.title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[11.5px] font-semibold ring-1 ring-inset ${cls}`}>
      {ok && <Check className="h-3 w-3" />}{refunded ? "Reembolsado" : partial ? "Parcial" : o.pay.label === "Pagado" ? "Aprobado" : o.pay.label}
    </span>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-[12.5px] font-semibold text-zinc-400">{title}</h4>{action}
      </div>
      {children}
    </section>
  );
}

function Step({ done, label, at, bad, note }: { done: boolean; label: string; at?: string | null; bad?: boolean; note?: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${bad ? "bg-red-500/15 text-red-400" : done ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-zinc-600"}`}>
        {bad ? <X className="h-3 w-3" /> : done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-medium ${bad ? "text-red-300" : done ? "text-zinc-100" : "text-zinc-500"}`}>{label}</span>
        {(at || note) && <span className="block text-[11.5px] text-zinc-500">{at ? dateTime(at) : ""}{at && note ? " · " : ""}{note}</span>}
      </span>
    </li>
  );
}

export default function OrderDrawer({ order, onClose }: { order: PulseOrder; onClose: () => void }) {
  const [d, setD] = useState<DrawerData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"email" | "resend" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Datos al abrir (y otra vez si cambia de pedido).
  useEffect(() => {
    let on = true;
    setD(null); setErr(null); setMsg(null); setEditing(false);
    fetch(`/api/admin/pedido/${order.id}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as DrawerData; })
      .then((j) => { if (on) setD(j); })
      .catch((e: Error) => { if (on) setErr(e.message); });
    return () => { on = false; };
  }, [order.id]);

  // «Atrás» del navegador o del celular cierra el cajón (no se va de la página); Esc también.
  useEffect(() => {
    // Se suma a lo que guarda Next en el historial (si no, al volver con «adelante» recargaría la página).
    history.pushState({ ...(history.state ?? {}), panelDrawer: order.id }, "");
    const onPop = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); history.back(); } };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [order.id]);
  const close = () => history.back();

  const saveEmail = async () => {
    const email = draft.trim();
    if (!email || email === d?.email) { setEditing(false); return; }
    if (!window.confirm(`¿Cambiar el email del pedido ${order.ref} a ${email}?`)) return;
    setBusy("email"); setMsg(null);
    try {
      const r = await fetch(`/api/admin/pedido/${order.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "email", email }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD((x) => (x ? { ...x, email: j.email } : x)); setEditing(false); setMsg({ ok: true, text: "Email actualizado." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const resend = async () => {
    if (!d?.email || !window.confirm(`¿Reenviar el mail de entrega a ${d.email}?`)) return;
    setBusy("resend"); setMsg(null);
    try {
      const r = await fetch(`/api/admin/pedido/${order.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resend" }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMsg({ ok: true, text: j.ok ?? "Reenviado." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sin portapapeles */ } };

  const mail = d?.mails[d.mails.length - 1] ?? null;
  const firstDl = d?.downloads[0] ?? mail?.downloadedAt ?? null;
  const PayIcon = d?.payment.kind === "wallet" ? Smartphone : d?.payment.kind === "card" ? CreditCard : Wallet;
  const place = [d?.city, d?.region].filter(Boolean).join(", ");

  return (
    <div className="fixed inset-0 z-[350]" role="dialog" aria-modal="true" aria-label={`Pedido ${order.ref}`}>
      <button type="button" aria-label="Cerrar" onClick={close} className="absolute inset-0 hidden bg-black/50 backdrop-blur-sm sm:block" />
      <div ref={panel} tabIndex={-1}
        className="absolute inset-0 flex flex-col bg-[#0c0c0e] outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[460px] sm:border-l sm:border-white/[0.08] sm:shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-mono text-[18px] font-bold text-white">{order.ref}</h3>
              <PayChip o={order} />
            </div>
            <p className="mt-1 text-[12.5px] text-zinc-500">{dateTime(order.at)} · hora de Argentina</p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          {err && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-300">No se pudo cargar todo el pedido: {err}</p>}
          {msg && <p className={`rounded-xl px-3 py-2 text-[12.5px] ${msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>{msg.text}</p>}

          <Card title="Cliente">
            <div className="space-y-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {editing ? (
                  <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveEmail(); }}>
                    <input autoFocus type="email" value={draft} onChange={(e) => setDraft(e.target.value)} className="ad-in h-9 min-w-0 flex-1 text-[13px]" aria-label="Email del pedido" />
                    <button type="submit" className="ad-btn sm primary" disabled={busy === "email"}>{busy === "email" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}</button>
                    <button type="button" className="ad-btn sm" onClick={() => setEditing(false)}>Cancelar</button>
                  </form>
                ) : (
                  <>
                    <span data-pv-blur className="min-w-0 flex-1 truncate text-[14px] font-medium text-white">{d ? d.email ?? "Sin email" : <span className="sk inline-block h-4 w-48 rounded" />}</span>
                    {d && <button type="button" className="ad-btn sm ghost" onClick={() => { setDraft(d.email ?? ""); setEditing(true); }}><Pencil className="h-3.5 w-3.5" /> Editar</button>}
                  </>
                )}
              </div>
              <p className="text-[13px] text-zinc-300">{order.buyer ? <Pv as="Cliente ••••">{order.buyer}</Pv> : <span className="text-zinc-500">Sin nombre</span>}</p>
              <p className="flex items-center gap-1.5 text-[12.5px] text-zinc-400">
                <Flag cc={order.country} w={16} />{order.country ? countryName(order.country) : "País desconocido"}{place ? ` · ${place}` : ""}
              </p>
              {order.network && <p className="flex items-center gap-1.5 text-[12.5px] text-zinc-400">Llegó desde <NetChip n={order.network} long /></p>}
              <button type="button" onClick={resend} disabled={!d?.email || order.status !== "paid" || busy === "resend"}
                className="ad-btn sm w-full justify-center" title={order.status !== "paid" ? "Solo se reenvía la entrega de un pedido pagado" : undefined}>
                {busy === "resend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Reenviar email a esta dirección
              </button>
            </div>
          </Card>

          <Card title={`Productos · ${order.items.length}`}>
            <ul className="m-0 grid list-none gap-2 p-0">
              {order.items.map((x, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2.5 text-[13px]">
                  <span className={`w-[72px] shrink-0 rounded-md px-1.5 py-[2px] text-center text-[11px] font-semibold ${ROLE[x.kind]}`}>{x.label}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200"><Pv as={x.alias}>{x.name}</Pv></span>
                  <span className={`shrink-0 tabular-nums ${x.refunded ? "text-red-400 line-through" : "text-zinc-300"}`}>{x.amount ? money(x.amount, x.currency) : "Gratis"}</span>
                </li>
              ))}
              {!order.items.length && <li className="text-[12.5px] text-zinc-500">Sin detalle de artículos.</li>}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[13px]">
              <span className="text-zinc-400">Total</span><b className="tabular-nums text-white">{money(order.amount, order.currency)}</b>
            </div>
          </Card>

          <Card title="Pago">
            <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-zinc-500">Método</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1.5 text-zinc-200">
                {!d ? <span className="sk inline-block h-4 w-32 rounded" /> : d.payment.method ? <><PayIcon className="h-4 w-4 shrink-0 text-zinc-400" /><span className="truncate">{d.payment.method}</span></> : <span className="text-zinc-500">{d.payment.error ? "No se pudo leer en Stripe" : "—"}</span>}
              </dd>
              <dt className="text-zinc-500">Pasarela</dt><dd className="m-0 text-zinc-200">Stripe</dd>
              <dt className="text-zinc-500">ID de pago</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1.5">
                {d?.payment.pi ? (
                  <>
                    <code data-pv-blur className="min-w-0 truncate text-[12px] text-zinc-300">{d.payment.pi}</code>
                    <button type="button" onClick={() => copy(d.payment.pi!)} className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Copiar ID de pago">
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </>
                ) : <span className="text-zinc-500">{d ? "—" : <span className="sk inline-block h-4 w-40 rounded" />}</span>}
              </dd>
              <dt className="text-zinc-500">Total</dt><dd className="m-0 tabular-nums text-white">{money(order.amount, order.currency)}</dd>
            </dl>
            {d?.payment.url && (
              <a href={d.payment.url} target="_blank" rel="noreferrer" className="ad-btn sm mt-3 w-full justify-center"><ExternalLink className="h-3.5 w-3.5" /> Abrir en Stripe</a>
            )}
          </Card>

          <Card title="Seguimiento del email">
            {!d ? <span className="sk block h-24 rounded-xl" /> : !mail ? (
              <p className="text-[12.5px] text-zinc-500">Todavía no salió el mail de entrega.</p>
            ) : (
              <ol className="m-0 grid list-none gap-3 p-0">
                <Step done={mail.status === "sent"} bad={mail.status === "failed"} label={mail.status === "failed" ? "No salió" : "Enviado"} at={mail.at}
                  note={mail.status === "failed" ? mail.error ?? undefined : `a ${mail.to}`} />
                {mail.bouncedAt && <Step done bad label="Rebotó" at={mail.bouncedAt} note={mail.bounceReason ?? undefined} />}
                <Step done={!!mail.openedAt} label="Abierto" at={mail.openedAt} note={mail.opens > 1 ? `${mail.opens} veces` : undefined} />
                <Step done={!!mail.clickedAt} label="Clic" at={mail.clickedAt} note={mail.clicks > 1 ? `${mail.clicks} clics` : undefined} />
                <Step done={!!firstDl} label="Descargó" at={firstDl} note={d.downloads.length > 1 ? `${d.downloads.length} descargas` : undefined} />
              </ol>
            )}
            {d && d.mails.length > 1 && <p className="mt-3 text-[11.5px] text-zinc-500">{d.mails.length} envíos: se muestra el último.</p>}
          </Card>

          <div className="grid grid-cols-2 gap-2 pb-2">
            <Link href={`/admin/avisos/pedido/${order.id}`} className="ad-btn sm justify-center">Ver pedido completo <ArrowRight className="h-3.5 w-3.5" /></Link>
            <Link href={`/admin/en-vivo/recorrido?pedido=${order.id}`} className="ad-btn sm justify-center">Recorrido <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </div>
      </div>
    </div>
  );
}
