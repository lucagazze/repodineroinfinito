import { Handshake } from "lucide-react";
import Shell from "@/components/admin/Shell";
import { Card, PageHead } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { offerList } from "@/lib/admin/offers";
import type { Partner } from "@/lib/partner";
import { createPartner, deletePartner, revokePartnerToken, setPartnerActive, setPartnerOffers, setPartnerPassword } from "@/lib/admin/partner-actions";
import PartnerToken from "@/components/admin/PartnerToken";

/** Donde se conecta la IA del socio (MCP con su token, solo sus ofertas). */
const MCP_SOCIO = `${process.env.PANEL_HOST ? `https://${process.env.PANEL_HOST}` : process.env.NEXT_PUBLIC_SITE_URL || ""}/api/mcp-socio`;

export const dynamic = "force-dynamic";

const input = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12.5px] font-semibold text-zinc-900 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";

/**
 * Socios. Cada socio entra por /entrar con su email y contraseña y cae en /socio: solo las ofertas tildadas acá,
 * con lo cobrado en Stripe y lo gastado en Meta. No ve compradores, mails ni nada más del panel.
 */
export default async function Socios() {
  const [{ data }, offers] = await Promise.all([
    db.from("partners").select("email,name,offer_ids,active,last_login_at,created_at,mcp_token_hint").order("created_at"),
    offerList(),
  ]);
  const partners = (data ?? []) as (Partner & { mcp_token_hint: string | null })[];
  const byStore = new Map<string, typeof offers>();
  for (const o of offers) byStore.set(o.store.display_name || o.store.name, [...(byStore.get(o.store.display_name || o.store.name) ?? []), o]);
  const when = (s: string | null) => (s ? new Date(s).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");

  return (
    <Shell>
      <PageHead title="Socios" icon={<Handshake className="h-[18px] w-[18px]" />} color="#0ea5e9"
        sub="Personas que entran con su usuario y ven solo los ingresos (Stripe) y el gasto en anuncios (Meta) de las ofertas que les asignes." />

      <div className="grid gap-4">
        {partners.map((p) => (
          <Card key={p.email}
            title={<>{p.name || p.email} {!p.active && <span className="ml-2 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-bold text-zinc-500">Pausado</span>}</>}
            sub={<>{p.email} · último ingreso: {when(p.last_login_at)}</>}
            action={<a className="ad-btn sm" href={`/socio?as=${encodeURIComponent(p.email)}`} target="_blank" rel="noreferrer">Ver su panel</a>}>
            <form action={setPartnerOffers} className="grid gap-3">
              <input type="hidden" name="email" value={p.email} />
              <p className="text-[12px] font-semibold text-zinc-500">Ofertas que puede ver ({p.offer_ids.length}):</p>
              {[...byStore.entries()].map(([store, list]) => (
                <fieldset key={store} className="grid gap-1.5">
                  <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{store}</legend>
                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-[12.5px] dark:border-white/[0.06]">
                        <input type="checkbox" name="offer" value={o.id} defaultChecked={p.offer_ids.includes(o.id)} />
                        <span className="min-w-0 truncate">{o.name}</span>
                        {!o.active && <span className="ml-auto shrink-0 text-[10.5px] text-zinc-400">pausada</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div><button className="ad-btn sm primary" type="submit">Guardar ofertas</button></div>
            </form>
            <div className="mt-4 grid gap-2 border-t border-zinc-100 pt-4 dark:border-white/[0.06]">
              <p className="text-[12px] text-zinc-500">Su IA (Claude) puede cargar y editar sus productos, su checkout, su post-pago y sus anuncios, solo de estas ofertas. Nunca reembolsos, mails, Stripe, píxeles ni datos de compradores; cada cambio de precio te llega como aviso.</p>
              <PartnerToken email={p.email} hint={p.mcp_token_hint} endpoint={MCP_SOCIO} />
              {p.mcp_token_hint && (
                <form action={revokePartnerToken}><input type="hidden" name="email" value={p.email} /><button className="ad-btn sm" type="submit">Revocar token</button></form>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4 dark:border-white/[0.06]">
              <form action={setPartnerPassword} className="flex items-end gap-2">
                <input type="hidden" name="email" value={p.email} />
                <label className="grid gap-1 text-[11px] font-semibold text-zinc-500">Nueva contraseña<input className={input} name="password" type="text" minLength={8} required autoComplete="off" /></label>
                <button className="ad-btn sm" type="submit">Cambiar</button>
              </form>
              <form action={setPartnerActive}>
                <input type="hidden" name="email" value={p.email} />
                <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                <button className="ad-btn sm" type="submit">{p.active ? "Pausar acceso" : "Reactivar acceso"}</button>
              </form>
              <form action={deletePartner}>
                <input type="hidden" name="email" value={p.email} />
                <button className="ad-btn sm danger" type="submit">Borrar</button>
              </form>
            </div>
          </Card>
        ))}

        <Card title="Nuevo socio" sub="Entra por la misma página de ingreso del panel, con este email y contraseña.">
          <form action={createPartner} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-[11px] font-semibold text-zinc-500">Nombre<input className={input} name="name" /></label>
            <label className="grid gap-1 text-[11px] font-semibold text-zinc-500">Email<input className={input} name="email" type="email" required /></label>
            <label className="grid gap-1 text-[11px] font-semibold text-zinc-500">Contraseña<input className={input} name="password" type="text" minLength={8} required autoComplete="off" /></label>
            <button className="ad-btn primary" type="submit">Crear</button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
