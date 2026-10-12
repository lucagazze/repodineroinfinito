"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { api, nf } from "./client";
import { LOCALES, LOCALE_ES, type Locale } from "@/lib/mkt/consts";
import type { Segment } from "@/lib/mkt/types";

/**
 * Armador de segmentos con el número en vivo (lo cuenta la base, con las
 * exclusiones fijas: bajas, rebotes, quejas, reembolsos y contracargos).
 */
export type SegOpts = {
  offers: { id: string; name: string; category: string | null; market: string | null }[];
  categories: string[];
  markets: string[];
  campaigns: { id: string; name: string }[];
};
export type Count = { total: number; by_locale: Record<string, number> };

function Chips<T extends string>({ items, value, onChange, label }: { items: [T, string][]; value: T[] | undefined; onChange: (v: T[]) => void; label: string }) {
  const set = new Set(value ?? []);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={set.has(k)}
          onClick={() => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); onChange([...n]); }}
          className={`max-w-full truncate rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-colors ${set.has(k) ? "bg-white text-zinc-900" : "bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.05] py-3 first:border-t-0 first:pt-0">
      <p className="mb-2 text-[12px] font-semibold text-zinc-300">{title}{hint && <span className="ml-1.5 font-normal text-zinc-500">{hint}</span>}</p>
      {children}
    </div>
  );
}

export function CountBadge({ count, busy }: { count: Count | null; busy: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-opacity ${busy ? "opacity-60" : ""}`}>
      <Users className="h-4 w-4 text-pink-400" />
      <b className="text-[15px] tabular-nums text-white">{count ? nf(count.total) : "…"}</b>
      <span className="text-[12px] text-zinc-400">personas</span>
      {count && Object.entries(count.by_locale).sort((a, b) => b[1] - a[1]).map(([l, n]) => (
        <span key={l} className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300">{LOCALE_ES[l as Locale] ?? l} {nf(n)}</span>
      ))}
    </div>
  );
}

/** Cuenta en vivo (con 350 ms de espera entre cambios). */
export function useLiveCount(storeId: string, seg: Segment) {
  const [count, setCount] = useState<Count | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(seg);
  useEffect(() => {
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api<Count>({ action: "count", store: storeId, segment: JSON.parse(key) })
        .then((c) => { if (n === seq.current) { setCount(c); setErr(null); } })
        .catch((e) => { if (n === seq.current) setErr((e as Error).message); })
        .finally(() => { if (n === seq.current) setBusy(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [storeId, key]);
  return { count, busy, err };
}

export default function SegmentBuilder({ value, onChange, opts, disabled }: {
  value: Segment; onChange: (s: Segment) => void; opts: SegOpts; disabled?: boolean;
}) {
  const set = <K extends keyof Segment>(k: K, v: Segment[K]) => onChange({ ...value, [k]: v });
  const offerItems = opts.offers.map((o) => [o.id, `${o.name}${o.market ? ` · ${o.market}` : ""}`] as [string, string]);
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-60">
      <Row title="Compró" hint="(cualquiera de estas ofertas)">
        <Chips items={offerItems} value={value.offers_any} onChange={(v) => set("offers_any", v)} label="Compró" />
      </Row>
      <Row title="NO tiene" hint="(ninguna de estas: lo que le querés vender)">
        <Chips items={offerItems} value={value.offers_none} onChange={(v) => set("offers_none", v)} label="No compró" />
      </Row>
      {opts.categories.length > 0 && (
        <Row title="Categoría que compró">
          <Chips items={opts.categories.map((c) => [c, c] as [string, string])} value={value.categories} onChange={(v) => set("categories", v)} label="Categoría" />
        </Row>
      )}
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Row title="Idioma">
          <Chips items={LOCALES.map((l) => [l, LOCALE_ES[l]] as [Locale, string])} value={value.locales} onChange={(v) => set("locales", v)} label="Idioma" />
        </Row>
        {opts.markets.length > 0 && (
          <Row title="Mercado del checkout">
            <Chips items={opts.markets.map((m) => [m, m] as [string, string])} value={value.markets} onChange={(v) => set("markets", v)} label="Mercado" />
          </Row>
        )}
        <Row title="País" hint="(códigos: IT, FR, US…)">
          <input className="ad-in" placeholder="Todos" defaultValue={(value.countries ?? []).join(", ")}
            onBlur={(e) => set("countries", e.target.value.toUpperCase().split(/[\s,;]+/).filter((c) => /^[A-Z]{2}$/.test(c)))} />
        </Row>
        <Row title="Última compra entre">
          <div className="flex gap-2">
            <input type="date" className="ad-in" value={value.from ?? ""} onChange={(e) => set("from", e.target.value)} aria-label="Desde" />
            <input type="date" className="ad-in" value={value.to ?? ""} onChange={(e) => set("to", e.target.value)} aria-label="Hasta" />
          </div>
        </Row>
        <Row title="Gastó al menos" hint="(USD, todo lo que compró)">
          <input type="number" min={0} step={1} className="ad-in" placeholder="Sin mínimo" value={value.spent_min ?? ""}
            onChange={(e) => set("spent_min", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} />
        </Row>
        <Row title="Excluir a los que compraron hace menos de" hint="(días)">
          <input type="number" min={0} step={1} className="ad-in" placeholder="No excluir" value={value.exclude_recent_days ?? ""}
            onChange={(e) => set("exclude_recent_days", e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))} />
        </Row>
      </div>
      {opts.campaigns.length > 0 && (
        <Row title="Según una campaña anterior">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className="ad-in" value={value.engaged?.campaign ?? ""} aria-label="Campaña"
              onChange={(e) => set("engaged", e.target.value ? { campaign: e.target.value, kind: value.engaged?.kind ?? "opened" } : null)}>
              <option value="">— ninguna —</option>
              {opts.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="ad-in sm:w-48" value={value.engaged?.kind ?? "opened"} disabled={!value.engaged} aria-label="Qué hizo"
              onChange={(e) => value.engaged && set("engaged", { ...value.engaged, kind: e.target.value as "opened" | "clicked" | "not_opened" })}>
              <option value="opened">la abrió</option>
              <option value="clicked">hizo clic</option>
              <option value="not_opened">NO la abrió</option>
            </select>
          </div>
        </Row>
      )}
      <Row title="Leads de carrito (no compraron)">
        <label className="ad-toggle">
          <input type="checkbox" checked={!!value.leads} onChange={(e) => set("leads", e.target.checked)} />
          <span className="ad-switch" />
          <span><b>Sumar los que tienen permiso</b><small>Apagado: solo compradores (RGPD). Un lead entra solo si le diste permiso a mano en Contactos.</small></span>
        </label>
      </Row>
      <p className="mt-2 text-[11.5px] text-zinc-500">Siempre fuera: dados de baja, rebotados, quejas de spam, reembolsos y contracargos.</p>
    </fieldset>
  );
}
