import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { Suspense } from "react";
import { ThemeSync } from "@/components/admin/Theme";
import NavProgress from "@/components/admin/NavProgress";
import { THEME_SCRIPT } from "@/components/admin/theme-script";
import { ADMIN_ICONS } from "@/components/admin/Logo";
import { fontVars } from "@/components/admin/fonts";
import "@/components/admin/admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Panel", robots: { index: false }, icons: ADMIN_ICONS };
export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

/**
 * App instalable (PWA), solo en el panel. Van como etiquetas y no en
 * `metadata`: Next 15 manda la metadata al final del <body> y Chrome solo lee
 * el manifest en el <head> (React sube estas etiquetas solo al <head>).
 */
const PWA_HEAD = (
  <>
    <link rel="manifest" href="/admin/manifest.webmanifest" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Panel" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  </>
);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // El login vive en /entrar, fuera de este layout: todo lo que cuelga de
  // /admin exige sesión sin excepciones que se puedan olvidar.
  if (!(await isLoggedIn())) redirect("/entrar");
  return (
    // suppressHydrationWarning: el script de abajo puede sumar "dark" antes de que React tome la página.
    // Siempre oscuro: la clase sale del servidor, así no hay destello claro al cargar.
    <div className={`ad-root dark ${fontVars}`} suppressHydrationWarning>
      {PWA_HEAD}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ThemeSync />
      {/* Barra de «cargando» al tocar un link: respuesta inmediata aunque la página tarde. */}
      <Suspense fallback={null}><NavProgress /></Suspense>
      {children}
    </div>
  );
}
