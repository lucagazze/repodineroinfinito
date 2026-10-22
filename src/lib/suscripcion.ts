import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { aNumero, conexionDe, montoCobrado, type PagoWhop } from "@/lib/whop";

/**
 * Cobro recurrente: el nivel pago de la carta semanal.
 *
 * QUE HACE ESTE ARCHIVO Y QUE NO
 *   Lo que toca plata vive en la base (sub_cobro, sub_fallo, sub_baja, de las
 *   migraciones 006 y 007): contar un cobro son tres escrituras y tienen que
 *   ser atomicas, porque si la segunda falla queda un pago anotado que no sumo
 *   -- y el reintento de Whop lo ve ya anotado y no lo corrige. Ese contador es
 *   el MRR que se mira para decidir.
 *   Aca esta lo demas: reconocer que un pago de Whop es de una suscripcion,
 *   decidir si alguien es fundador, avisar por mail y firmar el link de baja.
 *
 * LO QUE UNA SUSCRIPCION TIENE Y UNA VENTA NO
 *   Una venta termina. Una suscripcion cambia sola con el tiempo: se renueva
 *   sin que nadie toque nada, se cae una tarjeta, alguien se da de baja y
 *   conserva el acceso hasta terminar el mes que pago. Nada de eso se puede
 *   deducir de la tabla de pedidos, y por eso hay una tabla aparte.
 */

// --------------------------------------------------------------- el producto

export type ProductoSuscripcion = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  billing_period_days: number | null;
  whop_plan_id: string | null;
  whop_founder_plan_id: string | null;
  founder_cutoff: string | null;
};

const COLS =
  "id,slug,name,short_name,billing_period_days,whop_plan_id,whop_founder_plan_id,founder_cutoff";

/** La suscripcion de una tienda. Hoy hay una; la consulta no lo da por hecho. */
export async function suscripcionDe(storeId: string): Promise<ProductoSuscripcion | null> {
  const { data } = await db
    .from("products").select(COLS)
    .eq("store_id", storeId).eq("subscription", true)
    .order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  return (data as ProductoSuscripcion | null) ?? null;
}

/**
 * De que suscripcion es este plan de Whop.
 *
 * Se reconoce por el PLAN y no por la metadata del pago: la renovacion la
 * genera Whop solo, un mes despues, y ahi no hay metadata nuestra que leer --
 * el unico dato estable es el plan que se esta cobrando. Se miran los dos
 * planes porque el precio de fundador es un plan aparte, no un descuento.
 */
export async function suscripcionDelPlan(storeId: string, planId: string | null | undefined) {
  if (!planId) return null;
  const { data } = await db
    .from("products").select(COLS)
    .eq("store_id", storeId).eq("subscription", true)
    .or(`whop_plan_id.eq.${planId},whop_founder_plan_id.eq.${planId}`)
    .limit(1).maybeSingle();
  if (!data) return null;
  const p = data as ProductoSuscripcion;
  return { producto: p, fundador: p.whop_founder_plan_id === planId };
}

// -------------------------------------------------------------- el fundador

/**
 * Fundador = compro algo ANTES de la fecha de corte.
 *
 * No hace falta inventar un mecanismo ni una lista: la fecha de compra ya esta
 * en cada pedido. Sin `founder_cutoff` cargado no hay fundadores, que es el
 * estado correcto mientras el nivel pago no exista.
 */
export async function esFundador(storeId: string, email: string, cutoff: string | null) {
  if (!cutoff) return false;
  const { count } = await db
    .from("orders").select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("status", "paid")
    .ilike("email", email.trim())
    .lt("created_at", cutoff);
  return (count ?? 0) > 0;
}

// ------------------------------------------------------------------ cobros

/** Lo que devuelve sub_cobro. Tipado aca y no como Record: al esparcir un
 *  Record<string, unknown> TypeScript pierde las claves, y quien llama se
 *  queda sin `creada` -- justo la que decide si sale el mail de bienvenida. */
export type CobroSub = {
  repetido: boolean;
  creada: boolean;
  id: string;
  status?: string;
  pagos?: number;
  total?: number;
  founder?: boolean;
  hasta?: string | null;
};

/** Lo que devuelve sub_fallo. */
export type FalloSub = {
  repetido?: boolean;
  sin_suscripcion?: boolean;
  id?: string;
  email?: string;
  fallos?: number;
  status?: string;
  avisado?: boolean;
};

/**
 * Un cobro de suscripcion que entro: el alta o una renovacion.
 *
 * Devuelve null si el pago no es de una suscripcion, para que quien llama siga
 * con el camino normal de una venta.
 */
export async function registrarCobroSuscripcion(storeId: string, pago: PagoWhop) {
  const quien = await suscripcionDelPlan(storeId, pago.plan?.id);
  if (!quien) return null;

  const email = (pago.customer_email ?? pago.user?.email ?? "").trim().toLowerCase();
  if (!email) {
    // Error a proposito: Whop reintenta. Una suscripcion sin correo no se puede
    // entregar, y anotarla igual deja a alguien pagando por nada.
    throw new Error(`cobro de suscripcion ${pago.id} sin correo`);
  }

  const importe = montoCobrado(pago);
  if (importe === null) throw new Error(`cobro de suscripcion ${pago.id} sin importe legible`);

  const { data, error } = await db.rpc("sub_cobro", {
    p_store: storeId,
    p_product: quien.producto.id,
    p_email: email,
    p_payment: pago.id,
    p_amount: importe,
    p_currency: (pago.currency ?? "usd").toLowerCase(),
    p_name: pago.user?.name ?? pago.billing_address?.name ?? null,
    p_locale: pago.metadata?.locale ?? null,
    p_country: pago.billing_address?.country ?? null,
    p_membership: membresiaDe(pago),
    p_plan: pago.plan?.id ?? null,
    p_member: pago.member_id ?? pago.member?.id ?? null,
    p_pm: pago.payment_method_id ?? pago.payment_method?.id ?? null,
    p_period_days: quien.producto.billing_period_days ?? null,
    p_period_end: null,
    // El fundador se decide por el plan que esta pagando, no recalculando la
    // fecha: si entro por el plan de fundador, lo es, y lo sigue siendo.
    p_founder: quien.fundador,
  });
  if (error) throw new Error(`sub_cobro: ${error.message}`);
  const r = (data ?? {}) as unknown as CobroSub;
  return { ...r, producto: quien.producto, email, importe };
}

/** Una tarjeta rechazada en una renovacion. */
export async function registrarFalloSuscripcion(storeId: string, pago: PagoWhop) {
  const quien = await suscripcionDelPlan(storeId, pago.plan?.id);
  if (!quien) return null;
  const email = (pago.customer_email ?? pago.user?.email ?? "").trim().toLowerCase();
  const membresia = membresiaDe(pago);
  // Sin ninguno de los dos no hay a quien atribuirselo. No es un error: puede
  // ser un intento de alta que nunca llego a existir.
  if (!email && !membresia) return { sin_suscripcion: true };

  const { data, error } = await db.rpc("sub_fallo", {
    p_store: storeId,
    p_email: email,
    p_payment: pago.id,
    p_product: quien.producto.id,
    p_membership: membresia,
    p_motivo: motivoDe(pago),
  });
  if (error) throw new Error(`sub_fallo: ${error.message}`);
  return { ...((data ?? {}) as unknown as FalloSub), producto: quien.producto };
}

/**
 * La membresia de Whop dentro de un pago.
 *
 * No esta medida contra un pago de renovacion real -- la suscripcion todavia no
 * cobro nunca -- asi que se prueban las formas plausibles en vez de apostar a
 * una. Cual vino queda en subscription_events.raw, que es lo que despues
 * permite dejar solo la correcta sin adivinar.
 */
function membresiaDe(p: PagoWhop): string | null {
  const o = p as unknown as Record<string, unknown>;
  for (const k of ["membership_id", "member_ship_id"]) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  const m = o.membership as { id?: string } | undefined;
  if (m?.id) return m.id;
  return null;
}

function motivoDe(p: PagoWhop): string {
  const o = p as unknown as Record<string, unknown>;
  const partes = [o.failure_reason, o.failure_message, o.last_payment_error, o.status]
    .filter((x): x is string => typeof x === "string" && !!x);
  return partes.join(" · ").slice(0, 400) || "sin motivo informado";
}

// ------------------------------------------------------------- la membresia

/**
 * `membership.activated` / `membership.deactivated`.
 *
 * Whop manda estos eventos y hasta hoy el webhook los contestaba con
 * «ignorado». El cobro ya lo maneja payment.succeeded, asi que lo que agregan
 * es la BAJA: cuando alguien cancela desde Whop, o cuando Whop da por perdida
 * una tarjeta, no llega ningun pago -- llega esto y nada mas.
 *
 * La forma del evento no esta medida contra uno real todavia, asi que se guarda
 * crudo y se lee con cuidado. Nunca se da de alta una suscripcion desde aca:
 * un alta sin pago no existe.
 */
export async function membresiaWhop(
  storeId: string, tipo: "activated" | "deactivated" | "updated", dato: unknown,
) {
  const d = (dato ?? {}) as Record<string, unknown>;
  const m = ((d.membership ?? d) as Record<string, unknown>) ?? {};
  const id = typeof m.id === "string" ? m.id : null;
  const plan = ((m.plan as { id?: string } | undefined)?.id)
    ?? (typeof m.plan_id === "string" ? m.plan_id : null);
  const email = String(
    m.email ?? m.customer_email ?? (m.user as { email?: string } | undefined)?.email ?? "",
  ).trim().toLowerCase();

  const quien = await suscripcionDelPlan(storeId, plan);
  // No es de la suscripcion (o no se pudo leer el plan): se registra para poder
  // mirarlo, pero no se toca ninguna suscripcion.
  if (!quien) {
    await db.from("subscription_events").insert({
      store_id: storeId, email: email || null, kind: "desconocido",
      whop_membership_id: id, detail: `membership.${tipo} sin plan reconocido`,
      raw: dato as never,
    });
    return { ignorado: `membership.${tipo}` };
  }

  const { data: sub } = await db
    .from("subscriptions").select("id,email,status,current_period_end")
    .eq("store_id", storeId)
    .or([id ? `whop_membership_id.eq.${id}` : "", email ? `email.eq.${email}` : ""]
        .filter(Boolean).join(","))
    .limit(1).maybeSingle();

  if (!sub) {
    await db.from("subscription_events").insert({
      store_id: storeId, email: email || null, kind: "desconocido",
      whop_membership_id: id, detail: `membership.${tipo} de alguien sin suscripcion en la base`,
      raw: dato as never,
    });
    return { ignorado: `membership.${tipo} sin suscripcion` };
  }

  // La membresia queda enlazada en cuanto se la ve, aunque el pago no la
  // trajera: es lo que permite reconocer la baja despues.
  if (id) await db.from("subscriptions").update({ whop_membership_id: id }).eq("id", sub.id);

  if (tipo === "deactivated") {
    // Whop dejo de cobrar. El acceso se respeta hasta terminar el periodo
    // pagado: sub_baja sin `p_ya` deja `canceled`, que la vista sigue viendo.
    const { error } = await db.rpc("sub_baja", {
      p_id: sub.id, p_motivo: "baja informada por Whop (membership.deactivated)", p_ya: false,
    });
    if (error) throw new Error(`sub_baja: ${error.message}`);
    return { baja: sub.id, hasta: sub.current_period_end };
  }

  await db.from("subscription_events").insert({
    store_id: storeId, subscription_id: sub.id, email: sub.email,
    kind: "desconocido", whop_membership_id: id,
    detail: `membership.${tipo}`, raw: dato as never,
  });
  return { visto: `membership.${tipo}`, suscripcion: sub.id };
}

// ---------------------------------------------------------------- la baja

/** Cancela la membresia del lado de Whop. Sin esto, la baja de nuestra base no detiene el cobro. */
export async function cancelarEnWhop(storeId: string, membershipId: string) {
  const conn = await conexionDe(storeId);
  if (!conn) throw new Error("la tienda no tiene Whop conectado");
  const r = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${conn.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ cancel_at_period_end: true }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Whop ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
}

/**
 * El link de baja que va en cada mail.
 *
 * Firmado con HMAC y sin fecha de vencimiento, al contrario que el de la
 * biblioteca: un link de baja que caduca obliga a alguien que quiere irse a
 * escribir un mail, y eso termina en una queja de spam -- que cuesta mucho mas
 * que la suscripcion que se queria retener. Mismo molde que library-auth.ts.
 */
function llave() {
  const k = process.env.SECRETS_KEY;
  if (!k) throw new Error("Falta SECRETS_KEY");
  return k;
}
const firma = (subId: string) =>
  createHmac("sha256", llave()).update(`suscripcion\n${subId}`).digest("base64url").slice(0, 27);

export const firmarBaja = (subId: string) => `${subId}.${firma(subId)}`;

export function leerBaja(token: string | null | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const id = token.slice(0, i), s = token.slice(i + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const want = Buffer.from(firma(id)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return id;
}

// ------------------------------------------------------------------ lectura

export type Suscriptor = {
  id: string; email: string; name: string | null; status: string; founder: boolean;
  amount: number | null; currency: string; payments_count: number; paid_total: number;
  started_at: string; current_period_end: string | null; last_payment_at: string | null;
  failed_count: number; locale: string | null; country: string | null;
  billing_period_days: number | null;
  whop_membership_id: string | null;
};

const SUB_COLS =
  "id,email,name,status,founder,amount,currency,payments_count,paid_total,started_at," +
  "current_period_end,last_payment_at,failed_count,locale,country,billing_period_days,whop_membership_id";

/** Los que HOY tienen acceso. Lee la VISTA: una sola definicion de acceso en todo el sistema. */
export async function conAcceso(storeId: string): Promise<Suscriptor[]> {
  const { data } = await db
    .from("subscriptions_activas").select(SUB_COLS)
    .eq("store_id", storeId).order("started_at", { ascending: false }).limit(5000);
  return (data ?? []) as unknown as Suscriptor[];
}

export async function todos(storeId: string): Promise<Suscriptor[]> {
  const { data } = await db
    .from("subscriptions").select(SUB_COLS)
    .eq("store_id", storeId).order("started_at", { ascending: false }).limit(5000);
  return (data ?? []) as unknown as Suscriptor[];
}

export async function unaDe(storeId: string, email: string): Promise<Suscriptor | null> {
  const { data } = await db
    .from("subscriptions").select(SUB_COLS)
    .eq("store_id", storeId).eq("email", email.trim().toLowerCase())
    .limit(1).maybeSingle();
  return (data as unknown as Suscriptor | null) ?? null;
}

/** Como va la suscripcion: los numeros del panel. */
export async function resumen(storeId: string) {
  const t = await todos(storeId);
  const activos = t.filter((s) => s.status === "active");
  const mora = t.filter((s) => s.status === "past_due");
  const bajas = t.filter((s) => s.status === "canceled");
  const idos = t.filter((s) => s.status === "expired");
  // MRR: lo que se cobra por mes de quien esta al dia, normalizado por su
  // periodo -- un plan anual de 120 aporta 10 al mes, no 120. La mora NO suma:
  // es justamente plata que todavia no entro.
  const mrr = activos.reduce((a, s) => {
    const dias = Number(s.billing_period_days) || 30;
    return a + (Number(s.amount) || 0) * (30 / dias);
  }, 0);
  return {
    activos: activos.length, mora: mora.length, bajas: bajas.length, idos: idos.length,
    fundadores: t.filter((s) => s.founder).length,
    mrr: Math.round(mrr * 100) / 100,
    cobrado: Math.round(t.reduce((a, s) => a + (Number(s.paid_total) || 0), 0) * 100) / 100,
    total: t.length,
  };
}

export async function bitacora(subId: string, limite = 50) {
  const { data } = await db
    .from("subscription_events").select("kind,amount,currency,detail,whop_payment_id,at")
    .eq("subscription_id", subId).order("at", { ascending: false }).limit(limite);
  return data ?? [];
}

/** El barrido del dia: vence las bajas cumplidas y corta a los morosos. Lo llama el cron. */
export async function barrido(graciaDias = 14) {
  const { data, error } = await db.rpc("sub_vencer", { p_gracia_dias: graciaDias });
  if (error) throw new Error(`sub_vencer: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as { vencidas?: number; cortadas?: number } | null;
  return { vencidas: r?.vencidas ?? 0, cortadas: r?.cortadas ?? 0 };
}

export { aNumero };
