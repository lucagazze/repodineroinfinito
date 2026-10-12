/**
 * De qué red social vino una visita o una compra, cuando se puede saber:
 *  - el navegador de adentro de la app (el user agent dice «Instagram» o FBAN/FBAV/FB_IAB),
 *  - de dónde venía (instagram.com, facebook.com, l.facebook.com, messenger.com),
 *  - o el utm_source si nombra la red sin dudas (ig, instagram, msg, messenger, an).
 * «FB»/«facebook»/«meta» en utm_source NO alcanzan: la plantilla de los anuncios pone
 * «FB» para todo Meta (también Instagram). Sin señal, queda sin red: no se inventa.
 * Sin imports: lo usan el servidor y el navegador.
 */
export type Network = "Instagram" | "Facebook" | "Messenger" | "Audience Network";

export function networkOf(x: { ua?: string | null; browser?: string | null; refHost?: string | null; utmSource?: string | null }): Network | null {
  const ua = x.ua ?? "", b = (x.browser ?? "").toLowerCase();
  if (/Instagram/i.test(ua) || b === "instagram") return "Instagram";
  // Messenger antes que Facebook: su navegador también dice FBAN («FBAN/MessengerForiOS»).
  if (/MessengerForiOS|MessengerLite|Orca-Android/i.test(ua) || b === "messenger") return "Messenger";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBMD/.test(ua) || b === "facebook") return "Facebook";
  const ref = (x.refHost ?? "").toLowerCase().replace(/^www\./, "");
  if (/(^|\.)instagram\.com$/.test(ref)) return "Instagram";
  if (/(^|\.)messenger\.com$/.test(ref)) return "Messenger";
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/.test(ref)) return "Facebook";
  const s = (x.utmSource ?? "").toLowerCase().trim();
  if (/^(ig|instagram)$/.test(s)) return "Instagram";
  if (/^(msg|messenger)$/.test(s)) return "Messenger";
  if (/^(an|audience[ _-]?network)$/.test(s)) return "Audience Network";
  return null;
}
