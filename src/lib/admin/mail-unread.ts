import { db } from "@/lib/db";

/**
 * Mails de compradores sin leer, por tienda, en una sola consulta: los que
 * entraron, no son rebotes ni automáticos y no se abrieron (ni en el panel ni
 * en el webmail). Solo trae store_id: son pocos (lo que falta leer).
 */
export async function unreadByStore(): Promise<Record<string, number>> {
  const { data, error } = await db.from("inbox_messages").select("store_id")
    .eq("direction", "in").eq("is_bounce", false).eq("automated", false).is("read_at", null).limit(10_000);
  if (error) throw new Error(error.message);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.store_id as string] = (out[r.store_id as string] ?? 0) + 1;
  return out;
}
