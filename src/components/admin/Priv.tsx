import type { ReactNode } from "react";

/**
 * Lo que identifica al negocio, envuelto para el modo captura: con la clase
 * «privacy» en el panel se oculta el texto real y se muestra `as`. Es solo
 * CSS (admin.css): funciona igual en server y client components y no hay
 * parpadeo al navegar.
 */
export function Pv({ as, children }: { as: string; children: ReactNode }) {
  return <span className="pv" data-pv={as}><span className="pv-real">{children}</span></span>;
}
