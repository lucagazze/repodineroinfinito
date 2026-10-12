import { db } from "@/lib/db";
import { offerList } from "@/lib/admin/offers";
import { campaignsOf } from "@/lib/admin/meta-links";
import OfferAudit from "./OfferAudit";

/** El diagnóstico con las ofertas que hoy tienen alguna campaña activa en Meta (las que se ven primero). */
export default async function OfferAuditActive() {
  const offers = await offerList();
  const camps = new Map(offers.map((o) => [o.key, [...new Set(o.funnels.flatMap((f) => campaignsOf(f, {})))]]));
  const ids = [...new Set([...camps.values()].flat())];
  const { data } = ids.length
    ? await db.from("meta_objects").select("id").eq("level", "campaign").eq("effective_status", "ACTIVE").in("id", ids)
    : { data: [] as { id: string }[] };
  const on = new Set((data ?? []).map((r) => r.id));
  const active = [...camps].filter(([, cs]) => cs.some((c) => on.has(c))).map(([k]) => k);
  return <OfferAudit active={active} />;
}
