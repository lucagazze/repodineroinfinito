/** Lo que devuelve toda server action del panel: un mensaje para mostrar al lado del botón. */
export type ActionResult = {
  ok?: string;
  error?: string;
  /** Renglones extra (advertencias, detalle de lo que se hizo). */
  details?: string[];
  /** Datos para el componente que llamó (p. ej. el token recién creado). */
  data?: Record<string, unknown>;
};
