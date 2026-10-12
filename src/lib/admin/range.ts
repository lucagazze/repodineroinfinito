/**
 * El rango de fechas del panel presets (Hoy, Ayer,
 * Últimos 3/7/14/30 días, Este mes, Mes anterior, Este año, Año pasado) o
 * un rango propio del calendario. Vive en la URL (?r=7d o ?desde=&hasta=)
 * para que pase de una sección a otra y se pueda compartir. Los días son de
 * Argentina (PANEL_TZ): todo el panel usa esa hora (así coincide con los
 * envíos y con la cuenta de Meta, que también está en hora de Buenos Aires).
 * Antes era Londres. Las páginas y mails del comprador no usan esto.
 *
 * «Últimos N días» son N días CONTANDO HOY (hoy y los N−1 anteriores), y
 * «Este mes» y «Este año» llegan hasta hoy: un total nunca puede ser menor que
 * lo de Hoy (el dueño vio una venta en Hoy y 0 en «7 días»). Ojo: el período
 * anterior son días completos y hoy todavía no terminó.
 *
 * Sin imports de servidor: lo usan el selector (cliente) y las páginas.
 */

/** La zona horaria de todo el panel (días, «hoy», horas, gráficos). Cambiarla acá la cambia en todos lados. */
export const PANEL_TZ = "America/Argentina/Buenos_Aires";
export const PANEL_TZ_LABEL = "Hora de Argentina";
export const RANGE_TZ = PANEL_TZ;
export const DEFAULT_PRESET = "7d";

export const PRESETS: [string, string][] = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["3d", "Últimos 3 días"],
  ["7d", "Últimos 7 días"],
  ["14d", "Últimos 14 días"],
  ["30d", "Últimos 30 días"],
  ["mes", "Este mes"],
  ["mes-anterior", "Mes anterior"],
  ["anio", "Este año"],
  ["anio-anterior", "Año pasado"],
];
const LABEL = Object.fromEntries(PRESETS);

export type Range = { since: string; until: string; preset: string | null; label: string; days: number };

export const todayIn = (tz = RANGE_TZ, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export function shift(day: string, n: number) {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const daysIn = (since: string, until: string) =>
  Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / 864e5) + 1;

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export function presetRange(preset: string, today = todayIn()): { since: string; until: string } | null {
  const y = shift(today, -1);
  const [Y, M] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = (n: number) => ({ since: shift(today, -(n - 1)), until: today });
  switch (preset) {
    case "hoy": return { since: today, until: today };
    case "ayer": return { since: y, until: y };
    case "3d": return last(3);
    case "7d": return last(7);
    case "14d": return last(14);
    case "30d": return last(30);
    case "mes": return { since: `${Y}-${pad(M)}-01`, until: today };
    case "mes-anterior": {
      const py = M === 1 ? Y - 1 : Y, pm = M === 1 ? 12 : M - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { since: `${py}-${pad(pm)}-01`, until: `${py}-${pad(pm)}-${pad(last)}` };
    }
    case "anio": return { since: `${Y}-01-01`, until: today };
    case "anio-anterior": return { since: `${Y - 1}-01-01`, until: `${Y - 1}-12-31` };
    default: return null;
  }
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fmtShort(day: string, withYear = false) {
  const [y, m, d] = day.split("-");
  const thisYear = todayIn().slice(0, 4);
  return `${Number(d)} ${MESES[Number(m) - 1]}${withYear || y !== thisYear ? ` ${y}` : ""}`;
}
export const rangeText = (since: string, until: string) => (since === until ? fmtShort(since) : `${fmtShort(since)} – ${fmtShort(until)}`);

/** El rango pedido en la URL, o el por defecto (7 días). */
export function resolveRange(sp: { r?: string; desde?: string; hasta?: string }): Range {
  const today = todayIn();
  if (isDay(sp.desde)) {
    let since = sp.desde, until = isDay(sp.hasta) ? sp.hasta : sp.desde;
    if (until < since) [since, until] = [until, since];
    if (until > today) until = today;
    if (since > today) since = today;
    return { since, until, preset: null, label: rangeText(since, until), days: daysIn(since, until) };
  }
  const preset = sp.r && LABEL[sp.r] ? sp.r : DEFAULT_PRESET;
  const r = presetRange(preset, today)!;
  return { ...r, preset, label: LABEL[preset], days: daysIn(r.since, r.until) };
}

/** El período anterior del mismo largo, para comparar. */
export function previousOf(r: { since: string; until: string }) {
  const n = daysIn(r.since, r.until);
  return { since: shift(r.since, -n), until: shift(r.since, -1) };
}

/** Los parámetros del rango para sumar a un link (vacío = el por defecto). */
export function rangeQuery(sp: URLSearchParams | { get(k: string): string | null }) {
  const q = new URLSearchParams();
  const d = sp.get("desde"), h = sp.get("hasta"), r = sp.get("r");
  if (d) { q.set("desde", d); if (h) q.set("hasta", h); }
  else if (r && r !== DEFAULT_PRESET) q.set("r", r);
  return q.toString();
}
