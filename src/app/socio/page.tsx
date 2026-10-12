import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BarChart2, LogOut } from "lucide-react";
import { db } from "@/lib/db";
import { isLoggedIn } from "@/lib/auth";
import { currentPartner, partnerNumbers, partnerOffers, type Partner } from "@/lib/partner";
import { resolveRange, type Range } from "@/lib/admin/range";
import type { OfferItem } from "@/lib/admin/offers";
import { Card, Kpi, PageHead } from "@/components/admin/ui";
import { SpendRevenueChart } from "@/components/admin/charts";
import { SkCard } from "@/components/admin/Skeleton";
import RangeBar from "@/components/admin/RangeBar";
import { ADMIN_ICONS, Logo } from "@/components/admin/Logo";
import { ThemeSync } from "@/components/admin/Theme";
import { THEME_SCRIPT } from "@/components/admin/theme-script";
import { fontVars } from "@/components/admin/fonts";
import "@/components/admin/admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Panel · Socio", robots: { index: false }, icons: ADMIN_ICONS };
export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

const usd = (n: number) => `${n < 0 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 })}`;
const tone = (n: number) => (n > 0.005 ? "text-emerald-500" : n < -0.005 ? "text-red-500" : "");

/**
 * Panel del socio: solo sus ofertas, y de cada una lo que cobró (Stripe, real) y lo que se gastó en
 * anuncios (Meta). Nada más del panel: ni compradores, ni mails, ni configuración. El administrador lo ve como
 * el socio con ?as=<email> (vista previa desde «Socios»).
 */
export default async function SocioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let partner: Partner | null = await currentPartner();
  const preview = !!sp.as && (await isLoggedIn());
  if (preview) {
    const { data } = await db.from("partners").select("email,name,offer_ids,active,last_login_at,created_at").eq("email", sp.as!.toLowerCase()).maybeSingle();
    partner = (data as Partner | null) ?? null;
  }
  if (!partner) redirect("/entrar");
  const offers = await partnerOffers(partner);
  const cur = offers.find((o) => o.key === sp.o) ?? offers[0] ?? null;
  const R = resolveRange(sp);
  const q = (o: OfferItem) => {
    const u = new URLSearchParams(Object.entries({ ...sp, o: o.key }).filter((e): e is [string, string] => typeof e[1] === "string"));
    return `/socio?${u}`;
  };

  return (
    <div className={`ad-root dark ${fontVars} [overflow-x:clip]`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ThemeSync />
      {preview && <div className="bg-violet-600 px-3 py-1.5 text-center text-[12px] font-semibold text-white">Vista previa · así lo ve {partner.email}</div>}
      <header className="sticky top-0 z-40 border-b border-zinc-200/60 bg-[#f8f9fa]/85 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#060606]/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <Logo compact />
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden min-w-0 truncate text-[12.5px] font-semibold text-zinc-500 sm:block">{partner.name || partner.email}</span>
            {!preview && (
              <form method="post" action="/socio/salir">
                <button className="ad-btn sm" type="submit"><LogOut className="h-3.5 w-3.5" /> Salir</button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="ad-main mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-6">
        {!cur ? (
          <Card>
            <p className="py-10 text-center text-[13px] font-semibold text-zinc-500">Todavía no tenés ofertas asignadas. Apenas se carguen, aparecen acá.</p>
          </Card>
        ) : (
          <>
            {offers.length > 1 && (
              <nav className="mb-4 flex flex-wrap gap-1.5">
                {offers.map((o) => (
                  <Link key={o.id} href={q(o)} className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${o.id === cur.id ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                    {o.name}
                  </Link>
                ))}
              </nav>
            )}
            <PageHead title={cur.name} icon={<BarChart2 className="h-[18px] w-[18px]" />} color="#8b5cf6"
              sub={<>{cur.store.display_name || cur.store.name}{cur.markets.length ? ` · ${cur.markets.map((m) => m.market_label).filter(Boolean).join(", ")}` : ""} · en USD, días de Argentina</>} />
            <RangeBar since={R.since} until={R.until} preset={R.preset} label={R.label} />
            <Suspense key={`${cur.id}|${R.since}|${R.until}`} fallback={<div className="ad-grid g-kpi">{[0, 1, 2, 3, 4, 5].map((i) => <SkCard key={i} rows={1} title={false} />)}</div>}>
              <Numbers offer={cur} R={R} />
            </Suspense>
          </>
        )}
      </main>
    </div>
  );
}

async function Numbers({ offer, R }: { offer: OfferItem; R: Range }) {
  const n = await partnerNumbers(offer, R.since, R.until);
  const roas = n.spend ? n.gross / n.spend : null;
  const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
  const shown = n.days.filter((d) => d.gross || d.spend || d.refunded || d.sales).reverse();
  return (
    <>
      <div className="ad-grid g-kpi">
        <Kpi label="Ingresos" value={usd(n.gross)} hint={`${n.sales} ${n.sales === 1 ? "venta" : "ventas"}`} src="cobrado en Stripe" />
        <Kpi label="Gasto en anuncios" value={usd(n.spend)} hint={`${n.campaigns.filter((c) => c.spend > 0).length} campañas`} src="según Meta" />
        <Kpi label="Resultado" value={<b className={`font-semibold ${tone(n.result)}`}>{usd(n.result)}</b>} hint="ingresos − comisiones − reembolsos − anuncios" />
        <Kpi label="ROAS" value={roas == null ? "—" : `${roas.toFixed(2)}x`} hint="ingresos / gasto" />
        <Kpi label="Comisiones de Stripe" value={usd(n.fees)} src="reales" />
        <Kpi label="Reembolsos" value={usd(n.refunded)} hint={`${n.refunds} ${n.refunds === 1 ? "reembolso" : "reembolsos"}`} />
      </div>

      <div className="mt-4">
        <Card title="Ingresos y gasto por día">
          <SpendRevenueChart days={n.days.map((d) => ({ date: d.date, spend: d.spend, revenue: d.gross }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Día por día" pad={false}>
          <div className="ad-scroll">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead><tr className="text-left text-[11.5px] text-zinc-500"><th className="px-4 py-2 font-medium">Día</th><th className="px-2 py-2 text-right font-medium">Ventas</th><th className="px-2 py-2 text-right font-medium">Ingresos</th><th className="px-2 py-2 text-right font-medium">Anuncios</th><th className="px-4 py-2 text-right font-medium">Resultado</th></tr></thead>
              <tbody>
                {shown.length ? shown.map((d) => (
                  <tr key={d.date} className="border-t border-zinc-100 dark:border-white/[0.05]">
                    <td className="px-4 py-2 font-semibold">{fmtDay(d.date)}</td>
                    <td className="px-2 py-2 text-right">{d.sales}</td>
                    <td className="px-2 py-2 text-right font-semibold">{usd(d.gross)}</td>
                    <td className="px-2 py-2 text-right">{usd(d.spend)}</td>
                    <td className={`px-4 py-2 text-right font-bold ${tone(d.result)}`}>{usd(d.result)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-4 py-8 text-center font-semibold text-zinc-400">Sin ventas ni gasto en el período.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Campañas de la oferta" pad={false}>
          <div className="ad-scroll">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead><tr className="text-left text-[11.5px] text-zinc-500"><th className="px-4 py-2 font-medium">Campaña</th><th className="px-2 py-2 text-right font-medium">Gasto</th><th className="px-4 py-2 text-right font-medium">Compras (Meta)</th></tr></thead>
              <tbody>
                {n.campaigns.length ? n.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 dark:border-white/[0.05]">
                    <td className="max-w-[260px] truncate px-4 py-2 font-semibold" title={c.name}>
                      <i className={`mr-2 inline-block h-2 w-2 rounded-full ${c.status === "ACTIVE" ? "bg-emerald-500" : "bg-zinc-400"}`} />{c.name}
                    </td>
                    <td className="px-2 py-2 text-right">{usd(c.spend)}</td>
                    <td className="px-4 py-2 text-right">{Math.round(c.purchases)}</td>
                  </tr>
                )) : <tr><td colSpan={3} className="px-4 py-8 text-center font-semibold text-zinc-400">Todavía no hay campañas vinculadas a esta oferta.</td></tr>}
              </tbody>
            </table>
          </div>
          {n.metaAt && <p className="px-4 pb-3 pt-1 text-[11px] text-zinc-400" suppressHydrationWarning>Meta se actualiza cada 15 minutos · último dato {new Date(n.metaAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</p>}
        </Card>
      </div>
    </>
  );
}
