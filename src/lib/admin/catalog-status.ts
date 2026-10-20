import { createHash } from "crypto";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";
import { getCatalog, phoneOf } from "@/lib/catalog";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";
import { auditCatalog, type CatalogAudit } from "./catalog-audit";

/**
 * Catálogos y Stripe, siempre al día.
 *
 * Por tienda: la revisión del catálogo publicado (catalog-audit) + lo que Stripe tiene cargado de la cuenta
 * (sitio web, descripción del producto, email/teléfono/URL de soporte, descriptor, cobros y pagos habilitados y lo
 * que Stripe pide). Lo que no coincide con el catálogo y solo se cambia a mano en el panel de Stripe sale como
 * tarea, con el texto exacto para pegar. El resultado se guarda (app_settings «catalog_status»): el Inicio lo
 * muestra al instante y lo vuelve a revisar en segundo plano cuando tiene más de 10 minutos; el repaso de avisos,
 * cada hora. Un problema nuevo levanta un aviso (con push); cuando se arregla, se cierra solo.
 */
/** current = lo que Stripe tiene hoy en ese campo; diff = las palabras que cambian (Stripe → tiene que decir). */
export type StripeTask = { label: string; detail: string; severity: "error" | "warn"; copy?: string; current?: string | null; diff?: { have: string; want: string }[] };

/** Diferencias palabra por palabra entre lo que hay en Stripe y lo que tiene que decir (para ver qué cambiar). */
function wordDiff(have: string, want: string): { have: string; want: string }[] {
  const a = norm(have).split(" "), b = norm(want).split(" ");
  if (a.length * b.length > 400_000) return [{ have: have.slice(0, 200), want: want.slice(0, 200) }];
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { have: string; want: string }[] = [];
  let i = 0, j = 0, h: string[] = [], w: string[] = [];
  const flush = () => { if (h.length || w.length) out.push({ have: h.join(" "), want: w.join(" ") }); h = []; w = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < b.length && (i >= a.length || L[i][j + 1] >= L[i + 1][j])) w.push(b[j++]);
    else h.push(a[i++]);
  }
  flush();
  return out.slice(0, 12);
}
export type StoreStatus = {
  slug: string; name: string; url: string | null; account: string | null;
  catalogProblems: string[]; stripeTasks: StripeTask[]; stripeOk: boolean; stripeInfo: string[];
};
export type CatalogStatus = { at: number; stores: StoreStatus[]; alertRefs: string[] };

const KEY = "catalog_status";
const LOCK = "catalog_status_running";
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const host = (u: string | null | undefined) => (u ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();

export async function readCatalogStatus(): Promise<CatalogStatus | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return (data?.value as CatalogStatus | null) ?? null;
}

/**
 * Lo mismo que stripeTasks, para una tienda que cobra con Whop.
 *
 * Mucho mas corto a proposito: Whop es el comerciante de registro, asi que la
 * razon social, la direccion y el descriptor que revisa Stripe no corren aca --
 * los pone Whop. Lo que si tiene que estar es la conexion y, sobre todo, el
 * secreto de firma del webhook: sin el, cada pago cobrado se rechaza y NADA se
 * entrega, que es exactamente lo que paso el 20/10/2026.
 */
async function whopTasks(storeId: string): Promise<{ tasks: StripeTask[]; info: string[]; account: string | null }> {
  const tasks: StripeTask[] = [];
  const info: string[] = [];
  const { data: w } = await db.from("store_whop")
    .select("company_id,webhook_id,webhook_secret_enc,livemode,last_event_at")
    .eq("store_id", storeId).maybeSingle();
  if (!w) {
    return { tasks: [{ label: "La tienda cobra con Whop pero no tiene Whop conectado",
                       detail: "El checkout no puede cobrar. Conectala con la llave de la cuenta.",
                       severity: "error" }], info, account: null };
  }
  if (!w.webhook_secret_enc) {
    tasks.push({ label: "El webhook de Whop no tiene secreto de firma",
                 detail: "Cada pago cobrado se rechaza y no se entrega nada. Hay que rehacer el webhook guardando su ws_.",
                 severity: "error" });
  }
  if (!w.livemode) {
    tasks.push({ label: "La cuenta de Whop esta en modo prueba",
                 detail: "Las tarjetas reales no se cobran.", severity: "error" });
  }
  if (!w.last_event_at) {
    info.push("Todavia no llego ningun evento de Whop: hace una compra de prueba para confirmar la entrega.");
  }
  info.push("Whop es el comerciante de registro: la razon social y el descriptor en el resumen de la tarjeta los pone Whop, no esta tienda.");
  return { tasks, info, account: w.company_id as string };
}

async function stripeTasks(storeId: string, slug: string, audit: CatalogAudit): Promise<{ tasks: StripeTask[]; info: string[]; account: string | null }> {
  const tasks: StripeTask[] = [];
  const info: string[] = [];
  let acct: Awaited<ReturnType<Awaited<ReturnType<typeof stripeForStore>>["stripe"]["accounts"]["retrieve"]>>;
  try {
    const { stripe } = await stripeForStore(storeId);
    acct = await stripe.accounts.retrieve();
  } catch (e) {
    return { tasks: [{ label: "No pude leer la cuenta de Stripe", detail: (e as Error).message.slice(0, 160), severity: "warn" }], info, account: null };
  }
  const cat = await getCatalog(slug);
  const s = cat?.store;
  const bp: Partial<Stripe.Account.BusinessProfile> = acct.business_profile ?? {};
  const rq: Partial<Stripe.Account.Requirements> = acct.requirements ?? {};
  if (!acct.charges_enabled) tasks.push({ label: "Stripe frenó los cobros", detail: "Entrá a Stripe y completá lo que pide: mientras tanto el checkout no puede cobrar.", severity: "error" });
  if (!acct.payouts_enabled) tasks.push({ label: "Stripe frenó los pagos a tu banco", detail: "Entrá a Stripe y completá lo que pide.", severity: "error" });
  if (rq.disabled_reason) tasks.push({ label: "Cuenta de Stripe restringida", detail: String(rq.disabled_reason), severity: "error" });
  const due = [...(rq.past_due ?? []), ...(rq.currently_due ?? [])];
  if (due.length) tasks.push({ label: "Stripe pide datos", detail: `${[...new Set(due)].join(", ")}${rq.current_deadline ? ` · antes del ${new Date(rq.current_deadline * 1000).toLocaleDateString("es-AR")}` : ""}`, severity: "error" });
  if (rq.eventually_due?.length) info.push(`Más adelante Stripe va a pedir: ${rq.eventually_due.join(", ")}`);

  if (audit.url && host(bp.url) !== host(audit.url)) {
    tasks.push({ label: "Sitio web de la empresa", detail: "Tiene que ser el catálogo.", severity: "warn", copy: audit.url.replace(/\/+$/, ""), current: bp.url ?? null });
  }
  const about = norm(s?.business?.about);
  if (about && norm(bp.product_description) !== about) {
    tasks.push({ label: "Descripción del producto", detail: "La de Stripe no dice lo mismo que el catálogo (idiomas, temas o precios cambiaron). Pegá el texto de hoy.", severity: "warn", copy: about, current: bp.product_description ?? null, diff: wordDiff(bp.product_description ?? "", about) });
  }
  if (s?.support_email && (bp.support_email ?? "").toLowerCase() !== s.support_email.toLowerCase()) {
    tasks.push({ label: "Email de soporte", detail: "Tiene que ser el de la tienda.", severity: "warn", copy: s.support_email, current: bp.support_email ?? null });
  }
  const phone = s ? phoneOf(s) : null;
  if (phone && digits(bp.support_phone) !== digits(phone)) {
    tasks.push({ label: "Teléfono de soporte", detail: "Tiene que ser el del catálogo.", severity: "warn", copy: phone, current: bp.support_phone ?? null });
  }
  const desc = acct.settings?.payments?.statement_descriptor ?? null;
  if (s?.statement_descriptor && norm(desc).toUpperCase() !== norm(s.statement_descriptor).toUpperCase()) {
    tasks.push({ label: "Descriptor de la tarjeta", detail: "Tiene que coincidir con el de la app (lo que ve el comprador en el resumen).", severity: "warn", copy: s.statement_descriptor, current: desc });
  }
  if (bp.support_url) {
    const st = await fetch(bp.support_url, { method: "GET", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) }).then((r) => r.status).catch(() => 0);
    if (st !== 200) tasks.push({ label: "URL de soporte", detail: `No abre (${st || "sin respuesta"}). Poné una que abra, por ejemplo la página de contacto del catálogo.`, severity: "warn", copy: audit.url ? `${audit.url.replace(/\/+$/, "")}/contact` : undefined, current: bp.support_url });
  }
  info.push(`Rubro (MCC) ${bp.mcc ?? "—"} · ${bp.name ?? ""}`);
  return { tasks, info, account: acct.id };
}

/** Revisa todo y guarda el resultado. Una sola corrida a la vez (traba de 3 min). */
export async function runCatalogStatus(): Promise<CatalogStatus | null> {
  const { data: lock } = await db.from("app_settings").select("value").eq("key", LOCK).maybeSingle();
  if (Number((lock?.value as { at?: number } | null)?.at ?? 0) > Date.now() - 3 * 60_000) return readCatalogStatus();
  await db.from("app_settings").upsert({ key: LOCK, value: { at: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  try {
    const prev = await readCatalogStatus();
    const { data: stores } = await db.from("stores").select("id,slug,name,display_name,is_test,gateway").eq("active", true).order("name");
    const list = (stores ?? []).filter((s) => !s.is_test && !(process.env.EXCLUDED_STORES ?? "").split(",").map((x) => x.trim()).includes(s.slug as string));
    const out: StoreStatus[] = [];
    for (const st of list) {
      const a = await auditCatalog(st.slug as string);
      if (!a) continue;
      const catalogProblems = [
        ...(a.servedBy === "app" ? [] : [`El catálogo no lo sirve la app (${a.servedBy})`]),
        ...a.brokenLinks.map((l) => `Link de compra roto: ${l.name} (${l.status})`),
        ...a.legal.filter((c) => !c.ok).map((c) => `Falta ${c.label.toLowerCase()}`),
        ...a.pages.filter((c) => !c.ok).map((c) => `La página ${c.label} no abre (${c.detail})`),
        ...a.facts.unknown.map((c) => `Categoría «${c}» sin texto para el catálogo`),
        ...(a.missingLive.length ? [`${a.missingLive.length} productos no aparecen en la página publicada`] : []),
      ];
      // Con Whop no se revisa Stripe: una tienda que cobra perfectamente salia
      // con "no pude leer la cuenta de Stripe" como si estuviera rota.
      const s = (st as { gateway?: string }).gateway === "whop"
        ? await whopTasks(st.id as string)
        : await stripeTasks(st.id as string, st.slug as string, a);
      out.push({
        slug: st.slug as string, name: (st.display_name || st.name) as string, url: a.url, account: s.account,
        catalogProblems, stripeTasks: s.tasks, stripeOk: s.tasks.length === 0, stripeInfo: s.info,
      });
    }
    // Un aviso por tienda y por conjunto de problemas: si cambian, avisa de nuevo; si se arreglan, se cierra.
    const refs: string[] = [];
    for (const st of out) {
      const items = [...st.catalogProblems, ...st.stripeTasks.map((t) => `Stripe: ${t.label}`)];
      if (!items.length) continue;
      const ref = `catalog:${st.slug}:${createHash("sha1").update(items.join("|")).digest("hex").slice(0, 10)}`;
      refs.push(ref);
      await raiseAlert({
        kind: "catalog_stripe", severity: st.stripeTasks.some((t) => t.severity === "error") || st.catalogProblems.length ? "error" : "warn",
        ref, link: "/admin/catalogos",
        title: `${st.name}: ${items.length === 1 ? items[0] : `${items.length} cosas para arreglar`}`,
        body: `${items.join(" · ")}${st.stripeTasks.length ? ". Lo de Stripe se cambia a mano en su panel: en el Inicio está el texto para copiar." : ""}`,
      }).catch(() => {});
    }
    const gone = (prev?.alertRefs ?? []).filter((r) => !refs.includes(r));
    if (gone.length) await resolveAlerts("catalog_stripe", gone).catch(() => {});
    const status: CatalogStatus = { at: Date.now(), stores: out, alertRefs: refs };
    await db.from("app_settings").upsert({ key: KEY, value: status, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return status;
  } finally {
    await db.from("app_settings").upsert({ key: LOCK, value: { at: 0 }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }
}

/**
 * Prompt para pegarle a cualquier IA conectada a la app (MCP checkout): qué está mal y cómo se arregla cada cosa
 * Lo de Stripe solo lo cambia el dueño.
 */
export function catalogFixPrompt(st: CatalogStatus): string | null {
  const lines: string[] = [];
  const manual: string[] = [];
  for (const s of st.stores) {
    for (const p of s.catalogProblems) {
      const cat = p.match(/^Categoría «(.+)» sin texto/)?.[1];
      if (cat) lines.push(`- [${s.name}] La categoría «${cat}» no tiene texto para el catálogo. Mirá qué vende esa oferta (list_offers + get_product del principal) y cargá el tema y el público EN INGLÉS con \`set_catalog_topic\` (category: "${cat}", topic: frase corta como "reading an ECG", audience: a quién sirve, como "nurses and medical students"). Solo con lo que dicen los productos: nada inventado.`);
      else if (p.startsWith("Link de compra roto")) lines.push(`- [${s.name}] ${p}. Revisá ese checkout con get_checkout (activo, dirección pública que abra). Si su dirección propia no abre, que el catálogo use pay.<tienda>/<checkout>: corregí public_url con update_checkout o avisale al dueño.`);
      else if (p.startsWith("Falta ")) lines.push(`- [${s.name}] ${p}. Se carga en la tienda con update_store (razón social, dirección, email, teléfono en business.phone, descriptor). Si no sabés el dato exacto, preguntale al dueño: nunca inventarlo.`);
      else if (p.startsWith("La página")) lines.push(`- [${s.name}] ${p}. Las políticas las sirve la app en el dominio del catálogo; revisá que el dominio apunte a la app (cname.vercel-dns.com) y avisale al dueño.`);
      else if (p.startsWith("El catálogo no lo sirve la app")) lines.push(`- [${s.name}] ${p}. El dominio del catálogo tiene que apuntar a Vercel (CNAME cname.vercel-dns.com) y estar en stores.catalog_domain. Avisale al dueño antes de tocar DNS.`);
      else lines.push(`- [${s.name}] ${p}.`);
    }
    for (const t of s.stripeTasks) manual.push(`- [${s.name}] ${t.label}: ${t.detail}${t.copy ? `\n  Tiene que decir: ${t.copy}` : ""}${t.current !== undefined ? `\n  Hoy en Stripe dice: ${t.current || "(vacío)"}` : ""}`);
  }
  if (!lines.length && !manual.length) return null;
  return [
    "Revisá y arreglá los pendientes de «Catálogos y Stripe» de la app (MCP checkout). Leé antes la guía con get_guide (sección «panel-catalogos»).",
    "",
    lines.length ? "## Lo que podés arreglar vos ahora\n" + lines.join("\n") : "",
    manual.length ? "\n## Lo de Stripe (solo lo puede cambiar el dueño en el panel de Stripe: armale la lista con el texto exacto para copiar)\n" + manual.join("\n") : "",
    "",
    "Al terminar: llamá a `catalog_status` con refresh: true y confirmá que no quede nada pendiente. Contale al dueño en 3 líneas qué arreglaste y qué le queda a él.",
  ].filter((x) => x !== "").join("\n");
}
