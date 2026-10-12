"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, HardDrive, ImagePlus, Link2, Loader2, Pencil, Plus } from "lucide-react";
import { createSoloLink, updateProductField, uploadProductCover } from "@/lib/admin/actions";
import { Pv } from "./Priv";

/**
 * Productos de una oferta en una sola tabla, con edición rápida: click en la
 * celda → se edita ahí; Enter o salir guarda, Esc cancela. Se ve el cambio al
 * instante y si el servidor lo rechaza vuelve a lo que había. Al final, el
 * link para vender cada producto por separado.
 */

/** El papel de un producto en la oferta: n = nivel del OTO (1..3) o del OTO al que sigue el downsell. */
export type RoleTag = { key: "main" | "bonus" | "bump" | "oto" | "downsell"; n?: number };
export type QPrice = { currency: string; amount: number | null; compare_at: number | null };
export type QLink = { label: string; url: string };
export type QRow = {
  id: string; alias: string; active: boolean; roles: RoleTag[];
  name: string; short_name: string; description: string;
  image: string | null; delivery_url: string | null; file: string | null;
  /** Los PDF de la entrega (de la carpeta), para abrirlos directo. */
  pdfs?: { id: string; title: string }[];
  prices: QPrice[];
  /** Links de venta: el checkout de la oferta (principal, uno por mercado) o el de producto solo. */
  links: QLink[];
  /** Se puede crear su link de producto solo (tiene precio y no es el principal). */
  canCreate: boolean;
  /** Variantes de precio del mismo libro (products.variant_of): se muestran plegadas debajo. */
  variants: QRow[];
};

type Tone = "ok" | "warn" | "bad";

const ROLE_CLS = {
  main: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25",
  bonus: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  bump: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/25",
  oto: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25",
  downsell: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
};
const roleInfo = (r: RoleTag): [string, string] => {
  switch (r.key) {
    case "main": return ["Principal", "Lo que se compra en el checkout"];
    case "bonus": return ["Bono", "Va de regalo con la compra"];
    case "bump": return ["Upsell", "Order bump: se suma dentro del checkout, antes de pagar"];
    case "oto": return [`OTO ${r.n ?? 1}`, `Oferta de 1 clic después de pagar, nivel ${r.n ?? 1}`];
    default: return [`Downsell ${r.n ?? 1}`, `Se ofrece si rechaza el OTO ${r.n ?? 1}`];
  }
};
const tagKey = (r: RoleTag) => `${r.key}${r.n ?? ""}`;

function RoleBadge({ r }: { r: RoleTag }) {
  const [label, title] = roleInfo(r);
  return <span title={title} className={`inline-flex whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-black ring-1 ring-inset ${ROLE_CLS[r.key]}`}>{label}</span>;
}

const fmt = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  } catch { return `${cur} ${n}`; }
};
/** Lo mismo que entiende el servidor: coma decimal y puntos de miles, o punto decimal. */
const parsePrice = (s: string) => {
  let t = s.replace(/[^\d.,]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
/** «Drive» para los links de Google Drive; si no, el dominio. */
const hostLabel = (u: string) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return /(^|\.)(drive|docs)\.google\.com$/.test(h) ? "Drive" : h;
  } catch { return "Link"; }
};
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Una celda que se vuelve campo al tocarla. */
function Editable({ value, display, onSave, placeholder, money, label }: {
  value: string; display: ReactNode; onSave: (v: string) => void; placeholder?: string; money?: boolean; label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const open = () => { setDraft(value); done.current = false; setEditing(true); };
  // Enter desmonta el campo y el navegador puede disparar blur igual: se guarda una sola vez.
  const close = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save && draft.trim() !== value.trim()) onSave(draft);
  };
  if (editing) {
    return (
      <input autoFocus aria-label={label} data-pv-blur value={draft} placeholder={placeholder}
        inputMode={money ? "decimal" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => close(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); close(true); }
          else if (e.key === "Escape") { e.preventDefault(); close(false); }
        }}
        className={`ad-in h-8 rounded-lg px-2 text-[12.5px] ${money ? "text-right tabular-nums" : ""}`} />
    );
  }
  return (
    <button type="button" onClick={open} title="Click para editar" aria-label={`Editar ${label}`}
      className={`group/e -mx-2 flex min-h-8 w-[calc(100%+16px)] cursor-text items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-white/[0.06] ${money ? "justify-end text-right" : ""}`}>
      <span className="min-w-0 flex-1">{display}</span>
      <Pencil className="h-3 w-3 shrink-0 text-zinc-300 opacity-0 transition-opacity group-hover/e:opacity-100 dark:text-zinc-600" />
    </button>
  );
}

function Cover({ row, onPick, busy }: { row: QRow; onPick: (f: File) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={busy} title="Cambiar la tapa" aria-label="Cambiar la tapa"
        className="group/c relative block h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/5 bg-zinc-100 dark:border-white/10 dark:bg-zinc-800">
        {row.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img data-pv-img src={row.image} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <ImagePlus className="m-auto h-4 w-4 text-zinc-400" />}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover/c:opacity-100"}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </>
  );
}

const iconBtn = "shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/[0.06] dark:hover:text-white";

function CopyBtn({ url, what = "el link" }: { url: string; what?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title={`Copiar ${what}`} aria-label={`Copiar ${what}`} className={iconBtn}
      onClick={async () => { try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1400); } catch { /* sin permiso de portapapeles */ } }}>
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function OpenBtn({ url, what = "el link" }: { url: string; what?: string }) {
  return <a href={url} target="_blank" rel="noreferrer" title={`Abrir ${what}`} aria-label={`Abrir ${what}`} className={iconBtn}><ExternalLink className="h-3.5 w-3.5" /></a>;
}

export default function ProductsTable({ store, offerKey, market, base, currency, rate, initial }: {
  store: string; offerKey: string; market: string | null; base: string; currency: string; rate: number | null; initial: QRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: Tone; n: number } | null>(null);
  useEffect(() => { setRows(initial); }, [initial]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "ok" ? 1800 : 4200);
    return () => clearTimeout(t);
  }, [toast]);
  const say = (msg: string, tone: Tone) => setToast({ msg, tone, n: Date.now() });

  const [open, setOpen] = useState<Set<string>>(new Set());
  // Cambia la fila o la variante con ese id (las variantes viven dentro de su producto base).
  const patchRow = (id: string, fn: (r: QRow) => QRow) => setRows((rs) => rs.map((r) => (r.id === id ? fn(r)
    : r.variants.some((v) => v.id === id) ? { ...r, variants: r.variants.map((v) => (v.id === id ? fn(v) : v)) } : r)));

  /** Cambio optimista de una celda; si el servidor dice que no, se deshace solo esa celda. */
  async function save(row: QRow, field: "name" | "short_name" | "description" | "delivery_url", value: string) {
    const before = row[field];
    const next = field === "delivery_url" ? value.trim() || null : value.trim();
    patchRow(row.id, (r) => ({ ...r, [field]: next }));
    const res = await updateProductField(store, row.id, { field, value });
    if (res.error) { patchRow(row.id, (r) => ({ ...r, [field]: before })); say(res.error, "bad"); return; }
    say(res.details?.[0] ?? "Guardado ✓", res.details?.length ? "warn" : "ok");
  }

  async function savePrice(row: QRow, field: "amount" | "compare_at", raw: string) {
    const before = row.prices;
    const n = parsePrice(raw);
    const has = row.prices.some((p) => p.currency === currency);
    const prices = field === "amount" && n == null
      ? row.prices.filter((p) => p.currency !== currency)
      : has ? row.prices.map((p) => (p.currency === currency ? { ...p, [field]: n } : p))
        : [...row.prices, { currency, amount: null, compare_at: null, [field]: n }];
    patchRow(row.id, (r) => ({ ...r, prices }));
    const res = await updateProductField(store, row.id, { field, currency, value: raw });
    if (res.error) { patchRow(row.id, (r) => ({ ...r, prices: before })); say(res.error, "bad"); return; }
    say(res.details?.[0] ? `Guardado ✓ · ${res.details[0]}` : "Guardado ✓", res.details?.length ? "warn" : "ok");
  }

  async function cover(row: QRow, f: File) {
    const before = row.image;
    const local = URL.createObjectURL(f);
    patchRow(row.id, (r) => ({ ...r, image: local }));
    setBusy(`img:${row.id}`);
    const fd = new FormData();
    fd.set("file", f);
    const res = await uploadProductCover(store, row.id, fd);
    setBusy(null);
    if (res.error) { patchRow(row.id, (r) => ({ ...r, image: before })); say(res.error, "bad"); }
    else { patchRow(row.id, (r) => ({ ...r, image: String(res.data?.image ?? local) })); say(res.ok ?? "Guardado ✓", "ok"); }
    setTimeout(() => URL.revokeObjectURL(local), 5000);
  }

  async function createLink(row: QRow) {
    setBusy(`link:${row.id}`);
    const res = await createSoloLink(store, offerKey, row.id, market, currency);
    setBusy(null);
    if (res.error) { say(res.error, "bad"); return; }
    const url = String(res.data?.url ?? "");
    if (url) patchRow(row.id, (r) => ({ ...r, links: [{ label: "", url }] }));
    say(res.ok ?? "Link creado ✓", "ok");
  }

  const priceCell = (row: QRow, field: "amount" | "compare_at") => {
    const own = row.prices.find((p) => p.currency === currency);
    const usd = row.prices.find((p) => p.currency === "USD");
    const v = own?.[field] ?? null;
    // Sin precio fijo en la moneda del mercado, el checkout lo calcula desde USD.
    const auto = !own && currency !== "USD" && rate && usd?.[field] != null ? Number(usd[field]) * rate : null;
    const others = row.prices.filter((p) => p.currency !== currency)
      .map((p) => `${p.currency} ${p[field] == null ? "—" : fmt(Number(p[field]), p.currency)}`);
    const display = v != null
      ? (field === "amount" && Number(v) === 0 ? <span className="font-semibold text-zinc-400">Gratis</span>
        : <b className={field === "compare_at" ? "font-semibold text-zinc-400 line-through decoration-zinc-300" : ""}>{fmt(Number(v), currency)}</b>)
      : auto != null ? <span className="text-zinc-400" title="Sin precio fijo: se calcula desde USD">≈ {fmt(Math.round(auto * 100) / 100, currency)} <span className="text-[11.5px] font-semibold">auto</span></span>
        : <span className="text-zinc-300 dark:text-zinc-600">—</span>;
    return (
      <td className="num" title={others.length ? `Otras monedas: ${others.join(" · ")}` : undefined}>
        <Editable money label={field === "amount" ? "precio" : "precio sin descuento"}
          value={v == null ? "" : String(v).replace(".", ",")} placeholder={currency} display={display}
          onSave={(s) => savePrice(row, field, s)} />
      </td>
    );
  };

  const rowEl = (r: QRow, sub: boolean) => (
                <tr key={r.id} className={`align-middle ${sub ? "bg-zinc-50/70 dark:bg-white/[0.015]" : ""}`}>
                  <td><div className={`flex flex-wrap items-center gap-1 ${sub ? "pl-3" : ""}`}>{sub && <span className="text-zinc-300 dark:text-zinc-600">↳</span>}{r.roles.map((x) => <RoleBadge key={tagKey(x)} r={x} />)}</div></td>
                  <td><Cover row={r} busy={busy === `img:${r.id}`} onPick={(f) => cover(r, f)} /></td>
                  <td>
                    <div className="flex min-w-0 items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <Editable label="título" value={r.name} onSave={(v) => save(r, "name", v)}
                          display={<b className="line-clamp-2 text-[13px] leading-snug" title={r.name}><Pv as={r.alias}>{r.name}</Pv></b>} />
                        <Editable label="nombre corto" value={r.short_name} onSave={(v) => save(r, "short_name", v)}
                          display={<span className="block truncate text-[11px] font-semibold text-zinc-400">
                            Corto: <Pv as={r.alias}>{r.short_name}</Pv>{!r.active && <span className="ml-1.5 text-[11.5px] font-semibold">· Archivado</span>}
                          </span>} />
                        {!sub && r.variants.length > 0 && (
                          <button type="button" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                            aria-expanded={open.has(r.id)}
                            className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold text-violet-600 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10">
                            <ChevronDown className={`h-3 w-3 transition-transform ${open.has(r.id) ? "rotate-180" : ""}`} />
                            +{r.variants.length} {r.variants.length === 1 ? "variante" : "variantes"} de precio
                          </button>
                        )}
                      </div>
                      <Link href={`${base}/${r.id}`} title="Ver detalle" aria-label="Ver detalle" className={`${iconBtn} mt-1.5`}><ChevronRight className="h-4 w-4" /></Link>
                    </div>
                  </td>
                  <td>
                    <Editable label="qué es" value={r.description} onSave={(v) => save(r, "description", v)} placeholder="Una línea que lo describa"
                      display={r.description
                        ? <span data-pv-blur title={r.description} className="line-clamp-2 text-[12.5px] leading-snug text-zinc-600 dark:text-zinc-300">{r.description}</span>
                        : <span className="text-[12px] text-zinc-300 dark:text-zinc-600">Sin descripción</span>} />
                  </td>
                  {priceCell(r, "amount")}
                  {priceCell(r, "compare_at")}
                  <td>
                    <div className="flex min-w-0 items-center gap-0.5">
                      <div className="min-w-0 flex-1">
                        <Editable label="link de entrega" value={r.delivery_url ?? ""} onSave={(v) => save(r, "delivery_url", v)} placeholder="https://drive.google.com/…"
                          display={r.delivery_url
                            ? <span title={r.delivery_url} className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300">
                              <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-400" /><span className="truncate">{hostLabel(r.delivery_url)}</span>
                            </span>
                            : r.file ? <span className="block truncate text-[12px] font-semibold text-zinc-500">{r.file}</span>
                              : r.roles.some((x) => x.key === "bonus") && !r.roles.some((x) => x.key === "main") ? <span className="text-[12px] text-zinc-400">Dentro del principal</span>
                                // Un producto archivado (lugar guardado para uno que todavía no salió) no se vende: no le falta nada.
                                : !r.active ? <span className="inline-flex rounded-md bg-zinc-100 px-1.5 py-[2px] text-[10.5px] font-bold text-zinc-500 dark:bg-white/5 dark:text-zinc-400">Próximamente</span>
                                  : <span className="text-[12px] font-bold text-red-600 dark:text-red-400" title="Se vende y no tiene con qué entregarse: quedó un aviso para Claude.">Falta el link</span>} />
                      </div>
                      {r.pdfs?.[0] && (
                        <a href={`https://drive.google.com/file/d/${r.pdfs[0].id}/view`} target="_blank" rel="noreferrer" title={`Abrir ${r.pdfs[0].title}`}
                          className="inline-flex h-7 shrink-0 items-center rounded-md bg-emerald-50 px-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25">📄 PDF</a>
                      )}
                      {r.delivery_url && <><OpenBtn url={r.delivery_url} what="la entrega" /><CopyBtn url={r.delivery_url} what="el link de entrega" /></>}
                    </div>
                  </td>
                  <td>
                    {r.links.length ? (
                      <div className="flex min-w-0 items-center gap-0.5" title={r.links.length > 1 ? r.links.map((l) => `${l.label}: ${l.url}`).join("\n") : r.links[0].url}>
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        <span data-pv-blur className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-300">{shortUrl(r.links[0].url)}</span>
                        {r.links.length > 1 && <span className="shrink-0 text-[10px] font-black text-zinc-400">+{r.links.length - 1}</span>}
                        <OpenBtn url={r.links[0].url} /><CopyBtn url={r.links[0].url} />
                      </div>
                    ) : r.canCreate ? (
                      <button type="button" onClick={() => createLink(r)} disabled={busy === `link:${r.id}`} className="ad-btn sm">
                        {busy === `link:${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Crear link
                      </button>
                    ) : <span className="text-[12px] text-zinc-300 dark:text-zinc-600" title={`Sin precio en ${currency}: no se vende solo`}>—</span>}
                  </td>
                </tr>
  );

  const withLinks = rows.flatMap((r) => [r, ...r.variants]).filter((r) => r.links.length);

  return (
    <div className="ad-grid">
      <section className="ad-card overflow-hidden">
        <div className="ad-scroll">
          {/* Entra entera en una pantalla de 1440; más angosta, se desliza dentro de la tarjeta. */}
          <table className="ad-table min-w-[1100px] table-fixed [&_td]:!px-3 [&_th]:!px-3">
            <colgroup>
              <col style={{ width: 100 }} /><col style={{ width: 64 }} /><col /><col />
              <col style={{ width: 96 }} /><col style={{ width: 104 }} /><col style={{ width: 156 }} /><col style={{ width: 200 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Tipo</th><th>Imagen</th><th>Título</th><th>Qué es</th>
                <th className="num">Precio</th><th className="num !whitespace-normal !leading-tight">Precio sin descuento</th><th>Entrega</th><th>Link de venta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  {rowEl(r, false)}
                  {open.has(r.id) && r.variants.map((v) => rowEl(v, true))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-zinc-100 px-5 py-3 text-[11.5px] font-medium text-zinc-400 dark:border-white/[0.05]">
          Click en una celda para editarla: Enter guarda, Esc cancela. Precios en {currency}{currency !== "USD" ? "; vacío = se calcula desde USD" : ""}. Los compradores ven el cambio al momento.
        </p>
      </section>

      <section className="ad-card">
        <div className="ad-card-h"><div><h3>Links de venta</h3><p>Para vender cada producto por separado. El del principal es el checkout de la oferta.</p></div></div>
        {withLinks.length ? (
          <ul className="divide-y divide-zinc-100 px-5 pb-3 dark:divide-white/[0.05]">
            {withLinks.flatMap((r) => r.links.map((l, i) => (
              <li key={`${r.id}-${i}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-2">
                  <RoleBadge r={r.roles[0]} />
                  <b className="truncate text-[12.5px]"><Pv as={r.alias}>{r.short_name}</Pv></b>
                  {l.label && <span className="shrink-0 text-[11px] font-semibold text-zinc-400">{l.label}</span>}
                </span>
                <span className="flex min-w-0 flex-[2] basis-[260px] items-center gap-0.5">
                  <span data-pv-blur className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-600 dark:text-zinc-300">{l.url}</span>
                  <OpenBtn url={l.url} /><CopyBtn url={l.url} />
                </span>
              </li>
            )))}
          </ul>
        ) : <p className="ad-note px-5 pb-5">Todavía ningún producto tiene link propio. Tocá «Crear link» en la tabla.</p>}
      </section>

      {toast && (
        <div key={toast.n} role="status" aria-live="polite"
          className={`fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-full px-4 py-2 text-[12.5px] font-bold text-white shadow-xl ${toast.tone === "ok" ? "bg-zinc-900 dark:bg-white dark:text-zinc-900" : toast.tone === "warn" ? "bg-amber-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
