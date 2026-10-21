import { db } from "@/lib/db";
import { encrypt } from "@/lib/secrets";
import { verCuenta } from "@/lib/whop";

/**
 * Conectar y desconectar la cuenta de Whop de una tienda.
 *
 * Existe porque Whop entro al sistema por un script suelto y no por las
 * herramientas de la plataforma: el panel podia DIAGNOSTICAR un problema de
 * Whop pero no arreglarlo, y una tienda nueva no se podia dar de alta con Whop
 * por el camino normal. Stripe siempre tuvo connect/disconnect; esto empareja.
 *
 * Lo que NO se hace aca: crear el webhook. Whop solo devuelve su secreto de
 * firma en la respuesta de creacion, y perderlo significa que cada pago
 * cobrado se rechaza y nada se entrega. Por eso el secreto se recibe como
 * argumento: quien crea el webhook lo tiene delante y lo pega. Adivinarlo o
 * recrear el webhook en silencio es la forma mas rapida de romper la entrega.
 */

const API = "https://api.whop.com/api/v1";

export async function connectWhop(
  storeId: string,
  apiKey: string,
  companyId: string,
  webhookSecret: string | null,
  webhookId: string | null,
) {
  // La llave tiene que servir ANTES de guardarla: una llave invalida guardada
  // se descubre con la primera venta, que es el peor momento posible.
  const r = await fetch(`${API}/webhooks?account_id=${encodeURIComponent(companyId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`La llave no sirve para la cuenta ${companyId}: HTTP ${r.status} ${t.slice(0, 160)}`);
  }

  // De paso, de quien es la llave.
  let quien: string | null = null;
  try { quien = (await verCuenta(apiKey))?.id ?? null; } catch { /* /me puede no estar permitido */ }

  await db.from("store_whop").upsert({
    store_id: storeId,
    company_id: companyId,
    api_key_enc: encrypt(apiKey),
    ...(webhookSecret ? { webhook_secret_enc: encrypt(webhookSecret) } : {}),
    ...(webhookId ? { webhook_id: webhookId } : {}),
    livemode: true,
    connected_at: new Date().toISOString(),
  }, { onConflict: "store_id" });

  // La tienda pasa a cobrar con Whop. Sin esto el checkout sigue montando
  // Stripe y la conexion no sirve de nada.
  await db.from("stores").update({ gateway: "whop" }).eq("id", storeId);

  return {
    connected: companyId,
    key_owner: quien,
    webhook: webhookId,
    signing_secret: webhookSecret ? "guardado" : "FALTA",
    warning: webhookSecret ? undefined
      : "Sin secreto de firma NADA se entrega: cada pago cobrado se rechaza. Rehace el webhook en Whop y volve a conectar pegando su ws_.",
  };
}

export async function disconnectWhop(storeId: string) {
  const { data } = await db.from("store_whop").select("company_id").eq("store_id", storeId).maybeSingle();
  if (!data) throw new Error("La tienda no tiene Whop conectado.");
  await db.from("store_whop").delete().eq("store_id", storeId);
  // Vuelve a Stripe: dejarla en "whop" sin conexion deja el checkout sin forma
  // de cobrar y sin decir por que.
  await db.from("stores").update({ gateway: "stripe" }).eq("id", storeId);
  return { disconnected: data.company_id as string };
}
