import { createHash } from "crypto";
import { db } from "../db";
import { getRates } from "../fx";
import { localeFromCountry } from "../i18n";
import { parseDate, readSheet, type Sheet } from "./sheet";

/**
 * Contactos de marketing: los compradores de la app (mkt_sync, en la base) y
 * los de la plataforma anterior, que entran por el Excel «Ventas realizadas → Exportar
 * XLSX» (o cualquier CSV con email). Cada pedido importado queda en
 * mkt_import_orders con su número de orden: reimportar no duplica.
 */

export async function syncContacts(storeId?: string | null) {
  const { data, error } = await db.rpc("mkt_sync", { p_store: storeId ?? null });
  if (error) throw new Error(`No se pudieron actualizar los contactos: ${error.message}`);
  return data as { nuevos: number; leads_nuevos: number; bajas: number; rebotes: number };
}

/** Sincroniza si la última vez fue hace más de `maxMin` minutos (la página de Contactos y el envío). */
export async function syncIfStale(storeId: string, maxMin = 15) {
  const { data } = await db.from("mkt_store_settings").select("synced_at").eq("store_id", storeId).maybeSingle();
  if (data?.synced_at && Date.now() - +new Date(data.synced_at) < maxMin * 60_000) return null;
  return syncContacts(storeId);
}

// ------------------------------------------------------------------ importar

export const FIELDS = ["email", "name", "products", "country", "date", "total", "currency", "status", "order", "locale"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, string>>;
export const FIELD_ES: Record<Field, string> = {
  email: "Email", name: "Nombre", products: "Productos", country: "País", date: "Fecha", total: "Total",
  currency: "Moneda", status: "Estado del pago", order: "N.º de orden", locale: "Idioma",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const SYN: Record<Field, string[]> = {
  email: ["email", "e mail", "mail", "correo", "correo electronico", "customer email"],
  name: ["nombre", "name", "cliente", "nombre completo", "full name", "customer", "first name"],
  products: ["productos", "producto", "products", "product", "items", "articulos"],
  country: ["pais", "country", "pais cliente", "country code"],
  date: ["fecha", "date", "created at", "fecha de compra", "order date", "creado"],
  total: ["total", "monto", "importe", "amount", "cobrado"],
  currency: ["moneda", "currency", "moneda cobro"],
  status: ["estadopago", "estado pago", "estado", "status", "payment status"],
  order: ["orden", "order", "n orden", "numero", "order number", "pedido", "id"],
  locale: ["idioma", "language", "locale", "lang"],
};

export function autoMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    const hit = headers.find((h) => !used.has(h) && SYN[f].includes(norm(h)))
      ?? headers.find((h) => !used.has(h) && SYN[f].some((s) => norm(h).startsWith(s)));
    if (hit) { out[f] = hit; used.add(hit); }
  }
  return out;
}

/** «Nombre (Principal) x1 - 19.90 | Otro (Upsell) x1 - 7.00» → nombres (también sirve para una lista con comas). */
export function productNames(cell: string): string[] {
  const s = cell.trim();
  if (!s) return [];
  const parts = s.includes(" | ") ? s.split(" | ") : s.includes("|") ? s.split("|") : [s];
  return parts.map((p) => p.trim().replace(/\s*\((Principal|Upsell|Bonus|Bump|Downsell)\)\s*x\d+(\s*-\s*[\d.,]+)?$/i, "").replace(/\s*x\d+\s*$/i, "").trim()).filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAID = /^(aprobad[oa]|approved|paid|pagad[oa]|completad[oa]|completed|succeeded|exitos[oa])$/i;
const REFUNDED = /^(reembolsad[oa]|refunded|devuelt[oa]|disputad[oa]|disputed|chargeback|contracargo)$/i;

type StoreProduct = { id: string; name: string; short_name: string | null };

/** Sugerencia de producto de la app para un nombre del Excel (por palabras en común). */
function suggest(name: string, prods: StoreProduct[]): string | null {
  const stop = new Set(["kit", "il", "la", "le", "de", "di", "the", "and", "e", "y", "et", "und", "del", "della", "pdf", "libro", "book"]);
  const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1 && !stop.has(w)));
  const a = words(name);
  if (!a.size) return null;
  let best: { id: string; score: number } | null = null;
  for (const p of prods) {
    for (const cand of [p.name, p.short_name ?? ""]) {
      const b = words(cand);
      if (!b.size) continue;
      const inter = [...a].filter((w) => b.has(w)).length;
      const score = inter / Math.max(a.size, b.size);
      if (score > (best?.score ?? 0)) best = { id: p.id, score };
    }
  }
  return best && best.score >= 0.5 ? best.id : null;
}

export type ImportOrder = {
  ref: string; email: string; name: string | null; country: string | null; locale: string | null; ordered_at: string | null;
  names: string[]; total: number | null; currency: string | null; usd: number; status: "paid" | "refunded";
};

function toOrders(sheet: Sheet, map: Mapping, rates: Record<string, number>) {
  const get = (r: Record<string, string>, f: Field) => (map[f] ? (r[map[f]!] ?? "").trim() : "");
  const orders: ImportOrder[] = [];
  let invalid = 0, notPaid = 0;
  for (const r of sheet.rows) {
    const email = get(r, "email").toLowerCase();
    if (!EMAIL.test(email)) { invalid++; continue; }
    const st = get(r, "status");
    const status: "paid" | "refunded" | null = !map.status || !st || PAID.test(st) ? "paid" : REFUNDED.test(st) ? "refunded" : null;
    if (!status) { notPaid++; continue; }
    const country = get(r, "country").toUpperCase().slice(0, 2) || null;
    const d = parseDate(get(r, "date"));
    const total = Number(get(r, "total").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || null;
    const currency = get(r, "currency").toUpperCase().slice(0, 3) || null;
    const rate = currency ? (currency === "USD" ? 1 : rates[currency]) : null;
    const names = productNames(get(r, "products"));
    const loc = get(r, "locale").toLowerCase();
    const locale = ["it", "en", "es", "fr", "de"].includes(loc.slice(0, 2)) ? loc.slice(0, 2) : loc.startsWith("pt") ? "pt-BR" : country ? localeFromCountry(country) : null;
    const orderNo = get(r, "order");
    const ref = orderNo ? `o:${orderNo}` : `h:${createHash("sha1").update([email, d?.toISOString() ?? "", names.join("|"), total ?? ""].join("\n")).digest("hex").slice(0, 20)}`;
    orders.push({
      ref, email, name: get(r, "name") || null, country, locale, ordered_at: d?.toISOString() ?? null, names,
      total, currency, usd: total && rate ? Math.round((total / rate) * 100) / 100 : 0, status,
    });
  }
  return { orders, invalid, notPaid };
}

export type ImportPreview = {
  fileRows: number; headers: string[]; mapping: Mapping; orders: number; invalid: number; notPaid: number; refunded: number;
  contacts: number; existing: number; newOnes: number;
  products: { name: string; count: number; suggestion: string | null }[];
  sample: { email: string; name: string | null; country: string | null; date: string | null; products: string[] }[];
};

export async function importPreview(storeId: string, buf: Buffer, fileName: string, mapping?: Mapping): Promise<ImportPreview> {
  const sheet = readSheet(buf, fileName);
  if (!sheet.headers.length) throw new Error("El archivo está vacío");
  const map = mapping && Object.keys(mapping).length ? mapping : autoMapping(sheet.headers);
  if (!map.email) throw new Error("No encontré la columna del email: elegila en «Columnas»");
  const [rates, { data: prods }] = await Promise.all([
    getRates(), db.from("products").select("id,name,short_name").eq("store_id", storeId),
  ]);
  const { orders, invalid, notPaid } = toOrders(sheet, map, rates);
  const emails = [...new Set(orders.map((o) => o.email))];
  let existing = 0;
  for (let i = 0; i < emails.length; i += 300) {
    const { count } = await db.from("mkt_contacts").select("id", { count: "exact", head: true }).eq("store_id", storeId).in("email", emails.slice(i, i + 300));
    existing += count ?? 0;
  }
  const counts = new Map<string, number>();
  for (const o of orders) for (const n of o.names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const latest = new Map<string, ImportOrder>();
  for (const o of orders) if (!latest.has(o.email)) latest.set(o.email, o);
  return {
    fileRows: sheet.rows.length, headers: sheet.headers, mapping: map, orders: orders.length, invalid, notPaid,
    refunded: orders.filter((o) => o.status === "refunded").length,
    contacts: emails.length, existing, newOnes: emails.length - existing,
    products: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)
      .map(([name, count]) => ({ name, count, suggestion: suggest(name, (prods ?? []) as StoreProduct[]) })),
    sample: [...latest.values()].slice(0, 8).map((o) => ({ email: o.email, name: o.name, country: o.country, date: o.ordered_at, products: o.names })),
  };
}

/** Importa: guarda los pedidos (sin duplicar por número de orden) y arma/actualiza los contactos. */
export async function importCommit(storeId: string, buf: Buffer, fileName: string, mapping: Mapping, productMap: Record<string, string>) {
  const sheet = readSheet(buf, fileName);
  if (!mapping.email) throw new Error("Falta la columna del email");
  const rates = await getRates();
  const { orders, invalid, notPaid } = toOrders(sheet, mapping, rates);
  const { data: valid } = await db.from("products").select("id").eq("store_id", storeId);
  const ok = new Set((valid ?? []).map((p) => p.id as string));
  const { data: imp, error: e0 } = await db.from("mkt_imports").insert({
    store_id: storeId, file_name: fileName.slice(0, 200), rows: sheet.rows.length, contacts: new Set(orders.map((o) => o.email)).size,
    skipped: invalid + notPaid, mapping: { columns: mapping, products: productMap },
  }).select("id").single();
  if (e0) throw new Error(e0.message);
  const rows = orders.map((o) => ({
    store_id: storeId, ref: o.ref, email: o.email, name: o.name, country: o.country, locale: o.locale, ordered_at: o.ordered_at,
    names: o.names, products: [...new Set(o.names.map((n) => productMap[n]).filter((id): id is string => !!id && ok.has(id)))],
    total: o.total, currency: o.currency, usd: o.usd, status: o.status, import_id: imp.id,
  }));
  // Un mismo número de orden repetido en el archivo: queda la última fila.
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const list = [...byRef.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await db.from("mkt_import_orders").upsert(list.slice(i, i + 500), { onConflict: "store_id,ref" });
    if (error) throw new Error(`No se pudieron guardar los pedidos importados: ${error.message}`);
  }
  const { data: res, error } = await db.rpc("mkt_import_apply", { p_store: storeId });
  if (error) throw new Error(`No se pudieron armar los contactos: ${error.message}`);
  const r = res as { nuevos: number; actualizados: number };
  await db.from("mkt_imports").update({ created: r.nuevos, updated: Math.max(0, r.actualizados - r.nuevos) }).eq("id", imp.id);
  return { pedidos: list.length, nuevos: r.nuevos, actualizados: Math.max(0, r.actualizados - r.nuevos), salteados: invalid + notPaid };
}
