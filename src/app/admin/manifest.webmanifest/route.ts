/**
 * Manifest de la app instalable del panel (PWA). Solo lo enlaza el layout de
 * /admin: los checkouts y catálogos públicos no se ofrecen para instalar.
 *
 * scope "/" para que el login (/entrar, /auth) también quede dentro de la app:
 * fuera del scope, el iPhone abre la página en un navegador aparte y la
 * sesión puede no llegar a la app instalada (tiene sus propias cookies).
 */
export const dynamic = "force-static";

const manifest = {
  id: "/admin",
  name: "Panel",
  short_name: "Panel",
  description: "Panel de ventas",
  lang: "es-AR",
  start_url: "/admin",
  scope: "/",
  display: "standalone",
  background_color: "#f5f5f7",
  theme_color: "#ffffff",
  icons: [
    { src: "/brand/icon-192.png?v=3", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/brand/icon-maskable-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [{ name: "En vivo", url: "/admin/en-vivo", icons: [{ src: "/brand/icon-192.png?v=3", sizes: "192x192" }] }],
};

export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" },
  });
}
