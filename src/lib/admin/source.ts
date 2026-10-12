import { cookies } from "next/headers";
import { SOURCE_COOKIE, type Source } from "./source-shared";

export type { Source } from "./source-shared";
export { SOURCE_COOKIE } from "./source-shared";

/** De dónde salen las métricas del Inicio de una oferta: lo real, cobrado (por defecto) o Meta Ads. Lo recuerda una cookie. */
export async function metricSource(): Promise<Source> {
  return (await cookies()).get(SOURCE_COOKIE)?.value === "meta" ? "meta" : "real";
}
