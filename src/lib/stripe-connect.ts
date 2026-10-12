import type Stripe from "stripe";
import { db } from "./db";
import { encrypt, decrypt } from "./secrets";
import { stripeWith, forgetStoreStripe } from "./stripe";

/**
 * Conectar la cuenta de Stripe de una tienda pegando sus dos llaves.
 *
 * Todo lo que en la plataforma anterior era a mano lo hace esto solo: valida las llaves,
 * crea el webhook apuntando a esta tienda (y guarda su secreto), y registra los
 * dominios para que aparezcan Apple Pay y Google Pay.
 */

export const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
];

/** La versión de la API con la que está escrito el SDK: los eventos llegan con esa forma. */
const API_VERSION = "2025-08-27.basil";

export function publicBaseUrl() {
  const u = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return u.replace(/\/+$/, "");
}

export const webhookUrl = (storeId: string) => `${publicBaseUrl()}/api/stripe/webhook/${storeId}`;

export type ConnectResult = {
  accountId: string;
  accountName: string | null;
  livemode: boolean;
  chargesEnabled: boolean;
  webhook: "creado" | "error";
  applePay: { domain: string; ok: boolean; error?: string }[];
  warnings: string[];
};

export async function connectStripe(storeId: string, secretKey: string, publishableKey: string): Promise<ConnectResult> {
  secretKey = secretKey.trim();
  publishableKey = publishableKey.trim();
  const sk = secretKey.match(/^(sk|rk)_(live|test)_/);
  const pk = publishableKey.match(/^pk_(live|test)_/);
  if (!sk) throw new Error("La llave secreta tiene que empezar con sk_live_, rk_live_ (o _test_).");
  if (!pk) throw new Error("La llave publicable tiene que empezar con pk_live_ (o pk_test_).");
  if (sk[2] !== pk[1]) throw new Error("Una llave es de modo live y la otra de test: tienen que ser del mismo modo.");

  const stripe = stripeWith(secretKey);
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve();
  } catch (e) {
    throw new Error(`Stripe rechazó la llave secreta: ${(e as Error).message}`);
  }

  // Las llaves nuevas llevan el id de la cuenta adentro: así detectamos una
  // publicable de otra cuenta, que haría fallar el checkout sin explicación.
  const frag = account.id.replace(/^acct_/, "");
  if (secretKey.includes(frag) && !publishableKey.includes(frag)) {
    throw new Error("La llave publicable es de otra cuenta de Stripe.");
  }

  const warnings: string[] = [];
  const base = publicBaseUrl();
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) {
    throw new Error("Falta PUBLIC_BASE_URL con la dirección pública (https) de la app: Stripe no puede avisar a localhost.");
  }

  // Webhook: Stripe solo muestra el secreto al crearlo, así que si ya había
  // uno nuestro para esta tienda se borra y se crea de nuevo.
  const url = webhookUrl(storeId);
  let endpoint: Stripe.WebhookEndpoint;
  try {
    const existing = await stripe.webhookEndpoints.list({ limit: 100 });
    for (const w of existing.data) if (w.url === url) await stripe.webhookEndpoints.del(w.id);
    endpoint = await stripe.webhookEndpoints.create({
      url,
      enabled_events: WEBHOOK_EVENTS,
      api_version: API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
      description: "checkout-propio (no borrar: entrega los pedidos)",
      metadata: { source: "checkout-propio", store_id: storeId },
    });
  } catch (e) {
    throw new Error(`No se pudo crear el webhook en Stripe: ${(e as Error).message}`);
  }

  const applePay = await registerDomains(stripe, storeId);
  for (const d of applePay) if (!d.ok) warnings.push(`Apple Pay en ${d.domain}: ${d.error}`);
  if (!account.charges_enabled) warnings.push("La cuenta de Stripe todavía no tiene los cobros habilitados.");

  const { error } = await db.from("store_stripe").upsert({
    store_id: storeId,
    account_id: account.id,
    account_name: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null,
    livemode: sk[2] === "live",
    secret_key_enc: encrypt(secretKey),
    publishable_key: publishableKey,
    webhook_endpoint_id: endpoint.id,
    webhook_secret_enc: encrypt(endpoint.secret!),
    apple_pay_domains: applePay.filter((d) => d.ok).map((d) => d.domain),
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`No se pudo guardar la conexión: ${error.message}`);
  forgetStoreStripe(storeId);

  return {
    accountId: account.id,
    accountName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null,
    livemode: sk[2] === "live",
    chargesEnabled: !!account.charges_enabled,
    webhook: "creado",
    applePay,
    warnings,
  };
}

/** Dominios desde donde se cobra: el propio de la tienda y el de la app. */
async function checkoutDomains(storeId: string) {
  const [{ data }, { data: funnels }] = await Promise.all([
    db.from("stores").select("domain").eq("id", storeId).single(),
    // Cada checkout se sirve en su subdominio de pagos (pay.tumarca.com…).
    db.from("funnels").select("checkout_host").eq("store_id", storeId).not("checkout_host", "is", null),
  ]);
  const hosts = [data?.domain, publicBaseUrl().replace(/^https?:\/\//, ""), ...(funnels ?? []).map((f) => f.checkout_host as string)]
    .filter((h): h is string => !!h)
    .map((h) => h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase());
  return [...new Set(hosts)];
}

export async function registerDomains(stripe: Stripe, storeId: string) {
  const out: ConnectResult["applePay"] = [];
  for (const domain of await checkoutDomains(storeId)) {
    try {
      await stripe.paymentMethodDomains.create({ domain_name: domain });
      out.push({ domain, ok: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // Ya registrado = está bien.
      if (err.code === "resource_already_exists" || /already/i.test(err.message ?? "")) out.push({ domain, ok: true });
      else out.push({ domain, ok: false, error: err.message ?? "error" });
    }
  }
  return out;
}

export async function disconnectStripe(storeId: string) {
  const { data } = await db.from("store_stripe").select("secret_key_enc,webhook_endpoint_id").eq("store_id", storeId).maybeSingle();
  if (data?.webhook_endpoint_id) {
    await stripeWith(decrypt(data.secret_key_enc)).webhookEndpoints.del(data.webhook_endpoint_id).catch(() => {});
  }
  await db.from("store_stripe").delete().eq("store_id", storeId);
  forgetStoreStripe(storeId);
}

export type StripeHealth = {
  connected: boolean;
  accountId?: string;
  accountName?: string | null;
  livemode?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  webhookOk?: boolean;
  webhookUrlOk?: boolean;
  lastEventAt?: string | null;
  applePayDomains?: string[];
  error?: string;
};

/** Para el panel y el diagnóstico: ¿esta tienda puede cobrar y entregar? */
export async function stripeHealth(storeId: string): Promise<StripeHealth> {
  const { data } = await db
    .from("store_stripe")
    .select("account_id,account_name,livemode,secret_key_enc,webhook_endpoint_id,apple_pay_domains,last_event_at")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data) return { connected: false };
  const out: StripeHealth = {
    connected: true,
    accountId: data.account_id,
    accountName: data.account_name,
    livemode: data.livemode,
    lastEventAt: data.last_event_at,
    applePayDomains: data.apple_pay_domains,
  };
  try {
    const s = stripeWith(decrypt(data.secret_key_enc));
    const acct = await s.accounts.retrieve();
    out.chargesEnabled = !!acct.charges_enabled;
    out.payoutsEnabled = !!acct.payouts_enabled;
    if (data.webhook_endpoint_id) {
      const w = await s.webhookEndpoints.retrieve(data.webhook_endpoint_id);
      out.webhookOk = w.status === "enabled";
      out.webhookUrlOk = w.url === webhookUrl(storeId);
    } else out.webhookOk = false;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}
