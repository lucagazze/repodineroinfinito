import type { NextConfig } from "next";

/**
 * Landings servidas por la app (opcional, se leen al compilar):
 *  - LANDING_DOMAINS="tumarca.com,otramarca.com": en <oferta>.tumarca.com/<idioma> se sirve
 *    public/lp/<oferta>/<idioma>/index.html (con sus imágenes relativas). El checkout de esa oferta en el mismo
 *    subdominio (checkout_host + checkout_path) y la raíz → /<idioma> los resuelve src/middleware.ts. Landing y
 *    checkout en el mismo dominio = la misma cookie del píxel desde el anuncio hasta la compra.
 *  - LANDING_PROXIES="sitio=https://www.tumarca.com,otro=https://www.otramarca.com": /l/<alias>/<ruta> muestra
 *    esa página del sitio de la marca desde el dominio de la app (sin moverla de su repo).
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const landingDomains = (process.env.LANDING_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
const landingProxies = (process.env.LANDING_PROXIES ?? "").split(",").map((x) => x.trim().split("=")).filter((p) => p.length === 2 && /^[a-z0-9-]+$/.test(p[0]) && /^https:\/\//.test(p[1]))
  .map(([alias, url]) => ({ alias, url: url.replace(/\/+$/, "") }));

const config: NextConfig = {
  // No usamos next/image: todas las tapas van con <img>. Apagar el
  // optimizador deja inerte /_next/image y con eso la superficie de sharp.
  images: { unoptimized: true },
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: landingDomains.length
        ? [{
            source: "/:lang(en|it|es|pt|fr|de|pl|nl)",
            has: [{ type: "host" as const, value: `(?<sub>[a-z0-9-]+)\\.(?:${landingDomains.map(esc).join("|")})` }],
            destination: "/lp/:sub/:lang/index.html",
          }]
        : [],
      afterFiles: landingProxies.map((p) => ({ source: `/l/${p.alias}/:path*`, destination: `${p.url}/:path*` })),
      fallback: [],
    };
  },
  // Varios servidores de prueba en paralelo (uno por persona/agente) sin pisarse la compilación.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  experimental: {
    // Las tapas se suben por server action: el límite por defecto es 1 MB y
    // cualquier PNG de portada lo supera.
    serverActions: { bodySizeLimit: "12mb" },
    // Volver a una página vista hace menos de 30 s no
    // vuelve a pedirla. Guardar algo la invalida igual (revalidatePath/Tag).
    staleTimes: { dynamic: 30, static: 300 },
  },
};

export default config;
