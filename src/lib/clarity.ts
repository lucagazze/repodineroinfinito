/**
 * Microsoft Clarity (grabaciones de sesión). Cada sitio usa el proyecto que
 * ya carga su landing, así landing → checkout → pos-pago quedan en el mismo
 * proyecto y, en el mismo dominio, en la misma grabación. Cada página manda
 * clarity("identify", visitor_id): el panel filtra por ese Custom user ID.
 * Sirve en el navegador (track-client) y en el servidor (panel).
 */

export const CLARITY_DEFAULT = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

/**
 * Un proyecto por sitio. Clarity mezcla las grabaciones de dominios distintos
 * dentro del mismo proyecto, asi que Finance y Physics tienen que ir separados.
 * El mapa va por env y no por base porque esto corre en el navegador:
 *
 *   NEXT_PUBLIC_CLARITY_IDS=financestudylab:abc123,physicstudylab:def456
 *
 * La clave es el slug de la tienda o el dominio (lo que coincida primero).
 * Sin mapa, todo cae en NEXT_PUBLIC_CLARITY_ID, que es como venia.
 */
const MAPA: Record<string, string> = Object.fromEntries(
  (process.env.NEXT_PUBLIC_CLARITY_IDS ?? "")
    .split(",")
    .map((par) => par.trim().split(":").map((s) => s.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1])
);

export function clarityProject(o: { store?: string | null; host?: string | null }): string {
  if (o.store && MAPA[o.store]) return MAPA[o.store];
  // El host llega con subdominio (pay.financestudylab.com): se prueba entero y
  // despues sacando una etiqueta por vez, para que «financestudylab.com»
  // alcance para todos sus subdominios.
  const host = (o.host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (host) {
    const partes = host.split(".");
    for (let i = 0; i < partes.length - 1; i++) {
      const cand = partes.slice(i).join(".");
      if (MAPA[cand]) return MAPA[cand];
    }
  }
  return CLARITY_DEFAULT;
}

/** Grabaciones de un visitante (últimos 30 días, filtro «Custom user ID = vid»). */
export function clarityRecordingsUrl(project: string, vid: string) {
  return `https://clarity.microsoft.com/projects/view/${project}/impressions?date=${encodeURIComponent("Last 30 days")}&CustomUserId=${encodeURIComponent(`is;${vid}`)}`;
}
