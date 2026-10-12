import Link from "next/link";
import { after } from "next/server";
import Shell from "@/components/admin/Shell";
import { Badge, Card, EmptyState, Flag } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { BUYER, EMAIL } from "@/lib/admin/privacy";
import { PANEL_TZ } from "@/lib/admin/range";
import { db } from "@/lib/db";
import { syncIfStale } from "@/lib/mkt/contacts";
import { contactStats } from "@/lib/mkt/segments";
import { LOCALE_ES, type Locale } from "@/lib/mkt/types";
import { MktHead, mktStores, pickStore, StoreTabs } from "../shared";
import { ContactActions, ImportBox, SyncButton } from "./ContactsClient";

export const dynamic = "force-dynamic";

const PAGE = 50;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "2-digit", timeZone: PANEL_TZ }).replace(".", "") : "—");
const STATUS: Record<string, [string, "ok" | "bad" | "warn" | undefined]> = {
  subscribed: ["Activo", "ok"], unsubscribed: ["Se dio de baja", undefined], bounced: ["Rebotó", "bad"], complained: ["Spam", "bad"],
};

/**
 * Contactos de una tienda: compradores (Panel + importados de la plataforma anterior),
 * excluidos (bajas, rebotes, reembolsos, contracargos) y los leads de carrito,
 * que quedan aparte y sin marketing.
 */
export default async function Contactos({ searchParams }: { searchParams: Promise<{ tienda?: string; t?: string; q?: string; p?: string }> }) {
  const sp = await searchParams;
  const stores = await mktStores();
  const store = pickStore(stores, sp.tienda);
  if (!store) return <Shell><MktHead tab="contactos" /><EmptyState title="No hay tiendas" /></Shell>;
  // Se pone al día después de responder (cada 15 min como mucho): la página no espera. «Actualizar» lo hace ya.
  after(() => syncIfStale(store.id).catch(() => null));
  const t = sp.t === "leads" ? "leads" : sp.t === "fuera" ? "fuera" : "activos";
  const page = Math.max(0, Number(sp.p ?? 0) || 0);
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);

  let list = db.from("mkt_contacts")
    .select("id,email,name,locale,country,kind,source,status,status_reason,orders_count,spent_usd,last_purchase_at,refunded,disputed,marketing_ok,imp_names", { count: "exact" })
    .eq("store_id", store.id);
  if (t === "leads") list = list.eq("kind", "lead");
  else if (t === "fuera") list = list.eq("kind", "buyer").or("status.neq.subscribed,refunded.eq.true,disputed.eq.true");
  else list = list.eq("kind", "buyer").eq("status", "subscribed").eq("refunded", false).eq("disputed", false);
  if (q) list = list.or(`email.ilike.%${q.replace(/[%,()]/g, "")}%,name.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const [stats, { data: rows, count }, { data: prods }, { data: imports }] = await Promise.all([
    contactStats(store.id),
    list.order("last_purchase_at", { ascending: false, nullsFirst: false }).range(page * PAGE, page * PAGE + PAGE - 1),
    db.from("products").select("id,name").eq("store_id", store.id).order("name"),
    db.from("mkt_imports").select("file_name,created_at,contacts,created").eq("store_id", store.id).order("created_at", { ascending: false }).limit(3),
  ]);
  const base = `/admin/email/contactos`;
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams({ tienda: store.slug, ...(t !== "activos" ? { t } : {}), ...(q ? { q } : {}) });
    for (const [k, v] of Object.entries(o)) if (v === undefined || v === "") u.delete(k); else u.set(k, String(v));
    return `${base}?${u}`;
  };
  const excluded = stats.unsubscribed + stats.bounced + stats.complained + stats.refunded + stats.disputed;

  return (
    <Shell>
      <MktHead tab="contactos" actions={<><SyncButton store={store.id} /><ImportBox store={store.id} products={(prods ?? []).map((p) => ({ id: p.id, name: p.name }))} /></>} />
      <StoreTabs stores={stores} current={store.id} base={base} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="ad-card ad-kpi"><span>Reciben campañas</span><strong>{stats.active.toLocaleString("es-AR")}</strong><small>{Object.entries(stats.by_locale).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${LOCALE_ES[l as Locale] ?? l} ${n}`).join(" · ") || "—"}</small></div>
        <div className="ad-card ad-kpi"><span>Compradores</span><strong>{stats.buyers.toLocaleString("es-AR")}</strong><small>{stats.imported.toLocaleString("es-AR")} importados de la plataforma anterior</small></div>
        <div className="ad-card ad-kpi"><span>Fuera</span><strong>{excluded.toLocaleString("es-AR")}</strong><small>{stats.unsubscribed} bajas · {stats.bounced} rebotes · {stats.refunded} reemb. · {stats.disputed} contrac.{stats.complained ? ` · ${stats.complained} spam` : ""}</small></div>
        <div className="ad-card ad-kpi"><span>Leads de carrito</span><strong>{stats.leads.toLocaleString("es-AR")}</strong><small>{stats.leads_ok ? `${stats.leads_ok} con permiso` : "sin marketing (RGPD)"}</small></div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="ad-seg">
          {([["activos", "Reciben"], ["fuera", "Fuera"], ["leads", "Leads de carrito"]] as const).map(([k, l]) => (
            <Link key={k} href={qs({ t: k === "activos" ? undefined : k, p: undefined })} className={t === k ? "on" : ""}>{l}</Link>
          ))}
        </div>
        <form className="sm:ml-auto sm:w-72" action={base}>
          <input type="hidden" name="tienda" value={store.slug} />
          {t !== "activos" && <input type="hidden" name="t" value={t} />}
          <input name="q" defaultValue={q} className="ad-in" placeholder="Buscar email o nombre" aria-label="Buscar" />
        </form>
      </div>

      {t === "leads" && <p className="ad-note mb-3">Dejaron el email en un checkout y no compraron. No reciben campañas: solo los que tengan permiso (dado a mano acá, si te lo pidieron) y si el segmento los suma.</p>}

      {!rows?.length ? (
        <Card><EmptyState title={q ? "Nadie con esa búsqueda" : "No hay contactos acá"}>
          {t === "activos" && !q && <p className="ad-note mt-1">Importá el Excel de referencia (Ventas realizadas → Exportar XLSX) para sumar a los compradores de antes.</p>}
        </EmptyState></Card>
      ) : (
        <Card pad={false}>
          <ul className="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            {rows.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-white"><Pv as={EMAIL}>{c.email}</Pv></p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-zinc-400">
                    {c.name && <span className="max-w-[180px] truncate"><Pv as={BUYER}>{c.name}</Pv></span>}
                    {c.country && <span><Flag cc={c.country} />{c.country}</span>}
                    <span>{LOCALE_ES[c.locale as Locale] ?? c.locale ?? "—"}</span>
                    {c.kind === "buyer" && <span>{c.orders_count} {c.orders_count === 1 ? "compra" : "compras"} · US$ {Number(c.spent_usd).toLocaleString("es-AR")}</span>}
                    {c.last_purchase_at && <span>últ. {day(c.last_purchase_at)}</span>}
                    {c.source === "import" && <Badge>la plataforma anterior</Badge>}
                    {c.status !== "subscribed" && <Badge tone={STATUS[c.status]?.[1]}>{STATUS[c.status]?.[0] ?? c.status}</Badge>}
                    {c.refunded && <Badge tone="warn">Reembolso</Badge>}
                    {c.disputed && <Badge tone="bad">Contracargo</Badge>}
                    {c.kind === "lead" && c.marketing_ok && <Badge tone="brand">Con permiso</Badge>}
                  </p>
                  {c.status_reason && c.status !== "subscribed" && <p className="mt-0.5 text-[11px] text-zinc-500">{c.status_reason}</p>}
                </div>
                <ContactActions id={c.id} kind={c.kind} status={c.status} ok={c.marketing_ok} />
              </li>
            ))}
          </ul>
          {(count ?? 0) > PAGE && (
            <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-3 text-[12px] text-zinc-400 sm:px-5">
              <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, count ?? 0)} de {(count ?? 0).toLocaleString("es-AR")}</span>
              <span className="flex gap-2">
                {page > 0 && <Link className="ad-btn sm" href={qs({ p: page - 1 || undefined })}>Anterior</Link>}
                {(page + 1) * PAGE < (count ?? 0) && <Link className="ad-btn sm" href={qs({ p: page + 1 })}>Siguiente</Link>}
              </span>
            </div>
          )}
        </Card>
      )}
      {!!imports?.length && (
        <p className="mt-4 text-[11.5px] text-zinc-500">Importaciones: {imports.map((i) => `${i.file_name} (${day(i.created_at)}, ${i.contacts} contactos)`).join(" · ")}</p>
      )}
    </Shell>
  );
}
