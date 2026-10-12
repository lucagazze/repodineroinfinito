import { Suspense } from "react";
import { revalidatePath, revalidateTag } from "next/cache";
import { ShieldCheck } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, PageHead } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { catalogTag, formatMoney } from "@/lib/catalog";
import { auditCatalog } from "@/lib/admin/catalog-audit";
import CatalogStripeCard from "@/components/admin/CatalogStripeCard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Catálogos: el sitio de negocio de cada tienda, el que revisa Stripe. Se arma solo desde la base
 * (productos, precios, idiomas y temas en vivo); acá se ve lo publicado y se compara contra lo que hay de verdad:
 * quién sirve el dominio, productos que faltan, links de compra rotos, datos legales y políticas.
 */
async function refresh(formData: FormData) {
  "use server";
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "");
  if (slug) revalidateTag(catalogTag(slug));
  revalidatePath("/admin/catalogos");
}

const KIND: Record<string, string> = { product: "Productos", addon: "Agregados del checkout", after: "Ofertas post-pago", bonus: "Bonus de regalo" };

async function StoreAudit({ slug }: { slug: string }) {
  const a = await auditCatalog(slug);
  if (!a) return <Card title={slug}><p className="ad-note">El catálogo de esta tienda está apagado.</p></Card>;
  const ok = (b: boolean) => <span className={b ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{b ? "✓" : "✕"}</span>;
  const served = { app: "La app (se actualiza sola)", otro: "Otro sitio", "caído": "No responde" }[a.servedBy];
  return (
    <Card
      title={<>{a.name} {a.problems === 0 ? <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Todo en regla</span> : <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-600 dark:text-red-300">{a.problems} para revisar</span>}</>}
      sub={a.url ? <a className="ad-link-a" href={a.url} target="_blank" rel="noreferrer">{a.url}</a> : "Sin dirección pública"}
      action={<form action={refresh}><input type="hidden" name="slug" value={a.slug} /><button className="ad-btn sm" type="submit">Actualizar ahora</button></form>}
    >
      <div className="grid gap-4 text-[13px] lg:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold">Dominio</p>
          <p>{ok(a.servedBy === "app")} Lo sirve: <b>{served}</b></p>
          <p className="mt-3 mb-1 font-semibold">Lo que muestra ({a.items.length})</p>
          <ul className="space-y-0.5">{Object.entries(a.counts).map(([k, n]) => <li key={k}>{KIND[k] ?? k}: <b>{n}</b></li>)}</ul>
          {a.missingLive.length > 0 && <p className="mt-2 text-red-600 dark:text-red-400">Faltan en la página publicada ({a.missingLive.length}): {a.missingLive.slice(0, 12).join(" · ")}{a.missingLive.length > 12 ? "…" : ""}</p>}
          {a.noLink.length > 0 && <p className="mt-2 text-zinc-500">Sin checkout activo (se muestran sin botón de compra, como se venden en el checkout anterior): {a.noLink.length}</p>}
          <p className="mt-3 mb-1 font-semibold">Links de compra</p>
          {a.brokenLinks.length ? (
            <ul className="space-y-0.5 text-red-600 dark:text-red-400">{a.brokenLinks.map((l) => <li key={l.href}>✕ {l.name} — <a className="underline" href={l.href} target="_blank" rel="noreferrer">{l.status}</a></li>)}</ul>
          ) : <p>{ok(true)} Todos abren (200)</p>}
        </div>
        <div>
          <p className="mb-1 font-semibold">Datos legales (lo que pide Stripe)</p>
          <ul className="space-y-0.5">{a.legal.map((c) => <li key={c.label}>{ok(c.ok)} {c.label}: <span className="text-zinc-500">{c.detail}</span></li>)}</ul>
          <p className="mt-3 mb-1 font-semibold">Políticas publicadas</p>
          <ul className="flex flex-wrap gap-x-4">{a.pages.map((c) => <li key={c.label}>{ok(c.ok)} {c.label} <span className="text-zinc-400">{c.detail}</span></li>)}</ul>
          <p className="mt-3 mb-1 font-semibold">El texto del negocio dice (en vivo)</p>
          <p className="text-zinc-600 dark:text-zinc-300"><b>Idiomas:</b> {a.facts.languages.join(", ")}</p>
          <p className="text-zinc-600 dark:text-zinc-300"><b>Temas:</b> {a.facts.topics.join(", ")}</p>
          <p className="text-zinc-600 dark:text-zinc-300"><b>Países:</b> {a.facts.countries.join(", ")}</p>
          {a.facts.unknown.length > 0 && <p className="mt-1 text-red-600 dark:text-red-400">Categorías sin texto para el catálogo (hay que agregarlas): {a.facts.unknown.join(", ")}</p>}
          {a.facts.uncategorized.length > 0 && <p className="mt-1 text-amber-600 dark:text-amber-400">Ofertas sin categoría (no suman tema): {a.facts.uncategorized.join(", ")}</p>}
        </div>
      </div>
      <details className="mt-4 text-[12.5px]">
        <summary className="cursor-pointer font-semibold text-violet-700 dark:text-violet-300">Ver los {a.items.length} productos del catálogo</summary>
        <div className="mt-2 grid gap-1">
          {a.items.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-x-3 rounded-lg px-2 py-1 odd:bg-zinc-50 dark:odd:bg-white/[0.03]">
              <span className="w-28 shrink-0 text-zinc-400">{KIND[i.kind] ?? i.kind}</span>
              <b className="text-zinc-800 dark:text-zinc-100">{i.name}</b>
              <span className="ml-auto text-zinc-500">{i.amount ? formatMoney(i.amount, a.currency, "en-US") : i.kind === "bonus" ? `regalo${i.includedWith ? ` con ${i.includedWith}` : ""}` : "—"}</span>
              {i.href ? <a className="ad-link-a" href={i.href} target="_blank" rel="noreferrer">checkout</a> : <span className="text-zinc-400">sin link</span>}
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}

export default async function Catalogos() {
  const { data: stores } = await db.from("stores").select("slug,name,is_test,active").eq("active", true).order("name");
  const list = (stores ?? []).filter((s) => !s.is_test && !(process.env.EXCLUDED_STORES ?? "").split(",").map((x) => x.trim()).includes(s.slug as string));
  return (
    <Shell>
      <PageHead
        title="Catálogos"
        icon={<ShieldCheck className="h-[18px] w-[18px]" />} color="#0ea5e9"
        sub="El sitio de negocio de cada marca, el que revisa Stripe: se arma solo con lo que se vende y acá se valida contra lo publicado"
      />
      <div className="grid gap-4">
        {/* Lo último revisado, con lo que hay que cambiar a mano en Stripe. Abajo, la revisión en vivo de cada catálogo. */}
        <Suspense fallback={null}><CatalogStripeCard /></Suspense>
        {list.map((s) => (
          <Suspense key={s.slug} fallback={<Card title={s.name as string}><p className="ad-note">Revisando el catálogo publicado, las políticas y cada link de compra…</p></Card>}>
            <StoreAudit slug={s.slug as string} />
          </Suspense>
        ))}
      </div>
    </Shell>
  );
}
