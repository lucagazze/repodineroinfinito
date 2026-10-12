/**
 * Piloto de pujas: la decisión de UN conjunto con límite de puja (bid cap), en
 * una función pura (sin base ni Meta): recibe los números y devuelve qué hacer.
 * La prueban scripts/test-pujas.mjs con casos inventados. Reglas:
 *
 *  - Tope de puja = 70 % del precio del front de la oferta en USD (`max`; el
 *    porcentaje se cambia en la página). Una puja por encima del tope baja al tope.
 *  - Arranque: un conjunto que el piloto ve por primera vez arranca EN el tope.
 *    (Los que ya existían no saltan: suben con la regla de «sin gastar».)
 *  - Sin gastar (menos de 3 USD en 3 h —1 USD por hora— y ninguna compra en
 *    24 h): sube 10 % (al menos 0,25), a lo sumo cada 3 h, hasta el tope.
 *  - Convirtiendo, pocos cambios:
 *      CPA 3 días (3+ compras) > objetivo → baja 10 %, solo si pasaron 72 h
 *      desde el último cambio;
 *      CPA 7 días ≤ 0,80 × objetivo con 10+ compras → sube 5 % por volumen,
 *      solo si pasaron 96 h desde el último cambio. Nunca arriba del tope.
 *  - Freno duro: CPA 3 días (3+ compras) > precio del front (100 %) → baja
 *    10 % aunque esté dentro de la espera (a lo sumo cada 24 h). Comprar más
 *    caro de lo que se vende es perder plata.
 *  - Gastando sin ninguna compra: más de 2 × objetivo desde el último cambio
 *    (en 24 h o más) → baja 10 % (cada 24 h).
 *  - Nunca más de ±15 % de una vez (salvo el arranque y bajar al tope),
 *    redondeado a 0,05; nunca por debajo del piso.
 *  - Si la puja en Meta no es la última que puso el piloto, la cambió el dueño a
 *    mano: ese conjunto queda quieto 24 h.
 *  - Escalera (los 3 conjuntos de una BID CAP armada desde un ganador, a 50 /
 *    60 / 70 % del precio): su puja NO se mueve; solo se apaga el escalón cuyo
 *    CPA 3 días (3+ compras) pasa el precio del front.
 *
 * Sin imports a propósito: se corre igual en el servidor y en la prueba.
 */

export type PilotInput = {
  now: number;
  /** La puja que tiene hoy en Meta (USD). */
  bid: number;
  /** Objetivo de CPA, tope de puja (70 % del front, o el que puso el dueño) y piso. */
  target: number; max: number; floor: number;
  /** Presupuesto diario (de la campaña o del conjunto), USD; null si no tiene. */
  dailyBudget: number | null;
  /** El conjunto y su campaña están entregando (ACTIVE). */
  active: boolean;
  /** Gasto de las últimas 3 h (la regla de «sin gastar») y de 12 h (para el registro). */
  spend3h: number;
  spend12h: number;
  purchases24h: number;
  spend72h: number; purchases72h: number;
  spend7d: number; purchases7d: number;
  /** Desde el último cambio del piloto (o desde que lo vio por primera vez), con su largo en horas. */
  spendSinceChange: number; purchasesSinceChange: number; hoursSinceChange: number;
  lastRaiseAt: number | null; lastLowerAt: number | null;
  /** La última puja que puso el piloto (null: todavía no tocó este conjunto). */
  lastSetBid: number | null;
  /** Hasta cuándo queda quieto porque el dueño la cambió a mano. */
  manualUntil: number | null;
  /** El precio del front de la oferta en USD (null: sin oferta vinculada). */
  frontUsd: number | null;
  /** El piloto lo ve por primera vez (arranca en el tope). */
  firstSight: boolean;
  /**
   * El tope es firme (sale del precio del libro o lo puso el dueño): una puja por encima baja al tope.
   * Sin oferta vinculada el tope (1,5 × objetivo) es una estimación: solo frena las subas.
   */
  maxIsFirm: boolean;
  /** Escalón de una escalera (puja fija): el piloto solo lo puede apagar. */
  ladder: boolean;
};

export type PilotState = "sin_gastar" | "en_objetivo" | "caro" | "barato" | "pocas_compras" | "a_mano" | "pausado" | "en_tope" | "en_piso" | "arranque" | "escalera";
export type Decision = {
  action: "raise" | "lower" | "hold" | "pause";
  bid: number;
  newBid: number | null;
  state: PilotState;
  /** Qué regla decidió (para el registro). */
  rule: string;
  /** En castellano, con los números: va al registro, al panel y al push. */
  reason: string;
  /** Si recién detectó un cambio a mano: hasta cuándo dejarlo quieto. */
  manualUntil?: number | null;
  /** Al vencer el «a mano»: tomar la puja de Meta como propia (desde ahí la cuida el piloto). */
  adopt?: boolean;
};

const H = 3600_000;
/** «Sin gastar»: menos de 3 USD en las últimas 3 h (1 USD por hora) y ninguna compra en 24 h; se revisa cada 3 h. */
export const STARVE_USD = 3;
export const STARVE_H = 3;
/** Esperas una vez que convierte: para bajar por CPA (72 h) y para subir por volumen (96 h). */
export const LOWER_WAIT_H = 72;
export const RAISE_WAIT_H = 96;
export const round05 = (n: number) => Math.round(n * 20) / 20;
const down05 = (n: number) => Math.floor(n * 20 + 1e-9) / 20;
const usd = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = (ms: number) => Math.max(0, Math.round(ms / H));

/**
 * El nuevo valor: el paso pedido, sin pasar de ±15 %, redondeado a 0,05 y distinto del actual.
 * Al subir no pasa del tope; al bajar no pasa del piso (una puja que ya estaba fuera de esos
 * límites, puesta a mano, no se lleva de golpe: se mueve de a pasos como cualquier otra).
 */
export function stepBid(bid: number, wanted: number, floor: number, max: number): number | null {
  if (wanted > bid) {
    let v = round05(Math.min(wanted, bid * 1.15, max));
    if (v <= bid + 1e-9) v = round05(bid + 0.05);
    if (v > max + 1e-9) v = Math.floor(max * 20) / 20;
    return v > bid + 1e-9 ? Math.round(v * 100) / 100 : null;
  }
  let v = round05(Math.max(wanted, bid * 0.85, floor));
  if (v >= bid - 1e-9) v = round05(bid - 0.05);
  if (v < floor - 1e-9) v = Math.ceil(floor * 20) / 20;
  return v < bid - 1e-9 ? Math.round(v * 100) / 100 : null;
}

export function decide(x: PilotInput): Decision {
  const base = { bid: x.bid, newBid: null as number | null };
  const hold = (state: PilotState, rule: string, reason: string, extra: Partial<Decision> = {}): Decision =>
    ({ ...base, action: "hold", state, rule, reason, ...extra });
  const cpa3 = x.purchases72h >= 3 ? x.spend72h / x.purchases72h : null;
  const overFront = cpa3 != null && x.frontUsd != null && x.frontUsd > 0 && cpa3 > x.frontUsd;

  // 0) Escalón de una escalera: la puja no se toca; se apaga si compra más caro que el front.
  if (x.ladder) {
    if (!x.active) return hold("pausado", "inactive", "No está entregando (pausado o en revisión).");
    if (overFront) {
      return { ...base, action: "pause", state: "caro", rule: "ladder_over_front", reason: `Escalón a ${usd(x.bid)}: CPA 3 días ${usd(cpa3!)} más caro que el front (${usd(x.frontUsd!)}, ${x.purchases72h} compras).` };
    }
    return hold("escalera", "ladder", `Escalón con puja fija en ${usd(x.bid)}${cpa3 != null ? ` · CPA 3 días ${usd(cpa3)}` : ""}.`);
  }

  // 1) Lo cambió el dueño a mano: 24 h quieto.
  if (x.manualUntil && x.now < x.manualUntil) {
    return hold("a_mano", "manual", `Cambiada a mano: quieta hasta dentro de ${hours(x.manualUntil - x.now)} h.`);
  }
  const expired = !!x.manualUntil && x.now >= x.manualUntil;
  if (!expired && x.lastSetBid != null && Math.abs(x.bid - x.lastSetBid) >= 0.005) {
    return hold("a_mano", "manual",
      `La puja está en ${usd(x.bid)} y el piloto había puesto ${usd(x.lastSetBid)}: la cambiaste a mano. Queda quieta 24 h.`,
      { manualUntil: x.now + 24 * H });
  }
  const adopt = expired ? { adopt: true } : {};

  // 2) No está entregando: nada que decidir.
  if (!x.active) return hold("pausado", "inactive", "No está entregando (pausada o en revisión).", adopt);

  const sinceRaise = x.lastRaiseAt == null ? Infinity : (x.now - x.lastRaiseAt) / H;
  const sinceLower = x.lastLowerAt == null ? Infinity : (x.now - x.lastLowerAt) / H;
  const top = down05(x.max);

  // 3) Por encima del tope firme: baja al tope (de una). Hasta 0,05 arriba es redondeo (15,67 con tope 15,65): no se toca.
  if (x.maxIsFirm && x.bid > top + 0.05 - 1e-9) {
    return { ...base, ...adopt, action: "lower", newBid: Math.max(top, Math.ceil(x.floor * 20) / 20), state: "en_tope", rule: "over_max", reason: `Estaba en ${usd(x.bid)}, arriba del tope de ${usd(top)}: baja al tope.` };
  }

  // 4) Freno duro: comprando más caro que el front, baja aunque esté dentro de la espera.
  if (overFront) {
    const nums = `CPA 3 días ${usd(cpa3!)} más caro que el front (${usd(x.frontUsd!)}, ${x.purchases72h} compras)`;
    if (x.bid <= x.floor + 1e-9) return hold("en_piso", "over_front_at_floor", `${nums}, pero ya está en el piso de ${usd(x.floor)}.`, adopt);
    if (sinceLower < 24) return hold("caro", "over_front_wait", `${nums}; la última baja fue hace ${Math.floor(sinceLower)} h: espera 24 h entre bajas.`, adopt);
    const nb = stepBid(x.bid, x.bid * 0.90, x.floor, x.max);
    if (nb == null) return hold("en_piso", "over_front_at_floor", `${nums}, sin margen hasta el piso.`, adopt);
    return { ...base, ...adopt, action: "lower", newBid: nb, state: "caro", rule: "over_front", reason: nums };
  }

  // 5) Arranque: la primera vez que lo ve, va al tope (70 % del precio del front).
  // (Solo con el precio del libro: sin oferta vinculada el tope es 1,5 × objetivo y no se arranca ahí.)
  if (x.firstSight && x.frontUsd != null && x.bid < top - 1e-9) {
    return { ...base, ...adopt, action: "raise", newBid: top, state: "arranque", rule: "start", reason: `Arranca en el tope: ${usd(top)}.` };
  }

  // 6) Sin gastar (menos de 3 USD en 3 h y sin compras en 24 h): subir hacia el tope.
  if (x.spend3h < STARVE_USD && x.purchases24h === 0) {
    const why = `${usd(x.spend3h)} gastados en ${STARVE_H} h (mínimo ${usd(STARVE_USD)}) y sin compras en 24 h`;
    if (x.bid >= top - 1e-9) return hold("en_tope", "starving_at_max", `Sin gastar (${why}) pero ya está en el tope de ${usd(top)}.`, adopt);
    if (sinceRaise < STARVE_H) return hold("sin_gastar", "starving_wait", `Sin gastar (${why}); la última suba fue hace ${Math.floor(sinceRaise)} h: espera ${STARVE_H} h entre subas.`, adopt);
    const nb = stepBid(x.bid, x.bid + Math.max(0.25, x.bid * 0.10), x.floor, top);
    if (nb == null) return hold("en_tope", "starving_at_max", `Sin gastar (${why}) y sin margen hasta el tope de ${usd(top)}.`, adopt);
    return { ...base, ...adopt, action: "raise", newBid: nb, state: "sin_gastar", rule: "starving", reason: `Sin gastar: ${why}.` };
  }

  // 7) Convirtiendo: pocos cambios.
  const since = Math.floor(x.hoursSinceChange);
  if (cpa3 != null && cpa3 > x.target) {
    const nums = `CPA 3 días ${usd(cpa3)} (obj. ${usd(x.target)}, ${x.purchases72h} compras)`;
    if (x.bid <= x.floor + 1e-9) return hold("en_piso", "expensive_at_floor", `Caro: ${nums}, pero ya está en el piso de ${usd(x.floor)}.`, adopt);
    if (x.hoursSinceChange < LOWER_WAIT_H) return hold("caro", "expensive_wait", `Caro: ${nums}; el último cambio fue hace ${since} h: espera ${LOWER_WAIT_H} h para bajar.`, adopt);
    const nb = stepBid(x.bid, x.bid * 0.90, x.floor, top);
    if (nb == null) return hold("en_piso", "expensive_at_floor", `Caro: ${nums}, sin margen hasta el piso.`, adopt);
    return { ...base, ...adopt, action: "lower", newBid: nb, state: "caro", rule: "expensive", reason: nums };
  }
  const cpa7 = x.purchases7d >= 10 ? x.spend7d / x.purchases7d : null;
  if (cpa7 != null && cpa7 <= 0.80 * x.target) {
    const nums = `CPA 7 días ${usd(cpa7)} (obj. ${usd(x.target)}, ${x.purchases7d} compras)`;
    if (x.bid >= top - 1e-9) return hold("en_tope", "cheap_at_max", `Barato: ${nums}; ya está en el tope de ${usd(top)}.`, adopt);
    if (x.hoursSinceChange < RAISE_WAIT_H) return hold("barato", "cheap_wait", `Barato: ${nums}; el último cambio fue hace ${since} h: espera ${RAISE_WAIT_H} h para subir.`, adopt);
    const nb = stepBid(x.bid, x.bid * 1.05, x.floor, top);
    if (nb == null) return hold("en_tope", "cheap_at_max", `Barato: ${nums}; sin margen hasta el tope.`, adopt);
    return { ...base, ...adopt, action: "raise", newBid: nb, state: "barato", rule: "cheap", reason: `${nums}: sube para tener más volumen.` };
  }
  if (cpa3 != null) return hold("en_objetivo", "on_target", `En objetivo: CPA 3 días ${usd(cpa3)} (obj. ${usd(x.target)}, ${x.purchases72h} compras).`, adopt);

  // 8) Gastando sin compras desde el último cambio (en 24 h o más).
  if (x.hoursSinceChange >= 24 && x.purchasesSinceChange === 0 && x.spendSinceChange > 2 * x.target) {
    const nums = `${usd(x.spendSinceChange)} gastados en ${Math.round(x.hoursSinceChange)} h sin compras (más de 2 × ${usd(x.target)})`;
    if (x.bid <= x.floor + 1e-9) return hold("en_piso", "no_sales_at_floor", `${nums}, pero ya está en el piso de ${usd(x.floor)}.`, adopt);
    if (sinceLower < 24) return hold("caro", "no_sales_wait", `${nums}; la última baja fue hace ${Math.floor(sinceLower)} h: espera 24 h.`, adopt);
    const nb = stepBid(x.bid, x.bid * 0.90, x.floor, top);
    if (nb == null) return hold("en_piso", "no_sales_at_floor", `${nums}, sin margen hasta el piso.`, adopt);
    return { ...base, ...adopt, action: "lower", newBid: nb, state: "caro", rule: "no_sales", reason: nums };
  }

  return hold("pocas_compras", "too_few",
    `Gastando (${usd(x.spend3h)} en 3 h) con pocas compras para juzgar: ${x.purchases72h} en 3 días.`, adopt);
}

/**
 * «CPA caro». Por
 * campaña, con el precio del front en USD (100 %, no el tope de puja): (a) CPA de 24 h más caro que
 * el front, con 2 compras o más (o 1 si ya gastó 2 × el front); (b) gastó 2 × el front o más en
 * 24 h sin ninguna venta; (c) CPA de 3 días (3 compras o más) más caro que el front. Devuelve el
 * texto corto del push o null. Con una sola venta o menos de 2 × el front gastado no avisa: a la mañana una venta cara sola disparaba el aviso y al rato el CPA ya estaba bien.
 */
export function cpaAlert(x: { front: number | null; spend24h: number; purchases24h: number; spend72h: number; purchases72h: number }):
  { rule: "cpa_24h" | "spend_no_sales" | "cpa_3d"; body: string } | null {
  if (x.front == null || !(x.front > 0)) return null;
  const price = `precio ${usd(x.front)} USD`;
  const enough = x.purchases24h >= 2 || x.spend24h >= 2 * x.front;
  if (x.purchases24h >= 1 && enough && x.spend24h / x.purchases24h > x.front) return { rule: "cpa_24h", body: `CPA 24 h ${usd(x.spend24h / x.purchases24h)} > ${price}` };
  if (x.purchases24h === 0 && x.spend24h >= 2 * x.front) return { rule: "spend_no_sales", body: `gastó ${usd(x.spend24h)} USD sin ventas en 24 h` };
  if (x.purchases72h >= 3 && x.spend72h / x.purchases72h > x.front) return { rule: "cpa_3d", body: `CPA 3 días ${usd(x.spend72h / x.purchases72h)} > ${price}` };
  return null;
}
