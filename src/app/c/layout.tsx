import type { Viewport } from "next";

/**
 * Pantallas del comprador (checkout, ofertas post-pago y gracias): sin zoom.
 * maximumScale 1 evita además que el iPhone agrande la página al tocar un campo.
 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function BuyerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
