import Link from "next/link";
import { db } from "@/lib/db";
import { unreadByStore } from "@/lib/admin/mail-unread";
import { presaleBoardCached } from "@/lib/admin/presale";
import { readCatalogStatus, type CatalogStatus } from "@/lib/admin/catalog-status";
import { lastRun, topRecs } from "@/lib/coach/read";
import type { PresaleRow } from "@/lib/admin/presale-shared";
type Rec = Parameters<typeof topRecs>[0][number];

/**
 * «Para hacer»: lo pendiente de toda la app en una tarjeta,
 * cada cosa con su número y un toque para ir. En verde lo que está al día.
 */
type Row = { icon: string; label: string; n: number; tone: "bad" | "warn" | "ok"; href: string; sub?: string };

export default async function TodoCard() {
  const unreadP: Promise<Record<string, number>> = unreadByStore().catch(() => ({}));
  const alertsP: Promise<{ severity: string }[]> = Promise.resolve(db.from("alerts").select("severity").is("resolved_at", null).limit(1000)).then((r) => (r.data ?? []) as { severity: string }[]).catch(() => []);
  const boardP: Promise<PresaleRow[]> = presaleBoardCached().catch(() => []);
  const catP: Promise<CatalogStatus | null> = readCatalogStatus().catch(() => null);
  const coachP: Promise<Rec[]> = lastRun().then((r) => r.recs).catch(() => []);
  const [unread, alerts, board, cat, recs] = await Promise.all([unreadP, alertsP, boardP, catP, coachP]);
  const mails = Object.values(unread).reduce((a, n) => a + Number(n || 0), 0);
  const errs = alerts.filter((a) => a.severity === "error").length;
  const write = board.filter((r) => ["atrasado", "vence_pronto", "a_tiempo"].includes(r.state) && r.orders.length > 0);
  const late = write.filter((r) => r.state === "atrasado").length;
  const notify = board.filter((r) => r.state === "listo_sin_avisar").length;
  const catTasks = (cat?.stores ?? []).reduce((a, s) => a + s.catalogProblems.length + s.stripeTasks.length, 0);
  const mejoras = topRecs(recs, { kind: "mejora" }).filter((r) => r.severity === "alta").length;

  const rows: Row[] = [
    { icon: "✉️", label: "Mails sin leer", n: mails, tone: mails ? "warn" : "ok", href: "/admin/mails" },
    { icon: "🔔", label: "Avisos abiertos", n: alerts.length, tone: errs ? "bad" : alerts.length ? "warn" : "ok", href: "/admin/avisos", sub: errs ? `${errs} urgentes` : undefined },
    { icon: "📝", label: "Libros por escribir", n: write.length, tone: late ? "bad" : write.length ? "warn" : "ok", href: "/admin/preventas", sub: late ? `${late} atrasados` : notify ? `${notify} hechos sin avisar` : undefined },
    { icon: "🛡️", label: "Catálogos y Stripe", n: catTasks, tone: catTasks ? "bad" : "ok", href: "/admin/catalogos" },
    { icon: "✨", label: "Mejoras importantes", n: mejoras, tone: mejoras ? "warn" : "ok", href: "/admin/mejoras" },
  ];
  const pending = rows.filter((r) => r.tone !== "ok").length;
  const pill = { bad: "bg-red-500 text-white", warn: "bg-amber-500 text-white", ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/[0.07] dark:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-zinc-900 dark:text-white">🎯 Para hacer</h3>
        <span className={`text-[12px] font-semibold ${pending ? "text-zinc-500 dark:text-zinc-400" : "text-emerald-600 dark:text-emerald-400"}`}>{pending ? `${pending} de ${rows.length} con algo` : "todo al día"}</span>
      </div>
      <ul className="mt-2.5 grid gap-1">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] no-underline transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.04]">
              <span className="w-5 text-center" aria-hidden>{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">{r.label}</span>
                {r.sub && <span className="ml-1.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">· {r.sub}</span>}
              </span>
              <span className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-black ${pill[r.tone]}`}>{r.tone === "ok" ? "✓" : r.n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
