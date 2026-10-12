import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PageHead } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { Pv } from "@/components/admin/Priv";
import { storeAlias } from "@/lib/admin/privacy";
import type { ReactNode } from "react";

/** Cabecera y pestañas de Email marketing (Campañas · Contactos · Segmentos · Ajustes). */
export function MktHead({ tab, sub, actions }: { tab: "campanas" | "contactos" | "segmentos" | "ajustes"; sub?: ReactNode; actions?: ReactNode }) {
  const items = [
    ["campanas", "Campañas"], ["contactos", "Contactos"], ["segmentos", "Segmentos"], ["ajustes", "Ajustes"],
  ] as const;
  return (
    <>
      <PageHead title="Email marketing" icon={<Megaphone className="h-[18px] w-[18px]" />} color="#ec4899"
        sub={sub ?? "Campañas a tus compradores, en su idioma, con lo que todavía no tienen."} actions={actions} />
      <div className="mb-5">
        <nav className="ad-seg" aria-label="Secciones">
          {items.map(([k, l]) => <Link key={k} href={`/admin/email/${k}`} className={k === tab ? "on" : ""} aria-current={k === tab ? "page" : undefined}>{l}</Link>)}
        </nav>
      </div>
    </>
  );
}

export type StoreOpt = { id: string; slug: string; name: string };

/** Las tiendas reales (sin las de prueba). */
export async function mktStores(): Promise<StoreOpt[]> {
  const { data } = await db.from("stores").select("id,slug,name,display_name,is_test").order("created_at");
  return (data ?? []).filter((s) => !s.is_test).map((s) => ({ id: s.id, slug: s.slug, name: s.display_name || s.name }));
}

/** La tienda elegida (?tienda=slug) o la primera. */
export function pickStore(stores: StoreOpt[], slug?: string | null) {
  return stores.find((s) => s.slug === slug) ?? stores[0] ?? null;
}

export function StoreTabs({ stores, current, base, extra = "" }: { stores: StoreOpt[]; current: string; base: string; extra?: string }) {
  if (stores.length < 2) return null;
  return (
    <div className="mb-4"><div className="ad-seg">
      {stores.map((s) => (
        <Link key={s.id} href={`${base}?tienda=${s.slug}${extra}`} className={s.id === current ? "on" : ""}><Pv as={storeAlias(s.id)}>{s.name}</Pv></Link>
      ))}
    </div></div>
  );
}

export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "brand" | undefined> = {
  draft: undefined, scheduled: "brand", sending: "warn", paused: "bad", sent: "ok", cancelled: undefined,
};
