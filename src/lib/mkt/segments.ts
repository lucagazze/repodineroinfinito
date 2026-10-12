import { db } from "../db";
import { cleanSegment, type Segment } from "./types";

/**
 * Cuántos (y en qué idioma) cumplen un segmento: lo calcula la base
 * (mkt_segment_ids), con las exclusiones fijas adentro (bajas, rebotes,
 * quejas, reembolsos, contracargos, leads sin permiso).
 */
export type SegmentCount = { total: number; by_locale: Record<string, number> };

export async function countSegment(storeId: string, seg: Segment): Promise<SegmentCount> {
  const { data, error } = await db.rpc("mkt_segment_count", { p_store: storeId, f: cleanSegment(seg) });
  if (error) throw new Error(`No se pudo contar el segmento: ${error.message}`);
  const d = data as SegmentCount;
  return { total: Number(d.total ?? 0), by_locale: d.by_locale ?? {} };
}

export type ContactStats = {
  buyers: number; imported: number; leads: number; leads_ok: number; active: number; unsubscribed: number; bounced: number;
  complained: number; refunded: number; disputed: number; by_locale: Record<string, number>;
};

/** Cómo está la lista de una tienda: activos, excluidos y por qué. */
export async function contactStats(storeId: string): Promise<ContactStats> {
  const { data, error } = await db.rpc("mkt_contact_stats", { p_store: storeId });
  if (error) throw new Error(error.message);
  return data as ContactStats;
}

export type SavedSegment = { id: string; store_id: string; name: string; filters: Segment; updated_at: string };

export async function listSegments(storeId?: string | null): Promise<SavedSegment[]> {
  let q = db.from("mkt_segments").select("id,store_id,name,filters,updated_at").order("updated_at", { ascending: false }).limit(200);
  if (storeId) q = q.eq("store_id", storeId);
  const { data } = await q;
  return (data ?? []) as SavedSegment[];
}
