import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Activity, ArrowLeft, BarChart2, BookOpen, Gauge, Bell, Box, Clapperboard, CreditCard, FolderOpen, Globe, House, Inbox, LayoutGrid, Library, LogOut, Megaphone, Menu, Package, Receipt, Repeat, Settings, ShieldCheck, ShoppingCart, Sparkles, Trophy, Users, X, Handshake,
} from "lucide-react";
import { readCatalogStatus } from "@/lib/admin/catalog-status";
import { lastRun, topRecs } from "@/lib/coach/read";
import { presaleBoardCached } from "@/lib/admin/presale";
import { db } from "@/lib/db";
import { logout } from "@/lib/auth";
import { offerList, idsOrNone } from "@/lib/admin/offers";
import { diagnosticsAction } from "@/lib/admin/actions";
import NavLinks, { type NavItem } from "./NavLinks";
import OfferSwitcher from "./OfferSwitcher";
import Diagnostico from "./Diagnostico";
import SearchPalette, { SearchTrigger } from "./Search";
import { Logo } from "./Logo";
import { PrivacyToggle } from "./Theme";
import AutoRefresh from "./AutoRefresh";
import { Pv } from "./Priv";
import { storeAlias } from "@/lib/admin/privacy";
import TopBarPush from "./TopBarPush";
import HelpButton from "./HelpButton";
import PortalButton from "./PortalButton";
import PushToast from "./PushToast";
import AlertsBell, { AlertsToast } from "@/app/admin/avisos/AlertsBell";
import MailsUnread from "@/app/admin/mails/MailsUnread";

/** Carritos abandonados con email en las últimas 48 h: el número que vale la pena mirar. Llega después, sin frenar el menú. */
async function AbandonedBadge({ funnelIds }: { funnelIds: string[] }) {
  const { count } = await db
    .from("checkouts")
    .select("id", { count: "exact", head: true })
    .in("funnel_id", idsOrNone(funnelIds))
    .eq("status", "open")
    .not("email", "is", null)
    .is("recovery_sent_at", null)
    // Igual que la pestaña «Sin contactar» de Carritos: los que no se les manda (ya compraron, repetidos…) no cuentan.
    .is("recovery_skip", null)
    .gte("created_at", new Date(Date.now() - 48 * 3600_000).toISOString())
    .lte("created_at", new Date(Date.now() - 30 * 60_000).toISOString());
  if (!count) return null;
  return (
    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white shadow-sm shadow-red-500/30">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** «Mejoras» nuevas de gravedad alta del último análisis (de la oferta, o todas). Llega después, sin frenar el menú. */
async function MejorasBadge({ offerKey }: { offerKey?: string }) {
  const { recs } = await lastRun().catch(() => ({ recs: [] }));
  const n = topRecs(recs, { kind: "mejora", offerKey }).filter((r) => r.severity === "alta").length;
  if (!n) return null;
  return (
    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-black text-white shadow-sm shadow-violet-500/30">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Preventas con compradores esperando el contenido: ámbar, rojo si alguna está atrasada. */
async function PresaleBadge() {
  const rows = await presaleBoardCached().catch(() => []);
  const owed = rows.filter((r) => r.state !== "sin_ventas" && r.state !== "entregado");
  if (!owed.length) return null;
  const late = owed.some((r) => r.state === "atrasado");
  return (
    <span className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-black text-white shadow-sm ${late ? "bg-red-500" : "bg-amber-500"}`}>
      {owed.length}
    </span>
  );
}

/** Burbujita de «Catálogos»: lo que hay que arreglar en el catálogo o cambiar a mano en Stripe. */
async function CatalogBadge() {
  const st = await readCatalogStatus().catch(() => null);
  const n = (st?.stores ?? []).reduce((a, s) => a + s.catalogProblems.length + s.stripeTasks.length, 0);
  if (!n) return null;
  const bad = (st?.stores ?? []).some((s) => s.catalogProblems.length || s.stripeTasks.some((t) => t.severity === "error"));
  return (
    <span title="Cosas para hacer en el catálogo o en Stripe" className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-black text-white shadow-sm ${bad ? "bg-red-500" : "bg-amber-500"}`}>
      {n}
    </span>
  );
}

const ic = "h-4 w-4";

/**
 * Armazón del panel: menú blanco de 232 px con
 * secciones en mayúscula, la activa en negro; en el celular, barra fija
 * arriba y el menú como cajón (un checkbox lo abre, sin JavaScript).
 */
export default async function Shell({ scope, children }: { scope?: string; children: ReactNode }) {
  const offers = await offerList();
  const [st, of, fu] = (scope ?? "").split("~");
  const current = scope ? offers.find((o) => o.key === `${st}~${of}`) ?? null : null;
  const market = current && fu ? current.funnels.find((f) => f.slug === fu) ?? null : null;
  const scopeIds = market ? [market.id] : (current?.funnels.map((f) => f.id) ?? []);

  async function doLogout() {
    "use server";
    await logout();
    redirect("/entrar");
  }

  const b = current ? `/admin/o/${market ? market.key : current.key}` : "";
  const items: NavItem[] = current
    ? [
        { group: "Principal" },
        { href: b, label: "Inicio", icon: <House className={ic} />, exact: true },
        { href: `${b}/ventas`, label: "Pedidos", icon: <Receipt className={ic} /> },
        { href: `${b}/clientes`, label: "Clientes", icon: <Users className={ic} /> },
        { href: `${b}/carritos`, label: "Carritos", icon: <ShoppingCart className={ic} />, badge: <Suspense fallback={null}><AbandonedBadge funnelIds={scopeIds} /></Suspense> },
        { href: "/admin/mails", label: "Mails", icon: <Inbox className={ic} />, badge: <MailsUnread /> },
        { href: "/admin/email/campanas", match: "/admin/email", label: "Email marketing", icon: <Megaphone className={ic} /> },
        { href: "/admin/avisos", label: "Avisos", icon: <Bell className={ic} /> },
        { href: `${b}/mejoras`, label: "Mejoras", icon: <Sparkles className={ic} />, badge: <Suspense fallback={null}><MejorasBadge offerKey={current.key} /></Suspense> },
        { href: "/admin/piloto", match: "/admin/piloto", label: "Piloto Meta Ads", icon: <Gauge className={ic} /> },
        { group: "Oferta" },
        { href: `${b}/embudos`, label: "Checkouts", icon: <CreditCard className={ic} /> },
        { href: `${b}/productos`, label: "Productos", icon: <Box className={ic} /> },
        { href: `${b}/post-compra`, label: "Post-pago", icon: <Repeat className={ic} /> },
        { href: `${b}/estadisticas`, label: "Métricas", icon: <BarChart2 className={ic} /> },
        { href: `${b}/ads`, label: "Ads", icon: <Clapperboard className={ic} /> },
        { group: <>Tienda · <Pv as={storeAlias(current.store.id)}>{current.store.display_name || current.store.name}</Pv></> },
        { href: `${b}/configuracion/general`, match: `${b}/configuracion`, label: "Configuración", icon: <Settings className={ic} /> },
        { href: `${b}/mercados`, label: "Markets", icon: <Globe className={ic} /> },
        { href: `${b}/archivos`, label: "Archivos", icon: <FolderOpen className={ic} /> },
      ]
    : [
        { group: "Panel" },
        { href: "/admin/en-vivo", label: "En vivo", icon: <Activity className={ic} /> },
        { href: "/admin/metricas", label: "Métricas", icon: <BarChart2 className={ic} /> },
        { href: "/admin/top-ads", label: "Top Ads", icon: <Trophy className={ic} /> },
        { href: "/admin/mails", label: "Mails", icon: <Inbox className={ic} />, badge: <MailsUnread /> },
        { href: "/admin/email/campanas", match: "/admin/email", label: "Email marketing", icon: <Megaphone className={ic} /> },
        { href: "/admin/avisos", label: "Avisos", icon: <Bell className={ic} /> },
        { href: "/admin/ventas", label: "Ventas realizadas", icon: <Receipt className={ic} /> },
        { href: "/admin/clientes", label: "Clientes", icon: <Users className={ic} /> },
        { href: "/admin/biblioteca", label: "Biblioteca de clientes", icon: <Library className={ic} /> },
        { href: "/admin/carritos", label: "Carritos", icon: <ShoppingCart className={ic} /> },
        { href: "/admin/preventas", label: "Contenido pendiente", icon: <Package className={ic} />, badge: <Suspense fallback={null}><PresaleBadge /></Suspense> },
        { href: "/admin/mejoras", label: "Mejoras", icon: <Sparkles className={ic} />, badge: <Suspense fallback={null}><MejorasBadge /></Suspense> },
        { href: "/admin/piloto", match: "/admin/piloto", label: "Piloto Meta Ads", icon: <Gauge className={ic} /> },
        { href: "/admin/socios", label: "Socios", icon: <Handshake className={ic} /> },
        { href: "/admin/catalogos", label: "Catálogos", icon: <ShieldCheck className={ic} />, badge: <Suspense fallback={null}><CatalogBadge /></Suspense> },
        { href: "/admin/guia", label: "Guía de la app", icon: <BookOpen className={ic} /> },
      ];

  return (
    <div className="ad">
      <input type="checkbox" id="ad-menu" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <label htmlFor="ad-menu" aria-label="Cerrar menú"
        className="ad-scrim fixed inset-0 z-[280] hidden bg-black/40 backdrop-blur-md peer-checked:block lg:!hidden" />

      <aside className="ad-side fixed inset-y-0 left-0 z-[300] flex w-[232px] -translate-x-full flex-col border-r border-zinc-200 bg-white transition-transform duration-300 ease-in-out peer-checked:translate-x-0 peer-checked:shadow-[20px_0_60px_rgba(0,0,0,0.2)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none dark:border-white/[0.05] dark:bg-[#09090b]">
        <div className="flex h-[76px] shrink-0 items-center border-b border-zinc-100 px-5 dark:border-white/[0.03]">
          <Logo />
          {/* Junto al logo solo la X del cajón: los botones de captura y tema van abajo (al lado del logo se salían del menú). */}
          <div className="ml-auto flex items-center">
            <AlertsBell align="left" className="hidden lg:block" />
            <label htmlFor="ad-menu" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 lg:hidden dark:hover:bg-white/5 dark:hover:text-white" aria-label="Cerrar menú">
              <X className="h-[18px] w-[18px]" />
            </label>
          </div>
        </div>

        {/* El buscador (también con ⌘K o «/» desde cualquier página). */}
        <div className="px-3 pt-3"><SearchTrigger variant="side" /></div>

        {/* «Todas las ofertas» siempre arriba del selector de oferta, en el mismo lugar (también
            en el cajón del celular): desde una oferta es la vuelta al Inicio general, y en /admin
            queda resaltado. Por eso ya no está repetido en el grupo «Panel». */}
        <div className="px-3 pt-2">
          <NavLinks items={[{ href: "/admin", label: "Todas las ofertas", icon: current ? <ArrowLeft className={ic} /> : <LayoutGrid className={ic} />, exact: true }]} />
        </div>

        <OfferSwitcher current={scope ?? null}
          offers={offers.map((o) => ({
            key: o.key, name: o.name, alias: o.alias, category: o.category, store: o.store.display_name || o.store.name, storeAlias: storeAlias(o.store.id), image: o.image_url, active: o.active, created: o.created_at,
            markets: o.markets.map((f) => ({ key: f.key, label: f.market_label || f.name, slug: f.slug, flags: f.flags, active: f.active })),
          }))} />

        <div className="flex-1 overflow-y-auto px-3 pb-5 pt-3">
          <NavLinks items={items} />
        </div>

        <div className="shrink-0 border-t border-zinc-100 bg-zinc-50/50 p-3 dark:border-white/[0.03] dark:bg-white/[0.01]">
          {/* Notificaciones, actualizar y captura están en la barra de arriba. */}
          <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-white/[0.05] dark:bg-[#111]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-800 to-black text-[11px] font-black text-white dark:from-zinc-200 dark:to-white dark:text-black">
              AD
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold text-zinc-900 dark:text-white">Administrador</p>
              <p className="truncate text-[10px] text-zinc-400">{current ? <><Pv as={current.alias}>{current.name}</Pv>{market ? ` · ${market.market_label || market.name}` : ""}</> : `${offers.length} ofertas`}</p>
            </div>
            <form action={doLogout}>
              <button className="flex rounded-lg p-1.5 text-zinc-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" title="Cerrar sesión" aria-label="Cerrar sesión">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="ad-body">
        <div className="ad-mobilebar fixed inset-x-0 top-0 z-[200] flex h-14 items-center justify-between border-b border-black/[0.06] bg-white/80 px-4 backdrop-blur-xl lg:hidden dark:border-white/[0.05] dark:bg-[#161618]/80">
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="ad-menu" className="-ml-1.5 flex cursor-pointer rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/10" aria-label="Abrir menú">
              <Menu className="h-[18px] w-[18px]" />
            </label>
            <span className="truncate font-display text-[15px] font-bold tracking-tight text-zinc-900 dark:text-white">
              {current ? <><Pv as={current.alias}>{current.name}</Pv>{market ? ` · ${market.market_label || market.name}` : ""}</> : "Panel"}
            </span>
          </div>
          <div className="flex items-center"><SearchTrigger variant="icon" /><MailsUnread variant="icon" /><AlertsBell /><TopBarPush /><AutoRefresh compact /><PortalButton /><PrivacyToggle /></div>
        </div>
        <div className="ad-mobilespace h-14 lg:hidden" />
        {/* Barra de arriba en la compu: actualizar, notificaciones y modo captura. */}
        <div className="sticky top-0 z-[150] hidden h-12 items-center justify-end gap-1 border-b border-black/[0.06] bg-white/80 px-6 backdrop-blur-xl lg:flex dark:border-white/[0.05] dark:bg-[#09090b]/80">
          <div className="w-[200px]"><AutoRefresh /></div>
          <TopBarPush label />
          <PrivacyToggle label className="border border-zinc-200 dark:border-white/[0.06]" />
          <PortalButton label />
          <HelpButton label />
        </div>
        <main className="ad-main">{children}</main>
      </div>

      {current && <Diagnostico load={diagnosticsAction.bind(null, current.store.slug, b)} />}
      <SearchPalette />
      <AlertsToast />
      {/* Con la app abierta, cada notificación (compras incluidas) aparece también acá arriba. */}
      <PushToast />
    </div>
  );
}
