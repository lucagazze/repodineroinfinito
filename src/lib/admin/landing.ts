import { unstable_cache } from "next/cache";

/**
 * ¿La landing se deja mostrar en un iframe? Muchos sitios lo prohíben
 * (X-Frame-Options o CSP frame-ancestors) y el navegador no avisa: el iframe
 * queda en blanco. Se mira cada 10 minutos desde el servidor y, si no se
 * puede, el panel muestra una tarjeta con el link en vez de la vista previa.
 * Solo cuentan esos encabezados: una landing que todavía da 404 (recién
 * publicada) se puede mostrar igual, así no queda «sin vista previa» por una hora.
 */
export const canFrame = (url: string) =>
  unstable_cache(
    async () => {
      try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0 (checkout panel)" } });
        const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
        if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
        const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
        const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim();
        if (fa && !fa.split(/\s+/).includes("*")) return false;
        return true;
      } catch {
        return false;
      }
    },
    ["landing-frame-v2", url],
    { revalidate: 600 },
  )();
