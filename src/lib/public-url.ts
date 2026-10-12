/**
 * ¿Este link puede ir en un mail a un comprador? Solo https en un dominio
 * público: nunca localhost, una IP, una red privada, un nombre interno ni la
 * dirección de una preview de Vercel. Un link así funciona en la compu de
 * quien corrió el código y en el mail del comprador da error (pasó: el
 * seguimiento quedó apuntando a http://localhost:3077 en un mail de prueba).
 *
 * Sin dependencias a propósito: lo prueba scripts/check-public-url.mjs sin
 * levantar la app.
 */

const PRIVATE_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|example|invalid|vercel\.app|ngrok\.io|ngrok-free\.app|ngrok\.app|trycloudflare\.com|loca\.lt)$/;

/** El origen (https://host) si sirve para un mail; si no, null. */
export function publicOrigin(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  // Un puerto explícito es de una máquina de desarrollo o un túnel, no de un dominio público.
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h || !h.includes(".")) return null;
  // IPs (v4 o v6): ningún dominio nuestro se usa por IP.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[") || h.includes(":")) return null;
  if (PRIVATE_SUFFIX.test(h)) return null;
  // Etiquetas de dominio válidas y un TLD de letras.
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return null;
  return `https://${h}`;
}

/** ¿El link entero (no solo su origen) puede ir en un mail? */
export const isPublicUrl = (url: string | null | undefined) => !!url && /^https:\/\//i.test(url.trim()) && publicOrigin(url) !== null;
