/**
 * Reemplazo unico de los submodulos de "next" para correr src/lib fuera de Next.
 * La vista previa de una campaña solo necesita que estos modulos resuelvan: el
 * render de bloques text/heading no ejecuta cache, cookies, headers ni navegacion.
 * Si algun camino los llama de verdad, tiran error en vez de devolver algo falso.
 */
const nope = (name) => () => { throw new Error(`vista previa: se llamó a ${name}() de next fuera de Next`); };

export const unstable_cache = (fn) => fn;
export const revalidateTag = () => {};
export const revalidatePath = () => {};
export const unstable_noStore = () => {};
export const after = () => {};
export const notFound = nope("notFound");
export const redirect = nope("redirect");
export const cookies = nope("cookies");
export const headers = nope("headers");
