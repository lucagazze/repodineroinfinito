import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** «Meta Ads» pasó a llamarse «Métricas» (/admin/metricas): los links viejos llegan ahí, con el mismo período. */
export default async function MetaAds({ searchParams }: { searchParams: Promise<{ r?: string; desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  redirect(`/admin/metricas${q.size ? `?${q}` : ""}`);
}
