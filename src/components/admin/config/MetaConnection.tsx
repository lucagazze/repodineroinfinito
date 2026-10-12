import { Plug } from "lucide-react";
import { db } from "@/lib/db";
import { connectionInfo, type Usage } from "@/lib/admin/meta-conn";
import { adAccounts } from "@/lib/admin/meta-report";
import { clearMetaTokenAction, saveMetaTokenAction, syncMetaNowAction, testMetaConnectionAction } from "@/lib/admin/actions";
import { Badge, Card, PageHead, Table } from "../ui";
import { SaveForm } from "../ui-client";
import { PANEL_TZ } from "@/lib/admin/range";

/**
 * Configuración › Conexión con Meta (para todas las tiendas): el token con
 * que el panel lee los anuncios, de quién es, cuándo vence, qué cuentas ve,
 * cuánto queda de los límites de la API y lo último que se guardó. el dueño puede
 * pegar un token nuevo (por ejemplo de un usuario del sistema del Business
 * Manager): se prueba contra las cuentas de las tiendas y queda cifrado.
 */

const ic = "h-[18px] w-[18px]";
const when = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: PANEL_TZ });
const STATUS: Record<number, string> = { 1: "Activa", 2: "Deshabilitada", 3: "Con deuda", 7: "En revisión", 8: "Cerrada", 9: "En gracia", 100: "Por cerrar", 101: "Cerrada" };
const KEY_PERMS = ["ads_read", "ads_management", "read_insights", "business_management"];

function Meter({ label, pct, hint }: { label: string; pct: number | undefined; hint?: string }) {
  const v = Math.max(0, Math.min(100, Number(pct ?? 0)));
  const tone = v >= 90 ? "bg-red-500" : v >= 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-[11.5px] font-semibold text-zinc-600 dark:text-zinc-300">
        <span>{label}</span><b className="tabular-nums">{pct == null ? "—" : `${v}%`}</b>
      </div>
      <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]"><i className={`block h-full ${tone}`} style={{ width: `${v}%` }} /></span>
      {hint && <small className="text-[10.5px] text-zinc-400">{hint}</small>}
    </div>
  );
}

function Limits({ u, at }: { u: Usage | null; at: string | null }) {
  if (!u) return <p className="ad-note">Todavía no hay datos de uso: aparecen después de la primera lectura de Meta.</p>;
  const tier = u.account?.ads_api_access_tier ?? u.business?.find((b) => b.ads_api_access_tier)?.ads_api_access_tier;
  const wait = Math.max(0, ...(u.business ?? []).map((b) => Number(b.estimated_time_to_regain_access ?? 0)));
  return (
    <div className="grid gap-4">
      {tier === "development_access" && (
        <p className="ad-flash warn mb-0">
          La app del token está en <b>acceso de desarrollo</b>: Meta le da muy pocas consultas por hora y por eso a veces «se desconecta». Para que no pase:
          usá un token de <b>usuario del sistema</b> de una app con <b>Ads Management Standard Access</b> (se pide en developers.facebook.com › la app › Revisión de la app).
        </p>
      )}
      {wait > 0 && <p className="ad-flash bad mb-0">Meta bloqueó las consultas por {wait} min. El panel muestra lo último guardado y reintenta solo.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Meter label="App · llamadas" pct={u.app?.call_count} />
        <Meter label="App · tiempo de CPU" pct={u.app?.total_cputime} />
        <Meter label="Cuenta publicitaria" pct={u.account?.acc_id_util_pct} hint={u.account?.reset_time_duration ? `se libera en ${Math.ceil(u.account.reset_time_duration / 60)} min` : undefined} />
      </div>
      {(u.business ?? []).length > 0 && (
        <Table head={["Uso del negocio", { label: "Llamadas", num: true }, { label: "CPU", num: true }, { label: "Tiempo", num: true }, { label: "Espera", num: true }]}>
          {(u.business ?? []).map((b, i) => (
            <tr key={i}>
              <td><b>{b.type ?? "—"}</b>{b.ads_api_access_tier && <span className="sub">{b.ads_api_access_tier === "development_access" ? "acceso de desarrollo" : b.ads_api_access_tier === "standard_access" ? "acceso estándar" : b.ads_api_access_tier}</span>}</td>
              <td className="num">{b.call_count ?? 0}%</td><td className="num">{b.total_cputime ?? 0}%</td><td className="num">{b.total_time ?? 0}%</td>
              <td className="num">{b.estimated_time_to_regain_access ? `${b.estimated_time_to_regain_access} min` : "—"}</td>
            </tr>
          ))}
        </Table>
      )}
      <small className="text-[11px] text-zinc-400">Lo informa Meta en cada respuesta · último dato {when(at) ?? "—"}.</small>
    </div>
  );
}

export async function MetaConnectionTab() {
  const accounts = await adAccounts();
  const [info, { data: snaps }] = await Promise.all([
    connectionInfo(accounts.map((a) => a.id)),
    db.from("meta_sync").select("account_id,name,last_ok_at,last_error,error_at,retry_at,backfilled_from,rows_written,took_ms").order("account_id"),
  ]);
  const missing = accounts.filter((a) => info.me && !info.accounts.some((x) => x.id === a.id));
  return (
    <>
      <PageHead icon={<Plug className={ic} />} color="#1877f2" title="Conexión con Meta"
        sub="El token con que el panel lee los anuncios de todas las tiendas. Un cron trae Meta a la base cada 15 minutos y el panel solo lee de ahí; si Meta limita, se muestra lo guardado." />
      <div className="ad-grid">
        <Card title={<>Token en uso {info.source === "panel" ? <Badge tone="ok" dot>Cargado en el panel</Badge> : info.source === "env" ? <Badge tone="warn" dot>De entorno (META_ADS_TOKEN)</Badge> : <Badge tone="bad" dot>Sin token</Badge>}</>}
          action={<SaveForm action={testMetaConnectionAction} submit="Probar conexión" pendingText="Probando…" variant="secondary" size="sm" className="" />}>
          {info.error && <p className="ad-flash bad">Meta: {info.error}</p>}
          <dl className="ad-dl">
            <dt>Token</dt><dd><code>{info.masked ?? "—"}</code>{info.label ? ` · ${info.label}` : ""}{info.savedAt ? ` · guardado el ${fecha(info.savedAt)}` : ""}</dd>
            <dt>De quién es</dt><dd>{info.me ? <>{info.me.name} <span className="text-zinc-400">({info.me.id})</span></> : "—"}</dd>
            <dt>App</dt><dd>{info.appName ?? "—"}{info.type ? ` · ${info.type === "SYSTEM_USER" ? "usuario del sistema" : info.type === "USER" ? "usuario" : info.type}` : ""}</dd>
            <dt>Vence</dt><dd>{info.neverExpires ? <Badge tone="ok">No vence</Badge> : info.expiresAt ? fecha(info.expiresAt) : "—"}</dd>
            <dt>Permisos</dt>
            <dd className="flex flex-wrap gap-1">
              {KEY_PERMS.map((p) => <Badge key={p} tone={info.permissions.includes(p) ? "ok" : "warn"}>{p}{info.permissions.includes(p) ? " ✓" : " falta"}</Badge>)}
            </dd>
            <dt>Última lectura buena</dt><dd>{when(info.lastOkAt) ?? "—"}</dd>
            <dt>Último error</dt><dd>{info.lastError ? <>{info.lastError} <span className="text-zinc-400">({when(info.lastErrorAt)})</span></> : "Ninguno"}</dd>
          </dl>
        </Card>

        <Card title="Pegar un token nuevo" sub="Por ejemplo, el de un usuario del sistema del Business Manager (no vence). Se prueba contra las cuentas publicitarias de las tiendas antes de guardarse, y queda cifrado.">
          <SaveForm action={saveMetaTokenAction} submit="Probar y guardar" pendingText="Probando el token…" resetOnOk>
            <label className="ad-field"><span className="lbl">Token de acceso</span>
              <input className="ad-in mono" name="token" required autoComplete="off" spellCheck={false} placeholder="EAAG…" data-pv-blur /></label>
            <label className="ad-field"><span className="lbl">Nombre (opcional)</span>
              <input className="ad-in" name="label" placeholder="Usuario del sistema · Panel" /></label>
          </SaveForm>
          {info.source === "panel" && (
            <div className="mt-3"><SaveForm action={clearMetaTokenAction} submit="Volver al token de entorno" pendingText="…" variant="secondary" size="sm" className=""
              confirm="¿Sacar el token del panel y volver a usar META_ADS_TOKEN?" /></div>
          )}
        </Card>

        <Card title="Límites de la API" sub="Cuánto de su cupo usó el token. Cerca del 100 % Meta empieza a rechazar consultas por un rato.">
          <Limits u={info.usage} at={info.usageAt} />
        </Card>

        <Card title="Cuentas publicitarias que ve" pad={false}>
          {missing.length > 0 && <p className="ad-flash bad m-5 mb-0">No ve {missing.map((a) => a.id).join(", ")}, que usa{missing.length === 1 ? "" : "n"} una tienda: dale acceso en el Business Manager.</p>}
          {info.accounts.length ? (
            <Table head={["Cuenta", "Estado", { label: "Tiendas", hideM: true }]}>
              {info.accounts.slice(0, 40).map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b><span className="sub">{a.id}</span></td>
                  <td>{a.status === 1 ? <Badge tone="ok" dot>Activa</Badge> : <Badge tone="warn">{STATUS[a.status] ?? `estado ${a.status}`}</Badge>}</td>
                  <td className="hide-m">{a.used ? <Badge tone="brand">La usan las tiendas</Badge> : <span className="text-zinc-400">—</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="ad-note px-5 pb-5">{info.me ? "El token no ve ninguna cuenta publicitaria." : "Sin datos."}</p>}
        </Card>

        <Card title="Sincronización con Meta" sub="Cada 15 minutos se traen los últimos 3 días por anuncio (lo que Meta todavía corrige); la primera vez, hasta 62 días hacia atrás de a tandas. Si Meta limita, se espera y se reintenta solo."
          action={<SaveForm action={syncMetaNowAction} submit="Sincronizar ahora" pendingText="Sincronizando…" variant="secondary" size="sm" className="" />} pad={false}>
          {snaps?.length ? (
            <Table head={["Cuenta", "Última buena", { label: "Datos desde", hideM: true }, "Estado"]}>
              {snaps.map((r) => {
                const failed = r.last_error && (!r.last_ok_at || (r.error_at ?? "") >= r.last_ok_at);
                return (
                  <tr key={r.account_id}>
                    <td><b>{r.name ?? r.account_id}</b><span className="sub">{r.account_id}{r.rows_written != null ? ` · ${r.rows_written} filas en ${Math.round((r.took_ms ?? 0) / 1000)} s` : ""}</span></td>
                    <td>{when(r.last_ok_at) ?? "nunca"}</td>
                    <td className="hide-m">{r.backfilled_from ? fecha(r.backfilled_from) : "—"}</td>
                    <td>{failed ? <Badge tone="warn">{r.last_error}{r.retry_at ? ` · reintenta ${new Date(r.retry_at) > new Date() ? `en ${Math.ceil((new Date(r.retry_at).getTime() - Date.now()) / 60_000)} min` : "ya"}` : ""}</Badge> : <Badge tone="ok" dot>Bien</Badge>}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <p className="ad-note px-5 pb-5">Todavía no se sincronizó: corre sola cada 15 minutos, o tocá «Sincronizar ahora».</p>}
        </Card>
      </div>
    </>
  );
}
