import { gunzipSync } from "node:zlib";
import { db } from "@/lib/db";

/**
 * Lo que dicen las grabaciones propias de las landings (rrweb, rec_chunks)
 * sin mirar ningún video: hasta dónde baja cada visita, cuánto tiempo queda
 * la página grabando, cuántos tocan una imagen o el botón. Solo lectura.
 *
 * Límites (se informan, no se inventan):
 *  - rec_chunks se borra a las 72 h: esto mira solo los últimos 3 días.
 *  - la grabación arranca cuando la página terminó de cargar y quedó quieta:
 *    quien se va en el primer segundo no está (eso lo cuentan los eventos).
 *  - rrweb no guarda el alto de la página: se estima con lo más hondo que
 *    llegó alguien en ese dispositivo (mismo checkout y ruta). Es aproximado.
 *  - el texto de la página está tapado: no se sabe QUÉ sección es, solo a qué
 *    altura (en % de la página).
 */

export type DeviceBehaviour = {
  /** Visitas grabadas (cargas de página). */
  n: number;
  /** Alto estimado de la página en px (lo más hondo que alguien llegó + su pantalla). */
  pageH: number;
  /** Pantallas de alto de la página (pageH / alto de pantalla típico). */
  screens: number;
  /** Mediana de profundidad máxima (0–1 del alto estimado). */
  medianDepth: number;
  /** Proporción que no bajó ni un cuarto de pantalla. */
  noScroll: number;
  /** Proporción que llegó al 25/50/75/90 % de la página. */
  reached: { p25: number; p50: number; p75: number; p90: number };
  /** De los que no tocaron el botón de compra: dónde estaban al irse, en tramos de 10 % (10 números). */
  exitByDecile: number[];
  /** Tramo (0–9) con más salidas pasada la primera pantalla, y qué parte de esas salidas tiene. */
  topExit: { decile: number; share: number } | null;
};

export type LandingBehaviour = {
  sessions: number;
  mobile: DeviceBehaviour | null;
  desktop: DeviceBehaviour | null;
  /** Visitas que tocaron una imagen (no un link ni un botón). */
  imgClickShare: number;
  /** Visitas que tocaron el botón de compra (a[data-checkout]) según la grabación. */
  ctaShare: number;
  /** Mediana de segundos con la página grabando. */
  medianSec: number;
};

type Pv = {
  key: string; funnelId: string | null; path: string; vw: number; vh: number;
  maxY: number; t0: number; t1: number; clicks: number; imgClicks: number; ctaClicks: number;
};

const F_INTERACTIVE = 1, F_CTA = 2, F_IMG = 4;
const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "label", "summary", "details", "video", "iframe"]);

type SnNode = { id?: number; type?: number; tagName?: string; attributes?: Record<string, unknown>; childNodes?: SnNode[] };

function walk(n: SnNode, inherited: number, map: Map<number, number>) {
  let f = inherited;
  if (n.type === 2 && n.tagName) {
    const t = n.tagName.toLowerCase();
    if (INTERACTIVE.has(t) || (n.attributes && ("onclick" in n.attributes || n.attributes.role === "button"))) f |= F_INTERACTIVE;
    if (n.attributes && "data-checkout" in n.attributes) f |= F_CTA | F_INTERACTIVE;
    if (t === "img" || t === "picture") f |= F_IMG;
  }
  if (typeof n.id === "number") map.set(n.id, f);
  for (const c of n.childNodes ?? []) walk(c, f & ~F_IMG, map);
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Recorre los eventos de una carga de página (sus pedazos en orden). */
function digest(events: { type: number; timestamp: number; data?: Record<string, unknown> }[], pv: Pv, nodes: Map<number, number>) {
  for (const e of events) {
    if (typeof e.timestamp === "number") {
      if (!pv.t0 || e.timestamp < pv.t0) pv.t0 = e.timestamp;
      if (e.timestamp > pv.t1) pv.t1 = e.timestamp;
    }
    const d = e.data ?? {};
    if (e.type === 4) {
      // Meta: tamaño de la pantalla al empezar.
      if (!pv.vh && Number(d.height) > 0) { pv.vh = Number(d.height); pv.vw = Number(d.width) || 0; }
    } else if (e.type === 2) {
      const node = d.node as SnNode | undefined;
      if (node) walk(node, 0, nodes);
      const off = d.initialOffset as { top?: number } | undefined;
      if (off && Number(off.top) > pv.maxY) pv.maxY = Number(off.top);
    } else if (e.type === 3) {
      const src = Number(d.source);
      if (src === 3) {
        // Scroll: vertical (los carruseles se mueven en x, con y = 0).
        const y = Number(d.y) || 0;
        if (y > pv.maxY) pv.maxY = y;
      } else if (src === 4) {
        if (!pv.vh && Number(d.height) > 0) { pv.vh = Number(d.height); pv.vw = Number(d.width) || 0; }
      } else if (src === 0) {
        // Mutaciones: nodos nuevos (heredan lo del padre).
        for (const a of (d.adds as { parentId?: number; node?: SnNode }[] | undefined) ?? []) {
          if (a?.node) walk(a.node, (nodes.get(Number(a.parentId)) ?? 0) & ~F_IMG, nodes);
        }
      } else if (src === 2 && Number(d.type) === 2) {
        // Clic (también el toque en el celular).
        pv.clicks++;
        const f = nodes.get(Number(d.id)) ?? 0;
        if (f & F_CTA) pv.ctaClicks++;
        else if ((f & F_IMG) && !(f & F_INTERACTIVE)) pv.imgClicks++;
      }
    }
  }
}

/**
 * Comportamiento en las landings de estos checkouts desde `since` (como mucho
 * 72 h atrás, lo que se guarda). Devuelve uno por checkout con al menos `min`
 * visitas grabadas. Tope de lectura para no tardar: `maxChunks`.
 */
export async function landingBehaviour(funnelIds: string[], since: Date, opts: { min?: number; maxChunks?: number } = {}): Promise<{ byFunnel: Map<string, LandingBehaviour>; chunks: number; truncated: boolean }> {
  const min = opts.min ?? 30;
  const maxChunks = opts.maxChunks ?? 25_000;
  const byFunnel = new Map<string, LandingBehaviour>();
  if (!funnelIds.length) return { byFunnel, chunks: 0, truncated: false };

  // Las pestañas grabadas de estos checkouts (rec_sessions tiene el checkout; rec_chunks no).
  const sessFunnel = new Map<string, string>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("rec_sessions").select("session_id,funnel_id").in("funnel_id", funnelIds).gte("last_at", since.toISOString()).range(off, off + 999);
    if (error) throw new Error(`rec_sessions: ${error.message}`);
    for (const r of data ?? []) sessFunnel.set(r.session_id as string, r.funnel_id as string);
    if ((data ?? []).length < 1000) break;
  }
  if (!sessFunnel.size) return { byFunnel, chunks: 0, truncated: false };

  // Los pedazos de la landing, por id (paginado), solo de esas pestañas.
  type Row = { id: number; session_id: string; pv: string | null; seq: number; path: string | null; gz: string };
  const groups = new Map<string, Row[]>();
  const sids = [...sessFunnel.keys()];
  let read = 0, truncated = false;
  for (let i = 0; i < sids.length && !truncated; i += 150) {
    let after = 0;
    for (;;) {
      const { data, error } = await db.from("rec_chunks").select("id,session_id,pv,seq,path,gz")
        .eq("page", "landing").in("session_id", sids.slice(i, i + 150)).gte("at", since.toISOString())
        .gt("id", after).order("id", { ascending: true }).limit(400);
      if (error) throw new Error(`rec_chunks: ${error.message}`);
      const rows = (data ?? []) as Row[];
      for (const r of rows) {
        const k = `${r.session_id}|${r.pv ?? ""}`;
        (groups.get(k) ?? (groups.set(k, []), groups.get(k)!)).push(r);
        after = Math.max(after, r.id);
      }
      read += rows.length;
      if (read >= maxChunks) { truncated = true; break; }
      if (rows.length < 400) break;
    }
  }

  const pvs: Pv[] = [];
  for (const [k, rows] of groups) {
    rows.sort((a, b) => a.seq - b.seq);
    const sid = k.split("|")[0];
    const pv: Pv = { key: k, funnelId: sessFunnel.get(sid) ?? null, path: rows[0]?.path ?? "", vw: 0, vh: 0, maxY: 0, t0: 0, t1: 0, clicks: 0, imgClicks: 0, ctaClicks: 0 };
    const nodes = new Map<number, number>();
    for (const r of rows) {
      try {
        const hex = r.gz.startsWith("\\x") ? r.gz.slice(2) : r.gz;
        const arr = JSON.parse(gunzipSync(Buffer.from(hex, "hex")).toString("utf8"));
        if (Array.isArray(arr)) digest(arr, pv, nodes);
      } catch { /* un pedazo roto no frena el resto */ }
    }
    if (pv.vh > 0) pvs.push(pv);
  }

  // Por checkout y dispositivo (ancho < 768 = celular).
  const byF = new Map<string, Pv[]>();
  for (const p of pvs) if (p.funnelId) (byF.get(p.funnelId) ?? (byF.set(p.funnelId, []), byF.get(p.funnelId)!)).push(p);
  for (const [fid, list] of byF) {
    if (list.length < min) continue;
    const dev = (mobile: boolean): DeviceBehaviour | null => {
      const xs = list.filter((p) => (p.vw > 0 && p.vw < 768) === mobile);
      if (xs.length < Math.max(10, Math.round(min / 2))) return null;
      // Alto de la página por ruta (una landing por checkout, normalmente): lo más hondo + su pantalla.
      const pageOf = new Map<string, number>();
      for (const p of xs) pageOf.set(p.path, Math.max(pageOf.get(p.path) ?? 0, p.maxY + p.vh));
      const depth = (p: Pv) => Math.min(1, (p.maxY + p.vh) / Math.max(1, pageOf.get(p.path) ?? 1));
      const ds = xs.map(depth);
      const share = (f: (p: Pv, i: number) => boolean) => xs.filter(f).length / xs.length;
      const exits = new Array(10).fill(0);
      const vhMed = median(xs.map((p) => p.vh));
      const mainPath = [...pageOf.entries()].sort((a, b) => b[1] - a[1])[0];
      const firstScreen = mainPath ? vhMed / mainPath[1] : 0;
      let beyond = 0;
      xs.forEach((p, i) => {
        if (p.ctaClicks) return;
        const dec = Math.min(9, Math.floor(ds[i] * 10));
        exits[dec]++;
      });
      const total = exits.reduce((a, b) => a + b, 0);
      for (let d = 0; d < 10; d++) if (d / 10 >= firstScreen) beyond += exits[d];
      let topExit: DeviceBehaviour["topExit"] = null;
      if (beyond >= 10) {
        let best = -1;
        for (let d = 0; d < 10; d++) if (d / 10 >= firstScreen && (best < 0 || exits[d] > exits[best])) best = d;
        if (best >= 0) topExit = { decile: best, share: exits[best] / beyond };
      }
      return {
        n: xs.length,
        pageH: Math.round(mainPath?.[1] ?? 0),
        screens: vhMed ? Math.round(((mainPath?.[1] ?? 0) / vhMed) * 10) / 10 : 0,
        medianDepth: median(ds),
        noScroll: share((p) => p.maxY < p.vh * 0.25),
        reached: { p25: share((_, i) => ds[i] >= 0.25), p50: share((_, i) => ds[i] >= 0.5), p75: share((_, i) => ds[i] >= 0.75), p90: share((_, i) => ds[i] >= 0.9) },
        exitByDecile: total ? exits.map((n) => n / total) : exits,
        topExit,
      };
    };
    byFunnel.set(fid, {
      sessions: list.length,
      mobile: dev(true),
      desktop: dev(false),
      imgClickShare: list.filter((p) => p.imgClicks > 0).length / list.length,
      ctaShare: list.filter((p) => p.ctaClicks > 0).length / list.length,
      medianSec: Math.round(median(list.map((p) => Math.max(0, (p.t1 - p.t0) / 1000)))),
    });
  }
  return { byFunnel, chunks: read, truncated };
}
