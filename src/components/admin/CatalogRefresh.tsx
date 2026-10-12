import { after } from "next/server";
import { readCatalogStatus, runCatalogStatus } from "@/lib/admin/catalog-status";

/** Sin nada a la vista: al entrar al Inicio, si la revisión de catálogos y Stripe tiene más de 2 minutos, se rehace en segundo plano. */
export default async function CatalogRefresh() {
  const st = await readCatalogStatus().catch(() => null);
  if (!st || Date.now() - st.at > 2 * 60_000) after(() => runCatalogStatus().then(() => undefined).catch(() => undefined));
  return null;
}
