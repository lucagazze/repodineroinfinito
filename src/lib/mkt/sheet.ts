import { inflateRawSync } from "zlib";

/**
 * Lee un CSV o un XLSX (el «Exportar XLSX» de la plataforma anterior) sin librerías:
 * el XLSX es un zip con XML adentro; se descomprime con zlib y se leen la
 * primera hoja y los textos compartidos. Devuelve las filas como objetos
 * {encabezado: valor} (todo texto).
 */

export type Sheet = { headers: string[]; rows: Record<string, string>[] };

export function readSheet(buf: Buffer, fileName: string): Sheet {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(fileName)) return readXlsx(buf);
  return readCsv(buf.toString("utf8"));
}

// ------------------------------------------------------------------ CSV

function readCsv(text: string): Sheet {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.slice(0, t.indexOf("\n") >= 0 ? t.indexOf("\n") : t.length);
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return toSheet(out);
}

function toSheet(grid: string[][]): Sheet {
  if (!grid.length) return { headers: [], rows: [] };
  const seen = new Map<string, number>();
  const headers = grid[0].map((h, i) => {
    const base = (h ?? "").trim() || `Columna ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
  const rows = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

// ------------------------------------------------------------------ XLSX

function unzip(buf: Buffer): Map<string, Buffer> {
  // Fin del directorio central: firma 0x06054b50 cerca del final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel válido (.xlsx)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
  }
  return files;
}

const xmlText = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function readXlsx(buf: Buffer): Sheet {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of ss.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    shared.push(xmlText((si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<t\b[^>]*>|<\/t>/g, "")).join("")));
  }
  // La primera hoja según el libro (si no, sheet1).
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const rid = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : null;
  if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const xml = (files.get(sheetPath) ?? [...files.entries()].find(([k]) => k.startsWith("xl/worksheets/"))?.[1])?.toString("utf8");
  if (!xml) throw new Error("El Excel no tiene hojas");
  const grid: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const row: string[] = [];
    for (const c of rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = c.match(/\bt="([a-zA-Z]+)"/)?.[1];
      let v = "";
      if (type === "inlineStr") v = xmlText((c.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<t\b[^>]*>|<\/t>/g, "")).join(""));
      else {
        const raw = c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        v = type === "s" ? shared[Number(raw)] ?? "" : xmlText(raw);
      }
      const idx = ref ? colIndex(ref) : row.length;
      row[idx] = v;
    }
    grid.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ""));
  }
  return toSheet(grid.filter((r) => r.some((c) => c.trim())));
}

/** Fecha de una celda: ISO, dd/mm/aaaa (con hora opcional) o número de serie de Excel. */
export function parseDate(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400_000));
  }
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const d = new Date(Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 12), Number(dmy[5] ?? 0), Number(dmy[6] ?? 0)));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
