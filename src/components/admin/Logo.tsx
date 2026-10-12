/**
 * Marca de la app: reemplazar los archivos de public/brand (logo-app.webp + favicons e íconos) por los propios. Solo en el panel y el login,
 * nunca en páginas del comprador.
 */
export function LogoMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-app.webp?v=3" alt="" width={size} height={size} className="block h-full w-full object-contain" />
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={compact ? 32 : 42} />
      <div className="flex flex-col">
        <span className={`font-display font-bold leading-none tracking-tighter text-zinc-900 dark:text-white ${compact ? "text-[15px]" : "text-[17px]"}`}>Panel</span>
        {!compact && <span className="mt-1 whitespace-nowrap text-[8.5px] font-bold uppercase tracking-[0.16em] text-violet-500">Panel de control</span>}
      </div>
    </div>
  );
}

/** Íconos de la pestaña: solo /admin y /entrar los declaran (las páginas del comprador muestran los de cada tienda). */
export const ADMIN_ICONS = {
  icon: [
    { url: "/brand/favicon-48x48.png?v=3", sizes: "48x48", type: "image/png" },
    { url: "/brand/favicon-32x32.png?v=3", sizes: "32x32", type: "image/png" },
    { url: "/brand/favicon-16x16.png?v=3", sizes: "16x16", type: "image/png" },
  ],
  apple: [{ url: "/brand/apple-touch-icon.png?v=3", sizes: "180x180" }],
};
