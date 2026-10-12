import Link from "next/link";
import { Bell } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Badge, Card, EmptyState, Kpi, PageHead, SaveForm, Table, Tabs } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/admin-data";
import { EMAIL, storeAlias } from "@/lib/admin/privacy";
import { resendDeliveryAction } from "@/lib/admin/actions";
import { resolveAllAction } from "@/lib/admin/mail-actions";
import AlertRow from "./AlertRow";
import { Suspense } from "react";
import DeliveryHealth from "@/components/admin/DeliveryHealth";
import ResendButton from "@/components/admin/ResendButton";
import { ALERT_LABEL, closeAnsweredMailAlerts, type AlertKind } from "@/lib/alerts";
import { embeddedRef } from "@/lib/order-ref";

export const dynamic = "force-dynamic";

type Sp = { tab?: string; kind?: string; sev?: string; estado?: string; s?: string; mk?: string; d?: string; st?: string };

const SEV: Record<string, { tone: "bad" | "warn" | undefined; label: string }> = {
  error: { tone: "bad", label: "Error" }, warn: { tone: "warn", label: "Atención" }, info: { tone: undefined, label: "Info" },
};
const MAIL_KIND: Record<string, string> = { delivery: "Entrega", upsell: "Upsell", recovery: "Recuperación", test: "Prueba", reply: "Respuesta" };

/** Avisos (lo que hay que mirar) y la bitácora de mails enviados con aperturas, descargas y rebotes. */
export default async function Avisos({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tab = sp.tab === "mails" ? "mails" : "avisos";
  // Lo que ya se respondió no se muestra como pendiente: se cierra antes de listar.
  const [{ data: storeRows }] = await Promise.all([
    db.from("stores").select("id,slug,name,display_name").order("created_at"),
    closeAnsweredMailAlerts().catch(() => 0),
  ]);
  const stores = storeRows ?? [];
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const link = (extra: Partial<Sp>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, v);
    return `/admin/avisos${p.size ? `?${p}` : ""}`;
  };

  return (
    <Shell>
      <PageHead
        title="Avisos"
        icon={<Bell className="h-[18px] w-[18px]" />}
        color="#f59e0b"
        sub="Mails que no salieron o rebotaron, entregas que nadie abrió, links rotos, mails nuevos de compradores y problemas de Stripe."
        actions={<Tabs current={tab} items={[{ href: "/admin/avisos", label: "Avisos", key: "avisos" }, { href: "/admin/avisos?tab=mails", label: "Mails enviados", key: "mails" }]} />}
      />
      {tab === "avisos" && <Suspense fallback={null}><DeliveryHealth /></Suspense>}
      {tab === "avisos" ? <AlertsTab sp={sp} link={link} storeById={storeById} /> : <MailsTab sp={sp} link={link} stores={stores} storeById={storeById} />}
    </Shell>
  );
}

type StoreRow = { id: string; slug: string; name: string; display_name: string | null };

async function AlertsTab({ sp, link, storeById }: { sp: Sp; link: (e: Partial<Sp>) => string; storeById: Map<string, StoreRow> }) {
  // Abiertos (por defecto), Resueltos o Todos.
  const estado = sp.estado === "todos" || sp.estado === "resueltos" ? sp.estado : null;
  const all = estado === "todos";
  const kind = sp.kind && sp.kind in ALERT_LABEL ? (sp.kind as AlertKind) : null;
  const sev = sp.sev && sp.sev in SEV ? sp.sev : null;
  let q = db.from("alerts").select("id,store_id,kind,severity,title,body,link,created_at,resolved_at").order("created_at", { ascending: false }).limit(150);
  if (!estado) q = q.is("resolved_at", null);
  if (estado === "resueltos") q = q.not("resolved_at", "is", null);
  if (kind) q = q.eq("kind", kind);
  if (sev) q = q.eq("severity", sev);
  const [{ data: rows }, { data: openKinds }] = await Promise.all([q, db.from("alerts").select("kind").is("resolved_at", null).limit(2000)]);
  const DELIVERY = new Set(["email_failed", "delivery_error", "email_bounced"]);
  const orderOf = (l: string | null) => l?.match(/\/pedido\/([0-9a-f-]{36})/)?.[1] ?? null;
  const counts = new Map<string, number>();
  for (const r of openKinds ?? []) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);

  return (
    <>
      <div className="mb-4 grid gap-2.5">
        <div className="ad-seg">
          <Link href={link({ kind: undefined })} className={!kind ? "on" : ""}>Todos{openKinds?.length ? ` · ${openKinds.length}` : ""}</Link>
          {(Object.keys(ALERT_LABEL) as AlertKind[]).map((k) => (
            <Link key={k} href={link({ kind: k })} className={kind === k ? "on" : ""}>{ALERT_LABEL[k]}{counts.get(k) ? ` · ${counts.get(k)}` : ""}</Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ad-seg">
            <Link href={link({ sev: undefined })} className={!sev ? "on" : ""}>Toda gravedad</Link>
            {Object.entries(SEV).map(([k, v]) => <Link key={k} href={link({ sev: k })} className={sev === k ? "on" : ""}>{v.label}</Link>)}
          </div>
          <div className="ad-seg">
            <Link href={link({ estado: undefined })} className={!estado ? "on" : ""}>Abiertos</Link>
            <Link href={link({ estado: "resueltos" })} className={estado === "resueltos" ? "on" : ""}>Resueltos</Link>
            <Link href={link({ estado: "todos" })} className={all ? "on" : ""}>Todos</Link>
          </div>
          {!estado && !!rows?.length && (
            <SaveForm action={resolveAllAction.bind(null, kind)} submit={kind ? `Resolver todos (${ALERT_LABEL[kind]})` : "Resolver todos"} pendingText="…"
              variant="secondary" size="sm" className="ml-auto flex items-center gap-2" confirm="¿Marcar como resueltos todos los avisos abiertos de esta lista?" />
          )}
        </div>
      </div>

      <Card pad={false}>
        {!rows?.length ? (
          <EmptyState title={estado ? "Sin avisos" : "Nada pendiente"} icon={<Bell className="h-5 w-5" />}>
            {estado ? "Todavía no hubo ningún aviso con este filtro." : "Cuando un mail rebote, una entrega no se abra o un comprador escriba, aparece acá."}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map((a) => {
              const s = SEV[a.severity] ?? SEV.info;
              const st = a.store_id ? storeById.get(a.store_id) : null;
              return (
                <AlertRow key={a.id} id={a.id} title={a.title} resolved={!!a.resolved_at} keep={!!estado}
                  className="flex flex-wrap items-start gap-3 border-b border-zinc-100 px-5 py-3.5 last:border-b-0 dark:border-white/[0.04]"
                  actions={<>
                    {!a.resolved_at && DELIVERY.has(a.kind) && orderOf(a.link) && st && <ResendButton store={st.slug} orderId={orderOf(a.link)!} />}
                    {a.link ? <Link href={a.link} className="ad-btn sm">Ver</Link> : null}
                  </>}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "error" ? "bg-red-500" : a.severity === "warn" ? "bg-amber-500" : "bg-sky-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={s.tone}>{ALERT_LABEL[a.kind as AlertKind] ?? a.kind}</Badge>
                      {st && <span className="text-[11px] font-bold text-zinc-400"><Pv as={storeAlias(st.id)}>{st.display_name || st.name}</Pv></span>}
                      <span className="text-[11px] text-zinc-400">{fmtDate(a.created_at)}</span>
                    </div>
                    <p data-pv-blur className="mt-1 break-words text-[13px] font-bold text-zinc-900 dark:text-white">{a.title}</p>
                    {a.body && <p data-pv-blur className="mt-0.5 break-words text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{a.body}</p>}
                  </div>
                </AlertRow>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

async function MailsTab({ sp, link, stores, storeById }: { sp: Sp; link: (e: Partial<Sp>) => string; stores: StoreRow[]; storeById: Map<string, StoreRow> }) {
  const days = [7, 30, 90].includes(Number(sp.d)) ? Number(sp.d) : 7;
  const store = stores.find((s) => s.slug === sp.s) ?? null;
  const mk = sp.mk && sp.mk in MAIL_KIND ? sp.mk : null;
  const st = ["opened", "unopened", "downloaded", "bounced", "failed"].includes(sp.st ?? "") ? sp.st! : null;
  let q = db.from("email_log")
    .select("id,store_id,order_id,kind,to_email,subject,provider,status,error,created_at,tracked,opened_at,open_count,clicked_at,click_count,downloaded_at,bounced_at,bounce_reason,ai,orders(number,status)")
    .gte("created_at", new Date(Date.now() - days * 864e5).toISOString()).order("created_at", { ascending: false }).limit(200);
  if (store) q = q.eq("store_id", store.id);
  if (mk) q = q.eq("kind", mk);
  if (st === "opened") q = q.not("opened_at", "is", null);
  if (st === "unopened") q = q.eq("tracked", true).eq("status", "sent").is("opened_at", null).is("bounced_at", null);
  if (st === "downloaded") q = q.not("downloaded_at", "is", null);
  if (st === "bounced") q = q.not("bounced_at", "is", null);
  if (st === "failed") q = q.eq("status", "failed");
  const { data: rows } = await q;
  const list = rows ?? [];

  const sent = list.filter((r) => r.status === "sent");
  const tracked = sent.filter((r) => r.tracked);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <>
      <div className="mb-4 grid gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ad-seg">
            <Link href={link({ s: undefined })} className={!store ? "on" : ""}>Todas las tiendas</Link>
            {stores.map((s) => <Link key={s.id} href={link({ s: s.slug })} className={store?.id === s.id ? "on" : ""}><Pv as={storeAlias(s.id)}>{s.display_name || s.name}</Pv></Link>)}
          </div>
          <div className="ad-seg">
            {[7, 30, 90].map((d) => <Link key={d} href={link({ d: d === 7 ? undefined : String(d) })} className={days === d ? "on" : ""}>{d} días</Link>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ad-seg">
            <Link href={link({ mk: undefined })} className={!mk ? "on" : ""}>Todos</Link>
            {Object.entries(MAIL_KIND).map(([k, l]) => <Link key={k} href={link({ mk: k })} className={mk === k ? "on" : ""}>{l}</Link>)}
          </div>
          <div className="ad-seg">
            {([[null, "Cualquier estado"], ["opened", "Abiertos"], ["unopened", "Sin abrir"], ["downloaded", "Descargaron"], ["bounced", "Rebotaron"], ["failed", "Fallaron"]] as const).map(([k, l]) => (
              <Link key={l} href={link({ st: k ?? undefined })} className={st === k ? "on" : ""}>{l}</Link>
            ))}
          </div>
        </div>
      </div>

      <div className="ad-grid g-kpi mb-4">
        <Kpi label="Enviados" value={String(sent.length)} hint={`${list.length - sent.length} fallidos`} />
        <Kpi label="Abiertos" value={pct(tracked.filter((r) => r.opened_at).length, tracked.length)} hint={`de ${tracked.length} con seguimiento`} />
        <Kpi label="Descargaron" value={pct(tracked.filter((r) => r.downloaded_at).length, tracked.filter((r) => r.kind === "delivery" || r.kind === "upsell").length)} hint="de las entregas con seguimiento" />
        <Kpi label="Rebotes" value={String(list.filter((r) => r.bounced_at).length)} />
      </div>

      <Card pad={false}>
        {!list.length ? (
          <EmptyState title="Sin mails en este período">Probá con más días u otro filtro.</EmptyState>
        ) : (
          <Table head={["Destinatario", { label: "Tipo", hideM: true }, "Estado", { label: "Pedido", hideM: true }, ""]}>
            {list.map((r) => {
              const s = r.store_id ? storeById.get(r.store_id) : null;
              const broken = (r.error ?? "").startsWith("link roto");
              const times = [
                r.opened_at && `abrió ${fmtDate(r.opened_at)}`,
                r.downloaded_at && `descargó ${fmtDate(r.downloaded_at)}`,
                r.bounced_at && `rebotó ${fmtDate(r.bounced_at)}${r.bounce_reason ? `: ${r.bounce_reason}` : ""}`,
                r.status === "failed" && r.error,
                broken && r.error,
              ].filter(Boolean).join(" · ");
              return (
                <tr key={r.id}>
                  <td>
                    <b><Pv as={EMAIL}>{r.to_email}</Pv></b>
                    <span className="sub" data-pv-blur>{r.subject || "—"}</span>
                    <span className="sub">{fmtDate(r.created_at)}{s ? <> · <Pv as={storeAlias(s.id)}>{s.display_name || s.name}</Pv></> : ""} · {r.provider}</span>
                  </td>
                  <td className="hide-m">{MAIL_KIND[r.kind] ?? r.kind}</td>
                  <td>
                    <div className="flex max-w-[340px] flex-wrap gap-1">
                      {r.status === "failed" ? <Badge tone="bad" dot>Falló</Badge> : <Badge>Enviado</Badge>}
                      {r.ai && <Badge tone="brand">IA</Badge>}
                      {r.bounced_at && <Badge tone="bad" dot>Rebotó</Badge>}
                      {r.opened_at && <Badge tone="ok">Abierto{r.open_count ? ` (${r.open_count})` : ""}</Badge>}
                      {r.downloaded_at && <Badge tone="ok" dot>Descargó</Badge>}
                      {r.clicked_at && !r.downloaded_at && <Badge tone="brand">Clic ({r.click_count})</Badge>}
                      {broken && <Badge tone="bad">Link roto</Badge>}
                      {r.status === "sent" && r.tracked && !r.opened_at && !r.bounced_at && <Badge tone="warn">Sin abrir</Badge>}
                      {r.status === "sent" && !r.tracked && r.kind !== "reply" && <span className="text-[10.5px] text-zinc-400">sin seguimiento</span>}
                    </div>
                    {times && <span className="sub break-words" data-pv-blur>{times}</span>}
                  </td>
                  <td className="hide-m">{r.order_id ? <Link className="ad-link-a" href={`/admin/avisos/pedido/${r.order_id}`}>{embeddedRef(r.order_id, r.orders)}</Link> : <span className="text-zinc-400">—</span>}</td>
                  <td className="num">
                    {r.order_id && s && (r.kind === "delivery" || r.kind === "upsell") && (
                      <SaveForm action={resendDeliveryAction.bind(null, s.slug, r.order_id)} submit="Reenviar" pendingText="…" variant="secondary" size="sm"
                        className="inline-flex items-center justify-end gap-2" confirm={`¿Reenviar el mail de entrega a ${r.to_email}?`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
