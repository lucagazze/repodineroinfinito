"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Eye, FlaskConical, Gift, Heading, Image as ImageIcon, MousePointerClick, Package, Plus, Save, Send, Sparkles, Trash, Type, X,
} from "lucide-react";
import { api, nf } from "../../client";
import SegmentBuilder, { CountBadge, useLiveCount, type SegOpts } from "../../SegmentBuilder";
import { LOCALES, LOCALE_ES, newBlockId, type CampaignStatus, type Locale } from "@/lib/mkt/consts";
import type { Block, Segment, Version, Versions } from "@/lib/mkt/types";

/**
 * Editor de una campaña: destinatarios (segmento con número en vivo),
 * descuento, una versión por idioma (asunto, preheader y bloques), «Escribir
 * con IA», vista previa, prueba (solo a la casilla de prueba) y «Enviar…» con
 * la confirmación de la cantidad exacta.
 */

export type CatalogOpt = {
  funnelId: string; label: string; locale: Locale; active: boolean; solo: boolean; category: string | null; image: string | null; price: string | null;
};
type C = {
  id: string; storeId: string; status: CampaignStatus; name: string; segment: Segment; segmentId: string | null; versions: Versions;
  fallback: Locale | null; goal: string; discountPct: number | null; discountHours: number; discountRevoked: boolean;
};
type Plan = { total: number; split: { locale: string; n: number; as: Locale | null }[]; problems: string[]; warnings: string[]; sender: string; enabled: boolean; dailyCap: number; usedToday: number };

const BLANK = (): Version => ({ subject: "", preheader: "", blocks: [{ id: newBlockId(), type: "heading", text: "" }, { id: newBlockId(), type: "text", text: "" }, { id: newBlockId(), type: "recommend", count: 2 }] });

function Section({ n, title, sub, children, right }: { n: number; title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="ad-card mb-5">
      <div className="ad-card-h">
        <div className="min-w-0">
          <h3><span className="flex h-5 w-5 items-center justify-center rounded-md bg-pink-500/15 text-[11px] font-black text-pink-300">{n}</span>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </div>
      <div className="ad-card-b">{children}</div>
    </section>
  );
}

function BlockEditor({ b, onChange, catalog, locale, categories }: { b: Block; onChange: (b: Block) => void; catalog: CatalogOpt[]; locale: Locale; categories: string[] }) {
  const own = catalog.filter((c) => c.locale === locale);
  const other = catalog.filter((c) => c.locale !== locale);
  switch (b.type) {
    case "heading":
      return <input className="ad-in text-[15px] font-bold" placeholder="Título (podés usar {nombre})" value={b.text} maxLength={200} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case "text":
      return <textarea className="ad-in" rows={4} placeholder={"Texto. Línea en blanco = otro párrafo · **negrita** · {nombre} = su nombre"} value={b.text} maxLength={4000} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case "product": {
      const cur = catalog.find((c) => c.funnelId === b.funnel);
      return (
        <div className="grid gap-2">
          <select className="ad-in" value={b.funnel} onChange={(e) => onChange({ ...b, funnel: e.target.value })} aria-label="Producto">
            {!cur && <option value={b.funnel}>— elegí un checkout —</option>}
            <optgroup label={`En ${LOCALE_ES[locale]}`}>
              {own.map((c) => <option key={c.funnelId} value={c.funnelId}>{c.label}{c.price ? ` · ${c.price}` : ""}{c.active ? "" : " (pausado)"}</option>)}
            </optgroup>
            {other.length > 0 && <optgroup label="Otros idiomas">{other.map((c) => <option key={c.funnelId} value={c.funnelId}>{LOCALE_ES[c.locale]}: {c.label}{c.active ? "" : " (pausado)"}</option>)}</optgroup>}
          </select>
          {cur && cur.locale !== locale && <p className="text-[11.5px] text-amber-400">Ese checkout está en {LOCALE_ES[cur.locale]}: quien lo abra lo ve en ese idioma.</p>}
          {cur && !cur.active && <p className="text-[11.5px] text-red-400">Ese checkout está pausado: el bloque no se muestra.</p>}
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
            <input className="ad-in" placeholder="Botón (por defecto: «Ver más»)" value={b.cta ?? ""} maxLength={40} onChange={(e) => onChange({ ...b, cta: e.target.value || undefined })} />
            <input className="ad-in" placeholder="Una frase sobre el producto (opcional)" value={b.blurb ?? ""} maxLength={400} onChange={(e) => onChange({ ...b, blurb: e.target.value || undefined })} />
          </div>
          <p className="text-[11px] text-zinc-500">Tapa, nombre y precio salen solos, en la moneda de cada uno. A quien ya lo tiene no se le muestra.</p>
        </div>
      );
    }
    case "recommend": {
      const cats = new Set(b.categories ?? []);
      return (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-zinc-400">Mostrar</span>
            <select className="ad-in w-20" value={b.count} onChange={(e) => onChange({ ...b, count: Number(e.target.value) })} aria-label="Cuántos">
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-[12px] text-zinc-400">de lo que todavía NO tiene, en su idioma</span>
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button key={c} type="button" aria-pressed={cats.has(c)} onClick={() => { const n = new Set(cats); if (n.has(c)) n.delete(c); else n.add(c); onChange({ ...b, categories: [...n] }); }}
                  className={`rounded-lg px-2 py-1 text-[11px] font-bold ${cats.has(c) ? "bg-white text-zinc-900" : "bg-zinc-800/70 text-zinc-300"}`}>{c}</button>
              ))}
              <span className="self-center text-[11px] text-zinc-500">{cats.size ? "solo de estas categorías" : "de cualquier categoría"}</span>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="ad-in" placeholder="Título (por defecto: «Elegidos para vos»)" value={b.title ?? ""} maxLength={120} onChange={(e) => onChange({ ...b, title: e.target.value || undefined })} />
            <input className="ad-in" placeholder="Botón (por defecto: «Ver más»)" value={b.cta ?? ""} maxLength={40} onChange={(e) => onChange({ ...b, cta: e.target.value || undefined })} />
          </div>
        </div>
      );
    }
    case "image":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="ad-in" placeholder="https://… (JPG o PNG)" value={b.src} onChange={(e) => onChange({ ...b, src: e.target.value.trim() })} />
          <input className="ad-in" placeholder="Link al tocarla (opcional)" value={b.href ?? ""} onChange={(e) => onChange({ ...b, href: e.target.value.trim() || undefined })} />
        </div>
      );
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
          <input className="ad-in" placeholder="Texto del botón" value={b.label} maxLength={40} onChange={(e) => onChange({ ...b, label: e.target.value })} />
          <input className="ad-in" placeholder="https://…" value={b.href} onChange={(e) => onChange({ ...b, href: e.target.value.trim() })} />
        </div>
      );
  }
}

const BLOCK_ES: Record<Block["type"], [string, React.ReactNode]> = {
  heading: ["Título", <Heading key="h" className="h-3.5 w-3.5" />],
  text: ["Texto", <Type key="t" className="h-3.5 w-3.5" />],
  product: ["Producto", <Package key="p" className="h-3.5 w-3.5" />],
  recommend: ["Para vos", <Gift key="g" className="h-3.5 w-3.5" />],
  image: ["Imagen", <ImageIcon key="i" className="h-3.5 w-3.5" />],
  button: ["Botón", <MousePointerClick key="b" className="h-3.5 w-3.5" />],
};

export default function Editor({ campaign, catalog, opts, segments, sender, testTo, brand }: {
  campaign: C; catalog: CatalogOpt[]; opts: SegOpts; segments: { id: string; name: string; filters: Segment }[];
  sender: string; testTo: string; brand: string;
}) {
  const router = useRouter();
  const ro = campaign.status !== "draft";
  const [name, setName] = useState(campaign.name);
  const [segment, setSegment] = useState<Segment>(campaign.segment);
  const [segmentId, setSegmentId] = useState<string | null>(campaign.segmentId);
  const [versions, setVersions] = useState<Versions>(campaign.versions);
  const [fallback, setFallback] = useState<Locale | null>(campaign.fallback);
  const [discount, setDiscount] = useState<number | null>(campaign.discountPct);
  const [hours, setHours] = useState(campaign.discountHours);
  const [goal, setGoal] = useState(campaign.goal);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; bad?: string } | null>(null);
  const langs = (Object.keys(versions) as Locale[]).filter((l) => versions[l]);
  const [tab, setTab] = useState<Locale | null>(langs[0] ?? null);
  const { count, busy: counting, err: countErr } = useLiveCount(campaign.storeId, segment);
  const [aiLangs, setAiLangs] = useState<Locale[]>([]);
  const [aiErrors, setAiErrors] = useState<Partial<Record<Locale, string>>>({});
  const [preview, setPreview] = useState<{ html: string; subject: string; preheader: string; from: string; notes: string[]; skip: string | null } | null>(null);
  const [tests, setTests] = useState<{ locale: Locale; ok: boolean; subject?: string; error?: string; notes?: string[] }[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [sure, setSure] = useState(false);
  const categories = opts.categories;

  // Los idiomas de la IA: los de la gente del segmento (si todavía no eligió).
  const segLangs = useMemo(() => Object.keys(count?.by_locale ?? {}).filter((l) => (LOCALES as readonly string[]).includes(l)) as Locale[], [count]);
  useEffect(() => { if (!aiLangs.length && segLangs.length) setAiLangs(segLangs); }, [segLangs, aiLangs.length]);

  const touch = () => { setDirty(true); setMsg(null); };
  const v = tab ? versions[tab] : undefined;
  const setV = (nv: Version) => { if (!tab) return; setVersions({ ...versions, [tab]: nv }); touch(); };
  const setBlock = (i: number, b: Block) => v && setV({ ...v, blocks: v.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: -1 | 1) => {
    if (!v) return;
    const bl = [...v.blocks]; const j = i + d;
    if (j < 0 || j >= bl.length) return;
    [bl[i], bl[j]] = [bl[j], bl[i]];
    setV({ ...v, blocks: bl });
  };
  const add = (type: Block["type"]) => {
    if (!v || !tab) return;
    const id = newBlockId();
    const firstFunnel = catalog.find((c) => c.locale === tab && c.active && !c.solo)?.funnelId ?? catalog[0]?.funnelId ?? "";
    const b: Block = type === "heading" ? { id, type, text: "" } : type === "text" ? { id, type, text: "" }
      : type === "product" ? { id, type, funnel: firstFunnel } : type === "recommend" ? { id, type, count: 2 }
      : type === "image" ? { id, type, src: "" } : { id, type, label: "", href: "" };
    setV({ ...v, blocks: [...v.blocks, b] });
  };

  const save = async (quiet = false) => {
    if (ro) return true;
    setBusy("save");
    try {
      await api({ action: "campaign_save", id: campaign.id, patch: { name, segment, segment_id: segmentId, versions, fallback_locale: fallback, discount_pct: discount, discount_hours: hours, goal } });
      setDirty(false);
      if (!quiet) setMsg({ ok: "Guardado" });
      return true;
    } catch (e) { setMsg({ bad: (e as Error).message }); return false; } finally { setBusy(null); }
  };

  const doPreview = async () => {
    if (!tab || !v) return;
    setBusy("preview");
    try {
      const r = await fetch("/api/admin/mkt/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: campaign.id, locale: tab, version: v, discount_pct: discount, discount_hours: hours }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo armar");
      setPreview(j);
    } catch (e) { setMsg({ bad: (e as Error).message }); } finally { setBusy(null); }
  };

  const doAi = async () => {
    if (!(await save(true))) return;
    setBusy("ai"); setAiErrors({});
    try {
      const r = await api<{ versions: Versions; errors: Partial<Record<Locale, string>> }>({ action: "ai_write", id: campaign.id, goal, locales: aiLangs });
      setVersions(r.versions); setAiErrors(r.errors);
      const first = aiLangs.find((l) => r.versions[l]);
      if (first) setTab(first);
      setPreview(null);
      setMsg(Object.keys(r.errors).length ? { bad: "Algunos idiomas no salieron (abajo el motivo)" } : { ok: "Listo: revisalo idioma por idioma" });
    } catch (e) { setMsg({ bad: (e as Error).message }); } finally { setBusy(null); }
  };

  const doTest = async () => {
    if (!(await save(true))) return;
    setBusy("test"); setTests(null);
    try {
      const r = await api<{ results: NonNullable<typeof tests> }>({ action: "test", id: campaign.id });
      setTests(r.results);
    } catch (e) { setMsg({ bad: (e as Error).message }); } finally { setBusy(null); }
  };

  const doPlan = async () => {
    if (!(await save(true))) return;
    setBusy("plan"); setSure(false);
    try { setPlan(await api<Plan>({ action: "plan", id: campaign.id })); } catch (e) { setMsg({ bad: (e as Error).message }); } finally { setBusy(null); }
  };

  const doSend = async () => {
    if (!plan) return;
    setBusy("send");
    try {
      const iso = when === "later" && at ? `${at}:00-03:00` : null;
      const r = await api<{ queued: number; scheduled: string | null; enabled: boolean }>({ action: "send", id: campaign.id, expected: plan.total, at: iso, confirm: true });
      setPlan(null);
      setMsg({ ok: r.scheduled ? `Programada: ${nf(r.queued)} personas` : `En cola: ${nf(r.queued)} personas${r.enabled ? "" : " (los envíos están apagados en Ajustes)"}` });
      router.refresh();
    } catch (e) { setMsg({ bad: (e as Error).message }); } finally { setBusy(null); }
  };

  const addLang = (l: Locale) => { setVersions({ ...versions, [l]: BLANK() }); setTab(l); touch(); };
  const removeLang = (l: Locale) => {
    if (!confirm(`¿Borrar la versión en ${LOCALE_ES[l]}?`)) return;
    const n = { ...versions }; delete n[l]; setVersions(n); setTab((Object.keys(n) as Locale[])[0] ?? null); touch();
    if (fallback === l) setFallback(null);
  };
  const missing = segLangs.filter((l) => !versions[l]);

  return (
    <div className="pb-24">
      {ro && <div className="ad-flash warn mb-4">La campaña ya se confirmó: el contenido queda fijo. Para cambiarla, duplicala.</div>}

      <Section n={1} title="Nombre y destinatarios" sub="A quién le llega. El número se cuenta en vivo, ya sin bajas, rebotes, reembolsos ni contracargos.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="ad-field"><label htmlFor="cn">Nombre de la campaña (solo lo ves vos)</label>
            <input id="cn" className="ad-in" value={name} disabled={ro} maxLength={120} onChange={(e) => { setName(e.target.value); touch(); }} /></div>
          {segments.length > 0 && (
            <div className="ad-field"><label htmlFor="sg">Segmento guardado</label>
              <select id="sg" className="ad-in" disabled={ro} value={segmentId ?? ""} onChange={(e) => {
                const s = segments.find((x) => x.id === e.target.value);
                setSegmentId(s?.id ?? null); if (s) setSegment(s.filters); touch();
              }}>
                <option value="">— a mano —</option>
                {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          )}
        </div>
        <div className="mb-4"><CountBadge count={count} busy={counting} />{countErr && <p className="mt-1 text-[12px] text-red-400">{countErr}</p>}</div>
        <SegmentBuilder value={segment} onChange={(s) => { setSegment(s); setSegmentId(null); touch(); }} opts={opts} disabled={ro} />
      </Section>

      <Section n={2} title="Descuento (opcional)" sub="Un % firmado que vale solo en el checkout de cada botón, sobre el producto principal, hasta que vence. El checkout lo muestra y lo vuelve a verificar al cobrar.">
        <fieldset disabled={ro} className="flex flex-wrap items-center gap-3">
          <label className="ad-toggle">
            <input type="checkbox" checked={discount != null} onChange={(e) => { setDiscount(e.target.checked ? 15 : null); touch(); }} />
            <span className="ad-switch" /><span><b>Con descuento</b></span>
          </label>
          {discount != null && (
            <>
              <div className="flex items-center gap-1.5"><input type="number" min={1} max={90} className="ad-in w-20" value={discount} onChange={(e) => { setDiscount(Math.max(1, Math.min(90, Math.round(Number(e.target.value) || 1)))); touch(); }} /><span className="text-[12px] text-zinc-400">%</span></div>
              <div className="flex items-center gap-1.5"><span className="text-[12px] text-zinc-400">vence a las</span><input type="number" min={1} max={720} className="ad-in w-20" value={hours} onChange={(e) => { setHours(Math.max(1, Math.min(720, Math.round(Number(e.target.value) || 1)))); touch(); }} /><span className="text-[12px] text-zinc-400">horas de empezar a salir</span></div>
            </>
          )}
          {campaign.discountRevoked && <span className="text-[12px] text-red-400">Descuento cortado</span>}
        </fieldset>
      </Section>

      <Section n={3} title="Contenido" sub={`Una versión por idioma. Cada persona recibe la de su idioma, con la marca de ese idioma (${brand}).`}>
        {!ro && (
          <div className="mb-5 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-violet-200"><Sparkles className="h-4 w-4" /> Escribir con IA</p>
            <textarea className="ad-in" rows={2} placeholder="El objetivo, como se lo dirías a alguien: «a los que compraron Uñas USA ofreceles la colección completa»"
              value={goal} maxLength={1500} onChange={(e) => { setGoal(e.target.value); touch(); }} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {LOCALES.map((l) => {
                const on = aiLangs.includes(l);
                return <button key={l} type="button" aria-pressed={on} onClick={() => setAiLangs(on ? aiLangs.filter((x) => x !== l) : [...aiLangs, l])}
                  className={`rounded-lg px-2 py-1 text-[11px] font-bold ${on ? "bg-white text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>{LOCALE_ES[l]}{count?.by_locale[l] ? ` · ${nf(count.by_locale[l])}` : ""}</button>;
              })}
              <button className="ad-btn sm primary ml-auto" disabled={busy === "ai" || goal.trim().length < 5 || !aiLangs.length} onClick={doAi}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "ai" ? "Escribiendo…" : versions && langs.length ? "Reescribir" : "Escribir"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">Usa solo tus productos activos de cada idioma. Precios, links, descuento y pie los pone la plantilla, nunca la IA.</p>
            {Object.entries(aiErrors).map(([l, e]) => <p key={l} className="mt-1 text-[12px] text-red-400">{LOCALE_ES[l as Locale]}: {e}</p>)}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {langs.map((l) => (
            <button key={l} type="button" onClick={() => { setTab(l); setPreview(null); }} className={`rounded-xl px-3 py-1.5 text-[12px] font-bold ${tab === l ? "bg-white text-zinc-900" : "bg-zinc-800/70 text-zinc-300"}`}>
              {LOCALE_ES[l]}{count?.by_locale[l] ? <span className="ml-1 opacity-60">{nf(count.by_locale[l])}</span> : null}
            </button>
          ))}
          {!ro && (
            <select className="ad-in h-8 w-auto py-0 text-[12px]" value="" onChange={(e) => e.target.value && addLang(e.target.value as Locale)} aria-label="Agregar idioma">
              <option value="">+ Idioma</option>
              {LOCALES.filter((l) => !versions[l]).map((l) => <option key={l} value={l}>{LOCALE_ES[l]}</option>)}
            </select>
          )}
        </div>
        {missing.length > 0 && (
          <p className="mb-3 text-[12px] text-amber-400">
            Sin versión: {missing.map((l) => `${LOCALE_ES[l]} (${nf(count?.by_locale[l] ?? 0)})`).join(", ")}. {fallback ? `Reciben la de ${LOCALE_ES[fallback]}.` : "No reciben nada."}
          </p>
        )}
        {langs.length > 1 || missing.length ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
            Los que no tienen versión en su idioma reciben:
            <select className="ad-in h-8 w-auto py-0 text-[12px]" disabled={ro} value={fallback ?? ""} onChange={(e) => { setFallback((e.target.value || null) as Locale | null); touch(); }}>
              <option value="">nada (no se les manda)</option>
              {langs.map((l) => <option key={l} value={l}>la de {LOCALE_ES[l]}</option>)}
            </select>
          </div>
        ) : null}

        {!tab || !v ? (
          <p className="text-[13px] text-zinc-400">Escribila con la IA o agregá un idioma con «+ Idioma».</p>
        ) : (
          <fieldset disabled={ro} className="min-w-0">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="ad-field"><label htmlFor="subj">Asunto</label>
                <input id="subj" className="ad-in" value={v.subject} maxLength={150} placeholder="Corto y concreto ({nombre} = su nombre)" onChange={(e) => setV({ ...v, subject: e.target.value })} /></div>
              <div className="ad-field"><label htmlFor="pre">Preheader (la línea gris después del asunto)</label>
                <input id="pre" className="ad-in" value={v.preheader} maxLength={200} onChange={(e) => setV({ ...v, preheader: e.target.value })} /></div>
            </div>
            <ol className="mt-4 grid gap-3">
              {v.blocks.map((b, i) => (
                <li key={b.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[11.5px] font-bold text-zinc-400">{BLOCK_ES[b.type][1]} {BLOCK_ES[b.type][0]}</span>
                    {!ro && (
                      <span className="ml-auto flex gap-0.5">
                        <button type="button" className="ad-btn sm ghost px-2" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" className="ad-btn sm ghost px-2" aria-label="Bajar" disabled={i === v.blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" className="ad-btn sm ghost px-2" aria-label="Borrar" onClick={() => setV({ ...v, blocks: v.blocks.filter((_, j) => j !== i) })}><Trash className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </div>
                  <BlockEditor b={b} onChange={(nb) => setBlock(i, nb)} catalog={catalog} locale={tab} categories={categories} />
                </li>
              ))}
            </ol>
            {!ro && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(Object.keys(BLOCK_ES) as Block["type"][]).map((t) => (
                  <button key={t} type="button" className="ad-btn sm" onClick={() => add(t)}><Plus className="h-3 w-3" />{BLOCK_ES[t][0]}</button>
                ))}
                <button type="button" className="ad-btn sm ghost ml-auto text-red-400" onClick={() => removeLang(tab)}><X className="h-3.5 w-3.5" /> Borrar {LOCALE_ES[tab]}</button>
              </div>
            )}
          </fieldset>
        )}
        {tab && v && (
          <div className="mt-5">
            <button className="ad-btn" disabled={busy === "preview"} onClick={doPreview}><Eye className="h-4 w-4" /> {busy === "preview" ? "Armando…" : preview ? "Actualizar vista previa" : "Vista previa"}</button>
            {preview && (
              <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08]">
                <div className="border-b border-white/[0.06] bg-zinc-900 px-3 py-2 text-[12px]">
                  <p className="truncate text-zinc-400">De: <b className="text-zinc-200">{sender}</b></p>
                  <p className="truncate text-zinc-200"><b>{preview.subject || "(sin asunto)"}</b> <span className="text-zinc-500">— {preview.preheader}</span></p>
                  {preview.notes.map((n, i) => <p key={i} className="text-amber-400">{n}</p>)}
                  {preview.skip && <p className="text-amber-400">A quien ya tiene todo: no se le manda ({preview.skip}).</p>}
                </div>
                <iframe title="Vista previa" srcDoc={preview.html} sandbox="" className="block h-[75vh] w-full bg-[#f0f0f0]" />
              </div>
            )}
          </div>
        )}
      </Section>

      {!ro && (
        <Section n={4} title="Probar y enviar">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button className="ad-btn" disabled={!!busy || !langs.length} onClick={doTest}><FlaskConical className="h-4 w-4" /> {busy === "test" ? "Mandando…" : "Enviar prueba"}</button>
            <span className="text-[12px] text-zinc-500">Cada idioma, solo a <b className="text-zinc-300">{testTo}</b>. Desde {sender}.</span>
            <button className="ad-btn primary sm:ml-auto" disabled={!!busy || !langs.length} onClick={doPlan}><Send className="h-4 w-4" /> {busy === "plan" ? "Revisando…" : "Enviar…"}</button>
          </div>
          {tests && (
            <ul className="mt-3 grid gap-1.5 text-[12.5px]">
              {tests.map((t) => (
                <li key={t.locale} className={t.ok ? "text-emerald-400" : "text-red-400"}>
                  {LOCALE_ES[t.locale]}: {t.ok ? `salió «${t.subject}»` : t.error}
                  {t.notes?.map((n, i) => <span key={i} className="block text-amber-400">· {n}</span>)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {plan && (
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Confirmar envío">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-zinc-900 p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center"><h3 className="text-[16px] font-bold text-white">Confirmar envío</h3>
              <button className="ad-btn sm ghost ml-auto" onClick={() => setPlan(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button></div>
            <p className="text-[30px] font-bold tabular-nums text-white">{nf(plan.total)} <span className="text-[14px] font-medium text-zinc-400">personas</span></p>
            <ul className="mb-3 mt-2 grid gap-1 text-[13px]">
              {plan.split.map((s) => (
                <li key={s.locale} className="flex justify-between border-b border-white/[0.05] py-1">
                  <span className={s.as ? "text-zinc-200" : "text-zinc-500 line-through"}>{LOCALE_ES[s.locale as Locale] ?? s.locale}{s.as && s.as !== s.locale ? ` → versión en ${LOCALE_ES[s.as]}` : ""}{!s.as ? " (sin versión)" : ""}</span>
                  <b className="tabular-nums text-white">{nf(s.n)}</b>
                </li>
              ))}
            </ul>
            <p className="mb-2 text-[12px] text-zinc-400">Desde <b className="text-zinc-200">{plan.sender}</b> · tope {nf(plan.dailyCap)}/día (hoy van {nf(plan.usedToday)})</p>
            {plan.problems.map((p, i) => <p key={i} className="mb-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[12.5px] text-red-300">✕ {p}</p>)}
            {plan.warnings.map((p, i) => <p key={i} className="mb-1 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[12.5px] text-amber-300">! {p}</p>)}
            {!plan.problems.length && (
              <>
                <div className="my-3 flex flex-wrap items-center gap-2 text-[13px]">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Ahora</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Programar</label>
                  {when === "later" && <input type="datetime-local" className="ad-in h-9 w-auto" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Fecha y hora (Argentina)" />}
                  {when === "later" && <span className="text-[11px] text-zinc-500">hora de Argentina</span>}
                </div>
                <label className="mb-3 flex items-start gap-2 text-[13px] text-zinc-200">
                  <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                  Confirmo mandarle esta campaña a {nf(plan.total)} clientes reales.
                </label>
                <button className="ad-btn primary block" disabled={!sure || busy === "send" || (when === "later" && !at)} onClick={doSend}>
                  <Send className="h-4 w-4" /> {busy === "send" ? "Armando la cola…" : `Enviar a ${nf(plan.total)} personas`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!ro && (
        <div className="fixed inset-x-0 bottom-0 z-[250] border-t border-white/[0.06] bg-[#0a0a0a]/90 px-4 py-2.5 backdrop-blur-xl lg:left-[232px]">
          <div className="mx-auto flex max-w-[1320px] items-center gap-3">
            <span className={`truncate text-[12px] ${msg?.bad ? "text-red-400" : msg?.ok ? "text-emerald-400" : "text-zinc-500"}`}>
              {msg?.bad ?? msg?.ok ?? (dirty ? "Cambios sin guardar" : "Todo guardado")}
            </span>
            <button className="ad-btn primary ml-auto shrink-0" disabled={!dirty || busy === "save"} onClick={() => save()}><Save className="h-4 w-4" /> {busy === "save" ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      )}
      {ro && msg && <p className={`text-[12.5px] ${msg.bad ? "text-red-400" : "text-emerald-400"}`}>{msg.bad ?? msg.ok}</p>}
    </div>
  );
}
