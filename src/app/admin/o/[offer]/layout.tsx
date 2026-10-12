import Shell from "@/components/admin/Shell";
import { scopeFor } from "@/lib/admin/offers";

export default async function OfferLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ offer: string }> }) {
  // La lista de ofertas está en caché y la usa el menú: validar contra ella no suma una consulta.
  const sc = await scopeFor((await params).offer);
  return <Shell scope={sc.key}>{children}</Shell>;
}
