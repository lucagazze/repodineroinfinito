import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/secrets";
import { verCuenta } from "@/lib/mercadopago";

/**
 * Conectar y desconectar la cuenta de Mercado Pago de una tienda.
 *
 * Mismo molde que whop-connect.ts, incluida la leccion que trae escrita: el
 * secreto de firma del webhook NO se crea desde aca y se recibe como
 * argumento. Mercado Pago lo muestra una sola vez, al crear el webhook en «Tus
 * integraciones», y sin el secreto correcto cada cobro real se rechaza por
 * firma invalida y nada se entrega. Recrear el webhook en silencio para
 * «arreglarlo» es la forma mas rapida de romper la acreditacion.
 */

/** La conexion de una tienda, con los secretos ya descifrados. */
export async function conexionDe(storeId: string) {
  const { data } = await db
    .from("store_mercadopago")
    .select("user_id,site_id,access_token_enc,webhook_secret_enc,livemode")
    .eq("store_id", storeId)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: (data.user_id as string | null) ?? null,
    siteId: (data.site_id as string | null) ?? null,
    token: decrypt(data.access_token_enc as string),
    webhookSecret: data.webhook_secret_enc ? decrypt(data.webhook_secret_enc as string) : null,
    livemode: !!data.livemode,
  };
}

/**
 * CONECTAR NO ES ACTIVAR, y son dos decisiones distintas.
 *
 * Hasta el 27/10/2026 esto cambiaba `stores.gateway` al conectar, asi que
 * guardar las credenciales apagaba la pasarela que estaba cobrando. Bruno
 * quiere justo lo contrario: dejar Mercado Pago montado y PROBADO --webhook
 * registrado, firma validando-- mientras Whop sigue cobrando, hasta ver si
 * logra habilitar el retiro de Whop.
 *
 * Por eso `activar` es false por defecto: conectar es seguro, y el cambio de
 * pasarela es un acto aparte y explicito.
 */
export async function connectMercadoPago(
  storeId: string,
  accessToken: string,
  webhookSecret: string | null,
  activar = false,
) {
  // EL PREFIJO PEGADO DOS VECES.
  //   Paso el 27/10/2026: el token llego como «APP_USR-APP_USR-3386...», 82
  //   caracteres en vez de 74 y seis bloques en vez de cinco. Mercado Pago
  //   contestaba `invalid_token` y un 403 de PolicyAgent, que no se parecen en
  //   nada a «lo pegaste dos veces». Se arregla aqui en vez de hacer que
  //   alguien lo descubra leyendo bloques separados por guiones.
  accessToken = accessToken.trim();
  while (/^(APP_USR-|TEST-)\1/.test(accessToken)) {
    accessToken = accessToken.replace(/^(APP_USR-|TEST-)/, "");
  }

  // La llave tiene que servir ANTES de guardarla: una llave invalida guardada
  // se descubre con la primera venta, que es el peor momento posible.
  let cuenta: { id?: number; nickname?: string; site_id?: string };
  try {
    cuenta = await verCuenta(accessToken);
  } catch (e) {
    throw new Error(`La llave de Mercado Pago no sirve: ${(e as Error).message.slice(0, 200)}`);
  }
  if (!cuenta?.id) {
    throw new Error("La llave respondio pero sin id de cuenta; no se guarda algo que no se pudo identificar.");
  }

  // TEST- es el prefijo de las credenciales de prueba. Guardar una de prueba
  // como si fuera real deja la tienda «conectada» y cobrando en un sandbox:
  // nadie paga nada y no hay ningun error que lo delate.
  const esPrueba = accessToken.startsWith("TEST-");

  await db.from("store_mercadopago").upsert({
    store_id: storeId,
    user_id: String(cuenta.id),
    site_id: cuenta.site_id ?? null,
    access_token_enc: encrypt(accessToken),
    ...(webhookSecret ? { webhook_secret_enc: encrypt(webhookSecret) } : {}),
    livemode: !esPrueba,
    connected_at: new Date().toISOString(),
  }, { onConflict: "store_id" });

  const { data: antes } = await db.from("stores").select("gateway").eq("id", storeId).maybeSingle();
  if (activar) {
    await db.from("stores").update({ gateway: "mercadopago" }).eq("id", storeId);
  }

  return {
    connected: String(cuenta.id),
    nickname: cuenta.nickname ?? null,
    site: cuenta.site_id ?? null,
    livemode: !esPrueba,
    gateway: activar ? "mercadopago" : (antes?.gateway ?? null),
    cobrando_con: activar
      ? "Mercado Pago (la tienda cambio de pasarela)"
      : `${antes?.gateway ?? "la de antes"} — Mercado Pago queda conectado pero NO cobra. Para activarlo: activate_mercadopago.`,
    signing_secret: webhookSecret ? "guardado" : "FALTA",
    warning: webhookSecret ? undefined
      : "Sin secreto de firma NADA se acredita: cada cobro real se rechaza. Crea el webhook en «Tus integraciones» de Mercado Pago y volve a conectar pegando su secreto.",
  };
}

export async function disconnectMercadoPago(storeId: string) {
  const { data } = await db
    .from("store_mercadopago").select("user_id").eq("store_id", storeId).maybeSingle();
  if (!data) throw new Error("La tienda no tiene Mercado Pago conectado.");
  await db.from("store_mercadopago").delete().eq("store_id", storeId);
  // Vuelve a Stripe, igual que al desconectar Whop: dejarla en "mercadopago"
  // sin conexion deja el checkout sin forma de cobrar y sin decir por que.
  await db.from("stores").update({ gateway: "stripe" }).eq("id", storeId);
  return { disconnected: (data.user_id as string | null) ?? "sin id" };
}

/**
 * Encender Mercado Pago: el acto aparte.
 *
 * Comprueba lo que hace falta ANTES de cambiar la pasarela, porque despues del
 * cambio el checkout ya esta cobrando por ahi: sin credenciales o sin secreto
 * de firma, cada compra entraria y no se entregaria nada.
 */
export async function activateMercadoPago(storeId: string) {
  const conn = await conexionDe(storeId);
  if (!conn) throw new Error("La tienda no tiene Mercado Pago conectado. Conectalo primero.");
  if (!conn.webhookSecret) {
    throw new Error(
      "Mercado Pago esta conectado pero SIN secreto de firma: cada cobro se rechazaria y no se entregaria nada. " +
      "Crea el webhook en «Tus integraciones» y volve a conectar pegando su secreto.");
  }
  const { data: antes } = await db.from("stores").select("gateway").eq("id", storeId).maybeSingle();
  await db.from("stores").update({ gateway: "mercadopago" }).eq("id", storeId);
  return {
    antes: antes?.gateway ?? null,
    ahora: "mercadopago",
    livemode: conn.livemode,
    siguiente: "Corre precios-ars.py --cargar: ahora enciende el mercado en pesos solo.",
  };
}
