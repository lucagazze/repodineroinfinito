import Stripe from "stripe";
import { db } from "./db";
import { decrypt } from "./secrets";

/**
 * Cada tienda cobra en su propia cuenta de Stripe (cada marca). La llave se carga desde el panel y vive cifrada
 * en `store_stripe`. Si una tienda todavía no conectó la suya, se usa la de
 * STRIPE_SECRET_KEY (la de test en local).
 */

const clients = new Map<string, Stripe>();

export function stripeWith(secretKey: string): Stripe {
  let c = clients.get(secretKey);
  if (!c) {
    c = new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: "checkout-propio" } });
    clients.set(secretKey, c);
  }
  return c;
}

export type StoreStripe = {
  stripe: Stripe;
  publishableKey: string;
  livemode: boolean;
  accountId: string | null;
  /** false = la tienda no conectó su cuenta y corre con la llave del entorno. */
  connected: boolean;
};

type Row = { account_id: string; livemode: boolean; secret_key_enc: string; publishable_key: string };
const cache = new Map<string, { at: number; row: Row | null }>();

async function row(storeId: string): Promise<Row | null> {
  const hit = cache.get(storeId);
  if (hit && Date.now() - hit.at < 60_000) return hit.row;
  const { data, error } = await db
    .from("store_stripe")
    .select("account_id,livemode,secret_key_enc,publishable_key")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) {
    // La base falló: con la llave de la última lectura se sigue cobrando y entregando.
    if (hit?.row) {
      console.error("[stripe] store_stripe falló, uso la llave cacheada:", error.message);
      cache.set(storeId, { at: Date.now() - 50_000, row: hit.row }); // reintenta en 10 s
      return hit.row;
    }
    throw new Error(`store_stripe: ${error.message}`);
  }
  cache.set(storeId, { at: Date.now(), row: data });
  return data;
}

/** Olvida la llave cacheada (después de conectar o desconectar). */
export function forgetStoreStripe(storeId: string) {
  cache.delete(storeId);
}

export async function stripeForStore(storeId: string): Promise<StoreStripe> {
  const r = await row(storeId);
  if (r) {
    return {
      stripe: stripeWith(decrypt(r.secret_key_enc)),
      publishableKey: r.publishable_key,
      livemode: r.livemode,
      accountId: r.account_id,
      connected: true,
    };
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("La tienda no tiene Stripe conectado");
  return {
    stripe: stripeWith(key),
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PK ?? "",
    livemode: !/^(sk|rk)_test_/.test(key),
    accountId: null,
    connected: false,
  };
}

/** Link al pago en el dashboard de Stripe, en el modo que corresponde. */
export function dashboardUrl(s: Pick<StoreStripe, "livemode">, piId: string) {
  return `https://dashboard.stripe.com/${s.livemode ? "" : "test/"}payments/${piId}`;
}

/** La tienda dueña de un PaymentIntent, según el checkout que lo creó. */
export async function storeIdForPaymentIntent(piId: string): Promise<string | null> {
  const { data } = await db.from("checkouts").select("store_id").eq("stripe_payment_intent", piId).maybeSingle();
  if (data?.store_id) return data.store_id;
  const { data: o } = await db.from("orders").select("store_id").eq("stripe_payment_intent", piId).maybeSingle();
  return o?.store_id ?? null;
}
