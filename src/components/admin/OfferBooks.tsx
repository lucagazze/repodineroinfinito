import { db } from "@/lib/db";
import type { Scope } from "@/lib/admin/offers";
import { deliveryPdfs } from "@/lib/admin/presale";
import { Pv } from "./Priv";

/**
 * Lo que se ofrece en esta oferta, con el PDF a un toque: el principal, los bonus, los bumps y los
 * OTO del post-pago (sin los downsells: son el mismo PDF), cada uno con su tapa, el PDF y la carpeta.
 */
/**
 * `delivery_file` va incluido a proposito. Una tienda puede entregar de dos
 * formas — carpeta de Drive (`delivery_url`) o archivo propio en Supabase
 * (`delivery_file`) — y mirando solo la primera este panel marcaba en rojo
 * «Sin link de entrega» a productos que entregan perfecto. Medido el
 * 22/10/2026 contra Finance Study Lab: los cinco productos daban rojo y los
 * cinco archivos descargaban bien. Una alarma falsa en el panel de un dueño
 * que acaba de lanzar cuesta mas que no tener alarma.
 */
type Prod = { id: string; short_name: string | null; name: string; image_url: string | null; presale: boolean | null; delivery_url: string | null; delivery_file: string | null; delivery_file_name: string | null; variant_of: string | null };
const ROLE: Record<string, string> = { main: "Principal", bonus: "Bonus", included: "Incluido", bump: "Bump", upsell: "Upsell", oto: "Post-pago" };
const ORDER = ["main", "bonus", "included", "bump", "upsell", "oto"];

export default async function OfferBooks({ sc }: { sc: Scope }) {
  const fids = sc.markets.map((f) => f.id);
  if (!fids.length) return null;
  const [{ data: items }, { data: pps }] = await Promise.all([
    db.from("funnel_items").select("product_id,role,sort_order").in("funnel_id", fids).order("sort_order"),
    db.from("pp_funnels").select("id").eq("active", true).in("checkout_funnel_id", fids),
  ]);
  const { data: steps } = pps?.length ? await db.from("pp_steps").select("product_id,sort_order").in("pp_funnel_id", pps.map((p) => p.id)).order("sort_order") : { data: [] as { product_id: string }[] };
  const role = new Map<string, string>();
  for (const f of sc.markets) if (f.main_product_id) role.set(f.main_product_id, "main");
  for (const i of items ?? []) if (!role.has(i.product_id as string)) role.set(i.product_id as string, i.role as string);
  for (const s of steps ?? []) if (!role.has(s.product_id as string)) role.set(s.product_id as string, "oto");
  if (!role.size) return null;
  const { data } = await db.from("products").select("id,short_name,name,image_url,presale,delivery_url,delivery_file,delivery_file_name,variant_of").in("id", [...role.keys()]);
  const prods = ((data ?? []) as Prod[]).filter((p) => !(role.get(p.id) === "oto" && p.variant_of))
    .sort((a, b) => ORDER.indexOf(role.get(a.id)!) - ORDER.indexOf(role.get(b.id)!));
  const pdfs = await Promise.all(prods.map((p) => deliveryPdfs(p.delivery_url).catch(() => [])));

  return (
    <section className="mt2 ad-card">
      <div className="ad-card-h"><div><h3>Lo que se ofrece · {prods.length}</h3><p>Cada libro de la oferta con su PDF para abrirlo rápido (y la carpeta de entrega).</p></div></div>
      <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
        {prods.map((p, i) => {
          const files = pdfs[i];
          return (
            <div key={p.id} className="flex gap-3 rounded-xl border border-zinc-200/80 bg-white p-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.image_url ? <img data-pv-img src={p.image_url} alt="" className="h-[72px] w-[54px] shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-800" />
                : <span className="h-[72px] w-[54px] shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800" />}
              <div className="min-w-0 flex-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-400">{ROLE[role.get(p.id)!] ?? role.get(p.id)}</span>
                <p className="truncate text-[12.5px] font-semibold text-zinc-900 dark:text-white" title={p.name}><Pv as="Producto">{p.short_name || p.name}</Pv></p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                  {files.length ? files.slice(0, 3).map((f) => (
                    <a key={f.id} href={`https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer" title={f.title}
                      className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25">
                      📄 <span className="truncate">{files.length > 1 ? f.title.replace(/\.pdf$/i, "") : "Abrir PDF"}</span>
                    </a>
                  )) : p.delivery_file
                    ? <span className="inline-flex max-w-[210px] items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25"
                            title={p.delivery_file}>
                        📄 <span className="truncate">{p.delivery_file_name || p.delivery_file.split("/").pop()}</span>
                      </span>
                    : p.presale
                    ? <span className="font-semibold text-amber-600 dark:text-amber-400">En preventa: todavía no hay PDF</span>
                    : <span className="font-semibold text-red-600 dark:text-red-400">{p.delivery_url ? "Sin PDF en la carpeta" : "Sin link de entrega"}</span>}
                  {p.delivery_url && <a href={p.delivery_url} target="_blank" rel="noreferrer" className="font-semibold text-violet-600 hover:underline dark:text-violet-300">Carpeta</a>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
