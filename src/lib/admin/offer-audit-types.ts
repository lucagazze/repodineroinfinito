/**
 * Diagnóstico de ofertas (offer-audit.ts): lo que necesita también el
 * navegador (la tabla del Inicio), sin base de datos.
 */

export type CellStatus = "ok" | "warn" | "bad" | "off";
export type AuditCell = { status: CellStatus; label: string; detail?: string };

export const AUDIT_COLS = [
  ["landing", "Landing"],
  ["checkout", "Checkout"],
  ["pixel", "Pixel"],
  ["events", "Eventos 24 h"],
  ["bumps", "Bumps"],
  ["post", "Post-pago"],
  ["downsells", "Downsells"],
  ["delivery", "Entrega"],
  ["webhook", "Webhook"],
  ["recovery", "Recuperación"],
  ["recording", "Grabación"],
] as const;
export type AuditKey = (typeof AUDIT_COLS)[number][0];

export type OfferAuditRow = {
  /** El checkout (mercado): offerKey~slug. */
  key: string;
  offerKey: string;
  offer: string; alias: string; market: string; store: string; storeSlug: string;
  checkoutUrl: string; landingUrl: string | null;
  /** Lo peor de la fila (los «off» no cuentan). */
  status: CellStatus;
  cells: Record<AuditKey, AuditCell>;
};

const RANK: Record<CellStatus, number> = { bad: 0, warn: 1, ok: 2, off: 3 };
export const worst = (cells: AuditCell[]): CellStatus =>
  cells.filter((c) => c.status !== "off").reduce<CellStatus>((w, c) => (RANK[c.status] < RANK[w] ? c.status : w), "ok");
