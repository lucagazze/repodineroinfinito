/**
 * Modo captura: nombres neutros para mostrar en lugar de lo que identifica
 * el negocio (ofertas, productos, tiendas, compradores). Fijos por id, así la
 * misma cosa se llama igual en todas las pantallas y en cada captura.
 */

function code(id: string, letters = 2) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  let out = "";
  for (let i = 0; i < letters; i++) { out += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26); }
  return out;
}

export const productAlias = (id: string) => `Producto ${code(id)}`;
export const storeAlias = (id: string) => `Tienda ${code(id, 1)}`;
export const campaignAlias = (id: string) => `Campaña ${code(id, 3)}`;
export const checkoutAlias = (market: string | null | undefined) => (market ? `Checkout · ${market}` : "Checkout");
export const BUYER = "Cliente ••••";
export const EMAIL = "••••••@••••.com";
export const HIDDEN = "••••••";
