/**
 * Portadas y páginas en el tamaño en que se ven. Las imágenes viven en Supabase
 * Storage a tamaño completo (algunas portadas son PNG de 1–2 MB) y sin caché (`no-cache`): pasan por el endpoint de
 * transformación de Supabase, que las devuelve en WebP al ancho pedido y con caché de un año en su CDN. Las de otros
 * dominios (las landings) quedan como están.
 */
const SB = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/([^?#]+)(?:\?([^#]*))?$/i;

export function thumb(url: string, width: number, quality?: number): string;
export function thumb(url: string | null | undefined, width: number, quality?: number): string | null | undefined;
export function thumb(url: string | null | undefined, width: number, quality = 72) {
  const m = url ? SB.exec(url) : null;
  if (!m) return url;
  // resize=contain: solo con width, Supabase deja la altura original y recorta (una portada salía como una franja).
  return `${m[1]}/render/image/public/${m[2]}?width=${width}&resize=contain&quality=${quality}${m[3] ? `&${m[3]}` : ""}`;
}

/** Portada de una tarjeta de la grilla: 2 columnas en el celular, hasta 6 en pantallas grandes. */
export const coverImg = (url: string) => ({
  src: thumb(url, 400),
  srcSet: SB.test(url) ? `${thumb(url, 240)} 240w, ${thumb(url, 400)} 400w` : undefined,
  sizes: "(min-width:1180px) 230px, (min-width:640px) 31vw, 47vw",
});
