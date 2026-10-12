import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeForStore } from "@/lib/stripe";

/**
 * Trae los movimientos de saldo (balance transactions) de la cuenta de Stripe
 * de cada tienda a stripe_balance_txns: de ahí salen las comisiones REALES de
 * la fila de plata de Inicio. Solo lectura de Stripe.
 *
 * lo nuevo desde synced_until, y la primera vez una carga hacia
 * atrás de a tandas (backfill_cursor) hasta 2 días antes del primer pedido de
 * la tienda acá (lo anterior es de otras ventas y no hace falta).
 * Corre en el cron de Meta (cada 15 min); cada pasada hace como mucho unas
 * pocas páginas por tienda para no pasarse del tiempo del cron.
 */

const PAGE = 100;
const MAX_PAGES = 3;

type Row = {
  store_id: string; txn_id: string; type: string; reporting_category: string | null; created_at: string;
  amount: number; fee: number; net: number; currency: string; source_id: string | null; payment_intent: string | null;
  /** Quién pagó (email de la tarjeta o del recibo, o el cliente): junta en una compra sus cobros (056). */
  buyer: string | null;
  /** Cobro hecho por FUERA de la app (la plataforma anterior: metadata orderId + storeId), migración 058. */
  ext_order?: string | null; ext_store?: string | null; ext_post?: boolean | null;
  charge_amount?: number | null; charge_currency?: string | null;
};

function buyerOf(ch: Record<string, unknown>): string | null {
  const bd = ch.billing_details as { email?: string | null } | null | undefined;
  const email = bd?.email || (ch.receipt_email as string | null | undefined);
  if (email) return email.trim().toLowerCase();
  const cu = ch.customer;
  return typeof cu === "string" ? cu : cu && typeof cu === "object" ? ((cu as { id?: string }).id ?? null) : null;
}

function rowOf(storeId: string, t: Stripe.BalanceTransaction): Row {
  const src = t.source && typeof t.source === "object" ? (t.source as unknown as Record<string, unknown>) : null;
  const pi = src && src.object === "charge" ? src.payment_intent : src && src.object === "refund" ? src.payment_intent : null;
  return {
    store_id: storeId, txn_id: t.id, type: t.type, reporting_category: t.reporting_category ?? null,
    created_at: new Date(t.created * 1000).toISOString(),
    amount: t.amount / 100, fee: t.fee / 100, net: t.net / 100, currency: t.currency.toUpperCase(),
    source_id: (src?.id as string | undefined) ?? (typeof t.source === "string" ? t.source : null),
    payment_intent: typeof pi === "string" ? pi : pi && typeof pi === "object" ? ((pi as { id?: string }).id ?? null) : null,
    buyer: src && src.object === "charge" ? buyerOf(src) : null,
    ...extOf(src),
  };
}

/** Los cobros de la plataforma anterior traen metadata orderId + storeId; los de la app, store + funnel. */
function extOf(src: Record<string, unknown> | null): Partial<Row> {
  if (!src || src.object !== "charge" || src.status !== "succeeded") return {};
  const m = (src.metadata ?? {}) as Record<string, string>;
  if (!m.orderId || !m.storeId || m.store) return {};
  return {
    ext_order: m.orderId, ext_store: m.storeId, ext_post: m.isPostPurchase === "true",
    charge_amount: Number(src.amount ?? 0) / 100, charge_currency: String(src.currency ?? "").toUpperCase(),
  };
}



async function save(rows: Row[]) {
  if (!rows.length) return;
  const { error } = await db.from("stripe_balance_txns").upsert(rows, { onConflict: "store_id,txn_id" });
  if (error) throw new Error(`stripe_balance_txns: ${error.message}`);
}

export async function syncStoreBalance(storeId: string) {
  const s = await stripeForStore(storeId);
  if (!s.connected) return { storeId, skipped: "sin cuenta de Stripe conectada" };
  const { data: st } = await db.from("stripe_balance_sync").select("*").eq("store_id", storeId).maybeSingle();
  let state = st ?? { store_id: storeId, synced_until: 0, backfill_cursor: null as string | null, backfill_done: false, floor_at: null as string | null };
  let saved = 0;
  try {
    // Desde cuándo hace falta: 2 días antes del primer pedido de la tienda acá.
    if (!state.floor_at) {
      const { data: o } = await db.from("orders").select("created_at").eq("store_id", storeId).order("created_at", { ascending: true }).limit(1);
      const first = o?.[0]?.created_at ? new Date(o[0].created_at as string).getTime() : Date.now();
      state = { ...state, floor_at: new Date(first - 2 * 86_400_000).toISOString() };
    }
    const floor = Math.floor(new Date(state.floor_at!).getTime() / 1000);

    // 1) Carga inicial hacia atrás (de lo más nuevo a lo más viejo, desde el piso).
    if (!state.backfill_done) {
      let cursor = state.backfill_cursor;
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await s.stripe.balanceTransactions.list({
          limit: PAGE, created: { gte: floor }, expand: ["data.source"], ...(cursor ? { starting_after: cursor } : {}),
        });
        await save(page.data.map((t) => rowOf(storeId, t)));
        saved += page.data.length;
        // La primera página de todas marca hasta dónde está al día lo nuevo.
        if (!cursor && !state.synced_until) state = { ...state, synced_until: page.data[0]?.created ?? Math.floor(Date.now() / 1000) };
        if (!page.has_more || !page.data.length) { state = { ...state, backfill_done: true, backfill_cursor: null }; cursor = null; break; }
        cursor = page.data[page.data.length - 1].id;
        state = { ...state, backfill_cursor: cursor };
      }
    }

    // 2) Lo nuevo desde la última vez (de lo más nuevo hacia atrás hasta synced_until).
    if (state.synced_until) {
      let cursor: string | null = null, top = state.synced_until, done = false;
      for (let p = 0; p < MAX_PAGES; p++) {
        const page: Stripe.ApiList<Stripe.BalanceTransaction> = await s.stripe.balanceTransactions.list({
          limit: PAGE, created: { gt: state.synced_until }, expand: ["data.source"], ...(cursor ? { starting_after: cursor } : {}),
        });
        await save(page.data.map((t) => rowOf(storeId, t)));
        saved += page.data.length;
        for (const t of page.data) top = Math.max(top, t.created);
        if (!page.has_more || !page.data.length) { done = true; break; }
        cursor = page.data[page.data.length - 1].id;
      }
      // Solo se avanza si se trajo todo lo nuevo (si no, la próxima pasada sigue).
      if (done) state = { ...state, synced_until: top };
    }
    await db.from("stripe_balance_sync").upsert({ ...state, synced_at: new Date().toISOString(), error: null }, { onConflict: "store_id" });
    return { storeId, saved, backfillDone: state.backfill_done };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.from("stripe_balance_sync").upsert({ ...state, synced_at: new Date().toISOString(), error: msg }, { onConflict: "store_id" });
    return { storeId, saved, error: msg };
  }
}

/** Todas las tiendas con Stripe conectado, a la vez (cada una con su llave y su cuenta). */
export async function syncStripeBalances() {
  const { data } = await db.from("store_stripe").select("store_id");
  return Promise.all((data ?? []).map((r) => syncStoreBalance(r.store_id as string)));
}

/**
 * Las comisiones reales de esos PaymentIntents (pedidos y OTOs cobrados aparte), en USD.
 * found = cuántos de esos cobros ya están en la tabla (si faltan, el resto va estimado).
 */
export async function realFees(pis: string[], rates: Record<string, number>) {
  const want = [...new Set(pis.filter(Boolean))];
  let fee = 0;
  const found = new Set<string>();
  /** La comisión de cada cobro (USD), para repartirla por día. */
  const byPi = new Map<string, number>();
  for (let i = 0; i < want.length; i += 200) {
    const { data, error } = await db.from("stripe_balance_txns").select("payment_intent,fee,currency,type")
      .in("payment_intent", want.slice(i, i + 200)).in("type", ["charge", "payment"]);
    if (error) throw new Error(`stripe_balance_txns: ${error.message}`);
    for (const r of data ?? []) {
      const f = Number(r.fee ?? 0) / (rates[String(r.currency).toUpperCase()] ?? 1);
      fee += f;
      found.add(r.payment_intent as string);
      byPi.set(r.payment_intent as string, (byPi.get(r.payment_intent as string) ?? 0) + f);
    }
  }
  return { fee, found, byPi };
}
