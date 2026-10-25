/**
 * Reemplazo de "next/cache" para correr src/lib fuera de Next.
 * La vista previa de una campaña sin bloques de producto nunca ejecuta estos
 * caminos: alcanza con que el módulo resuelva. unstable_cache pasa derecho.
 */
export const unstable_cache = (fn) => fn;
export const revalidateTag = () => {};
export const revalidatePath = () => {};
export const unstable_noStore = () => {};
