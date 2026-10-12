import Link from "next/link";
import { CirclePlay, Route } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { PageHead } from "@/components/admin/ui";
import { visitorJourney, visitorOfOrder, type VisitSession } from "@/lib/live";
import {
  Flag, Pv, hhmmss, dayTime, dur, placeOf, DeviceLine, IpTag, ReturnBadge, SourceLine, LineRow,
} from "../parts";
import { RecButton } from "../Player";

export const dynamic = "force-dynamic";

/**
 * Recorrido de un visitante: todas sus visitas (pestañas) de los últimos 30
 * días con cada paso, y el link a sus grabaciones de Clarity.
 *   /admin/en-vivo/recorrido?v={visitor_id}   desde «Personas ahora» y el feed
 *   /admin/en-vivo/recorrido?pedido={id}      desde un pedido
 */

const VID = /^[A-Za-z0-9_-]{6,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function Empty({ text }: { text: string }) {
  return (
    <Shell>
      <PageHead title="Recorrido del visitante" icon={<Route className="h-[18px] w-[18px]" />} color="#10b981" crumb={[{ href: "/admin/en-vivo", label: "En vivo" }]} />
      <div className="ad-card"><div className="ad-card-b ad-muted">{text}</div></div>
    </Shell>
  );
}

function Session({ s, n, clarityUrl }: { s: VisitSession; n: number; clarityUrl: string | null }) {
  const span = Date.parse(s.end) - Date.parse(s.start);
  const bought = s.journey.filter((l) => l.cats.includes("compras"));
  return (
    <section className="ad-card mt">
      <div className="ad-card-h">
        <div className="min-w-0 flex-1">
          <h3>
            Visita {n} · {dayTime(s.start)}
            {span > 0 && <span className="ad-faint text-[12px] font-medium">{dur(span)}</span>}
            {s.paid && <span className="ad-badge ok">compró</span>}
          </h3>
          <div className="mt-1.5 grid gap-1 text-[12px] text-zinc-600 dark:text-zinc-300">
            <div className="flex min-w-0"><SourceLine s={s.source} /></div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex min-w-0 items-center gap-1.5"><Flag cc={s.country} />{placeOf(s)}</span>
              <span className="flex min-w-0"><DeviceLine w={s} /></span>
              <span className="ad-faint"><IpTag ip={s.ip} /></span>
            </div>
            {s.offer && <div className="ad-faint"><Pv as={s.alias ?? "—"}>{s.offer}</Pv>{s.market ? ` · ${s.market}` : ""}</div>}
            {bought.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {bought.map((l) => <span key={l.key} className="ad-badge ok">✓ {l.step}{l.amount ? ` · ${l.amount}` : ""}</span>)}
              </div>
            )}
          </div>
          {s.rec && s.sid && (
            <div className="mt-3">
              <RecButton
                sid={s.sid}
                className="ad-btn sm primary"
                label="Ver grabación"
                title={`Visita ${n} · ${dayTime(s.start)}`}
                sub={<span className="flex min-w-0 flex-wrap items-center gap-x-3"><DeviceLine w={s} /><SourceLine s={s.source} /></span>}
                clarityUrl={clarityUrl}
              />
            </div>
          )}
        </div>
      </div>
      <div className="ad-card-b">
        <ol className="m-0 list-none p-0">
          {s.journey.map((l) => <LineRow key={l.key} l={l} time={hhmmss(l.at)} />)}
          {!s.journey.length && <li className="ad-faint py-1.5 text-[12.5px]">Solo latidos de presencia.</li>}
        </ol>
        {s.orders.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {s.orders.map((o) => o.href
              ? <Link key={o.id} href={o.href} className="ad-btn sm">Ver pedido {o.ref}</Link>
              : <span key={o.id} className="ad-badge">Pedido {o.ref}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

export default async function Recorrido({ searchParams }: { searchParams: Promise<{ v?: string; pedido?: string }> }) {
  const sp = await searchParams;
  let vid = sp.v && VID.test(sp.v) ? sp.v : null;
  if (!vid && sp.pedido && UUID.test(sp.pedido)) {
    vid = await visitorOfOrder(sp.pedido);
    if (!vid) return <Empty text="Este pedido no tiene recorrido registrado (se hizo antes del registro de visitas o desde otro dispositivo sin el seguimiento)." />;
  }
  if (!vid) return <Empty text="Falta el visitante: entrá desde «En vivo» o desde un pedido." />;

  const j = await visitorJourney(vid);
  if (!j.sessions.length) return <Empty text="No hay visitas de este visitante en los últimos 30 días." />;

  const w = j.who;
  return (
    <Shell>
      <PageHead
        title="Recorrido del visitante"
        icon={<Route className="h-[18px] w-[18px]" />}
        color="#10b981"
        crumb={[{ href: "/admin/en-vivo", label: "En vivo" }]}
        sub={`Todas sus visitas de los últimos 30 días${j.truncated ? " (las más recientes)" : ""}, con cada paso. Horas de Londres.`}
        actions={j.clarity.map((c) => (
          <a key={c.project} href={c.url} target="_blank" rel="noreferrer" className="ad-btn">
            <CirclePlay className="h-4 w-4" />Ver grabación en Clarity
          </a>
        ))}
      />

      <section className="ad-card">
        <div className="ad-card-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[16px] font-bold text-zinc-900 dark:text-white">
                <Flag cc={w.country} /><span className="truncate">{placeOf(w)}</span>
              </div>
              <div className="ad-muted mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="flex min-w-0"><DeviceLine w={w} /></span>
                <IpTag ip={w.ip} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {j.live && <span className="ad-livedot">Conectado ahora</span>}
              <ReturnBadge returning={j.sessions.length > 1 || w.returning ? true : w.returning} />
            </div>
          </div>
          <dl className="ad-dl mt-4" style={{ gridTemplateColumns: "minmax(110px, 170px) minmax(0, 1fr)" }}>
            <dt>Visitas</dt><dd>{j.sessions.length}</dd>
            <dt>Primera vez</dt><dd>{j.first ? dayTime(j.first) : "—"}</dd>
            <dt>Última vez</dt><dd>{j.last ? dayTime(j.last) : "—"}</dd>
            <dt>Clarity</dt>
            <dd>
              Filtro <b>Custom user ID</b> = <code>{j.vid}</code>
              <span className="ad-faint ad-small block mt-1">El botón ya abre las grabaciones filtradas. Si no aparece nada, la grabación puede tardar unos minutos en procesarse.</span>
            </dd>
          </dl>
        </div>
      </section>

      {j.sessions.map((s, i) => <Session key={s.sid ?? s.start} s={s} n={j.sessions.length - i} clarityUrl={j.clarity[0]?.url ?? null} />)}
    </Shell>
  );
}
