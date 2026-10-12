import { unstable_cache } from "next/cache";
import { stripeForStore } from "@/lib/stripe";

/**
 * Configuración › Dominios: el estado REAL de cada dirección pública de la
 * tienda, revisado en vivo desde el servidor (guardado ≤ 60 s):
 *  - DNS: a qué apunta el nombre (DNS sobre HTTPS de Cloudflare).
 *  - HTTPS: si la dirección responde y con qué código (sin seguir redirecciones;
 *    un certificado vencido o de otro dominio sale como error).
 *  - Apple Pay / Google Pay: si el dominio está dado de alta en la cuenta de
 *    Stripe de la tienda (solo lectura: paymentMethodDomains.list).
 */

export type DnsCheck = { status: "ok" | "missing" | "error"; records: { type: "CNAME" | "A"; data: string }[]; error?: string };
export type HttpCheck = { ok: boolean; status: number | null; location: string | null; ms: number; error: string | null };
export type WalletDomain = { host: string; enabled: boolean; apple: string | null; google: string | null };

export const hostOf = (u: string) => {
  try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.toLowerCase(); } catch { return u.toLowerCase(); }
};

async function dns(host: string): Promise<DnsCheck> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    const j = (await r.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    // 3 = el nombre no existe.
    if (j.Status === 3) return { status: "missing", records: [] };
    const records = (j.Answer ?? []).filter((a) => a.type === 5 || a.type === 1)
      .map((a) => ({ type: a.type === 5 ? "CNAME" as const : "A" as const, data: String(a.data).replace(/\.$/, "") }));
    return { status: records.length ? "ok" : "missing", records };
  } catch (e) {
    return { status: "error", records: [], error: (e as Error).message };
  }
}

const NET: Record<string, string> = {
  ENOTFOUND: "el nombre no existe en el DNS",
  EAI_AGAIN: "el DNS no respondió",
  ECONNREFUSED: "el servidor rechazó la conexión",
  ECONNRESET: "el servidor cortó la conexión",
  CERT_HAS_EXPIRED: "el certificado HTTPS está vencido",
  ERR_TLS_CERT_ALTNAME_INVALID: "el certificado HTTPS es de otro dominio",
  DEPTH_ZERO_SELF_SIGNED_CERT: "el certificado HTTPS no es válido",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "el certificado HTTPS no es válido",
  UND_ERR_CONNECT_TIMEOUT: "no respondió a tiempo",
};

/** Sin caché: el Diagnóstico revisa en el momento. */
export async function checkHttp(url: string): Promise<HttpCheck> {
  const t = Date.now();
  const init = { redirect: "manual" as const, cache: "no-store" as const, headers: { "user-agent": "checkout-panel (chequeo de dominios)" } };
  try {
    // HEAD alcanza para saber si responde; si el servidor no lo acepta, GET.
    let r = await fetch(url, { ...init, method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (r.status === 405 || r.status === 501) r = await fetch(url, { ...init, method: "GET", signal: AbortSignal.timeout(8000) });
    return { ok: r.status < 400, status: r.status, location: r.headers.get("location"), ms: Date.now() - t, error: null };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const code = err.cause?.code ?? (err.name === "TimeoutError" ? "UND_ERR_CONNECT_TIMEOUT" : "");
    return { ok: false, status: null, location: null, ms: Date.now() - t, error: NET[code] ?? err.cause?.message ?? err.message };
  }
}

export async function checkWallet(storeId: string): Promise<{ ok: true; domains: WalletDomain[] } | { ok: false; error: string; domains: WalletDomain[] }> {
  try {
    const { stripe } = await stripeForStore(storeId);
    const list = await stripe.paymentMethodDomains.list({ limit: 100 });
    return {
      ok: true,
      domains: list.data.map((d) => ({
        host: d.domain_name.toLowerCase(), enabled: d.enabled,
        apple: d.apple_pay?.status ?? null, google: d.google_pay?.status ?? null,
      })),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, domains: [] };
  }
}

export const dnsOf = (host: string) => unstable_cache(() => dns(host), ["dom-dns", host], { revalidate: 60 })();
export const httpOf = (url: string) => unstable_cache(() => checkHttp(url), ["dom-http", url], { revalidate: 60 })();
export const walletOf = (storeId: string) => unstable_cache(() => checkWallet(storeId), ["dom-wallet", storeId], { revalidate: 60 })();
