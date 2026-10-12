/**
 * CSV que Excel en español abre bien: BOM (tildes) + punto y coma (columnas)
 * + coma decimal. Sin imports de servidor: lo usan las rutas de exportación y
 * la tabla de Clientes (que arma el archivo en el navegador).
 */

/** Una celda: neutraliza fórmulas (= + - @) y entrecomilla lo que haga falta. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 1234.5 → «1234,50» (Excel en español lo toma como número). */
export const csvNum = (n: number, decimals = 2) => (Number.isFinite(n) ? n.toFixed(decimals).replace(".", ",") : "");

/** «2026-10-07 14:32» en la hora del panel. */
export function csvDate(iso: string | null | undefined, tz = "America/Argentina/Buenos_Aires"): string {
  if (!iso) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** El archivo entero, con BOM y saltos de Windows. */
export const toCsv = (head: string[], rows: unknown[][]) =>
  "﻿" + [head.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))].join("\r\n");
