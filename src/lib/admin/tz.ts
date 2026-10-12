/**
 * Días en la zona horaria de la tienda. "Hoy" para una tienda de Italia no
 * empieza a la misma hora que para una de Buenos Aires, y el servidor corre
 * en UTC: sin esto, las ventas de la noche caen en el día equivocado.
 */

/** Minutos que la zona está adelantada respecto de UTC en ese instante. */
function offsetMin(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** La fecha (AAAA-MM-DD) de un instante en la zona. */
export function dayOf(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** El instante UTC en que empieza ese día en la zona (respeta el cambio de horario). */
export function startOfDay(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMin(new Date(guess), tz) * 60_000;
  t = guess - offsetMin(new Date(t), tz) * 60_000;
  return new Date(t);
}

export function addDays(day: string, n: number) {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Hora local (0-23, con fracción) de un instante en la zona. */
export function hourOf(at: Date, tz: string) {
  const local = new Date(at.getTime() + offsetMin(at, tz) * 60_000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

export const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-AR", { ...opts, timeZone: "UTC" });
}
