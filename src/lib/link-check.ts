import { db } from "./db";
import { raiseAlert, resolveAlerts } from "./alerts";

/**
 * ¿Abre de verdad el link de entrega? Se sigue como un navegador (redirects,
 * UA de Chrome, 8 s) y tiene que terminar en un 2xx que sea un archivo o una
 * carpeta: un Drive borrado da 404 y uno privado manda a iniciar sesión.
 * Lo usan el envío de cada mail (entrega / recuperación) y el repaso diario.
 */

export type LinkCheck = { url: string; ok: boolean; status: number | null; final: string | null; title: string | null; reason?: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const OK_TTL = 10 * 60_000;
const cache = new Map<string, { at: number; r: LinkCheck }>();

const GOOGLE = /(^|\.)(drive|docs)\.google\.com$/i;
const GOOGLE_ITEM = /\/(file\/d|drive\/(u\/\d+\/)?folders|folders|document\/d|spreadsheets\/d|presentation\/d|uc|open)\b/i;
const GOOGLE_TITLE = /\s[-–]\s(Google (Drive|Docs|Sheets|Slides|Forms)|Documentos de Google|Hojas de cálculo de Google|Presentaciones de Google)\s*$/i;
const BAD_TITLE = /not found|no se encontr|non trovat|introuvable|nicht gefunden|access denied|acceso denegado|you need access|necesitas acceso|richiedi l.accesso|sign.?in|iniciar sesi|accedi|connexion|anmelden|error \d{3}/i;

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export async function checkLink(url: string): Promise<LinkCheck> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < OK_TTL) return hit.r;
  const r = await run(url);
  if (r.ok) cache.set(url, { at: Date.now(), r });
  else cache.delete(url);
  return r;
}

async function run(url: string): Promise<LinkCheck> {
  const base = { url, ok: false, status: null, final: null, title: null } as LinkCheck;
  if (!/^https?:\/\//i.test(url)) return { ...base, reason: "no es un link http(s)" };
  // /d/{pedido}/{producto}: se mira el archivo en Storage sin pasar por la ruta (anotaría una descarga).
  const own = url.match(/\/d\/([0-9a-f-]{36})\/([a-z0-9-]{1,80})(?:[?#]|$)/);
  if (own) return ownFile(url, own[1], own[2]);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      // Range: un PDF directo no se baja entero para comprobarlo.
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.8", range: "bytes=0-" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const final = res.url || url;
    const ct = res.headers.get("content-type") ?? "";
    let title: string | null = null;
    if (/html/i.test(ct)) {
      const body = (await res.text()).slice(0, 400_000);
      const t = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      title = t ? decode(t).slice(0, 200) : null;
    } else {
      await res.body?.cancel().catch(() => {});
    }
    const out = { url, status: res.status, final, title };
    if (!res.ok) return { ...out, ok: false, reason: `HTTP ${res.status}${title ? ` (${title})` : ""}` };
    const host = new URL(final).hostname;
    if (/accounts\.google\.com$/i.test(host) || /ServiceLogin|signin/i.test(final)) {
      return { ...out, ok: false, reason: "pide iniciar sesión: el archivo no está compartido con «cualquiera con el link»" };
    }
    if (title && BAD_TITLE.test(title)) return { ...out, ok: false, reason: `la página dice «${title}»` };
    if (GOOGLE.test(host)) {
      if (!GOOGLE_ITEM.test(new URL(final).pathname)) return { ...out, ok: false, reason: "no es un archivo ni una carpeta de Drive" };
      if (/html/i.test(ct) && title && !GOOGLE_TITLE.test(title) && !/virus|scan/i.test(title)) {
        return { ...out, ok: false, reason: `Drive no muestra el archivo («${title}»)` };
      }
    }
    return { ...out, ok: true };
  } catch (e) {
    const err = e as Error;
    return { ...base, reason: err.name === "TimeoutError" ? "no respondió en 8 s" : err.message.slice(0, 120) };
  }
}

async function ownFile(url: string, orderId: string, slug: string): Promise<LinkCheck> {
  const base = { url, status: null, final: null, title: null };
  const { data: order } = await db.from("orders").select("store_id").eq("id", orderId).maybeSingle();
  if (!order) return { ...base, ok: false, reason: "el pedido del link no existe" };
  const { data: p } = await db.from("products").select("delivery_file,delivery_url,delivery_file_name").eq("store_id", order.store_id).eq("slug", slug).maybeSingle();
  if (!p) return { ...base, ok: false, reason: `no existe el producto ${slug}` };
  if (!p.delivery_file) return p.delivery_url ? checkLink(p.delivery_url) : { ...base, ok: false, reason: "el producto no tiene archivo ni link" };
  const { data } = await db.storage.from("entregas").createSignedUrl(decodeURIComponent(p.delivery_file), 60);
  if (!data?.signedUrl) return { ...base, ok: false, reason: "el archivo no está en Storage (bucket entregas)" };
  const res = await fetch(data.signedUrl, { headers: { range: "bytes=0-1023" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  await res?.body?.cancel().catch(() => {});
  return res && (res.ok || res.status === 206)
    ? { ...base, ok: true, status: res.status, title: p.delivery_file_name ?? null }
    : { ...base, ok: false, status: res?.status ?? null, reason: "el archivo de Storage no responde" };
}

/** Links http(s) de los <a> de un mail, sin repetir. */
export function linksOf(html: string) {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/gi)) {
    const u = m[1].replace(/&amp;/g, "&").trim();
    // La baja no se abre para probarla: un GET da de baja.
    if (/^https?:\/\//i.test(u) && !/\/api\/m\/u\//.test(u)) out.add(u);
  }
  return [...out];
}

export const checkLinks = (urls: string[]) => Promise.all(urls.map(checkLink));

const linkRef = (url: string) => `link:${url.slice(0, 900)}`;

/** Avisa los rotos (uno por link, se reabre si vuelve a fallar) y cierra los que ya andan. */
export async function reportLinks(results: LinkCheck[], ctx: { storeId?: string | null; where: string; link?: string | null }) {
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) {
    await raiseAlert({
      kind: "broken_link", severity: "error", storeId: ctx.storeId ?? null, ref: linkRef(r.url), reopen: true,
      link: ctx.link ?? "/admin/avisos?kind=broken_link",
      title: `Link de entrega roto · ${ctx.where}`, body: `${r.url} — ${r.reason ?? "no abre"}`,
    });
  }
  await resolveAlerts("broken_link", results.filter((r) => r.ok).map((r) => linkRef(r.url))).catch(() => {});
  return bad;
}

/** Repaso diario: el link de entrega (y los extra) de cada producto activo. */
export async function checkAllProductLinks() {
  const { data } = await db.from("products")
    .select("id,store_id,slug,short_name,delivery_url,delivery_links,delivery_file,stores(slug)")
    .eq("active", true);
  const rows: { url: string; product: string; store: string; storeId: string }[] = [];
  for (const p of data ?? []) {
    const store = (p.stores as unknown as { slug: string } | null)?.slug ?? "";
    // Con archivo propio, el mail lleva /d/…: el link viejo ya no se usa.
    if (p.delivery_url && !p.delivery_file) rows.push({ url: p.delivery_url, product: p.short_name || p.slug, store, storeId: p.store_id });
    for (const l of (p.delivery_links ?? []) as { url?: string }[]) {
      if (l?.url && /^https?:\/\//.test(l.url)) rows.push({ url: l.url, product: p.short_name || p.slug, store, storeId: p.store_id });
    }
  }
  // De a 6 a la vez: Drive limita si se le pide todo junto.
  const results: (LinkCheck & { product: string; store: string })[] = [];
  for (let i = 0; i < rows.length; i += 6) {
    const part = rows.slice(i, i + 6);
    const rs = await checkLinks(part.map((r) => r.url));
    for (let j = 0; j < part.length; j++) {
      results.push({ ...rs[j], product: part[j].product, store: part[j].store });
      await reportLinks([rs[j]], { storeId: part[j].storeId, where: `${part[j].product} (${part[j].store})` });
    }
  }
  return results;
}
