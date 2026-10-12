import { db } from "@/lib/db";
import { decrypt } from "@/lib/secrets";
import { checkoutUrl } from "@/lib/checkout-url";
import { offerList } from "./offers";
import { checkHttp, checkWallet, hostOf } from "./domains";
import { pixelsFor } from "@/lib/meta";
import { metaConfigured, metaGet } from "./meta-conn";
import type { DiagCheck } from "./diagnostico";
import { pixelNames, pixelRef, pixelText } from "./pixel-names";

/**
 * Diagnóstico › lo que se prueba EN EL MOMENTO, por tienda y por oferta
 * activa (nada sale de caché): que la casilla de mail acepte el login, que
 * los pixels estén recibiendo eventos de cada landing y checkout, que Apple
 * Pay / Google Pay estén dados de alta para cada checkout, que cada página
 * responda y que cada link de entrega abra. Cada fila dice qué hacer.
 */

const GRAPH = "https://graph.facebook.com/v23.0";
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  if (m < 48 * 60) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Login SMTP a la casilla de la tienda, sin mandar nada. */
async function smtpCheck(storeId: string, cfg: string): Promise<DiagCheck | null> {
  const { data } = await db.from("store_mail").select("host,port,username,password_enc").eq("store_id", storeId).maybeSingle();
  if (!data) return null;
  try {
    const nodemailer = await import("nodemailer");
    const tx = nodemailer.createTransport({
      host: data.host, port: data.port, secure: data.port === 465,
      auth: { user: data.username, pass: decrypt(data.password_enc) },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
    });
    await Promise.race([tx.verify(), new Promise((_, rej) => setTimeout(() => rej(new Error("no respondió en 8 s")), 8500))]);
    tx.close();
    return { id: "smtp", status: "ok", title: "La casilla de mail acepta el login", detail: `${data.username} en ${data.host}:${data.port}` };
  } catch (e) {
    return { id: "smtp", status: "bad", title: "La casilla de mail rechaza el login", detail: `${data.username}: ${(e as Error).message}. Revisá la contraseña en el proveedor de correo y pedile a Claude que la actualice (si no, sale por Brevo de respaldo).`, href: `${cfg}/entrega`, fix: "Ver" };
  }
}

async function mailChecks(storeId: string, cfg: string, base: string): Promise<DiagCheck[]> {
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const [smtp, last, failed, bounced] = await Promise.all([
    smtpCheck(storeId, cfg).catch(() => null),
    // Las direcciones de prueba (@example.com) no cuentan: no son compradores.
    db.from("email_log").select("status,error,created_at,to_email").eq("store_id", storeId).eq("kind", "delivery").not("to_email", "ilike", "%@example.com").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("email_log").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "failed").not("to_email", "ilike", "%@example.com").gte("created_at", since7),
    db.from("email_log").select("id", { count: "exact", head: true }).eq("store_id", storeId).not("bounced_at", "is", null).not("to_email", "ilike", "%@example.com").gte("created_at", since7),
  ]);
  const out: DiagCheck[] = [];
  if (smtp) out.push(smtp);
  const l = last.data;
  out.push(!l
    ? { id: "lastmail", status: "warn", title: "Todavía no salió ningún mail de entrega" }
    : l.status === "failed"
      ? { id: "lastmail", status: "bad", title: `El último mail de entrega falló (${ago(l.created_at)})`, detail: `${l.to_email ?? ""}: ${l.error ?? "sin detalle"}. Reenviarlo desde el pedido.`, href: `${base}/ventas`, fix: "Ver pedidos" }
      : { id: "lastmail", status: "ok", title: `Último mail de entrega enviado ${ago(l.created_at)}` });
  const f = failed.count ?? 0;
  const b = bounced.error ? 0 : bounced.count ?? 0;
  out.push(f || b
    ? { id: "mailfails", status: "bad", title: `${[f ? plural(f, "mail falló", "mails fallaron") : "", b ? plural(b, "rebotó", "rebotaron") : ""].filter(Boolean).join(" y ")} en 7 días`, detail: "Mirá cada caso en Avisos y reenviá la entrega.", href: "/admin/avisos", fix: "Avisos" }
    : { id: "mailfails", status: "ok", title: "Ningún mail falló ni rebotó en 7 días" });
  return out;
}

type Stats = { data?: { start_time: string; data: { value: string; count: number }[] }[]; error?: { message: string } };
export async function pixelStats(pixel: string, agg: "event" | "host") {
  if (!(await metaConfigured())) return null;
  const start = Math.floor(Date.now() / 1000) - 86400;
  const j = await metaGet<Stats>(`${pixel}/stats`, { aggregation: agg, start_time: String(start) }, 10_000);
  return j.data ?? [];
}

/** Los pixels que la landing carga de verdad: se baja la página y se buscan los fbq('init', '…'). */
async function landingPixels(url: string): Promise<{ ids: string[]; error: string | null }> {
  try {
    const r = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0 (checkout-panel diagnóstico)" } });
    const html = await r.text();
    const ids = [...html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g)].map((m) => m[1]);
    return { ids: [...new Set(ids)], error: r.ok ? null : `respondió ${r.status}` };
  } catch (e) {
    return { ids: [], error: (e as Error).message };
  }
}

/**
 * Por oferta activa y mercado: qué pixel carga la landing y cuál el checkout
 * (tienen que ser el mismo, uno solo), cuántos eventos del navegador recibió
 * Meta de cada dominio (esta hora y 24 h), si Meta está descartando un
 * dominio (Permisos de tráfico) y un botón para probar el pixel por la API de
 * Conversiones. Después, las compras sin informar por CAPI.
 */
async function pixelChecks(storeId: string, offers: Awaited<ReturnType<typeof offerList>>, cfg: string): Promise<DiagCheck[]> {
  const markets = offers.flatMap((o) => o.markets.filter((f) => f.active).map((f) => ({ o, f })));
  if (!markets.length) return [];
  const { data: fs } = await db.from("funnels").select("id,pixel_ids").in("id", markets.map((m) => m.f.id));
  const since24 = new Date(Date.now() - 864e5).toISOString();
  const hourAgo = Date.now() - 3600_000;
  const statsCache = new Map<string, Promise<{ ev: NonNullable<Awaited<ReturnType<typeof pixelStats>>>; hosts: NonNullable<Awaited<ReturnType<typeof pixelStats>>> } | null>>();
  const statsOf = (pixel: string) => {
    if (!statsCache.has(pixel)) {
      statsCache.set(pixel, Promise.all([pixelStats(pixel, "event"), pixelStats(pixel, "host")]).then(([ev, hosts]) => (ev && hosts ? { ev, hosts } : null)));
    }
    return statsCache.get(pixel)!;
  };
  const out: DiagCheck[] = [];
  for (const { o, f } of markets) {
    const m = f.market_label ? ` (${f.market_label})` : "";
    const fr = (fs ?? []).find((x) => x.id === f.id);
    const checkoutPx = (await pixelsFor(storeId, (fr?.pixel_ids ?? []) as string[])).map((p) => p.pixel_id);
    const checkoutUrlOf = f.checkout_host ? checkoutUrl(f, o.store.slug) : null;
    const land = f.landing_url ? await landingPixels(f.landing_url) : null;
    // Los pixels por su nombre (el número entre paréntesis).
    const pxn = await pixelNames([...checkoutPx, ...(land?.ids ?? [])]);
    const pt = (ids: string[]) => ids.map((id) => pixelText(id, pxn)).join(", ");

    // (a) Landing y checkout con el mismo pixel, uno solo.
    if (!checkoutPx.length) {
      out.push({ id: `px-none-${f.id}`, status: "bad", title: `${o.name}${m}: el checkout no tiene pixel`, detail: "Las compras no se informan a Meta. Pedile a Claude que le asigne el pixel de la oferta.", href: `${cfg}/tracking`, fix: "Ver" });
    }
    if (land) {
      const same = land.ids.length === checkoutPx.length && land.ids.every((id) => checkoutPx.includes(id));
      out.push(land.error && !land.ids.length
        ? { id: `px-land-${f.id}`, status: "warn", title: `${o.name}${m}: no se pudo leer la landing para ver su pixel`, detail: `${f.landing_url}: ${land.error}` }
        : !land.ids.length
          ? { id: `px-land-${f.id}`, status: "bad", title: `${o.name}${m}: la landing no carga ningún pixel`, detail: `No encontré fbq('init', …) en ${f.landing_url}. Sin pixel en la landing, Meta no ve las visitas.` }
          : land.ids.length > 1
            ? { id: `px-land-${f.id}`, status: "bad", title: `${o.name}${m}: la landing carga ${land.ids.length} pixels`, detail: `Landing: ${pt(land.ids)} · checkout: ${pt(checkoutPx) || "ninguno"}. Tiene que cargar uno solo, el de la oferta.` }
            : same
              ? { id: `px-land-${f.id}`, status: "ok", title: `${o.name}${m}: landing y checkout con el mismo pixel`, detail: pixelRef([land.ids[0]], pxn) }
              : { id: `px-land-${f.id}`, status: "bad", title: `${o.name}${m}: la landing y el checkout usan pixels distintos`, detail: `Landing: ${pt(land.ids)} · checkout: ${pt(checkoutPx) || "ninguno"}. Meta no puede unir la visita con la compra.` });
    }

    // (c) Eventos del navegador por dominio y (d) Permisos de tráfico.
    for (const pixel of checkoutPx) {
      try {
        const st = await statsOf(pixel);
        if (!st) { out.push({ id: `px-${pixel}-${f.id}`, status: "warn", title: `${pixelRef([pixel], pxn)}: no se puede leer (no hay conexión con Meta)` }); continue; }
        const byHost = new Map<string, { hour: number; day: number }>();
        for (const b of st.hosts) for (const d of b.data) {
          const h = d.value.replace(/^www\./, "").toLowerCase();
          const e = byHost.get(h) ?? { hour: 0, day: 0 };
          e.day += d.count; if (new Date(b.start_time).getTime() >= hourAgo) e.hour += d.count;
          byHost.set(h, e);
        }
        const others = [...byHost.values()].some((v) => v.day > 0);
        for (const [what, url] of [["landing", f.landing_url], ["checkout", checkoutUrlOf]] as const) {
          if (!url) continue;
          const host = hostOf(url).replace(/^www\./, "");
          const n = byHost.get(host) ?? { hour: 0, day: 0 };
          const { count } = await db.from("site_events").select("id", { count: "exact", head: true })
            .eq("funnel_id", f.id).eq("page", what).eq("event", "view").gte("at", since24);
          const visits = count ?? 0;
          const test = { kind: "pixel-test" as const, pixelId: pixel, url };
          if (!n.day && visits && others) {
            out.push({ id: `pxh-${pixel}-${f.id}-${what}`, status: "bad",
              title: `Meta está descartando los eventos de ${host}: agregalo en Permisos de tráfico`,
              detail: `${o.name}${m}: ${plural(visits, "visita", "visitas")} ${what === "landing" ? "a la landing" : "al checkout"} en 24 h y 0 eventos del pixel ${pixelText(pixel, pxn)} desde ${host}, mientras otros dominios sí llegan. En el Administrador de eventos › Configuración › Permisos de tráfico, agregá ${host.split(".").slice(-2).join(".")}.`,
              action: test });
          } else {
            out.push({ id: `pxh-${pixel}-${f.id}-${what}`, status: n.day ? "ok" : visits ? "warn" : "ok",
              title: `${o.name}${m}: ${what === "landing" ? "landing" : "checkout"} → pixel ${pxn[pixel] ?? pixel}`,
              detail: `Eventos del navegador desde ${host}: ${n.hour} esta hora · ${n.day} en 24 h · ${plural(visits, "visita", "visitas")} registradas por la app en 24 h.`,
              action: test });
          }
        }
      } catch (e) {
        out.push({ id: `px-${pixel}-${f.id}`, status: "warn", title: `${pixelRef([pixel], pxn)}: Meta no respondió`, detail: (e as Error).message });
      }
    }
  }

  // API de Conversiones: las compras que no se le informaron a Meta.
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const tenMin = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ count: pending }, { data: lastCapi }] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "paid").is("capi_sent_at", null).gte("created_at", since7).lt("created_at", tenMin),
    db.from("orders").select("capi_sent_at").eq("store_id", storeId).not("capi_sent_at", "is", null).order("capi_sent_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  out.push(pending
    ? { id: "capi", status: "bad", title: `${plural(pending, "compra sin informar", "compras sin informar")} a Meta por la API de Conversiones (7 días)`, detail: "Revisá el token de la API de Conversiones del pixel (probalo con «Probar pixel ahora»).", href: `${cfg}/tracking`, fix: "Ver" }
    : { id: "capi", status: "ok", title: "API de Conversiones: todas las compras informadas", detail: lastCapi?.capi_sent_at ? `Última ${ago(lastCapi.capi_sent_at)}.` : "Todavía sin compras." });
  return out;
}

/** Que cada landing y checkout responda, y que Apple Pay / Google Pay estén dados de alta para cada checkout. */
async function pageChecks(storeId: string, offers: Awaited<ReturnType<typeof offerList>>, cfg: string): Promise<DiagCheck[]> {
  const rows: { offer: string; what: string; url: string; wallet: boolean }[] = [];
  for (const o of offers) for (const f of o.markets.filter((m) => m.active)) {
    const m = f.market_label ? ` (${f.market_label})` : "";
    if (f.landing_url) rows.push({ offer: o.name, what: `la landing${m}`, url: f.landing_url, wallet: false });
    rows.push({ offer: o.name, what: `el checkout${m}`, url: checkoutUrl(f, o.store.slug), wallet: true });
  }
  const [wallet, ...https] = await Promise.all([checkWallet(storeId), ...rows.map((r) => checkHttp(r.url))]);
  const out: DiagCheck[] = [];
  rows.forEach((r, i) => {
    const h = https[i];
    out.push(h.ok
      ? { id: `http-${r.url}`, status: "ok", title: `${r.offer}: ${r.what} responde`, detail: `${r.url.replace(/^https:\/\//, "")} · ${h.status} en ${h.ms} ms` }
      : { id: `http-${r.url}`, status: "bad", title: `${r.offer}: ${r.what} no responde bien`, detail: `${r.url.replace(/^https:\/\//, "")} · ${h.status ?? h.error}. Revisá el dominio y el deploy.`, href: `${cfg}/dominios`, fix: "Dominios" });
    if (r.wallet) {
      const host = hostOf(r.url);
      const d = wallet.domains.find((x) => x.host === host);
      out.push(!wallet.ok
        ? { id: `wallet-${host}`, status: "warn", title: `${r.offer}: no se pudo leer Apple Pay en Stripe`, detail: wallet.error }
        : d && d.enabled && d.apple === "active"
          ? { id: `wallet-${host}`, status: "ok", title: `${r.offer}: Apple Pay y Google Pay listos en ${host}` }
          : { id: `wallet-${host}`, status: "warn", title: `${r.offer}: Apple Pay / Google Pay sin registrar en ${host}`, detail: "El checkout funciona, pero sin esos botones. Pedile a Claude register_apple_pay_domains.", href: `${cfg}/dominios`, fix: "Dominios" });
    }
  });
  // Un mismo host aparece en varias filas: una sola vez por host.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** Cada link de entrega de los productos activos de las ofertas: que abra para cualquiera (Drive compartido). */
async function linkChecks(storeId: string, base: string): Promise<DiagCheck[]> {
  const { data } = await db.from("products").select("id,short_name,delivery_url,delivery_links").eq("store_id", storeId).eq("active", true);
  const links = (data ?? []).flatMap((p) => [
    ...(p.delivery_url ? [{ p, url: p.delivery_url as string }] : []),
    ...(((p.delivery_links ?? []) as { url?: string }[]).filter((l) => l?.url).map((l) => ({ p, url: l.url! }))),
  ]);
  if (!links.length) return [];
  const res: { name: string; url: string; ok: boolean; why: string }[] = [];
  // De a 8 por vez: no hace falta martillar Drive.
  for (let i = 0; i < links.length; i += 8) {
    res.push(...(await Promise.all(links.slice(i, i + 8).map(async ({ p, url }) => {
      const h = await checkHttp(url);
      const login = h.location && /accounts\.google\.com|ServiceLogin/i.test(h.location);
      const ok = !!h.status && h.status < 400 && !login;
      return { name: p.short_name as string, url, ok, why: login ? "pide iniciar sesión (no está compartido con «cualquiera con el link»)" : h.status ? `responde ${h.status}` : h.error ?? "no responde" };
    }))));
  }
  const bad = res.filter((r) => !r.ok);
  return [bad.length
    ? { id: "dl-links", status: "bad", title: `${plural(bad.length, "link de entrega no abre", "links de entrega no abren")}`,
        detail: bad.slice(0, 4).map((r) => `${r.name}: ${r.why}`).join(" · "), href: `${base}/productos`, fix: "Productos" }
    : { id: "dl-links", status: "ok", title: `Los ${res.length} links de entrega abren` }];
}

export async function liveChecks(storeId: string, base: string): Promise<DiagCheck[]> {
  const cfg = `${base}/configuracion`;
  const offers = (await offerList()).filter((o) => o.store.id === storeId && o.active);
  const parts = await Promise.all([
    mailChecks(storeId, cfg, base).catch((e) => [{ id: "mail-x", status: "warn" as const, title: "No se pudo revisar el mail", detail: (e as Error).message }]),
    pixelChecks(storeId, offers, cfg).catch((e) => [{ id: "px-x", status: "warn" as const, title: "No se pudieron revisar los pixels", detail: (e as Error).message }]),
    pageChecks(storeId, offers, cfg).catch((e) => [{ id: "pg-x", status: "warn" as const, title: "No se pudieron revisar las páginas", detail: (e as Error).message }]),
    linkChecks(storeId, base).catch((e) => [{ id: "dl-x", status: "warn" as const, title: "No se pudieron revisar los links de entrega", detail: (e as Error).message }]),
  ]);
  return parts.flat();
}
