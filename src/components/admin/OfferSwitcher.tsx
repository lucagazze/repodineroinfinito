"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Globe, LayoutGrid, Search } from "lucide-react";
import { Pv } from "./Priv";
import { rangeQuery } from "@/lib/admin/range";

export type SwitchMarket = { key: string; label: string; slug: string; flags: string[]; active: boolean };
export type SwitchOffer = {
  key: string; name: string; alias: string; category: string | null; store: string; storeAlias: string;
  image: string | null; active: boolean; markets: SwitchMarket[];
  /** Cuándo se creó (para «Recientes»). */
  created?: string;
};

/** Banderas como imagen: Windows no dibuja los emojis de banderas. */
export function Flags({ codes, size = 16, max = 2 }: { codes: string[]; size?: number; max?: number }) {
  if (!codes.length) return <Globe className="shrink-0 text-zinc-400" style={{ width: size, height: size }} />;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {codes.slice(0, max).map((c) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={c} src={`https://flagcdn.com/20x15/${c}.png`} srcSet={`https://flagcdn.com/40x30/${c}.png 2x`} alt={c.toUpperCase()}
          width={Math.round(size * 1.33)} height={size} className="rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,.06)]" style={{ width: Math.round(size * 1.33), height: size }} />
      ))}
    </span>
  );
}

/**
 * La foto redonda de cada oferta: la bandera del país donde se lanza (la del primer mercado, si
 * tiene varios); sin mercado, su tapa (offers.image_url); sin nada, un globo.
 */
function Avatar({ image, flags, size = 28 }: { image: string | null; flags: string[]; size?: number }) {
  const box = "shrink-0 overflow-hidden rounded-full border border-black/5 dark:border-white/10";
  const c = flags[0];
  if (c) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://flagcdn.com/w80/${c}.png`} alt={c.toUpperCase()} width={size} height={size} className={`${box} object-cover`} style={{ width: size, height: size }} />;
  }
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img data-pv-img src={image} alt="" width={size} height={size} className={`${box} bg-white object-cover`} style={{ width: size, height: size }} />;
  }
  return <span className={`${box} flex items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-zinc-800`} style={{ width: size, height: size }}><Globe style={{ width: size * 0.55, height: size * 0.55 }} /></span>;
}

/** Las banderas de una categoría, encimadas en el lugar de una sola (hasta 3). */
function FlagStack({ codes, size = 28 }: { codes: string[]; size?: number }) {
  const cs = codes.slice(0, 3);
  if (cs.length < 2) return <Avatar image={null} flags={cs} size={size} />;
  const s = Math.round(size * 0.64);
  const at = cs.length === 2 ? [[0, 0], [size - s, size - s]] : [[0, 0], [size - s, 0], [(size - s) / 2, size - s]];
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {cs.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={c} src={`https://flagcdn.com/w40/${c}.png`} alt={c.toUpperCase()} width={s} height={s}
          className="absolute rounded-full border border-white object-cover dark:border-zinc-900" style={{ width: s, height: s, left: at[i][0], top: at[i][1] }} />
      ))}
    </span>
  );
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «Uñas»: la misma idea en varios países. Sin categoría, la oferta va sola con su nombre. */
type Cat = { id: string; name: string; offers: SwitchOffer[] };
const catName = (o: SwitchOffer) => o.category || o.name;

type Entry = { kind: "all" } | { kind: "cat"; c: Cat } | { kind: "offer"; o: SwitchOffer; c?: Cat; child?: boolean };
const hrefOf = (o: SwitchOffer) => `/admin/o/${o.key}`;

/** Las banderas de todos los mercados de una oferta, sin repetir. */
const flagsOf = (o: SwitchOffer) => [...new Set(o.markets.flatMap((m) => m.flags))];
/** El país de una oferta («EE. UU.», «Alemania»): las etiquetas de sus mercados, sin repetir. */
const placeOf = (o: SwitchOffer) => [...new Set(o.markets.map((m) => m.label).filter(Boolean))].join(", ") || "Sin mercado";

/**
 * Selector de oferta, agrupado por categoría: una fila por categoría («Uñas») que se
 * despliega por país (Uñas USA, Alemania, Francia); una categoría con una sola oferta
 * va directo. La búsqueda mira categoría, oferta, país, tienda y checkout, y abre lo
 * que encuentra. Flechas para moverse, Enter para ir (o desplegar), Esc para cerrar.
 */
export default function OfferSwitcher({ offers, current }: { offers: SwitchOffer[]; current: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [hi, setHi] = useState(0);
  // Orden de la lista: A-Z o las últimas ofertas agregadas primero (se recuerda).
  const [order, setOrder] = useState<"az" | "new">("az");
  useEffect(() => { try { if (localStorage.getItem("ad-switch-order") === "new") setOrder("new"); } catch { /* sin storage */ } }, []);
  const pickOrder = (v: "az" | "new") => { setOrder(v); try { localStorage.setItem("ad-switch-order", v); } catch { /* sin storage */ } };
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const [cs, co, cf] = (current ?? "").split("~");
  const curOffer = offers.find((o) => o.key === `${cs}~${co}`);
  const curMarket = curOffer && cf ? curOffer.markets.find((m) => m.slug === cf) : undefined;
  const isCur = (o: SwitchOffer) => !!current && (current === o.key || current.startsWith(`${o.key}~`));
  const searching = !!q.trim();

  // En modo captura cada categoría se ve como «Categoría N» (fijo: no depende de la búsqueda).
  const catAlias = useMemo(() => {
    const names = [...new Set(offers.filter((o) => o.active).map((o) => norm(catName(o))))].sort();
    return new Map(names.map((n, i) => [n, `Categoría ${i + 1}`]));
  }, [offers]);

  // Lo que queda visible con la búsqueda. Buscando, también las inactivas.
  const view = useMemo(() => {
    const t = norm(q.trim());
    const hit = (o: SwitchOffer) => !t || norm(
      `${o.name} ${o.category ?? ""} ${o.store} ${o.alias} ${o.markets.map((m) => `${m.label} ${m.slug} ${m.flags.join(" ")}`).join(" ")}`,
    ).includes(t);
    const byCat = new Map<string, Cat>();
    for (const o of offers) {
      if (!o.active || !hit(o)) continue;
      const id = norm(catName(o));
      if (!byCat.has(id)) byCat.set(id, { id, name: catName(o), offers: [] });
      byCat.get(id)!.offers.push(o);
    }
    const newest = (c: Cat) => c.offers.reduce((m, o) => (o.created && o.created > m ? o.created : m), "");
    const cats = [...byCat.values()].sort((a, b) => order === "new" ? newest(b).localeCompare(newest(a)) || a.name.localeCompare(b.name, "es") : a.name.localeCompare(b.name, "es"));
    for (const c of cats) c.offers.sort((a, b) => order === "new" ? (b.created ?? "").localeCompare(a.created ?? "") : placeOf(a).localeCompare(placeOf(b), "es"));
    const inactive = offers.filter((o) => !o.active && hit(o))
      .sort((a, b) => order === "new" ? (b.created ?? "").localeCompare(a.created ?? "") : a.name.localeCompare(b.name, "es"));
    return { cats, inactive };
  }, [offers, q, order]);
  const inactiveOpen = showOff || searching;

  const { entries, nActive } = useMemo(() => {
    const out: Entry[] = [];
    if (!searching) out.push({ kind: "all" });
    for (const c of view.cats) {
      if (c.offers.length === 1) { out.push({ kind: "offer", o: c.offers[0], c }); continue; }
      out.push({ kind: "cat", c });
      if (searching || exp.has(c.id)) for (const o of c.offers) out.push({ kind: "offer", o, c, child: true });
    }
    const n = out.length;
    if (inactiveOpen) for (const o of view.inactive) out.push({ kind: "offer", o });
    return { entries: out, nActive: n };
  }, [view, exp, searching, inactiveOpen]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    // Al abrir, la categoría de la oferta en la que estás ya desplegada.
    if (curOffer) setExp(new Set([norm(catName(curOffer))]));
    setTimeout(() => input.current?.focus(), 0);
    // Al abrir, se adelanta el esqueleto de cada oferta (prefetch hasta su loading): al elegir
    // una, la página nueva aparece al instante y los datos van llegando, sin quedarse en la vieja.
    for (const o of offers.filter((x) => x.active).slice(0, 20)) router.prefetch(hrefOf(o));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    const m = document.getElementById("ad-menu") as HTMLInputElement | null;
    if (m) m.checked = false;
    const rq = rangeQuery(new URLSearchParams(window.location.search));
    router.push(rq ? `${href}?${rq}` : href);
  };
  const toggle = (id: string) => setExp((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const act = (e: Entry) => (e.kind === "all" ? go("/admin") : e.kind === "cat" ? toggle(e.c.id) : go(hrefOf(e.o)));

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setHi((i) => Math.min(entries.length - 1, i + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (entries[hi]) act(entries[hi]); }
    else if (ev.key === "Escape") { ev.preventDefault(); setOpen(false); }
  };

  const dot = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />;
  const row = (e: Entry, i: number) => {
    const on = e.kind === "all" ? !current : e.kind === "offer" ? isCur(e.o) : false;
    const base = `flex w-full items-center gap-2 text-left transition-colors ${i === hi ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${on ? "text-violet-700 dark:text-violet-400" : "text-zinc-800 dark:text-zinc-200"}`;
    const common = { "data-i": i, role: "option", "aria-selected": i === hi, onMouseEnter: () => setHi(i) } as const;

    if (e.kind === "all") {
      return (
        <a key="all" {...common} href="/admin" onClick={(ev) => { ev.preventDefault(); act(e); }} className={`${base} px-3 py-2 text-[11.5px] font-bold`}>
          <LayoutGrid className="h-3.5 w-3.5" /> Todas las ofertas
        </a>
      );
    }

    if (e.kind === "cat") {
      const opened = searching || exp.has(e.c.id);
      const places = [...new Set(e.c.offers.map(placeOf))];
      const has = e.c.offers.some(isCur);
      return (
        <button key={`cat:${e.c.id}`} type="button" {...common} aria-expanded={opened} onClick={() => act(e)}
          className={`${base} mt-1 px-3 py-1.5 ${has ? "text-violet-700 dark:text-violet-400" : ""}`}>
          <FlagStack codes={[...new Set(e.c.offers.flatMap(flagsOf))]} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold"><Pv as={catAlias.get(e.c.id) ?? "Categoría"}>{e.c.name}</Pv></span>
            <span className="block truncate text-[11px] text-zinc-400">
              {places.length === e.c.offers.length ? `${places.length} países` : `${e.c.offers.length} ofertas`} · {places.join(", ")}
            </span>
          </span>
          {has && !opened && dot}
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${opened ? "rotate-90" : ""}`} />
        </button>
      );
    }

    const o = e.o;
    const click = (ev: React.MouseEvent) => { ev.preventDefault(); act(e); };
    if (e.child) {
      // Un país dentro de su categoría.
      return (
        <a key={o.key} {...common} href={hrefOf(o)} onClick={click} className={`${base} py-1.5 pl-8 pr-3`}>
          <Avatar image={o.image} flags={flagsOf(o)} size={20} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
            {placeOf(o)} <span className="font-medium text-zinc-400">· <Pv as={o.alias}>{o.name}</Pv></span>
          </span>
          {on && dot}
        </a>
      );
    }
    if (e.c) {
      // Categoría de una sola oferta: va directo, con su país.
      const named = !!o.category;
      return (
        <a key={o.key} {...common} href={hrefOf(o)} onClick={click} className={`${base} mt-1 px-3 py-1.5`}>
          <Avatar image={o.image} flags={flagsOf(o)} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold">
              {named ? <Pv as={catAlias.get(e.c.id) ?? "Categoría"}>{e.c.name}</Pv> : <Pv as={o.alias}>{o.name}</Pv>}
            </span>
            <span className="block truncate text-[11px] text-zinc-400">
              {placeOf(o)} · {named ? <Pv as={o.alias}>{o.name}</Pv> : <Pv as={o.storeAlias}>{o.store}</Pv>}
            </span>
          </span>
          {on && dot}
        </a>
      );
    }
    // Inactiva.
    return (
      <a key={o.key} {...common} href={hrefOf(o)} onClick={click} className={`${base} mt-1 px-3 py-1.5 opacity-80`}>
        <Avatar image={o.image} flags={flagsOf(o)} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold"><Pv as={o.alias}>{o.name}</Pv></span>
          <span className="block truncate text-[11px] text-zinc-400"><Pv as={o.storeAlias}>{o.store}</Pv> · {o.markets.length === 1 ? "1 mercado" : `${o.markets.length} mercados`}</span>
        </span>
        {on && dot}
      </a>
    );
  };

  return (
    <div ref={ref} className="relative shrink-0 px-3 pb-2 pt-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        <span className="text-[11.5px] font-semibold text-zinc-400 dark:text-zinc-500">Oferta</span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-12 w-full items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/80 pl-2 pr-8 text-left transition-all hover:border-violet-300 dark:border-zinc-800 dark:bg-white/[0.035] dark:hover:border-violet-500/50"
      >
        {curOffer ? <Avatar image={curOffer.image} flags={curMarket ? curMarket.flags : flagsOf(curOffer)} /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-white"><LayoutGrid className="h-3.5 w-3.5" /></span>}
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-zinc-900 dark:text-white">
            <span className="truncate">{curOffer ? <Pv as={curOffer.alias}>{curOffer.name}</Pv> : "Todas las ofertas"}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 truncate text-[10px] font-medium text-zinc-400">
            {curOffer
              ? curMarket ? <span className="truncate">Solo {curMarket.label} · <Pv as={curOffer.storeAlias}>{curOffer.store}</Pv></span> : <span className="truncate"><Pv as={curOffer.storeAlias}>{curOffer.store}</Pv></span>
              : `${offers.filter((o) => o.active).length} activas · ${offers.length} en total`}
          </span>
        </span>
        <ChevronDown className={`absolute right-3 h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900" style={{ width: "min(320px, calc(100vw - 24px))" }}>
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3 dark:border-zinc-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              placeholder="Buscar categoría, oferta o país…" aria-label="Buscar oferta"
              className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[12.5px] font-medium text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white" />
            <div role="group" aria-label="Ordenar" className="inline-flex shrink-0 rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700">
              {([["az", "A-Z"], ["new", "Recientes"]] as const).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={order === v} onClick={() => pickOrder(v)} title={v === "az" ? "Por abecedario" : "Las últimas agregadas primero"}
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${order === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div ref={list} role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
            {entries.slice(0, nActive).map((e, i) => row(e, i))}
            {view.inactive.length > 0 && (
              <div className="mt-1 border-t border-zinc-100 dark:border-zinc-800">
                {!searching && (
                  <button type="button" onClick={() => setShowOff((v) => !v)}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11.5px] font-semibold text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                    <ChevronRight className={`h-3 w-3 transition-transform ${inactiveOpen ? "rotate-90" : ""}`} /> Inactivas ({view.inactive.length})
                  </button>
                )}
                {entries.slice(nActive).map((e, i) => row(e, nActive + i))}
              </div>
            )}
            {!entries.length && <p className="px-3 py-4 text-center text-[12px] text-zinc-400">Nada con «{q}»</p>}
          </div>
        </div>
      )}
    </div>
  );
}
