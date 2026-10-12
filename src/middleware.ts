import { NextResponse, type NextRequest } from "next/server";

/**
 * Ruteo por dominio.
 *
 * Cada tienda puede apuntar a este proyecto dos dominios propios:
 *  - stores.catalog_domain (catalogo.marca.com): el catálogo público.
 *      /                → /catalogo/{slug}
 *      /terms, /privacy, /refund-policy, /contact → /catalogo/{slug}/…
 *  - stores.domain (pay.marca.com): el checkout.
 *      /{embudo}        → /c/{slug}/{embudo}
 *      /                → stores.catalog_url (el catálogo de siempre, en el
 *                         dominio de la marca) o, si no hay, el de la app
 *      /terms, /privacy, /refund-policy, /contact → páginas del catálogo
 *      /gracias, /oferta/…, /catalogo/{slug}/…, /c/{slug}/… → sin tocar
 * En ambos, /admin, /entrar y /auth dan 404: el panel solo vive en el
 * dominio principal de la app. Cualquier otro host (vercel.app, localhost,
 * el dominio de la app) pasa sin cambios.
 *
 * Corre en Edge: nada de Node ni supabase-js, solo fetch a PostgREST.
 */

export const config = {
  // Fuera: /api (webhooks de Stripe, sin latencia extra), /_next y archivos con extensión.
  matcher: ["/((?!api/|_next/|.*\\.[A-Za-z0-9]+$).*)"],
};

type Hit = { slug: string; kind: "catalog" | "checkout" | "library"; catalogUrl: string | null };
/** host = normalizado (sin www.) para comparar; pub = el host tal como se publica, para redirigir. */
type Ck = { store: string; funnel: string; host: string; pub: string; path: string };
type Maps = {
  hosts: Map<string, Hit>;
  stores: Map<string, { domain: string; catalogUrl: string | null }>;
  /** Checkouts con dirección propia (funnels.checkout_host + checkout_path), por "host/path" y por "tienda/embudo". */
  byUrl: Map<string, Ck>;
  byFunnel: Map<string, Ck>;
  /** Subdominios de oferta → sus checkouts. */
  offerHosts: Map<string, Ck[]>;
};

const TTL = 60_000;
const RETRY = 10_000;
let cache: { at: number; ttl: number; map: Maps } | null = null;
let inflight: Promise<Maps> | null = null;

/** "https://Pay.Marca.com:443/x" → "pay.marca.com" (sin www.). */
function norm(h: string | null | undefined): string {
  return (h ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#,]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

async function load(): Promise<Maps> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("sin SUPABASE_URL / SUPABASE_SERVICE_KEY");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const get = (q: string) => fetch(`${url}/rest/v1/${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    const [res, fres] = await Promise.all([
      get("stores?select=slug,domain,catalog_domain,catalog_url,library_domain&active=eq.true"),
      get("funnels?select=slug,checkout_host,checkout_path,stores!inner(slug)&checkout_path=not.is.null&checkout_host=not.is.null"),
    ]);
    if (!res.ok) throw new Error(`stores ${res.status}`);
    if (!fres.ok) throw new Error(`funnels ${fres.status}`);
    const rows = (await res.json()) as { slug: string; domain: string | null; catalog_domain: string | null; catalog_url: string | null; library_domain?: string | null }[];
    const frows = (await fres.json()) as { slug: string; checkout_host: string; checkout_path: string; stores: { slug: string } }[];
    const hosts = new Map<string, Hit>();
    const stores: Maps["stores"] = new Map();
    for (const r of rows) {
      const d = norm(r.domain);
      const cd = norm(r.catalog_domain);
      const catalogUrl = /^https:\/\//.test(r.catalog_url ?? "") ? r.catalog_url : null;
      if (d) hosts.set(d, { slug: r.slug, kind: "checkout", catalogUrl });
      if (cd) hosts.set(cd, { slug: r.slug, kind: "catalog", catalogUrl });
      const ld = norm(r.library_domain);
      if (ld) hosts.set(ld, { slug: r.slug, kind: "library", catalogUrl });
      stores.set(r.slug, { domain: d, catalogUrl });
    }
    const byUrl: Maps["byUrl"] = new Map();
    const byFunnel: Maps["byFunnel"] = new Map();
    const offerHosts: Maps["offerHosts"] = new Map();
    for (const f of frows) {
      const pub = f.checkout_host.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
      const ck = { store: f.stores.slug, funnel: f.slug, host: norm(pub), pub, path: "/" + f.checkout_path.replace(/^\/+|\/+$/g, "") };
      byUrl.set(ck.host + ck.path, ck);
      byFunnel.set(`${ck.store}/${ck.funnel}`, ck);
      offerHosts.set(ck.host, [...(offerHosts.get(ck.host) ?? []), ck]);
    }
    return { hosts, stores, byUrl, byFunnel, offerHosts };
  } finally {
    clearTimeout(timer);
  }
}

/** Mapas host → tienda y tienda → dominios, cacheados 60 s. Si la base no responde, sigue con el último (o vacío). */
async function storeMap(): Promise<Maps> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.map;
  inflight ??= load()
    .then((map) => {
      cache = { at: Date.now(), ttl: TTL, map };
      return map;
    })
    .catch((e) => {
      console.warn("[middleware] sin mapa de dominios:", (e as Error).message);
      cache = {
        at: Date.now(), ttl: RETRY,
        map: cache?.map ?? { hosts: new Map(), stores: new Map(), byUrl: new Map(), byFunnel: new Map(), offerHosts: new Map() },
      };
      return cache.map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Hosts propios de la app: nunca se reescriben ni se consulta la base. */
function isAppHost(host: string): boolean {
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".vercel.app")) return true;
  for (const v of [process.env.NEXT_PUBLIC_SITE_URL, process.env.PUBLIC_BASE_URL]) {
    if (v && norm(v) === host) return true;
  }
  return false;
}

const CATALOG_PAGES = new Set(["terms", "privacy", "refund-policy", "contact"]);
const PANEL = new Set(["admin", "entrar", "auth", "socio"]);
const PASS = new Set(["api", "_next", "gracias", "oferta", "d"]);

const notFound = () =>
  new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Sigue sin cambios. x-catalog-root solo lo pone este middleware: si viene de afuera, se descarta. */
function pass(req: NextRequest) {
  if (!req.headers.has("x-catalog-root")) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.delete("x-catalog-root");
  return NextResponse.next({ request: { headers } });
}

function rewrite(req: NextRequest, pathname: string, catalogRoot = false) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  if (!catalogRoot) return NextResponse.rewrite(url);
  // Avisa a las páginas del catálogo que sus links van a la raíz del dominio.
  const headers = new Headers(req.headers);
  headers.set("x-catalog-root", "1");
  return NextResponse.rewrite(url, { request: { headers } });
}

export async function middleware(req: NextRequest) {
  // www.dominio → dominio (una sola dirección por sitio: links, cookies del pixel y Apple Pay).
  const raw = (req.headers.get("host") ?? "").toLowerCase();
  if (raw.startsWith("www.")) {
    const url = req.nextUrl.clone();
    url.host = raw.slice(4);
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
  // Detrás de un rewrite del sitio principal (www.tumarca.com/oferta/checkout →
  // esta app) el host es el de Vercel y el público viene en x-forwarded-host.
  const host = norm(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  // Si hay PANEL_HOST, el panel vive en ese subdominio: la dirección de Vercel lleva
  // ahí. Solo el panel; el resto (checkouts viejos, gracias, descargas) sigue.
  const panelHost = norm(process.env.PANEL_HOST || "");
  if (panelHost && host.endsWith(".vercel.app") && /^\/(admin|entrar|socio)?(\/|$)/.test(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone();
    url.host = panelHost;
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
  // Cada checkout se abre en el .com de su tienda (stores.domain): un link desde
  // la app, el panel o un dominio viejo (LEGACY_HOST) lleva ahí. La vista previa del editor (?preview=1) se queda, porque
  // el iframe tiene que ser del mismo origen. /api no pasa por acá (webhooks).
  const legacy = !!process.env.LEGACY_HOST && host === norm(process.env.LEGACY_HOST);
  // scripts/smoke.mjs prueba el build de una preview (*.vercel.app) antes de
  // publicarlo: con su header secreto el checkout se queda en la preview en vez
  // de saltar al dominio de producción. Nada cambia para los visitantes.
  const smoke = host.endsWith(".vercel.app") && !!process.env.SMOKE_SECRET && req.headers.get("x-smoke") === process.env.SMOKE_SECRET;
  if ((legacy || (panelHost && host === panelHost) || host.endsWith(".vercel.app")) && !req.nextUrl.searchParams.has("preview") && !smoke) {
    const seg = req.nextUrl.pathname.split("/").filter(Boolean);
    if (legacy || (seg[0] === "c" && seg[1])) {
      const maps = await storeMap().catch(() => undefined);
      const ck = seg[0] === "c" && seg[2] ? maps?.byFunnel.get(`${seg[1]}/${seg[2]}`) : undefined;
      if (ck) return NextResponse.redirect(`https://${ck.pub}${ck.path}${req.nextUrl.search}`, legacy ? 308 : 302);
      const own = (seg[0] === "c" || seg[0] === "catalogo") && seg[1] ? maps?.stores.get(seg[1]) : undefined;
      const home = maps?.stores.get(process.env.PUBLIC_HOME_STORE || "");
      const to = own?.domain || (legacy ? home?.domain || "" : "");
      if (legacy && seg.length === 0 && home?.catalogUrl) return NextResponse.redirect(home.catalogUrl, 308);
      if (to) {
        const url = req.nextUrl.clone();
        url.host = to;
        url.port = "";
        url.protocol = "https:";
        return NextResponse.redirect(url, legacy ? 308 : 302);
      }
    }
  }
  if (isAppHost(host)) return pass(req);

  let maps: Maps | undefined;
  try {
    maps = await storeMap();
  } catch {
    maps = undefined; // fail open
  }
  const path = req.nextUrl.pathname;
  const seg = path.split("/").filter(Boolean);
  const first = seg[0] ?? "";

  // El subdominio propio de la biblioteca (biblioteca.tumarca.com): la raíz es la biblioteca de esa tienda,
  // /entrar y /salir son los suyos; nada más se sirve ahí (ni checkout, ni catálogo, ni panel).
  const lib = maps?.hosts.get(host);
  if (lib?.kind === "library") {
    if (seg.length === 0) return rewrite(req, `/biblioteca/${lib.slug}`);
    if (seg.length === 1 && (first === "entrar" || first === "salir")) return rewrite(req, `/biblioteca/${lib.slug}/${first}`);
    if (first === "biblioteca") {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url, 308);
    }
    return notFound();
  }

  // Mi biblioteca: /biblioteca en un dominio de la tienda (pay.*, el de una oferta) es la de ESA tienda.
  if (first === "biblioteca") {
    const slug = maps?.hosts.get(host)?.slug ?? maps?.offerHosts.get(host)?.[0]?.store;
    if (slug && seg[1] !== slug) return rewrite(req, `/biblioteca/${slug}${seg.length > 1 ? `/${seg.slice(1).join("/")}` : ""}`);
  }

  // En el dominio del panel no se muestra ningún catálogo: la portada lleva al
  // de la marca y las políticas a su dominio de pagos.
  if (panelHost && host === panelHost && first === "catalogo" && seg[1]) {
    const st = maps?.stores.get(seg[1]);
    if (seg.length === 2 && st?.catalogUrl) return NextResponse.redirect(st.catalogUrl, 302);
    if (st?.domain) return NextResponse.redirect(`https://${st.domain}${path}${req.nextUrl.search}`, 302);
    return pass(req);
  }

  // Un checkout con dirección propia se abre siempre ahí (salvo la vista previa del editor).
  if (first === "c" && seg[2] && !req.nextUrl.searchParams.has("preview")) {
    const ck = maps?.byFunnel.get(`${seg[1]}/${seg[2]}`);
    if (ck && ck.host !== host) return NextResponse.redirect(`https://${ck.pub}${ck.path}${req.nextUrl.search}`, 302);
  }

  // Subdominio de una oferta (oferta.tumarca.com): la landing en /{idioma}
  // (next.config la sirve de public/lp), el checkout en su checkout_path, y
  // /checkout a secas si la oferta tiene un solo checkout ahí.
  const offer = maps?.offerHosts.get(host);
  if (offer) {
    const ck = maps!.byUrl.get(host + path.replace(/\/+$/, "")) ?? (path === "/checkout" && offer.length === 1 ? offer[0] : undefined);
    if (ck) return rewrite(req, `/c/${ck.store}/${ck.funnel}`);
    // Si además es el dominio de pagos de una tienda (pay.tumarca.com con el checkout de una oferta), lo demás
    // (los otros checkouts por /{slug}, las políticas, la portada) sigue como dominio de la tienda, más abajo.
    if (!maps?.hosts.get(host)) {
      const lang = offer[0].path.split("/")[1];
      if (path === "/" && lang && lang !== "checkout") {
        const url = req.nextUrl.clone();
        url.pathname = `/${lang}`;
        return NextResponse.redirect(url, 302);
      }
      return pass(req);
    }
  }

  const hit = maps?.hosts.get(host);
  if (!hit) return pass(req);

  if (PANEL.has(first)) return notFound();

  if (hit.kind === "catalog") {
    if (first === "_next") return pass(req);
    return rewrite(req, `/catalogo/${hit.slug}${path === "/" ? "" : path}`, true);
  }

  // Dominio de checkout.
  if (seg.length === 0) {
    return hit.catalogUrl ? NextResponse.redirect(hit.catalogUrl, 302) : rewrite(req, `/catalogo/${hit.slug}`, true);
  }
  if (seg.length === 1 && CATALOG_PAGES.has(first)) return rewrite(req, `/catalogo/${hit.slug}/${first}`, true);
  if (PASS.has(first)) return pass(req);
  // Las rutas internas de otra tienda no se sirven en este dominio.
  if (first === "catalogo" || first === "c") return seg[1] === hit.slug ? pass(req) : notFound();
  if (seg.length === 1) return rewrite(req, `/c/${hit.slug}/${first}`);
  return pass(req);
}
