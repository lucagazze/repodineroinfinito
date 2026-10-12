import { db } from "@/lib/db";
import { decrypt, encrypt, mask } from "@/lib/secrets";

/**
 * La conexión con Meta, para todo el panel: un token (el que pega el dueño en
 * Configuración › Conexión con Meta, cifrado en app_settings; si no hay, el de
 * META_ADS_TOKEN) y lo que Meta informa de sus límites en cada respuesta
 * (x-app-usage, x-ad-account-usage, x-business-use-case-usage). Toda lectura
 * de Meta del panel sale por metaFetch: usa este token y anota el uso.
 */

export const GRAPH = "https://graph.facebook.com/v23.0";
const KEY = "meta_connection";

export type Usage = {
  app?: { call_count?: number; total_cputime?: number; total_time?: number };
  account?: { acc_id_util_pct?: number; reset_time_duration?: number; ads_api_access_tier?: string };
  business?: { type?: string; call_count?: number; total_cputime?: number; total_time?: number; estimated_time_to_regain_access?: number; ads_api_access_tier?: string }[];
};
export type Conn = {
  token_enc?: string; label?: string; saved_at?: string;
  last_ok_at?: string; last_error?: string; last_error_at?: string;
  usage?: Usage; usage_at?: string;
};

let memo: { at: number; token: string; source: "panel" | "env" | null } | null = null;

export async function readConn(): Promise<Conn> {
  const { data } = await db.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return (data?.value ?? {}) as Conn;
}
async function writeConn(patch: Partial<Conn>) {
  const cur = await readConn();
  await db.from("app_settings").upsert({ key: KEY, value: { ...cur, ...patch }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** El token en uso: el del panel si hay, si no el de META_ADS_TOKEN. Se recuerda 60 s. */
export async function metaToken(): Promise<{ token: string; source: "panel" | "env" | null }> {
  if (memo && Date.now() - memo.at < 60_000) return memo;
  let token = "", source: "panel" | "env" | null = null;
  try {
    const c = await readConn();
    if (c.token_enc) { token = decrypt(c.token_enc); source = "panel"; }
  } catch { /* sin tabla o sin poder descifrar: el de entorno */ }
  if (!token) {
    token = process.env.META_ADS_TOKEN || process.env.META_TOKEN || "";
    source = token ? "env" : null;
  }
  memo = { at: Date.now(), token, source };
  return memo;
}
export const forgetToken = () => { memo = null; };
export async function metaConfigured() { return !!(await metaToken()).token; }

function parse<T>(h: string | null): T | undefined {
  if (!h) return undefined;
  try { return JSON.parse(h) as T; } catch { return undefined; }
}
/**
 * Qué tan cerca está la cuenta del límite de Meta, de 0 a 100: el mayor de los
 * porcentajes que informa en los encabezados (x-ad-account-usage,
 * x-business-use-case-usage y x-app-usage). Lo que no es imprescindible (la
 * carga hacia atrás, el desglose por red, los anuncios con sus miniaturas, el
 * piloto de pujas) se saltea arriba del 75 % (BUSY_PCT). Si Meta ya cortó
 * (código 17/613/80004…), queda en 100 hasta que pase la espera que pidió.
 */
export const BUSY_PCT = 75;
let pressure: { pct: number; at: number; regainMin: number } = { pct: 0, at: 0, regainMin: 0 };
function pctOf(u: Usage): number {
  const vals = [
    u.app?.call_count, u.app?.total_cputime, u.app?.total_time,
    u.account?.acc_id_util_pct,
    ...(u.business ?? []).flatMap((b) => [b.call_count, b.total_cputime, b.total_time]),
  ].map(Number).filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}
function notePressure(u: Usage, limited = false) {
  const regain = Math.max(0, ...(u.business ?? []).map((b) => Number(b.estimated_time_to_regain_access ?? 0)), Number(u.account?.reset_time_duration ?? 0) / 60);
  const pct = limited ? 100 : pctOf(u);
  pressure = { pct, at: Date.now(), regainMin: limited ? Math.max(regain, 15) : regain };
}
/**
 * La presión actual (0–100) y cuántos minutos pidió esperar Meta. De memoria si es de los últimos
 * 10 min; si no, de lo último que se guardó (otra instancia del servidor pudo haberlo visto).
 */
export async function metaPressure(): Promise<{ pct: number; regainMin: number }> {
  const fresh = (at: number) => Date.now() - at < 10 * 60_000;
  let p = fresh(pressure.at) ? pressure : null;
  if (!p) {
    const c = await readConn().catch(() => ({} as Conn));
    const at = c.usage_at ? Date.parse(c.usage_at) : 0;
    const errAt = c.last_error_at ? Date.parse(c.last_error_at) : 0;
    const limited = fresh(errAt) && errAt >= at && /limit|too many/i.test(c.last_error ?? "");
    if (limited || (fresh(at) && c.usage)) {
      const regain = Math.max(0, ...(c.usage?.business ?? []).map((b) => Number(b.estimated_time_to_regain_access ?? 0)));
      p = { pct: limited ? 100 : pctOf(c.usage ?? {}), at: limited ? errAt : at, regainMin: limited ? Math.max(regain, 15) : regain };
    }
  }
  if (!p) return { pct: 0, regainMin: 0 };
  // La espera que pidió Meta se descuenta con el tiempo.
  const left = Math.max(0, p.regainMin - (Date.now() - p.at) / 60_000);
  return { pct: left > 0 ? Math.max(p.pct, 100) : p.pct, regainMin: Math.ceil(left) };
}
/** ¿Conviene saltear lo que no es imprescindible? */
export const metaBusy = async (limit = BUSY_PCT) => (await metaPressure()).pct >= limit;

let lastUsageWrite = 0;
/** Anota el uso de los límites que manda Meta (a lo sumo cada 30 s) y si la llamada anduvo. */
async function noteUsage(headers: Headers | null, ok: boolean, error?: string, code?: number, extra?: Usage) {
  const h = (k: string) => headers?.get(k) ?? null;
  const app = parse<Usage["app"]>(h("x-app-usage")) ?? extra?.app;
  const account = parse<Usage["account"]>(h("x-ad-account-usage")) ?? extra?.account;
  const biz = parse<Record<string, Usage["business"]>>(h("x-business-use-case-usage"));
  const business = (biz ? Object.values(biz).flat().filter(Boolean) as NonNullable<Usage["business"]> : undefined) ?? extra?.business;
  const limited = !ok && ([4, 17, 32, 613, 80000, 80003, 80004, 80014].includes(Number(code)) || /request limit|too many calls|rate limit/i.test(error ?? ""));
  if (app || account || business || limited) notePressure({ app, account, business }, limited);
  const now = Date.now();
  if (ok && now - lastUsageWrite < 30_000 && !app && !account && !business) return;
  lastUsageWrite = now;
  const at = new Date().toISOString();
  await writeConn({
    ...(app || account || business ? { usage: { app, account, business }, usage_at: at } : {}),
    ...(ok ? { last_ok_at: at } : { last_error: error ?? "error", last_error_at: at }),
  }).catch(() => {});
}

export class MetaError extends Error {
  code?: number;
  constructor(message: string, code?: number) { super(message); this.code = code; }
}

/** GET a la Graph API con el token en uso; devuelve el JSON y anota el uso. */
export async function metaGet<T>(pathOrUrl: string, params: Record<string, string> = {}, timeout = 20_000): Promise<T> {
  const { token } = await metaToken();
  if (!token) throw new MetaError("No hay token de Meta: cargalo en Configuración › Conexión con Meta.");
  const u = new URL(/^https?:/.test(pathOrUrl) ? pathOrUrl : `${GRAPH}/${pathOrUrl.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!u.searchParams.get("access_token")) u.searchParams.set("access_token", token);
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message: string; code?: number } };
  await noteUsage(r.headers, !j.error, j.error?.message, j.error?.code);
  if (j.error) throw new MetaError(j.error.message, j.error.code);
  return j;
}

/**
 * POST a la Graph API (para escribir: el piloto de pujas cambia el bid_amount de un conjunto).
 * Anota el uso igual que las lecturas. Nunca reintenta: si falla, tira el error.
 */
export async function metaPost<T>(path: string, params: Record<string, string>, timeout = 20_000): Promise<T> {
  const { token } = await metaToken();
  if (!token) throw new MetaError("No hay token de Meta: cargalo en Configuración › Conexión con Meta.");
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${GRAPH}/${path.replace(/^\//, "")}`, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message: string; code?: number; error_user_msg?: string } };
  await noteUsage(r.headers, !j.error, j.error?.message, j.error?.code);
  if (j.error) throw new MetaError(j.error.error_user_msg || j.error.message, j.error.code);
  return j;
}

/**
 * Varias lecturas en UN pedido HTTP (batch de la Graph API). Cada pedido
 * sigue contando para los límites de Meta, pero llega todo junto.
 */
export async function metaBatch(urls: string[], timeout = 25_000): Promise<unknown[]> {
  const { token } = await metaToken();
  if (!token) throw new MetaError("No hay token de Meta: cargalo en Configuración › Conexión con Meta.");
  // Con los encabezados de cada parte: ahí viene el uso por cuenta publicitaria (x-ad-account-usage).
  const body = new URLSearchParams({
    access_token: token, include_headers: "true",
    batch: JSON.stringify(urls.map((relative_url) => ({ method: "GET", relative_url }))),
  });
  const r = await fetch(`${GRAPH}/`, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(timeout) });
  const j = (await r.json().catch(() => null)) as ({ code: number; body: string; headers?: { name: string; value: string }[] } | null)[] | { error?: { message: string; code?: number } } | null;
  if (!Array.isArray(j)) {
    const err = (j as { error?: { message: string; code?: number } } | null)?.error;
    await noteUsage(r.headers, false, err?.message, err?.code);
    throw new MetaError(err?.message ?? `Meta respondió ${r.status}`, err?.code);
  }
  // El uso más alto que informó cualquiera de las partes.
  const parts = j.map((x) => {
    const hh = new Map((x?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
    const biz = parse<Record<string, Usage["business"]>>(hh.get("x-business-use-case-usage") ?? null);
    const u: Usage = {
      app: parse<Usage["app"]>(hh.get("x-app-usage") ?? null),
      account: parse<Usage["account"]>(hh.get("x-ad-account-usage") ?? null),
      business: biz ? Object.values(biz).flat().filter(Boolean) as NonNullable<Usage["business"]> : undefined,
    };
    return u;
  });
  const worst = parts.reduce<Usage>((a, u) => (pctOf(u) >= pctOf(a) ? u : a), {});
  let failed: MetaError | null = null;
  const out = j.map((x) => {
    const b = x?.body ? (JSON.parse(x.body) as { error?: { message: string; code?: number } }) : null;
    if (!b || b.error) { failed ??= new MetaError(b?.error?.message ?? "Meta no contestó una parte del pedido", b?.error?.code); return null; }
    return b as unknown;
  });
  const f = failed as MetaError | null;
  await noteUsage(r.headers, !f, f?.message, f?.code, worst);
  if (f) throw f;
  return out;
}

/** Errores de Meta en castellano (el más común: el límite de consultas). */
export function metaError(e: unknown) {
  const err = e as MetaError;
  if (err?.name === "TimeoutError") return "Meta tardó demasiado en contestar";
  if ([4, 17, 32, 613, 80000, 80003, 80004, 80014].includes(Number(err?.code)) || /request limit|too many calls|rate limit/i.test(err?.message ?? "")) {
    return "Meta limitó las consultas";
  }
  if (Number(err?.code) === 190) return "El token de Meta venció o fue revocado: cargá uno nuevo en Configuración › Conexión con Meta";
  return err?.message || "Meta no contestó";
}
export const isRateLimit = (msg: string | null | undefined) => !!msg && /limitó/.test(msg);

// ------------------------------------------------------------ configuración

export type ConnInfo = {
  source: "panel" | "env" | null; masked: string | null; label: string | null; savedAt: string | null;
  me: { id: string; name: string } | null;
  permissions: string[]; expiresAt: string | null; neverExpires: boolean; appName: string | null; type: string | null;
  accounts: { id: string; name: string; status: number; used: boolean }[];
  lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null;
  usage: Usage | null; usageAt: string | null;
  error: string | null;
};

/** Lo que muestra Configuración › Conexión con Meta: de quién es el token, permisos, vencimiento, cuentas y límites. */
export async function connectionInfo(usedAccounts: string[]): Promise<ConnInfo> {
  const { token, source } = await metaToken();
  const c = await readConn().catch(() => ({} as Conn));
  const base: ConnInfo = {
    source, masked: token ? mask(token) : null, label: c.label ?? null, savedAt: c.saved_at ?? null,
    me: null, permissions: [], expiresAt: null, neverExpires: false, appName: null, type: null, accounts: [],
    lastOkAt: c.last_ok_at ?? null, lastError: c.last_error ?? null, lastErrorAt: c.last_error_at ?? null,
    usage: c.usage ?? null, usageAt: c.usage_at ?? null, error: null,
  };
  if (!token) return base;
  try {
    const [me, perms, dbg, accs] = await Promise.all([
      metaGet<{ id: string; name: string }>("me", { fields: "id,name" }),
      metaGet<{ data: { permission: string; status: string }[] }>("me/permissions").catch(() => ({ data: [] })),
      metaGet<{ data: { expires_at?: number; data_access_expires_at?: number; application?: string; type?: string } }>("debug_token", { input_token: token }).catch(() => null),
      metaGet<{ data: { id: string; name: string; account_status: number }[] }>("me/adaccounts", { fields: "name,account_status", limit: "200" }).catch(() => ({ data: [] })),
    ]);
    const used = new Set(usedAccounts);
    const exp = dbg?.data?.expires_at;
    const c2 = await readConn().catch(() => c);
    return {
      ...base, me,
      permissions: perms.data.filter((p) => p.status === "granted").map((p) => p.permission),
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null, neverExpires: exp === 0,
      appName: dbg?.data?.application ?? null, type: dbg?.data?.type ?? null,
      accounts: accs.data.map((a) => ({ id: a.id, name: a.name, status: a.account_status, used: used.has(a.id) }))
        .sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name)),
      lastOkAt: c2.last_ok_at ?? null, usage: c2.usage ?? null, usageAt: c2.usage_at ?? null,
    };
  } catch (e) {
    return { ...base, error: metaError(e) };
  }
}

/**
 * Guarda un token nuevo: antes lo prueba (quién es y que vea las cuentas
 * publicitarias de las tiendas). Queda cifrado; el de entorno pasa a ser el
 * de respaldo.
 */
export async function saveToken(token: string, label: string, accounts: string[]): Promise<{ ok: string } | { error: string }> {
  const t = token.trim();
  if (!/^[A-Za-z0-9_-]{30,600}$/.test(t)) return { error: "Eso no parece un token de Meta." };
  const get = async <T,>(path: string, params: Record<string, string> = {}) => {
    const u = new URL(`${GRAPH}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("access_token", t);
    const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as T & { error?: { message: string; code?: number } };
    if (j.error) throw new MetaError(j.error.message, j.error.code);
    return j;
  };
  try {
    const me = await get<{ id: string; name: string }>("me", { fields: "id,name" });
    const missing: string[] = [];
    for (const act of accounts) {
      try { await get(act, { fields: "name" }); } catch { missing.push(act); }
    }
    if (missing.length) return { error: `El token es de ${me.name}, pero no ve ${missing.join(", ")}: dale acceso a esa cuenta publicitaria (en el Business Manager) y probá de nuevo.` };
    await writeConn({ token_enc: encrypt(t), label: label.trim() || me.name, saved_at: new Date().toISOString(), last_error: undefined, last_error_at: undefined });
    forgetToken();
    // Que la próxima sincronización no espere por los errores del token viejo.
    await db.from("meta_sync").update({ retry_at: null, fails: 0 }).neq("account_id", "");
    return { ok: `Guardado: token de ${me.name}${accounts.length ? `, ve ${accounts.length === 1 ? "la cuenta" : `las ${accounts.length} cuentas`} de las tiendas` : ""} ✓` };
  } catch (e) {
    return { error: `Meta rechazó el token: ${metaError(e)}` };
  }
}

/** Saca el token del panel (vuelve el de entorno, si hay). */
export async function clearToken() {
  await writeConn({ token_enc: undefined, label: undefined, saved_at: undefined });
  forgetToken();
}
