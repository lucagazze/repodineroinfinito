import { db } from "./db";

/**
 * Tiendas de PRUEBA (stores.is_test, migración 038): cobran con llaves de
 * prueba de Stripe. Lo que pasa en ellas nunca es una venta: ni en el panel,
 * ni en los push, ni en Meta (CAPI), ni en los eventos en vivo. Los pedidos
 * traen su propio orders.is_test (lo pone la base); esto es para lo demás.
 * Caché de 60 s: cambia casi nunca.
 */
let cache: { at: number; ids: Set<string> } | null = null;
let loading: Promise<Set<string>> | null = null;

export async function testStoreIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ids;
  loading ??= (async () => {
    const { data, error } = await db.from("stores").select("id").eq("is_test", true);
    // Si la base falla, la lista anterior (o vacía) y se reintenta en 10 s.
    if (error) {
      cache = { at: Date.now() - 50_000, ids: cache?.ids ?? new Set() };
      return cache.ids;
    }
    cache = { at: Date.now(), ids: new Set((data ?? []).map((s) => s.id as string)) };
    return cache.ids;
  })().finally(() => { loading = null; });
  return loading;
}

export async function isTestStore(storeId: string | null | undefined): Promise<boolean> {
  return !!storeId && (await testStoreIds()).has(storeId);
}
