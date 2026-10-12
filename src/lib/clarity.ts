/**
 * Microsoft Clarity (grabaciones de sesión). Cada sitio usa el proyecto que
 * ya carga su landing, así landing → checkout → pos-pago quedan en el mismo
 * proyecto y, en el mismo dominio, en la misma grabación. Cada página manda
 * clarity("identify", visitor_id): el panel filtra por ese Custom user ID.
 * Sirve en el navegador (track-client) y en el servidor (panel).
 */

export const CLARITY_DEFAULT = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

export function clarityProject(_o: { store?: string | null; host?: string | null }): string {
  return CLARITY_DEFAULT;
}

/** Grabaciones de un visitante (últimos 30 días, filtro «Custom user ID = vid»). */
export function clarityRecordingsUrl(project: string, vid: string) {
  return `https://clarity.microsoft.com/projects/view/${project}/impressions?date=${encodeURIComponent("Last 30 days")}&CustomUserId=${encodeURIComponent(`is;${vid}`)}`;
}
