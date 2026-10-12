import { db } from "./db";

/**
 * Supabase devuelve como mucho 1000 filas por consulta y corta en silencio. Una tienda con más de 1000
 * productos dejaría de ver los más nuevos.
 * Todo lo que lea «todos los X de la tienda» va por acá, de a 1000 y con un orden fijo.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/** Todos los productos de una tienda (las columnas que pida), sin el corte de 1000. */
export function storeProducts<T>(storeId: string, cols: string): Promise<T[]> {
  return fetchAll<T>((a, b) => db.from("products").select(cols).eq("store_id", storeId).order("id").range(a, b));
}
