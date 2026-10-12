import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { offerKeyOfFunnel } from "@/lib/admin/offers";

export const dynamic = "force-dynamic";

/** Los avisos y mails guardan el pedido, no su oferta: acá se resuelve a qué oferta pertenece y se va a su página. */
export default async function PedidoDeAviso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/admin/avisos");
  const { data: o } = await db.from("orders").select("funnel_id").eq("id", id).maybeSingle();
  const key = o?.funnel_id ? await offerKeyOfFunnel(o.funnel_id) : null;
  redirect(key ? `/admin/o/${key}/ventas/${id}` : "/admin/avisos");
}
