import { notFound } from "next/navigation";
import { scopeFor } from "@/lib/admin/offers";
import {
  GeneralTab, NegocioTab, EntregaTab, PagosTab, DominiosTab, TrackingTab, WebhooksTab, ApiTab,
} from "@/components/admin/config/tabs";
import { MetaConnectionTab } from "@/components/admin/config/MetaConnection";

export const dynamic = "force-dynamic";

export default async function ConfigTab({ params }: { params: Promise<{ offer: string; tab: string }> }) {
  const { offer, tab } = await params;
  const s = (await scopeFor(offer)).store;
  switch (tab) {
    case "general": return <GeneralTab s={s} />;
    case "negocio": return <NegocioTab s={s} />;
    case "entrega": return <EntregaTab s={s} />;
    case "pagos": return <PagosTab s={s} />;
    case "dominios": return <DominiosTab s={s} />;
    case "tracking": return <TrackingTab s={s} />;
    case "webhooks": return <WebhooksTab s={s} />;
    case "api": return <ApiTab />;
    case "meta": return <MetaConnectionTab />;
    default: notFound();
  }
}
