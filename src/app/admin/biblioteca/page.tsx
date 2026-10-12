import { Library } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, PageHead } from "@/components/admin/ui";
import { Pv } from "@/components/admin/Priv";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/admin-data";
import { EMAIL } from "@/lib/admin/privacy";

export const dynamic = "force-dynamic";

/**
 * Mi biblioteca, desde el panel: el link público de
 * cada tienda (lo que abre el comprador) y entrar a la biblioteca de cualquier comprador tal cual la ve él.
 */
export default async function BibliotecaAdmin() {
  const { data: stores } = await db.from("stores").select("id,slug,name,display_name,domain,library_domain,is_test").eq("active", true).order("name");
  const list = (stores ?? []).filter((s) => !s.is_test && s.domain && !(process.env.EXCLUDED_STORES ?? "").split(",").map((x) => x.trim()).includes(s.slug as string));
  const { data: recent } = await db.from("orders").select("email,name,created_at,store_id,is_test")
    .eq("status", "paid").eq("is_test", false).in("store_id", list.map((s) => s.id)).order("created_at", { ascending: false }).limit(40);
  const seen = new Set<string>();
  const buyers = (recent ?? []).filter((o) => o.email && !seen.has(`${o.store_id}:${String(o.email).toLowerCase()}`) && seen.add(`${o.store_id}:${String(o.email).toLowerCase()}`)).slice(0, 12);
  const nameOf = new Map(list.map((s) => [s.id as string, (s.display_name || s.name) as string]));

  return (
    <Shell>
      <PageHead
        title="Biblioteca de clientes"
        icon={<Library className="h-[18px] w-[18px]" />} color="#5b3df5"
        sub="El portal donde cada comprador ve sus libros, los descarga y desbloquea los que le faltan"
      />
      <div className="grid gap-4">
        <Card title="Portal público de cada tienda" sub="El comprador entra con su email: le llega un link para entrar, sin contraseña.">
          <div className="grid gap-2">
            {list.map((s) => {
              const url = s.library_domain ? `https://${s.library_domain}` : `https://${s.domain}/biblioteca`;
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-white/10">
                  <b className="text-[13.5px] text-zinc-900 dark:text-white">{s.display_name || s.name}</b>
                  <span className="font-mono text-[12.5px] text-zinc-500">{url}</span>
                  <a className="ad-btn sm ml-auto" href={`/api/admin/biblioteca?store=${s.slug}&all=1`} target="_blank" rel="noreferrer" title="Todo el contenido de la tienda, por oferta, con portadas y descargas">Abrir el portal con todo</a>
                  <a className="ad-btn sm" href={url} target="_blank" rel="noreferrer" title="Lo que ve el comprador: entra con su mail">Portal del comprador</a>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Ver la biblioteca de un comprador" sub="Se abre exactamente lo que ve esa persona (sin poder comprar), por 2 horas.">
          <form action="/api/admin/biblioteca" method="get" target="_blank" className="flex flex-wrap items-center gap-2">
            <input name="email" type="email" required placeholder="email del comprador" className="ad-in min-w-[240px] flex-1" />
            <select name="store" className="ad-in w-auto" defaultValue={list[0]?.slug}>
              {list.map((s) => <option key={s.id} value={s.slug as string}>{s.display_name || s.name}</option>)}
            </select>
            <button type="submit" className="ad-btn">Ver su biblioteca</button>
          </form>
          {buyers.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-semibold text-zinc-500">Últimos compradores</p>
              <div className="grid gap-1.5">
                {buyers.map((o) => (
                  <a key={`${o.store_id}:${o.email}`} href={`/api/admin/biblioteca?store=${o.store_id}&email=${encodeURIComponent(String(o.email))}`} target="_blank" rel="noreferrer"
                    className="flex flex-wrap items-center gap-x-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-zinc-50 dark:hover:bg-white/[0.04]">
                    <b className="text-zinc-800 dark:text-zinc-100"><Pv as={EMAIL}>{String(o.email)}</Pv></b>
                    <span className="text-zinc-500">{nameOf.get(o.store_id as string)}</span>
                    <span className="ml-auto text-zinc-400">{fmtDate(o.created_at as string)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Cómo funciona" pad>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-zinc-600 dark:text-zinc-300">
            <li>Ve todo lo que compró en esa tienda (principal, bumps, OTOs y lo del checkout anterior que se reconoce), con portada y botón para descargar. Las descargas siguen yendo a Drive.</li>
            <li>Abajo, «Completá la colección»: los libros de sus ofertas que le faltan, al precio de la tienda, en 1 clic con la tarjeta que ya usó. Se suma a su último pedido y le llega el mail de entrega.</li>
            <li>El mail de entrega todavía no trae el link al portal: se agrega cuando lo apruebes.</li>
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
