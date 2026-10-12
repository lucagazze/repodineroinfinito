import type { StepMeta } from "./postpurchase";

/**
 * Nombre de cada paso para el panel y la simulación: «OTO 1», «Downsell 1»…
 * Varios OTO del mismo nivel son alternativas para compradores distintos
 * (según lo que compró en el checkout): comparten número, con letra
 * («OTO 1a», «OTO 1b», «OTO 1c»).
 */
export function stepLabels(meta: StepMeta[]) {
  const perLevel = new Map<number, number[]>();
  meta.forEach((m, i) => {
    if (m.kind === "downsell") return;
    perLevel.set(m.level, [...(perLevel.get(m.level) ?? []), i]);
  });
  const otoLabel = new Map<number, string>();
  for (const [level, idx] of perLevel) {
    idx.forEach((i, k) => otoLabel.set(i, idx.length > 1 ? `${level}${"abcdefghijklmnopqrstuvwxyz"[k] ?? k}` : `${level}`));
  }
  return meta.map((m, i) => (m.kind === "downsell" && m.parent !== null ? `Downsell ${otoLabel.get(m.parent) ?? m.level}` : `OTO ${otoLabel.get(i) ?? m.level}`));
}
