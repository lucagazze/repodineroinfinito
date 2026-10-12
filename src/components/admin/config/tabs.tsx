import { Suspense, type ReactNode } from "react";
import { Briefcase, CreditCard, Globe, KeyRound, Mail, Sparkles, Store, Target, Webhook } from "lucide-react";
import { db } from "@/lib/db";
import { mailProvider } from "@/lib/email";
import { decrypt, mask } from "@/lib/secrets";
import { publicBaseUrl, stripeHealth, webhookUrl } from "@/lib/stripe-connect";
import { listApiTokens } from "@/lib/api-tokens";
import { type AdminStore, LANG_LABEL, TIMEZONES, pixelList } from "@/lib/admin/store";
import { domainStatus, vercelReady } from "@/lib/admin/vercel-domains";
import { dnsOf, hostOf, httpOf, walletOf } from "@/lib/admin/domains";
import { offerList } from "@/lib/admin/offers";
import { checkoutUrl } from "@/lib/checkout-url";
import { businessMissing } from "@/lib/admin/setup";
import { sampleEmails } from "@/lib/admin/email-sample";
import { Badge, Card, Checks, CopyField, Flash, PageHead, Table, EmptyState } from "../ui";
import { Sk, SkCard } from "../Skeleton";
import { IExternal } from "../icons";
import { Pv } from "../Priv";

/**
 * Configuración, solo para mirar: el panel es del dueño para ver cómo está
 * cada tienda; crear y cambiar lo hace Claude por el MCP. Cada pestaña dice
 * qué hay cargado y si funciona. Lo que depende de un servicio externo
 * (Stripe, Vercel) llega después, dentro de un Suspense.
 */

const when = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
const ic = "h-[18px] w-[18px]";

/** Lo que no está cargado se dice, no se deja en blanco. */
const val = (v: ReactNode, empty = "Sin cargar") =>
  v === null || v === undefined || v === "" ? <span className="text-zinc-400 dark:text-zinc-500">{empty}</span> : v;

function Ask({ what = "algo de esto" }: { what?: string }) {
  return (
    <p className="-mt-2 mb-5 flex items-center gap-2 text-[12px] font-semibold text-zinc-500 dark:text-zinc-400">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
      Solo para mirar. Para cambiar {what}, pedíselo a Claude.
    </p>
  );
}

function Swatch({ color, fallback }: { color?: string; fallback: string }) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-5 w-5 rounded-md border border-black/10" style={{ background: c ?? fallback }} />
      <code>{c ?? fallback}</code>{!c && <span className="text-[11px] text-zinc-400">por defecto</span>}
    </span>
  );
}

const yes = (b: boolean, on = "Sí", off = "No") => (b ? <Badge tone="ok" dot>{on}</Badge> : <Badge>{off}</Badge>);

// ======================================================================= General

export function GeneralTab({ s }: { s: AdminStore }) {
  const name = s.display_name || s.name;
  const pay = s.brand.payButton && /^#[0-9a-f]{6}$/i.test(s.brand.payButton) ? s.brand.payButton : "#005bd1";
  const primary = s.brand.primary && /^#[0-9a-f]{6}$/i.test(s.brand.primary) ? s.brand.primary : "#1d1d1f";
  const tz = TIMEZONES.find(([id]) => id === s.timezone)?.[1] ?? s.timezone;
  return (
    <>
      <PageHead icon={<Store className={ic} />} color="#8b5cf6" title="General" sub="Quién es la tienda: cómo se llama, cómo la ve el comprador y a dónde le escribe." />
      <Ask what="la marca o los datos" />
      <div className="ad-grid">
        <Card title="Marca" sub="Lo que ve el comprador en el checkout, la página de gracias y los mails.">
          <div className="ad-grid g-11" style={{ gap: 24, alignItems: "start" }}>
            <dl className="ad-dl">
              <dt>Nombre visible</dt><dd>{s.display_name || <>{s.name} <span className="text-[11px] text-zinc-400">(el de la tienda)</span></>}</dd>
              <dt>Logo</dt>
              <dd>{s.logo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.logo_url} alt="" className="max-h-12 max-w-[180px] rounded-md border border-zinc-100 bg-white p-1 dark:border-white/10" />
                : val(null)}</dd>
              <dt>Color de marca</dt><dd><Swatch color={s.brand.primary} fallback="#1d1d1f" /></dd>
              <dt>Botón de pagar</dt><dd><Swatch color={s.brand.payButton} fallback="#005bd1" /></dd>
              <dt>Imagen de garantía</dt>
              <dd>{typeof s.brand.guaranteeImage === "string"
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.brand.guaranteeImage} alt="" className="max-h-16 rounded-md" />
                : val(null)}</dd>
            </dl>
            <div className="ad-preview grid gap-3">
              <div className="ad-mock overflow-hidden" style={{ padding: 0 }}>
                <div className="flex items-center justify-between gap-2.5 border-b border-zinc-100 px-4 py-3">
                  {s.logo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.logo_url} alt="" style={{ maxHeight: 26, maxWidth: 140 }} />
                    : <b className="truncate text-[14px]">{name}</b>}
                  <span className="whitespace-nowrap text-[12px] font-semibold text-green-700">🔒 Compra segura</span>
                </div>
                <div className="p-4">
                  <div className="h-2.5 w-3/5 rounded bg-zinc-100" />
                  <div className="mb-3.5 mt-2 h-2.5 w-2/5 rounded bg-zinc-50" />
                  <div className="rounded-[10px] p-3 text-center text-[14px] font-bold text-white" style={{ background: pay }}>Pagar ahora</div>
                </div>
              </div>
              <div className="ad-mock">
                <p className="text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: primary }}>{name}</p>
                <p className="my-1.5 text-[18px] font-bold">¡Gracias, Giulia!</p>
                <div className="rounded-[10px] p-2.5 text-center text-[13px] font-semibold text-white" style={{ background: primary }}>Descargar</div>
              </div>
            </div>
          </div>
        </Card>

        <div className="ad-grid g-2">
          <Card title="Tienda">
            <dl className="ad-dl">
              <dt>Nombre</dt><dd>{s.name}</dd>
              <dt>Dirección</dt><dd><code>{s.slug}</code></dd>
              <dt>Idioma por defecto</dt><dd>{LANG_LABEL[s.default_locale] ?? s.default_locale}</dd>
              <dt>Zona horaria</dt><dd>{tz}</dd>
              <dt>Garantía</dt><dd>{s.guarantee_days} días</dd>
              <dt>Estado</dt><dd>{s.active ? <Badge tone="ok" dot>Activa</Badge> : <Badge>Pausada</Badge>}</dd>
            </dl>
          </Card>
          <Card title="Contacto" sub="A dónde responden los compradores. Sale en los mails que reciben.">
            <dl className="ad-dl">
              <dt>Email de soporte</dt><dd>{s.support_email}</dd>
              <dt>Creada</dt><dd>{date(s.created_at)}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

// ======================================================================= Negocio

export function NegocioTab({ s }: { s: AdminStore }) {
  const b = s.business;
  const missing = businessMissing(s);
  const items = [
    { ok: !!s.legal_name, t: "Razón social" },
    { ok: !!s.legal_address, t: "Dirección legal" },
    { ok: !!s.statement_descriptor, t: "Nombre en el resumen de la tarjeta" },
    { ok: !!b.phone, t: "Teléfono" },
    { ok: !!b.about, t: "Quiénes somos" },
    { ok: !!b.tagline, t: "Frase corta", optional: true },
    { ok: !!b.audience, t: "Para quién es", optional: true },
    { ok: !!b.languages?.length, t: "Idiomas", optional: true },
  ];
  const statement = (s.statement_descriptor || process.env.STATEMENT_NAME || "MI EMPRESA").toUpperCase();
  return (
    <>
      <PageHead icon={<Briefcase className={ic} />} color="#0ea5e9" title="Negocio y catálogo" sub="Los datos que Stripe revisa en la cuenta y que muestra el catálogo público: quién vende, a quién y cómo contactarlo." />
      <Ask what="estos datos" />
      <div className="ad-grid g-21">
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="Datos legales" sub="Tienen que coincidir con los de la cuenta de Stripe.">
            <dl className="ad-dl">
              <dt>Razón social</dt><dd>{val(s.legal_name, `Sin cargar (se usa ${process.env.LEGAL_NAME || "Mi Empresa LLC"})`)}</dd>
              <dt>Dirección legal</dt><dd>{val(s.legal_address)}</dd>
              <dt>En el resumen de la tarjeta</dt>
              <dd><code>{statement}</code>{!s.statement_descriptor && <span className="ml-2 text-[11px] text-zinc-400">por defecto</span>}</dd>
              <dt>Teléfono</dt><dd>{val(b.phone)}</dd>
            </dl>
          </Card>
          <Card title="Presentación" sub="Lo que lee quien entra al catálogo (y el revisor de Stripe).">
            <dl className="ad-dl">
              <dt>Frase corta</dt><dd>{val(b.tagline)}</dd>
              <dt>Quiénes somos</dt><dd className="whitespace-pre-line">{val(b.about)}</dd>
              <dt>Para quién es</dt><dd className="whitespace-pre-line">{val(b.audience)}</dd>
              <dt>Tiempo de respuesta</dt><dd>{b.reply_hours || "24 hours"}</dd>
              <dt>Idiomas</dt><dd>{b.languages?.length ? <span className="flex flex-wrap gap-1.5">{b.languages.map((l) => <Badge key={l}>{l}</Badge>)}</span> : val(null)}</dd>
            </dl>
          </Card>
        </div>
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="Completo para Stripe" sub={missing.length ? `Faltan ${missing.length} datos obligatorios.` : "Están todos los datos obligatorios."}>
            <Checks items={items.map((i) => ({ status: i.ok ? "ok" : i.optional ? "na" : "bad", title: i.t, detail: i.optional && !i.ok ? "Opcional" : undefined }))} />
          </Card>
          <Card title="Catálogo público" sub="La web de la tienda que revisa Stripe: quiénes somos, productos y precios, términos, reembolsos y contacto.">
            <div className="grid gap-3">
              <a className="ad-btn primary" href={`/catalogo/${s.slug}`} target="_blank" rel="noreferrer"><IExternal size={15} /> Ver catálogo</a>
              <p className="ad-note">{s.catalog_domain ? <>En su dominio: <b>{s.catalog_domain}</b>.</> : "Todavía sin dominio propio."}</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

// ======================================================================= Entrega

async function EmailPreviews({ s }: { s: AdminStore }) {
  const m = await sampleEmails(s.id, s.slug);
  return (
    <div className="ad-grid g-2">
      <Card title="Mail de entrega" sub={<>Asunto: <b className="text-zinc-700 dark:text-zinc-200">{m.delivery.subject}</b></>}>
        <iframe title="Mail de entrega" className="ad-frame" style={{ height: 680 }} sandbox="" srcDoc={m.delivery.html} />
      </Card>
      <Card title="Mail de carrito abandonado" sub={<>Asunto: <b className="text-zinc-700 dark:text-zinc-200">{m.recovery.subject}</b></>}>
        <iframe title="Mail de carrito abandonado" className="ad-frame" style={{ height: 680 }} sandbox="" srcDoc={m.recovery.html} />
      </Card>
    </div>
  );
}

export function EntregaTab({ s }: { s: AdminStore }) {
  const provider = mailProvider();
  const ty = s.thankyou, de = s.delivery_email;
  const def = "Por defecto (traducido al idioma del comprador)";
  return (
    <>
      <PageHead icon={<Mail className={ic} />} color="#10b981" title="Entrega" sub="Lo que recibe el comprador al pagar: la página de gracias y el mail con sus descargas." />
      <Ask what="los textos" />
      <div className="ad-grid">
        <div className="ad-grid g-2">
          <Card title="Página de gracias">
            <dl className="ad-dl">
              <dt>Título</dt><dd>{val(ty.title, def)}</dd>
              <dt>Mensaje</dt><dd className="whitespace-pre-line">{val(ty.message, def)}</dd>
              <dt>Resumen de compra</dt><dd>{yes(!!ty.showSummary, "Se muestra", "No se muestra")}</dd>
              <dt>Aviso de spam</dt><dd>{yes(ty.showSpam !== false, "Se muestra", "No se muestra")}</dd>
            </dl>
          </Card>
          <Card title="Mail de entrega" sub="Sale solo apenas se confirma el pago.">
            <dl className="ad-dl">
              <dt>Asunto</dt><dd>{val(de.subject, def)}</dd>
              <dt>Bienvenida</dt><dd className="whitespace-pre-line">{val(de.welcome, def)}</dd>
              <dt>Cierre</dt><dd className="whitespace-pre-line">{val(de.closing, "Sin cierre")}</dd>
              <dt>Color</dt><dd><Swatch color={de.color} fallback="#005bd1" /></dd>
              <dt>Imagen de cabecera</dt><dd>{de.headerImage ? <a className="ad-link-a" href={de.headerImage} target="_blank" rel="noreferrer">Ver imagen</a> : val(null, "Sin imagen")}</dd>
            </dl>
          </Card>
        </div>

        <Card title="Remitente" sub="Desde qué dirección salen los mails de esta tienda.">
          <dl className="ad-dl">
            <dt>Sale desde</dt>
            <dd>{s.email_from ? <b>{s.email_from}</b> : <>{process.env.DELIVERY_FROM || s.support_email} <Badge tone="warn">sin remitente propio</Badge></>}</dd>
            <dt>Responden a</dt><dd>{s.support_email}</dd>
            <dt>Proveedor</dt>
            <dd>{provider ? <Badge tone="ok" dot>{provider === "postmark" ? "Postmark" : "Brevo"}</Badge> : <Badge tone="bad" dot>Ninguno: falta POSTMARK_TOKEN o BREVO_API_KEY</Badge>}</dd>
          </dl>
          <p className="ad-note mt-3">El dominio del remitente tiene que estar verificado en el proveedor (DKIM y SPF). Si no lo está, el envío se rechaza y el pedido queda sin entregar: lo marca el Diagnóstico.</p>
        </Card>

        <Suspense fallback={<div className="ad-grid g-2"><SkCard rows={10} h={760} /><SkCard rows={10} h={760} /></div>}>
          <EmailPreviews s={s} />
        </Suspense>
      </div>
    </>
  );
}

// ======================================================================= Pagos

const PERMS: [string, string][] = [
  ["PaymentIntents", "Escritura"], ["Customers", "Escritura"], ["Refunds", "Escritura"], ["Webhook Endpoints", "Escritura"],
  ["Payment Method Domains", "Escritura"], ["Charges", "Lectura"], ["PaymentMethods", "Lectura"],
];

/** Lo que sí hay que preguntarle a Stripe (cobros, pagos, webhook). Se dibuja después, dentro de un Suspense. */
async function LiveHealth({ storeId }: { storeId: string }) {
  const h = await stripeHealth(storeId);
  const hookOk = h.webhookOk && h.webhookUrlOk;
  return (
    <>
      {h.error && <dd style={{ gridColumn: "1/-1" }}><Flash bad={`Stripe rechazó la llave guardada: ${h.error}`} /></dd>}
      <dt>Cobros</dt><dd>{h.chargesEnabled == null ? "—" : h.chargesEnabled ? <Badge tone="ok" dot>Habilitados</Badge> : <Badge tone="bad" dot>No habilitados</Badge>}</dd>
      <dt>Pagos a tu banco</dt><dd>{h.payoutsEnabled == null ? "—" : h.payoutsEnabled ? <Badge tone="ok" dot>Habilitados</Badge> : <Badge tone="warn" dot>No habilitados</Badge>}</dd>
      <dt>Webhook</dt>
      <dd>
        {hookOk ? <Badge tone="ok" dot>Activo y apuntando bien</Badge>
          : h.webhookOk === false ? <Badge tone="bad" dot>Desactivado o borrado</Badge>
          : h.webhookUrlOk === false ? <Badge tone="bad" dot>Apunta a otra dirección</Badge> : "—"}
        <span className="ad-hint"><code>{webhookUrl(storeId)}</code></span>
      </dd>
    </>
  );
}

function LiveHealthSkeleton() {
  return (
    <>
      <dt>Cobros</dt><dd><Sk w={110} h={22} r={11} /></dd>
      <dt>Pagos a tu banco</dt><dd><Sk w={110} h={22} r={11} /></dd>
      <dt>Webhook</dt><dd><Sk w={170} h={22} r={11} /></dd>
    </>
  );
}

async function StripeBlock({ s }: { s: AdminStore }) {
  const { data: row } = await db.from("store_stripe")
    .select("account_id,account_name,livemode,publishable_key,secret_key_enc,connected_at,last_event_at,apple_pay_domains")
    .eq("store_id", s.id).maybeSingle();
  if (!row) {
    return (
      <Card title={<>Stripe <Badge tone="bad" caps>No conectado</Badge></>} sub="Esta tienda todavía no tiene su cuenta de Stripe: el checkout cobra con la llave general del servidor.">
        <p className="ad-note">Para conectarla, pasale a Claude la llave secreta (mejor restringida, con los permisos de abajo) y la publicable de esa cuenta.</p>
      </Card>
    );
  }
  let skMask = "";
  try { skMask = mask(decrypt(row.secret_key_enc)); } catch { skMask = "no se puede leer (¿cambió SECRETS_KEY?)"; }
  const domains: string[] = row.apple_pay_domains ?? [];
  return (
    <Card
      title={<>Stripe {row.livemode ? <Badge tone="ok" dot caps>Modo real</Badge> : <Badge tone="warn" dot caps>Modo prueba</Badge>}</>}
      sub={<Pv as="Cuenta de Stripe">{row.account_name ?? row.account_id}</Pv>}
      action={<a className="ad-btn sm" href={`https://dashboard.stripe.com/${row.livemode ? "" : "test/"}dashboard`} target="_blank" rel="noreferrer"><IExternal size={14} /> Abrir Stripe</a>}
    >
      <dl className="ad-dl">
        <dt>Cuenta</dt><dd>{row.account_name ? `${row.account_name} · ` : ""}<code>{row.account_id}</code></dd>
        <Suspense fallback={<LiveHealthSkeleton />}><LiveHealth storeId={s.id} /></Suspense>
        <dt>Último evento</dt><dd>{when(row.last_event_at) ?? "Todavía no llegó ninguno"}</dd>
        <dt>Apple Pay / Google Pay</dt>
        <dd>{domains.length ? <span className="flex flex-wrap gap-1.5">{domains.map((d) => <Badge key={d} tone="ok">{d}</Badge>)}</span> : "Ningún dominio registrado"}</dd>
        <dt>Llaves</dt><dd><code>{skMask || "—"}</code> · <code>{row.publishable_key ? mask(row.publishable_key) : "—"}</code></dd>
        {row.connected_at && <><dt>Conectada</dt><dd>{date(row.connected_at)}</dd></>}
      </dl>
    </Card>
  );
}

export function PagosTab({ s }: { s: AdminStore }) {
  return (
    <>
      <PageHead icon={<CreditCard className={ic} />} color="#6366f1" title="Pagos" sub="La cuenta de Stripe donde cobra esta tienda. Cada tienda cobra en la suya." />
      <Ask what="la cuenta" />
      <div className="ad-grid">
        <Suspense fallback={<SkCard rows={6} h={300} />}>
          <StripeBlock s={s} />
        </Suspense>
        <div className="ad-grid g-2">
          <Card title="Permisos de la llave" sub="Si se usa una llave restringida (rk_live_), que es lo más seguro.">
            <p className="ad-note mb-3">Stripe → Desarrolladores → Claves de API → <b>Crear clave restringida</b>, con estos permisos y el resto en «Ninguno»:</p>
            <Table head={["Recurso", "Permiso"]}>
              {PERMS.map(([r, p]) => <tr key={r}><td>{r}</td><td><Badge tone={p === "Escritura" ? "brand" : undefined}>{p}</Badge></td></tr>)}
            </Table>
          </Card>
          <Card title="Medios de pago" sub="Tarjetas, Apple Pay, Google Pay, Link y los locales de cada país.">
            <p className="ad-note">Qué medios de pago se muestran se elige en Stripe → Configuración → Métodos de pago. Lo que se prenda ahí aparece solo en el checkout, según el país y la moneda del comprador.</p>
            <p className="ad-note">Apple Pay y Google Pay necesitan el dominio del checkout registrado en Stripe (ver arriba).</p>
          </Card>
        </div>
      </div>
    </>
  );
}

// ======================================================================= Dominios

type Addr = { label: string; url: string; wallet: boolean };

const chipCls = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
  off: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
};
const dotCls = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", off: "bg-zinc-400" };

function Chip({ tone, title, children }: { tone: keyof typeof chipCls; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-[2px] text-[11px] font-bold ring-1 ring-inset ${chipCls[tone]}`}>
      <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls[tone]}`} />
      {children}
    </span>
  );
}

/** Una dirección con sus chequeos en vivo: DNS, HTTPS y, si cobra, Apple Pay / Google Pay. */
async function AddressChecks({ a, storeId }: { a: Addr; storeId: string }) {
  const host = hostOf(a.url);
  const [d, h, w, v] = await Promise.all([
    dnsOf(host), httpOf(a.url), a.wallet ? walletOf(storeId) : null,
    a.wallet && vercelReady() ? domainStatus(host).catch(() => null) : null,
  ]);
  const target = d.records.find((r) => r.type === "CNAME")?.data ?? d.records.find((r) => r.type === "A")?.data;
  const dnsChip = d.status === "ok"
    ? <Chip tone="ok" title={`El nombre existe y apunta a: ${d.records.map((r) => `${r.type} ${r.data}`).join(", ")}`}>DNS → <Pv as="••••">{target}</Pv></Chip>
    : d.status === "missing"
      ? <Chip tone="bad" title="Nadie que escriba esta dirección va a llegar: falta el registro en el DNS del dominio.">DNS: el nombre no existe</Chip>
      : <Chip tone="off" title={d.error}>DNS: no se pudo consultar</Chip>;
  const loc = h.location ? h.location.replace(/^https?:\/\//, "") : "";
  const httpChip = h.status == null
    ? <Chip tone="bad" title="La dirección no contestó: los compradores ven un error.">No responde: {h.error}</Chip>
    : h.status < 300
      ? <Chip tone="ok" title={`Contesta con HTTPS válido en ${h.ms} ms.`}>Responde · {h.status}</Chip>
      : h.status < 400
        ? <Chip tone="ok" title={`Contesta y manda a ${h.location ?? "otra página"}`}>Redirige ({h.status}){loc ? <> → <Pv as="••••">{loc.slice(0, 40)}</Pv></> : null}</Chip>
        : h.status < 500
          ? <Chip tone="warn" title="Contesta, pero esa página no existe o no deja entrar.">Responde {h.status}{h.status === 404 ? " · no existe" : ""}</Chip>
          : <Chip tone="bad" title="El servidor contestó con un error.">Error del servidor · {h.status}</Chip>;
  let walletChip: ReactNode = null;
  if (w) {
    const m = w.domains.find((x) => x.host === host);
    walletChip = !w.ok
      ? <Chip tone="off" title={w.error}>Apple/Google Pay: no se pudo leer Stripe</Chip>
      : !m
        ? <Chip tone="warn" title="El dominio no está dado de alta en Stripe: en este checkout no aparecen Apple Pay ni Google Pay. Se registra con register_apple_pay_domains (MCP).">Apple/Google Pay: falta registrar en Stripe</Chip>
        : m.enabled && m.apple === "active" && m.google !== "inactive"
          ? <Chip tone="ok" title="Registrado y activo en la cuenta de Stripe de la tienda.">Apple Pay y Google Pay listos</Chip>
          : <Chip tone="warn" title={`Stripe: Apple Pay ${m.apple ?? "?"} · Google Pay ${m.google ?? "?"}${m.enabled ? "" : " · deshabilitado"}`}>Apple/Google Pay: pendiente en Stripe</Chip>;
  }
  // Vercel solo si hay token: si no, el chequeo de HTTPS de arriba ya dice si anda.
  const vercel = v && v.api ? (
    v.error ? <Chip tone="off" title={v.error}>Vercel: no se pudo consultar</Chip>
      : v.inProject === false ? <Chip tone="warn" title="El dominio no está agregado al proyecto de Vercel.">Vercel: no está en el proyecto</Chip>
      : v.misconfigured ? <Chip tone="warn" title="Vercel ve el DNS mal apuntado.">Vercel: DNS sin apuntar</Chip>
      : <Chip tone="ok">Vercel: ok</Chip>
  ) : null;
  return <div className="flex flex-wrap gap-1.5">{dnsChip}{httpChip}{walletChip}{vercel}</div>;
}

function AddressRow({ a, storeId }: { a: Addr; storeId: string }) {
  return (
    <div className="grid gap-1.5 border-t border-zinc-100 py-3 first:border-t-0 first:pt-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4 dark:border-white/[0.05]">
      <span className="text-[12px] font-bold text-zinc-500 dark:text-zinc-400">{a.label}</span>
      <div className="grid min-w-0 gap-1.5">
        <a href={a.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] font-semibold text-zinc-800 hover:underline dark:text-zinc-100">
          <span data-pv-blur className="truncate">{a.url.replace(/^https:\/\//, "")}</span><IExternal />
        </a>
        <Suspense fallback={<div className="flex gap-1.5"><Sk w={150} h={18} r={6} /><Sk w={110} h={18} r={6} /></div>}>
          <AddressChecks a={a} storeId={storeId} />
        </Suspense>
      </div>
    </div>
  );
}

export async function DominiosTab({ s }: { s: AdminStore }) {
  const offers = (await offerList()).filter((o) => o.store.id === s.id && o.active);
  const catalog = (s as AdminStore & { catalog_url?: string | null }).catalog_url ?? null;
  const groups: { key: string; title: ReactNode; rows: Addr[] }[] = offers.map((o) => ({
    key: o.key,
    title: <Pv as={o.alias}>{o.name}</Pv>,
    rows: o.markets.filter((f) => f.active).flatMap((f) => {
      const m = f.market_label ? ` · ${f.market_label}` : "";
      return [
        ...(f.landing_url ? [{ label: `Landing${m}`, url: f.landing_url, wallet: false }] : []),
        { label: `Checkout${m}`, url: checkoutUrl(f, s.slug), wallet: true },
      ];
    }),
  })).filter((g) => g.rows.length);
  const store: Addr[] = [
    ...(s.domain ? [{ label: "Respaldo (pay)", url: `https://${s.domain}/`, wallet: true }] : []),
    ...(catalog ? [{ label: "Catálogo (referencia)", url: catalog, wallet: false }] : []),
    ...(s.catalog_domain ? [{ label: "Catálogo de la app", url: `https://${s.catalog_domain}/`, wallet: false }] : []),
  ];
  return (
    <>
      <PageHead icon={<Globe className={ic} />} color="#0ea5e9" title="Dominios"
        sub="Todas las direcciones públicas que usa la tienda, revisadas en vivo: si el DNS existe, si la página responde y si Apple Pay / Google Pay están listos. Se vuelven a revisar cada minuto." />
      <div className="ad-grid">
        {groups.map((g) => (
          <Card key={g.key} title={g.title} sub="Landing y checkout de cada mercado.">
            <div>{g.rows.map((a) => <AddressRow key={a.label + a.url} a={a} storeId={s.id} />)}</div>
          </Card>
        ))}
        {!groups.length && <Card><p className="ad-note">Esta tienda no tiene ofertas activas con checkout.</p></Card>}
        <Card title="Tienda" sub="La dirección de respaldo para cobrar y el catálogo de la marca.">
          {store.length
            ? <div>{store.map((a) => <AddressRow key={a.label + a.url} a={a} storeId={s.id} />)}</div>
            : <p className="ad-note">Sin dominio propio ni catálogo cargado: los links usan la dirección de la app.</p>}
        </Card>
        <details className="ad-card group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-[14px] font-bold [&::-webkit-details-marker]:hidden">
            <span className="text-zinc-400 transition-transform group-open:rotate-90">›</span> Cómo se apunta un dominio
          </summary>
          <ol className="m-0 grid list-decimal gap-2.5 px-5 pb-5 pl-10 text-[13px] leading-relaxed text-zinc-600 marker:font-bold marker:text-zinc-400 dark:text-zinc-300">
            <li>Subdominio (ej. <code>pay.tudominio.com</code>) → <b>CNAME</b> a <code>cname.vercel-dns.com</code>.</li>
            <li>Dominio raíz (<code>tudominio.com</code>) → registro <b>A</b> a <code>76.76.21.21</code>.</li>
            <li>Si el dominio venía de otra plataforma, hay que <b>borrar los registros viejos</b> de ese nombre: si conviven, funciona a veces sí y a veces no.</li>
            <li>El DNS tarda de unos minutos a 48 horas en repartirse.</li>
          </ol>
        </details>
      </div>
    </>
  );
}

// ======================================================================= Tracking

const UTM = "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

export async function TrackingTab({ s }: { s: AdminStore }) {
  const pixels = await pixelList(s.id);
  const envToken = !!process.env.META_CAPI_TOKEN;
  return (
    <>
      <PageHead icon={<Target className={ic} />} color="#ec4899" title="Tracking" sub="Con qué se miden las ventas: el pixel de Meta en el navegador y la API de Conversiones desde el servidor." />
      <Ask what="los pixels" />
      <div className="ad-grid">
        <Card title="Pixels de Meta" sub="Un pixel por oferta: cada checkout carga los suyos; los marcados «todos los checkouts» se cargan siempre." pad={false}>
          {pixels.length ? (
            <Table head={["Pixel", "API de Conversiones", { label: "Dónde se carga", hideM: true }, { label: "Código de prueba", hideM: true }]}>
              {pixels.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name || "Sin nombre"}</b><span className="sub"><code>{p.pixel_id}</code></span></td>
                  <td>{p.has_token ? <Badge tone="ok" dot>Token cargado ✓</Badge> : envToken ? <Badge>Token general</Badge> : <Badge tone="bad" dot>Sin token ✕</Badge>}</td>
                  <td className="hide-m">{p.all_funnels ? <Badge tone="brand">Todos los checkouts</Badge> : <Badge>Solo los elegidos</Badge>}</td>
                  <td className="hide-m">{p.test_event_code ? <Badge tone="warn">{p.test_event_code}</Badge> : <span className="text-zinc-400">—</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState title="Sin pixels" icon={<Target className="h-5 w-5" />}>Las ventas de esta tienda no se le informan a Meta.</EmptyState>}
        </Card>
        {pixels.some((p) => p.test_event_code) && (
          <Flash warn="Hay un pixel con código de prueba: mientras esté cargado, sus compras reales también llegan a Meta como prueba y no cuentan para las campañas." />
        )}

        <Card title="Link para tus anuncios" sub="Los parámetros que pegan cada venta a su campaña, su conjunto y su anuncio.">
          <div className="ad-form">
            <div className="ad-field"><span className="lbl">Parámetros de URL (esto va en Meta)</span><CopyField value={UTM} /></div>
            <p className="ad-note">Se pegan en el campo <b>«Parámetros de URL»</b> del anuncio (nivel del anuncio, abajo del destino). Las llaves dobles no se tocan: Meta las reemplaza sola.</p>
            <ul className="ad-note grid list-disc gap-1.5 pl-5">
              <li><code>utm_source</code> — de dónde viene la visita: <b>FB</b> para todo lo de Meta (Facebook e Instagram).</li>
              <li><code>utm_campaign</code> — la campaña: nombre e id separados por una barra.</li>
              <li><code>utm_medium</code> — el conjunto de anuncios, igual.</li>
              <li><code>utm_content</code> — el anuncio, igual. El id cruza cada venta con el gasto exacto aunque se renombre la campaña.</li>
              <li><code>utm_term</code> — la ubicación (feed, reels, stories…).</li>
            </ul>
          </div>
        </Card>

        <Card title="Cuenta de anuncios de Meta" sub="Para que Métricas traiga el gasto de las campañas. No tiene que ver con el pixel.">
          <dl className="ad-dl"><dt>Cuenta</dt><dd>{s.meta_ad_account_id ? <code>{s.meta_ad_account_id}</code> : val(null)}</dd></dl>
        </Card>
      </div>
    </>
  );
}

// ======================================================================= Webhooks

const PAYLOAD = `{
  "event": "sale.paid",
  "order_id": "6f1c…",
  "created_at": "2026-10-05T14:03:11Z",
  "store": "mitienda",
  "checkout": "mi-oferta",
  "customer": { "email": "comprador@mail.com", "name": "Giulia Rossi", "phone": null, "country": "IT" },
  "currency": "EUR",
  "total": 27,
  "utm": { "utm_source": "FB", "utm_campaign": "Mi campaña|120330…" },
  "payment_intent": "pi_…",
  "items": [
    { "kind": "main", "amount": 27, "slug": "mi-producto", "name": "Mi Producto" },
    { "kind": "bump", "amount": 9, "slug": "esami", "name": "Esami di Laboratorio" }
  ]
}`;

export function WebhooksTab({ s }: { s: AdminStore }) {
  return (
    <>
      <PageHead icon={<Webhook className={ic} />} color="#f97316" title="Webhooks" sub="Un aviso automático a otro sistema (área de miembros, CRM, planilla) cada vez que se cobra una venta." />
      <Ask what="la dirección" />
      <div className="ad-grid">
        <Card title={<>Webhook de ventas {s.sales_webhook_url ? <Badge tone="ok" dot>Prendido</Badge> : <Badge>Apagado</Badge>}</>}>
          <dl className="ad-dl"><dt>Dirección</dt><dd>{s.sales_webhook_url ? <code>{s.sales_webhook_url}</code> : val(null, "Sin dirección: no se avisa a nadie")}</dd></dl>
        </Card>
        <Card title="Qué llega" sub="Un POST por venta pagada, con este cuerpo:">
          <pre className="ad-pre">{PAYLOAD}</pre>
          <div className="mt-3.5 grid gap-2">
            <p className="ad-note"><code>kind</code> de cada item: <b>main</b>, <b>bump</b>, <b>included</b> o <b>bonus</b> (estos dos con importe 0). Los upsells que acepte después no generan otro aviso.</p>
            <p className="ad-note">Va firmado en <code>X-Signature</code> (HMAC-SHA256 del cuerpo). Todavía no hay una clave de firma propia por tienda: conviene que la dirección lleve un secreto difícil de adivinar.</p>
            <p className="ad-note">Si el otro sistema no responde en 8 segundos o da error, no se reintenta; la venta igual queda en Pedidos.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

// ======================================================================= Acceso API

export async function ApiTab() {
  const tokens = await listApiTokens();
  const mcp = `${publicBaseUrl() || "https://tu-app.vercel.app"}/api/mcp`;
  return (
    <>
      <PageHead icon={<KeyRound className={ic} />} color="#71717a" title="Acceso API" sub="Los tokens con los que Claude (y tus scripts) manejan las tiendas por el servidor MCP. Valen para todas las tiendas." />
      <Ask what="un token" />
      <div className="ad-grid">
        <Card title="Tokens" pad={false}>
          {tokens.length ? (
            <Table head={["Nombre", { label: "Creado", hideM: true }, "Último uso", "Estado"]}>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name}</b></td>
                  <td className="hide-m">{date(t.created_at)}</td>
                  <td>{when(t.last_used_at) ?? "Nunca"}</td>
                  <td>{t.revoked_at ? <Badge>Revocado</Badge> : <Badge tone="ok" dot>Activo</Badge>}</td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState title="Todavía no hay tokens" icon={<KeyRound className="h-5 w-5" />}>Sin token, Claude no puede entrar al MCP.</EmptyState>}
        </Card>
        <Card title="Conectar Claude" sub="Claude Code habla con las tiendas por el servidor MCP de la app.">
          <div className="ad-form" style={{ gap: 12 }}>
            <div className="ad-field"><span className="lbl">Dirección del MCP</span><CopyField value={mcp} /></div>
            <div className="ad-field">
              <span className="lbl">Comando para la terminal</span>
              <CopyField wrap value={`claude mcp add --transport http checkout ${mcp} --header "Authorization: Bearer <token>"`} />
              <small>Reemplazá &lt;token&gt; por uno activo. El token se ve una sola vez, cuando se crea.</small>
            </div>
            <p className="ad-note">Un token da acceso completo a pedidos, productos y compradores de todas las tiendas. Si se filtra, hay que revocarlo.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
