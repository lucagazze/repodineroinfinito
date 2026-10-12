import { db } from "@/lib/db";
import { raiseAlert, resolveAlerts } from "@/lib/alerts";
import { offerList } from "./offers";
import { postPurchaseOf } from "./offer-audit";
import { testStoreIds } from "@/lib/test-store";

/**
 * Aviso «Oferta sin post-pago» (warn): un checkout activo de una oferta activa
 * al que, después de pagar, no se le ofrece nada (sin cadena post-compra
 * activa ni upsells cargados). Uno por checkout; se cierra solo cuando se
 * carga la cadena. Solo base de datos (sin pedidos HTTP): lo corre el repaso
 * de avisos cada 5 min.
 */
export async function syncOfferAlerts() {
  const test = await testStoreIds();
  const offers = (await offerList()).filter((o) => o.active && !test.has(o.store.id));
  const markets = offers.flatMap((o) => o.markets.filter((f) => f.active).map((f) => ({ o, f })));
  if (!markets.length) return { checked: 0, missing: 0 };
  const { data: items } = await db.from("funnel_items").select("funnel_id,product_id").eq("role", "bump").in("funnel_id", markets.map((m) => m.f.id));
  const missing: string[] = [];
  const fine: string[] = [];
  const fineAll: string[] = [];
  for (const { o, f } of markets) {
    const bumps = (items ?? []).filter((i) => i.funnel_id === f.id).map((i) => i.product_id as string);
    const pp = await postPurchaseOf(o.store.id, f.id, bumps).catch(() => null);
    if (!pp) continue; // si no se pudo simular, no se avisa nada (ni se cierra)
    const ref = `pp:${f.id}`;
    // Simulado con todos los bumps tildados (no contando productos): el mejor comprador no puede quedarse sin OTO.
    const refAll = `ppall:${f.id}`;
    if (pp.steps && pp.levels && bumps.length && !pp.levelsAllBumps) {
      missing.push(refAll);
      await raiseAlert({
        kind: "offer_no_postpurchase", severity: "warn", storeId: o.store.id, ref: refAll, link: `/admin/o/${f.key}/post-compra`,
        title: `Sin OTO para el que lleva todos los bumps: ${o.name}${f.market_label ? ` (${f.market_label})` : ""}`,
        body: `Quien agrega los ${bumps.length} bumps no ve ninguna oferta después de pagar: la cadena está hecha con los mismos libros de los bumps y no se ofrece lo que ya tiene. Sumale un nivel con algo que no esté en el checkout (p. ej. la biblioteca completa).`,
      });
    } else fineAll.push(refAll);
    if (pp.steps && pp.levels) { fine.push(ref); continue; }
    missing.push(ref);
    await raiseAlert({
      kind: "offer_no_postpurchase", severity: "warn", storeId: o.store.id, ref, link: `/admin/o/${f.key}/post-compra`,
      title: `Oferta sin post-pago: ${o.name}${f.market_label ? ` (${f.market_label})` : ""}`,
      body: "Después de pagar no se le ofrece nada al comprador: no hay cadena post-compra activa para este checkout. Cargala (o activala) en Post-pago.",
    });
  }
  await resolveAlerts("offer_no_postpurchase", [...fine, ...fineAll]);
  return { checked: markets.length, missing: missing.length };
}
