import { Library } from "lucide-react";
import { db } from "@/lib/db";

/**
 * «Portal» en la barra de arriba: el portal de clientes
 * con TODO el contenido de cada tienda (vista de administrador), y la página para ver el de un comprador.
 */
/**
 * Tiendas con portal de clientes: las activas (sin las de prueba) con subdominio propio de biblioteca o dominio de pago.
 * El «demo» de cada una sale de PORTAL_DEMO_EMAILS («slug=email-de-un-comprador-de-prueba,otra=...»); sin eso, solo
 * aparece el portal con todo el contenido.
 */
async function portalStores(): Promise<{ slug: string; name: string; demo: string | null }[]> {
  const demos = new Map((process.env.PORTAL_DEMO_EMAILS ?? "").split(",").map((x) => x.trim().split("=")).filter((p) => p.length === 2 && p[0] && p[1]).map(([a, b]) => [a.trim(), b.trim()] as [string, string]));
  const { data } = await db.from("stores").select("slug,name,display_name,domain,library_domain,is_test").eq("active", true).order("name");
  return (data ?? [])
    .filter((s) => !s.is_test && (s.library_domain || s.domain))
    .map((s) => ({ slug: s.slug as string, name: (s.display_name || s.name) as string, demo: demos.get(s.slug as string) ?? null }));
}

export default async function PortalButton({ label }: { label?: boolean }) {
  const STORES = await portalStores().catch(() => []);
  if (!STORES.length) return null;
  const DEMOS = STORES.flatMap((s) => (s.demo ? [{ slug: s.slug, name: s.name, demo: s.demo }] : []));
  return (
    <details className="relative">
      <summary title="Portal de clientes (Mi biblioteca)"
        className={`flex h-8 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white [&::-webkit-details-marker]:hidden ${label ? "px-2.5 text-[11.5px] font-semibold" : "w-8"}`}>
        <Library className="h-4 w-4" />{label && "Portal"}
      </summary>
      <div className="absolute right-0 z-[400] mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 text-[12.5px] shadow-xl dark:border-white/10 dark:bg-zinc-900">
        <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-zinc-400">Portal con todo el contenido</p>
        {STORES.map((s) => (
          <a key={s.slug} href={`/api/admin/biblioteca?store=${s.slug}&all=1`} target="_blank" rel="noreferrer"
            className="block rounded-lg px-3 py-2 font-semibold text-zinc-800 no-underline hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/5">
            📚 {s.name}
          </a>
        ))}
        {DEMOS.length > 0 && <>
        <div className="my-1 h-px bg-zinc-100 dark:bg-white/[0.06]" />
        <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-zinc-400">Como lo ve un comprador (demo)</p>
        {DEMOS.map((s) => (
          <a key={s.demo} href={`/api/admin/biblioteca?store=${s.slug}&email=${encodeURIComponent(s.demo)}&as=buyer`} target="_blank" rel="noreferrer"
            className="block rounded-lg px-3 py-2 text-zinc-700 no-underline hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/5">
            👤 {s.demo} <span className="text-zinc-400">· {s.name}</span>
          </a>
        ))}
        </>}
        <div className="my-1 h-px bg-zinc-100 dark:bg-white/[0.06]" />
        <a href="/admin/biblioteca" className="block rounded-lg px-3 py-2 text-zinc-600 no-underline hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5">
          Ver el portal de un comprador →
        </a>
      </div>
    </details>
  );
}
