/**
 * La decisión de «este origen puede mandar eventos», sin base de datos ni
 * NextRequest, así la prueba la puede correr: scripts/test-origen-landing.mjs.
 */

export const hostOf = (u: string | null | undefined) => {
  if (!u) return "";
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).host.toLowerCase(); } catch { return ""; }
};

/** Host sin el puerto: lo que se compara contra las landings declaradas. */
export const bareHost = (h: string) => h.replace(/:\d+$/, "");

/**
 * `own`: hosts propios de la app (el de la petición y los de entorno).
 * `landings`: hosts declarados como landing de un checkout (funnels.landing_url).
 * Una landing estática vive en otro dominio que su checkout (www.lamarca.com y
 * pay.lamarca.com), así que su Origin NUNCA es el propio: sin esta lista, los
 * eventos de la landing se caen con 403 y el panel la ve con cero visitas.
 */
export function originAllowed(origin: string | null, ctx: { own: string[]; crossSite: boolean; landings: Set<string> }): boolean {
  // Sin Origin no hay nada que comparar: vale si el navegador no lo llama otro sitio.
  if (!origin) return !ctx.crossSite;
  const o = hostOf(origin);
  if (!o) return false;
  if (ctx.own.includes(o)) return true;
  const bare = bareHost(o);
  if (bare === "localhost" || bare === "127.0.0.1" || bare.endsWith(".vercel.app")) return true;
  return ctx.landings.has(bare);
}
