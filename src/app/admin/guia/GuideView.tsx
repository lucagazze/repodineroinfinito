"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { GuideSection } from "@/lib/guia";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** `código`, **negrita** y links sueltos (https://…). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-zinc-100 px-1 py-px font-mono text-[0.88em] text-zinc-800 dark:bg-white/10 dark:text-zinc-100">{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-zinc-900 dark:text-white">{t.slice(2, -2)}</strong>);
    else out.push(<a key={k++} href={t} target="_blank" rel="noreferrer" className="break-all text-violet-600 underline dark:text-violet-400">{t}</a>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Markdown chico: ###, listas (- y 1.), tablas, párrafos. */
function Body({ md }: { md: string }) {
  const blocks: ReactNode[] = [];
  const lines = md.split("\n");
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("### ")) { blocks.push(<h4 key={k++} className="mt-4 text-[13.5px] font-bold text-zinc-900 dark:text-white">{inline(l.slice(4))}</h4>); i++; continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, ...rest] = rows;
      blocks.push(
        <div key={k++} className="my-2 overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-zinc-200 px-2 py-1.5 font-semibold text-zinc-500 dark:border-white/10">{inline(c)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-zinc-100 px-2 py-1.5 align-top dark:border-white/[0.05]">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const num = /^\d+\. /.test(l);
    if (num || l.startsWith("- ")) {
      const items: string[] = [];
      const isItem = (s: string) => (num ? /^\d+\. /.test(s) : s.startsWith("- "));
      while (i < lines.length && (isItem(lines[i]) || (items.length > 0 && /^ {2,}\S/.test(lines[i])))) {
        if (/^ {2,}\S/.test(lines[i])) items[items.length - 1] += `\n${lines[i].trim()}`;
        else items.push(lines[i].replace(/^(\d+\.|-) /, ""));
        i++;
      }
      const Tag = num ? "ol" : "ul";
      blocks.push(
        <Tag key={k++} className={`my-2 grid gap-1 pl-5 ${num ? "list-decimal" : "list-disc"} marker:text-zinc-400`}>
          {items.map((it, j) => <li key={j}>{it.split("\n").map((p, pi) => <Fragment key={pi}>{pi > 0 && <br />}{inline(p)}</Fragment>)}</li>)}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(### |\||- |\d+\. )/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-2">{inline(para.join(" "))}</p>);
  }
  return <div className="text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">{blocks}</div>;
}

export default function GuideView({ sections }: { sections: GuideSection[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = norm(q.trim());
    return t ? sections.filter((s) => norm(`${s.title} ${s.body}`).includes(t)) : sections;
  }, [q, sections]);
  const groups = useMemo(() => [...new Set(sections.map((s) => s.group))], [sections]);

  // Al llegar con #seccion (desde el botón «?»), se baja hasta ella.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
        <label className="mb-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la guía…" aria-label="Buscar en la guía"
            className="h-9 min-w-0 flex-1 border-0 bg-transparent text-[12.5px] outline-none placeholder:text-zinc-400" />
        </label>
        <div className="hidden lg:block">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <p className="mb-1 px-2 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">{g}</p>
              {sections.filter((s) => s.group === g).map((s) => (
                <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-2 py-1 text-[12.5px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white">{s.title}</a>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="grid min-w-0 gap-4">
        {!shown.length && <p className="text-[13px] text-zinc-500">Nada con «{q}».</p>}
        {shown.map((s, i) => (
          <Fragment key={s.id}>
            {(i === 0 || shown[i - 1].group !== s.group) && <h2 className="mt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">{s.group}</h2>}
            <section id={s.id} className="scroll-mt-20 rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <h3 className="mb-1 text-[16px] font-bold tracking-tight text-zinc-900 dark:text-white">
                <a href={`#${s.id}`} className="hover:underline">{s.title}</a>
              </h3>
              <Body md={s.body} />
            </section>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
