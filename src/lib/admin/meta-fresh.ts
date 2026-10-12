/** Más de 40 min sin sincronizar (el cron corre cada 15) = datos viejos. Sin dependencias del servidor: lo usa también la tabla de campañas. */
export const STALE_MS = 40 * 60_000;

/**
 * «Datos de Meta: actualizados hace X min» y, si la última sincronización
 * falló, por qué (en ámbar: se muestran igual las filas guardadas).
 */
export function freshness(s: { fetchedAt: number | null; error: string | null; stale?: boolean }, now = Date.now()) {
  const why = s.error ? (/limitó/.test(s.error) ? "Meta limitó las consultas; se reintenta solo" : `${s.error}; se reintenta solo`) : null;
  if (!s.fetchedAt) return { text: `Datos de Meta: todavía no se sincronizó${why ? ` · ${why}` : ""}`, warn: true };
  const min = Math.max(0, Math.round((now - s.fetchedAt) / 60_000));
  const ago = min < 1 ? "recién" : min < 60 ? `hace ${min} min` : min < 48 * 60 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
  return { text: `Datos de Meta: actualizados ${ago}${why ? ` · ${why}` : ""}`, warn: !!why || now - s.fetchedAt > STALE_MS };
}
