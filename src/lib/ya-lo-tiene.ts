import { db } from "@/lib/db";
import { ownsProduct, overlapsOwned, type Owned } from "@/lib/postpurchase";

/**
 * No cobrarle dos veces el mismo libro.
 *
 * EL AGUJERO QUE TAPA, MEDIDO EL 29/10/2026
 *   `overlapsOwned` dice de si mismo «nunca se cobra dos veces un libro», y la
 *   biblioteca y el post-pago lo respetan. **El checkout no lo llamaba nunca.**
 *   En la tienda de Physics eso dejaba CINCO caminos abiertos, todos con su
 *   checkout propio y su link vivo en la landing:
 *
 *     tiene physics-illustrated GBP 13,99  ->  puede pagar final-solved      GBP 59,99
 *     tiene the-final-book      GBP 35,99  ->  puede pagar final-solved      GBP 59,99
 *     tiene physics-solved      GBP 11,99  ->  puede pagar final-solved      GBP 59,99
 *     tiene physics-illustrated GBP 13,99  ->  puede pagar kit-physics-solved GBP 24,99
 *     tiene physics-solved      GBP 11,99  ->  puede pagar kit-physics-solved GBP 24,99
 *
 * POR QUE VA EN LA RUTA DE PAGO Y NO EN LA PAGINA
 *   Al dibujar el checkout todavia no se sabe quien mira: no hay sesion y el
 *   mail aun no se escribio. La ruta de pago SI lo tiene. Es el primer momento
 *   del embudo en que la pregunta «¿esto ya lo compro?» se puede contestar.
 *
 * LA LINEA ENTRE FRENAR Y AVISAR
 *   Se frena solo el duplicado PURO --ya tiene todo lo que este producto
 *   entrega--. Si tiene una pieza de un pack de cuatro, las otras tres son una
 *   compra legitima y frenarla seria perder una venta de verdad: eso se
 *   registra y se deja pasar. Un falso positivo aca cuesta plata, asi que el
 *   corte es el estricto.
 *
 * REEMBOLSADOS NO CUENTAN. La biblioteca mira `paid` y `refunded` porque
 * muestra lo que tuvo; aca solo `paid`: a quien le devolvieron el dinero hay
 * que dejarlo comprar otra vez.
 */

export type Veredicto =
  | { duplicado: false; parcial: false }
  | { duplicado: false; parcial: true; piezas: string[] }
  | { duplicado: true; parcial: false };

/** Lo que este mail ya pago en esta tienda, con bases de variantes y contenido de packs. */
export async function loQueYaTiene(storeId: string, email: string): Promise<Set<string>> {
  const owned = new Set<string>();
  const mail = email.trim().toLowerCase();
  if (!mail || !mail.includes("@")) return owned;

  const { data: pedidos } = await db
    .from("orders")
    .select("id,order_items(product_id)")
    .eq("store_id", storeId)
    .ilike("email", mail)
    .eq("status", "paid")
    .limit(80);
  if (!pedidos?.length) return owned;

  const ids = [...new Set(
    pedidos.flatMap((o) => (o.order_items ?? []) as { product_id: string | null }[])
      .map((i) => i.product_id).filter((x): x is string => !!x),
  )];
  if (!ids.length) return owned;

  // Lo que cada compra arrastra: su base si es variante, y su contenido si es pack.
  const { data: prods } = await db
    .from("products").select("id,variant_of,includes").in("id", ids);
  for (const p of prods ?? []) {
    owned.add(p.id as string);
    if (p.variant_of) owned.add(p.variant_of as string);
    for (const x of ((p.includes as string[] | null) ?? [])) if (x) owned.add(x);
  }
  return owned;
}

/** ¿Hay que frenar este cobro? Solo si ya tiene TODO lo que el producto entrega. */
export async function revisarDuplicado(
  storeId: string, email: string, principal: Owned,
): Promise<Veredicto> {
  const owned = await loQueYaTiene(storeId, email);
  if (!owned.size) return { duplicado: false, parcial: false };
  if (ownsProduct(owned, principal)) return { duplicado: true, parcial: false };
  if (overlapsOwned(owned, principal)) {
    const piezas = ((principal.includes ?? []) as string[]).filter((id) => !!id && owned.has(id));
    return { duplicado: false, parcial: true, piezas };
  }
  return { duplicado: false, parcial: false };
}

/** El texto que ve el comprador. En su idioma, sin jerga y con una salida. */
export function textoDuplicado(locale: string | null | undefined): string {
  const es = (locale ?? "").toLowerCase().startsWith("es");
  return es
    ? "Esto ya lo tenés: lo compraste antes con este mismo correo. No te lo vamos a cobrar de nuevo — revisá tu biblioteca o escribinos y te lo reenviamos."
    : "You already own this — you bought it with this same email. We won't charge you twice. Check your library, or write to us and we'll resend it.";
}
