
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3021").replace(/\/$/, "");

/**
 * Manda el mail de recuperación de un carrito, a mano (MCP «send_recovery»):
 * el mail con IA y el descuento firmado de cart-recovery.ts, sin esperar los
 * minutos de inactividad. Sigue sin mandarse a quien ya compró, se dio de
 * baja, rebotó, es de prueba o es de Alemania/Austria.
 */
export async function recoverCheckout(checkoutId: string) {
  const { recoverCart } = await import("./cart-recovery");
  const r = await recoverCart(checkoutId, { force: true });
  return "sent" in r ? { sent: r.sent } : { skipped: "skipped" in r ? r.skipped : "vista previa" };
}
