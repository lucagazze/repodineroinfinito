import { unstable_cache } from "next/cache";
import { driveFile, moveToNoticeArchive } from "@/lib/drive-sa";
import { db } from "@/lib/db";

/**
 * Preventas: lo que se vende antes de que exista el contenido.
 * Un producto en preventa (products.presale) le dice al comprador «te llega en N
 * días»; acá se ve qué falta escribir, a cuántos compradores se les debe y para
 * cuándo (la primera compra + N días). Las variantes (el downsell a mitad) y los
 * packs que lo traen adentro cuentan como el mismo libro.
 *
 * Al marcarlo listo deja de ser preventa (content_ready_at); queda en la lista
 * hasta que se avisa a todos los que lo compraron (reenvío de la entrega,
 * presale_notices).
 */

import type { PresaleRow, PresaleState, ReadyFile } from "./presale-shared";
export { dueText, type PresaleRow, type PresaleState, type ReadyFile } from "./presale-shared";

type P = {
  id: string; slug: string; short_name: string | null; name: string; image_url: string | null; store_id: string;
  presale: boolean | null; presale_days: number | null; presale_since: string | null; content_ready_at: string | null;
  delivery_url: string | null; variant_of: string | null; includes: string[] | null; ready_files?: ReadyFile[] | null; leftover_notices?: { id: string; title: string }[] | null;
  presale_pages?: number | null; presale_outline?: string | null;
};

const H = 3600_000;

/** La misma cuenta, guardada 1 minuto: para el número del menú y la tarjeta del Inicio (no frenan cada página). */
export const PRESALE_TAG = "presale-board";
export const presaleBoardCached = () => unstable_cache(() => presaleBoard(), ["presale-board-v1"], { revalidate: 60, tags: [PRESALE_TAG] })();

/**
 * De qué oferta es cada libro: dónde se vende él, su variante o un pack que lo incluye —
 * como bump o bonus de un checkout, o como OTO de su post-pago — con el nombre de la oferta.
 */
async function attachOffers(rows: PresaleRow[]) {
  const ids = [...new Set(rows.flatMap((r) => r.productIds))];
  if (!ids.length) return;
  const [{ data: fi }, { data: st }] = await Promise.all([
    db.from("funnel_items").select("product_id,role,funnels!inner(active,offer_id)").in("product_id", ids),
    db.from("pp_steps").select("product_id,pp_funnels!inner(active,checkout_funnel_id)").in("product_id", ids),
  ]);
  const ppFunnels = [...new Set((st ?? []).map((s) => (s.pp_funnels as unknown as { checkout_funnel_id: string | null }).checkout_funnel_id).filter(Boolean) as string[])];
  const { data: fs } = ppFunnels.length ? await db.from("funnels").select("id,offer_id").in("id", ppFunnels) : { data: [] as { id: string; offer_id: string | null }[] };
  const offerOfFunnel = new Map((fs ?? []).map((f) => [f.id as string, f.offer_id as string | null]));
  const links: { product: string; offer: string; role: string }[] = [];
  const ROLE: Record<string, string> = { bump: "bump", bonus: "bonus", included: "incluido", upsell: "upsell" };
  for (const r of fi ?? []) {
    const f = r.funnels as unknown as { active: boolean; offer_id: string | null };
    if (f?.active && f.offer_id) links.push({ product: r.product_id as string, offer: f.offer_id, role: ROLE[r.role as string] ?? String(r.role) });
  }
  for (const s of st ?? []) {
    const pf = s.pp_funnels as unknown as { active: boolean; checkout_funnel_id: string | null };
    const off = pf?.active && pf.checkout_funnel_id ? offerOfFunnel.get(pf.checkout_funnel_id) : null;
    if (off) links.push({ product: s.product_id as string, offer: off, role: "post-pago" });
  }
  const offerIds = [...new Set(links.map((l) => l.offer))];
  const { data: os } = offerIds.length ? await db.from("offers").select("id,name").in("id", offerIds) : { data: [] as { id: string; name: string }[] };
  const name = new Map((os ?? []).map((o) => [o.id as string, o.name as string]));
  for (const r of rows) {
    const seen = new Map<string, Set<string>>();
    for (const l of links.filter((x) => r.productIds.includes(x.product))) {
      const n = name.get(l.offer);
      if (!n) continue;
      (seen.get(n) ?? seen.set(n, new Set()).get(n)!).add(l.role);
    }
    r.offers = [...seen.entries()].map(([n, roles]) => ({ name: n, role: [...roles].join(" y ") })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
}

export async function presaleBoard(): Promise<PresaleRow[]> {
  // Los que están en preventa y los que se terminaron en los últimos 30 días (puede faltar avisar).
  const since30 = new Date(Date.now() - 30 * 24 * H).toISOString();
  const { data: own } = await db.from("products")
    .select("id,slug,short_name,name,image_url,store_id,presale,presale_days,presale_since,content_ready_at,delivery_url,variant_of,includes,ready_files,leftover_notices,presale_pages,presale_outline")
    .or(`presale.eq.true,content_ready_at.gte.${since30}`);
  const rows = (own ?? []) as P[];
  if (!rows.length) return [];

  // Un libro = su base (las variantes cuelgan de ella).
  const baseOf = (p: P) => p.variant_of ?? p.id;
  const baseIds = [...new Set(rows.map(baseOf))];
  const { data: fam } = await db.from("products")
    .select("id,slug,short_name,name,image_url,store_id,presale,presale_days,presale_since,content_ready_at,delivery_url,variant_of,includes,ready_files,leftover_notices,presale_pages,presale_outline")
    .or(`id.in.(${baseIds.join(",")}),variant_of.in.(${baseIds.join(",")})`);
  const family = (fam ?? []) as P[];
  const { data: packs } = await db.from("products").select("id,includes").overlaps("includes", family.map((p) => p.id));
  const { data: stores } = await db.from("stores").select("id,name,display_name");
  const storeName = new Map((stores ?? []).map((s) => [s.id as string, (s.display_name || s.name) as string]));

  const out: PresaleRow[] = [];
  // Todo en 2 consultas (antes eran 1-2 por libro y la cuenta tardaba ~10 s; la usan el menú y el Inicio en
  // cada página): qué productos son cada libro, todas sus ventas pagadas y todos los avisos ya mandados.
  const idsOf = new Map(baseIds.map((id) => {
    const ids = family.filter((p) => p.id === id || p.variant_of === id).map((p) => p.id);
    const packIds = (packs ?? []).filter((k) => ((k.includes as string[] | null) ?? []).some((x) => ids.includes(x))).map((k) => k.id as string);
    return [id, [...new Set([...ids, ...packIds])]] as const;
  }));
  const allIds = [...new Set([...idsOf.values()].flat())];
  type Sale = { order_id: string; product_id: string; created_at: string };
  const sales: Sale[] = [];
  for (let from = 0; allIds.length && from < 20_000; from += 1000) {
    const { data } = await db.from("order_items").select("order_id,product_id,created_at,orders!inner(status,is_test)")
      .in("product_id", allIds).eq("orders.status", "paid").eq("orders.is_test", false).order("created_at", { ascending: true }).range(from, from + 999);
    sales.push(...((data ?? []) as unknown as Sale[]));
    if ((data ?? []).length < 1000) break;
  }
  const { data: allNotices } = baseIds.length ? await db.from("presale_notices").select("order_id,product_id,sent_at").in("product_id", baseIds) : { data: [] as { order_id: string; product_id: string; sent_at: string }[] };

  for (const id of baseIds) {
    const mine = family.filter((p) => p.id === id || p.variant_of === id);
    const base = mine.find((p) => p.id === id) ?? mine[0];
    if (!base) continue;
    const presale = mine.some((p) => p.presale);
    const readyAt = presale ? null : mine.map((p) => p.content_ready_at).filter(Boolean).sort().at(-1) ?? null;
    const productIds = [...(idsOf.get(id) ?? [])];
    const startedAt = mine.map((p) => p.presale_since).filter(Boolean).sort()[0] ?? null;

    const pset = new Set(productIds);
    const items = sales.filter((x) => pset.has(x.product_id));
    // Solo se le debe el aviso a quien compró ANTES de que el contenido estuviera listo: el que compra
    // después ya recibe la carpeta con el PDF en su mail de entrega.
    const owed = readyAt ? items.filter((i) => (i.created_at as string) < readyAt) : items;
    const orders = [...new Set(owed.map((i) => i.order_id as string))];
    const firstSale = items[0]?.created_at as string | undefined;

    let pendingNotice = 0, noticedAt: string | null = null;
    if (!presale && orders.length) {
      const oset = new Set(orders);
      const done = (allNotices ?? []).filter((n) => n.product_id === id && oset.has(n.order_id as string));
      pendingNotice = orders.length - new Set(done.map((d) => d.order_id)).size;
      noticedAt = done.map((d) => d.sent_at as string).sort().at(-1) ?? null;
    }
    // Listo y avisado a todos (o listo sin nadie esperando): ya no es tarea; se ve abajo, en «Listos y avisados».
    const delivered = !presale && pendingNotice === 0;
    const readyFiles = (mine.map((p) => p.ready_files).find((f) => Array.isArray(f) && f.length) ?? []) as ReadyFile[];

    const days = Math.max(...mine.map((p) => p.presale_days ?? 3));
    const due = firstSale ? new Date(Date.parse(firstSale) + days * 24 * H).toISOString() : null;
    const hoursLeft = due ? (Date.parse(due) - Date.now()) / H : null;
    const state: PresaleState = delivered ? "entregado" : !presale ? "listo_sin_avisar"
      : !orders.length ? "sin_ventas"
      : hoursLeft! <= 0 ? "atrasado"
      : hoursLeft! <= 24 ? "vence_pronto"
      : "a_tiempo";
    out.push({
      id, slug: base.slug, name: base.short_name || base.name, image: base.image_url,
      storeId: base.store_id, storeName: storeName.get(base.store_id) ?? "",
      days, since: startedAt, readyAt, deliveryUrl: base.delivery_url,
      productIds, orders, pendingNotice, firstSale: firstSale ?? null, due, hoursLeft, state, offers: [], readyFiles, noticedAt,
      leftoverNotices: presale ? [] : ((mine.map((p) => p.leftover_notices).find((f) => Array.isArray(f) && f.length) ?? []) as { id: string; title: string }[]),
      plannedPages: mine.map((p) => p.presale_pages).find((x) => x != null) ?? null,
      plannedOutline: mine.map((p) => p.presale_outline).find((x) => !!x) ?? null,
    });
  }
  await attachOffers(out);
  const rank: Record<PresaleState, number> = { atrasado: 0, vence_pronto: 1, listo_sin_avisar: 2, a_tiempo: 3, sin_ventas: 4, entregado: 5 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.hoursLeft ?? 1e9) - (b.hoursLeft ?? 1e9));
}


// ------------------------------------------------------------------ revisión automática de las carpetas

/** Lo que dice «todavía no está» (el aviso que va en la carpeta mientras se escribe el libro). */
const NOTICE = /leggimi|read ?me|lisez|liesmich|l[ée]eme|quando arriva|in arrivo|arriv|kommt|llega|bient[ôo]t|pr[óo]ximamente|pre-?sale|preventa|pr[ée]vente|vorverkauf|coming soon/i;

type Entry = { id: string; folder: boolean; pdf: boolean; doc: boolean; title: string };
const decodeHtml = (t: string) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Lo que hay en una carpeta pública de Drive (la vista embebida no pide clave). null = no se pudo leer. */
async function listFolder(id: string): Promise<Entry[] | null> {
  try {
    const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const html = await r.text();
    // Una carpeta vacía (subcarpeta de un pack sin libro todavía, o la de avisos resueltos) trae «flip-entries» sin
    // entradas: es una carpeta leída y vacía, no una que Drive no deja ver.
    if (!html.includes("flip-entr") && !/flip-view|folder-view/i.test(html)) return null;
    return html.split('<div class="flip-entry"').slice(1).map((chunk) => ({
      id: chunk.match(/id="entry-([^"]+)"/)?.[1] ?? "",
      folder: /drive\/folders\//.test(chunk.slice(0, 600)),
      pdf: /type\/application\/pdf/.test(chunk) || /\.pdf</i.test(chunk),
      doc: /type\/application\/(vnd\.google-apps\.document|vnd\.openxmlformats-officedocument\.wordprocessingml|msword|rtf)/.test(chunk) || /\.(docx?|rtf|odt)</i.test(chunk),
      title: decodeHtml((chunk.match(/flip-entry-title">([^<]*)/)?.[1] ?? "").trim()),
    })).filter((e) => e.id);
  } catch {
    return null;
  }
}

/** Un libro ilustrado pesa varios MB; un aviso o una hoja suelta, pocos KB. Menos de esto no se da por libro. */
const MIN_BOOK_BYTES = 1_000_000;

/**
 * ¿Es un PDF de libro de verdad? Pide a Drive solo el primer KB (Range): tiene que empezar con «%PDF» y el
 * tamaño total (Content-Range) tiene que ser de libro. Un archivo de más de ~100 MB devuelve la página de
 * «no se puede analizar por virus»: eso también es un archivo grande de verdad.
 */
async function verifyPdf(id: string): Promise<{ ok: boolean; bytes: number | null; why?: string }> {
  try {
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`, {
      headers: { Range: "bytes=0-1023" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const ct = r.headers.get("content-type") ?? "";
    if (/text\/html/.test(ct)) {
      const html = await r.text();
      return /virus|too large|troppo grande|demasiado grande/i.test(html) ? { ok: true, bytes: null } : { ok: false, bytes: null, why: "Drive no deja bajarlo (¿no está compartido con el enlace?)" };
    }
    const head = Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString("latin1");
    const total = Number(r.headers.get("content-range")?.split("/")[1] ?? r.headers.get("content-length") ?? NaN);
    const bytes = Number.isFinite(total) ? total : null;
    if (head !== "%PDF-") return { ok: false, bytes, why: "no es un PDF de verdad" };
    if (bytes != null && bytes < MIN_BOOK_BYTES) return { ok: false, bytes, why: `pesa ${Math.round(bytes / 1000)} KB: no parece el libro` };
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, bytes: null, why: `no se pudo leer (${(e as Error).message})` };
  }
}

export type FolderCheck = { state: "ready" | "pending" | "unknown"; files: ReadyFile[]; why: string | null; notices: { id: string; title: string }[] };

/**
 * ¿Ya está el contenido? Listo = hay al menos un PDF verificado (un PDF de verdad, con peso de libro, que no
 * se llama como el aviso) y ninguna carpeta de adentro quedó solo con el aviso (en un pack, falta un libro).
 * Mira hasta 2 niveles. «unknown» si Drive no contestó o la carpeta no es pública. `why` dice qué falta.
 */
export async function folderCheck(url: string | null): Promise<FolderCheck> {
  const id = url?.match(/folders\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) return { state: "unknown", files: [], why: "la entrega no es una carpeta de Drive", notices: [] };
  const files: ReadyFile[] = [];
  // El aviso de preventa (un documento de Word, o lo que se llame como el aviso y no sea el libro).
  const notices: { id: string; title: string; parent: string }[] = [];
  let waiting = false, why: string | null = null;
  const walk = async (fid: string, depth: number): Promise<boolean> => {
    const list = await listFolder(fid);
    if (!list) return false;
    const plain = list.filter((e) => !e.folder);
    const pdfs = plain.filter((e) => e.pdf && !NOTICE.test(e.title)).slice(0, 6);
    let good = 0;
    for (const f of pdfs) {
      const v = await verifyPdf(f.id);
      if (v.ok) { good++; files.push({ id: f.id, title: f.title, bytes: v.bytes }); }
      else why ??= `«${f.title}»: ${v.why}`;
    }
    const books = new Set(files.map((f) => f.id));
    for (const e of plain) if (!books.has(e.id) && (e.doc || NOTICE.test(e.title))) notices.push({ id: e.id, title: e.title, parent: fid });
    if (plain.length && !good) { waiting = true; why ??= pdfs.length ? null : "solo está el aviso, todavía no hay PDF"; }
    if (depth < 2) for (const f of list.filter((e) => e.folder)) if (!(await walk(f.id, depth + 1))) return false;
    return true;
  };
  if (!(await walk(id, 0))) return { state: "unknown", files: [], why: "no se pudo leer la carpeta (¿está compartida con el enlace?)", notices: [] };
  if (!files.length || waiting) return { state: "pending", files, why: why ?? "todavía no hay PDF del libro", notices: notices.map(({ id, title }) => ({ id, title })) };
  return { state: "ready", files, why: null, notices: await settleNotices(notices) };
}

/**
 * Con el libro ya en la carpeta, el aviso de preventa se saca solo: lo que se llama como el aviso
 * («LEGGIMI - in arrivo», «llega en 2 días»…), pesa poco y no es un PDF se mueve a «_Avisos de preventa ya
 * resueltos» (no se borra). Un documento con otro nombre no se toca: queda marcado para que lo mire una persona.
 * Lo que la vista pública todavía muestra pero ya está en la papelera o en otra carpeta, no cuenta.
 * Devuelve lo que sigue en la carpeta.
 */
async function settleNotices(notices: { id: string; title: string; parent: string }[]): Promise<{ id: string; title: string }[]> {
  const left: { id: string; title: string }[] = [];
  for (const n of notices) {
    const f = await driveFile(n.id);
    if (f && (f.trashed || !(f.parents ?? []).includes(n.parent))) continue;
    const small = !f?.size || Number(f.size) < MIN_BOOK_BYTES;
    if (f && small && f.mimeType !== "application/pdf" && NOTICE.test(f.name) && (await moveToNoticeArchive(n.id, n.parent))) {
      console.log(`[preventa] aviso sacado de la carpeta: «${f.name}» (${n.id})`);
      continue;
    }
    left.push({ id: n.id, title: n.title });
  }
  return left;
}

/**
 * Los PDF de una entrega, para abrirlos rápido desde el panel: los de la carpeta de Drive (y de
 * sus subcarpetas, un nivel), sin el aviso de preventa; o el archivo suelto si el link es a un archivo.
 * Guardado 30 min: no se le pregunta a Drive en cada carga.
 */
export const deliveryPdfs = (url: string | null) =>
  unstable_cache(async (): Promise<{ id: string; title: string }[]> => {
    const file = url?.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1];
    if (file) return [{ id: file, title: "PDF" }];
    const id = url?.match(/folders\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id) return [];
    const out: { id: string; title: string }[] = [];
    const walk = async (fid: string, depth: number) => {
      const list = await listFolder(fid);
      if (!list) return;
      for (const e of list) if (!e.folder && e.pdf && !NOTICE.test(e.title)) out.push({ id: e.id, title: e.title });
      if (depth < 1) for (const f of list.filter((e) => e.folder)) await walk(f.id, depth + 1);
    };
    await walk(id, 0);
    return out.slice(0, 8);
  }, ["delivery-pdfs-v1", url ?? ""], { revalidate: 1800 })();

/** Compatibilidad: solo el estado. */
export async function folderReady(url: string | null): Promise<"ready" | "pending" | "unknown"> {
  return (await folderCheck(url)).state;
}

/** «Avisarme cuando un libro está hecho». Prendido salvo que lo apague. */
export async function bookDoneAlertOn(): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", "book_done_alert").maybeSingle();
  return (data?.value as { on?: boolean } | null)?.on !== false;
}
export async function setBookDoneAlert(on: boolean) {
  await db.from("app_settings").upsert({ key: "book_done_alert", value: { on }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/**
 * Revisa las carpetas de todo lo que está en preventa y marca listo lo que ya tiene el PDF
 * (presale=false, content_ready_at). Devuelve los libros que pasaron a listos. La corre el repaso
 * de avisos; como mucho una vez cada 15 minutos (app_settings «presale_scan»), salvo `force`.
 */
type Leftover = { id: string; name: string; storeId: string; files: { id: string; title: string }[] };
export async function scanPresaleFolders(force = false): Promise<{ ready: { id: string; name: string; storeId: string }[]; checked: number; skipped?: boolean; leftovers: Leftover[]; cleared: string[] }> {
  const { data: last } = await db.from("app_settings").select("value").eq("key", "presale_scan").maybeSingle();
  const at = Number((last?.value as { at?: number } | null)?.at ?? 0);
  if (!force && Date.now() - at < 15 * 60_000) return { ready: [], checked: 0, skipped: true, leftovers: [], cleared: [] };
  await db.from("app_settings").upsert({ key: "presale_scan", value: { at: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "key" });

  const { data } = await db.from("products").select("id,short_name,name,store_id,delivery_url,variant_of").eq("presale", true);
  const rows = (data ?? []) as { id: string; short_name: string | null; name: string; store_id: string; delivery_url: string | null; variant_of: string | null }[];
  const byFolder = new Map<string, FolderCheck>();
  const ready: { id: string; name: string; storeId: string }[] = [];
  for (const p of rows) {
    const key = p.delivery_url ?? "";
    if (!byFolder.has(key)) byFolder.set(key, await folderCheck(p.delivery_url));
    const chk = byFolder.get(key)!;
    if (chk.state !== "ready") continue;
    await db.from("products").update({ presale: false, content_ready_at: new Date().toISOString(), ready_files: chk.files, leftover_notices: chk.notices.length ? chk.notices : null }).eq("id", p.id);
    ready.push({ id: p.variant_of ?? p.id, name: p.short_name || p.name, storeId: p.store_id });
  }
  // Los que quedaron con el aviso de preventa al lado del libro: se vuelven a mirar hasta que alguien lo borre.
  const { data: dirty } = await db.from("products").select("id,short_name,name,store_id,delivery_url,variant_of").eq("presale", false).not("leftover_notices", "is", null);
  const leftovers = new Map<string, Leftover>();
  const cleared = new Set<string>();
  for (const p of [...((dirty ?? []) as typeof rows), ...rows]) {
    const key = p.delivery_url ?? "";
    if (!byFolder.has(key)) byFolder.set(key, await folderCheck(p.delivery_url));
    const chk = byFolder.get(key)!;
    if (chk.state === "unknown") continue;
    const base = p.variant_of ?? p.id;
    if (chk.state === "ready" && chk.notices.length) leftovers.set(base, { id: base, name: p.short_name || p.name, storeId: p.store_id, files: chk.notices });
    else if (chk.state === "ready") cleared.add(base);
    if (!rows.includes(p)) await db.from("products").update({ leftover_notices: chk.notices.length ? chk.notices : null }).eq("id", p.id);
  }
  return { ready: [...new Map(ready.map((r) => [r.id, r])).values()], checked: byFolder.size, leftovers: [...leftovers.values()], cleared: [...cleared].filter((c) => !leftovers.has(c)) };
}
