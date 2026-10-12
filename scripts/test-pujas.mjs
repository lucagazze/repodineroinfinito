// Pruebas del piloto de pujas (la decisión, con casos inventados). Correr:
//   node --experimental-strip-types --test scripts/test-pujas.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { decide, stepBid, cpaAlert } = await import("../src/lib/bid-pilot/decide.ts");

const H = 3600_000;
const NOW = Date.parse("2026-10-07T15:00:00Z");
/**
 * Un conjunto «normal» que ya convierte: objetivo 10, tope 15, piso 3, 500/día, CPA 3 días 10 (en
 * objetivo), CPA 7 días 12, último cambio hace 100 h, sin precio del front.
 */
const base = (over = {}) => ({
  now: NOW, bid: 13, target: 10, max: 15, floor: 3, dailyBudget: 500, active: true,
  spend3h: 25, spend12h: 50, purchases24h: 4, spend72h: 120, purchases72h: 12, spend7d: 240, purchases7d: 20,
  spendSinceChange: 300, purchasesSinceChange: 25, hoursSinceChange: 100,
  lastRaiseAt: null, lastLowerAt: null, lastSetBid: null, manualUntil: null,
  frontUsd: null, firstSight: false, ladder: false, maxIsFirm: true, ...over,
});
/** Sin gastar: menos de 3 USD en 3 h y ninguna compra en 24 h. */
const starving = (over = {}) => base({ spend3h: 0, purchases24h: 0, spend72h: 20, purchases72h: 1, spend7d: 40, purchases7d: 2, ...over });

test("en objetivo: se queda", () => {
  const d = decide(base());
  assert.equal(d.action, "hold"); assert.equal(d.state, "en_objetivo");
});

// ------------------------------------------------------------------ arranque y tope

test("arranque: la primera vez que lo ve, va al tope de una (70 % del front)", () => {
  // Oferta USA: front 27 → tope 18,90.
  const d = decide(base({ bid: 10, max: 18.9, frontUsd: 27, firstSight: true }));
  assert.equal(d.action, "raise"); assert.equal(d.rule, "start"); assert.equal(d.newBid, 18.9);
  // Sin precio del libro (sin oferta vinculada) no arranca en el tope de 1,5 × objetivo.
  assert.notEqual(decide(base({ bid: 10, max: 22.5, frontUsd: null, firstSight: true })).rule, "start");
  // Si ya está en el tope, no hace nada por arranque.
  assert.notEqual(decide(base({ bid: 15, max: 15, firstSight: true })).rule, "start");
});
test("los que ya existían no saltan: suben de a 10 % con «sin gastar»", () => {
  const d = decide(starving({ bid: 14.3, max: 18.9, frontUsd: 27 }));
  assert.equal(d.rule, "starving"); assert.equal(d.newBid, 15.75); // 14,30 × 1,10 = 15,73 → 15,75
});
test("por encima del tope: baja al tope de una", () => {
  // Front EUR 14,90 ≈ 16,79 USD → tope 11,75; venía en 14,30.
  const d = decide(base({ bid: 14.3, max: 11.75, frontUsd: 16.79 }));
  assert.equal(d.action, "lower"); assert.equal(d.rule, "over_max"); assert.equal(d.newBid, 11.75);
});
test("por encima del tope: lo que es redondeo (15,67 con tope 15,65) no se toca", () => {
  assert.notEqual(decide(base({ bid: 15.67, max: 15.65, frontUsd: 22.39 })).rule, "over_max");
  assert.equal(decide(starving({ bid: 15.67, max: 15.65, frontUsd: 22.39 })).rule, "starving_at_max");
  assert.equal(decide(base({ bid: 15.71, max: 15.65, frontUsd: 22.39 })).rule, "over_max");
});
test("sin oferta vinculada el tope (1,5 × objetivo) no baja pujas: solo frena las subas", () => {
  const d = decide(base({ bid: 15.67, max: 15, frontUsd: null, maxIsFirm: false }));
  assert.notEqual(d.rule, "over_max");
  assert.equal(decide(starving({ bid: 15.67, max: 15, frontUsd: null, maxIsFirm: false })).rule, "starving_at_max");
  // Con el tope puesto a mano sí es firme.
  assert.equal(decide(base({ bid: 15.67, max: 15, frontUsd: null, maxIsFirm: true })).rule, "over_max");
});

// ------------------------------------------------------------------ sin gastar

test("sin gastar: < 3 USD en 3 h y 0 compras en 24 h → +10 %, redondeado a 0,05", () => {
  const d = decide(starving());
  assert.equal(d.action, "raise"); assert.equal(d.newBid, 14.3); assert.equal(d.rule, "starving");
  assert.equal(decide(starving({ spend3h: 2.99 })).rule, "starving");
  assert.notEqual(decide(starving({ spend3h: 3.01 })).rule, "starving");
});
test("sin gastar: con una compra en 24 h ya no cuenta como «sin gastar»", () => {
  assert.notEqual(decide(starving({ purchases24h: 1 })).rule, "starving");
});
test("sin gastar: el presupuesto no cambia el umbral (500 USD/día)", () => {
  assert.equal(decide(starving({ dailyBudget: 500, spend3h: 2, spend12h: 40 })).rule, "starving");
  assert.equal(decide(starving({ dailyBudget: null, spend3h: 2.5 })).action, "raise");
});
test("sin gastar: mínimo +0,25 pero nunca más de +15 %", () => {
  assert.equal(decide(starving({ bid: 2, floor: 0.6 })).newBid, 2.25); // +10 % = 0,20 → +0,25
  assert.equal(decide(starving({ bid: 1, floor: 0.6 })).newBid, 1.15); // +0,25 sería 25 % → tope 15 %
});
test("sin gastar: nunca pasa el tope (Oferta USA 18,90) y espera 3 h entre subas", () => {
  assert.equal(decide(starving({ bid: 18, max: 18.9 })).newBid, 18.9);
  assert.equal(decide(starving({ bid: 18.9, max: 18.9 })).rule, "starving_at_max");
  assert.equal(decide(starving({ lastRaiseAt: NOW - 2 * H })).rule, "starving_wait");
  assert.equal(decide(starving({ lastRaiseAt: NOW - 3 * H })).action, "raise");
});

// ------------------------------------------------------------------ convirtiendo: pocos cambios

test("caro: CPA 3 días > objetivo → baja 10 %, solo con 72 h desde el último cambio", () => {
  const d = decide(base({ spend72h: 120, purchases72h: 10 })); // CPA 12
  assert.equal(d.action, "lower"); assert.equal(d.rule, "expensive"); assert.equal(d.newBid, 11.7);
  const wait = decide(base({ spend72h: 120, purchases72h: 10, hoursSinceChange: 71 }));
  assert.equal(wait.action, "hold"); assert.equal(wait.rule, "expensive_wait");
  assert.equal(decide(base({ spend72h: 120, purchases72h: 10, hoursSinceChange: 72 })).action, "lower");
});
test("caro: el borde es estricto (CPA 10,00 con objetivo 10 se queda)", () => {
  assert.equal(decide(base({ spend72h: 100, purchases72h: 10 })).action, "hold");
  assert.equal(decide(base({ spend72h: 100.1, purchases72h: 10 })).action, "lower");
});
test("barato: CPA 7 días ≤ 0,80 × objetivo con 10+ compras → +5 %, solo con 96 h desde el último cambio", () => {
  const d = decide(base({ spend7d: 80, purchases7d: 10 })); // CPA 7 días 8
  assert.equal(d.action, "raise"); assert.equal(d.rule, "cheap"); assert.equal(d.newBid, 13.65);
  assert.equal(decide(base({ spend7d: 80, purchases7d: 10, hoursSinceChange: 95 })).rule, "cheap_wait");
  assert.equal(decide(base({ spend7d: 72, purchases7d: 9 })).rule, "on_target"); // 9 compras: no alcanza
  assert.equal(decide(base({ bid: 15, spend7d: 80, purchases7d: 10 })).state, "en_tope");
  assert.equal(decide(base({ bid: 14.9, spend7d: 80, purchases7d: 10 })).newBid, 15); // nunca arriba del tope
});
test("con menos de 3 compras en 3 días no se juzga el CPA", () => {
  const d = decide(base({ spend72h: 90, purchases72h: 2, spend7d: 90, purchases7d: 2, spendSinceChange: 15, purchasesSinceChange: 2 }));
  assert.equal(d.action, "hold"); assert.equal(d.state, "pocas_compras");
});

// ------------------------------------------------------------------ freno duro (precio del front)

test("freno duro: CPA 3 días > precio del front → baja aunque esté en la espera de 72 h", () => {
  // Objetivo 15 (USA), front 13,40: CPA 14 está «en objetivo» pero pierde plata; último cambio hace 10 h.
  const d = decide(base({ target: 15, max: 9.35, bid: 9.35, spend72h: 140, purchases72h: 10, frontUsd: 13.4, hoursSinceChange: 10 }));
  assert.equal(d.action, "lower"); assert.equal(d.rule, "over_front"); assert.equal(d.newBid, 8.4);
  assert.match(d.reason, /más caro que el front/);
});
test("freno duro: a lo sumo una baja cada 24 h y nunca bajo el piso", () => {
  assert.equal(decide(base({ spend72h: 60, purchases72h: 3, frontUsd: 19, lastLowerAt: NOW - 5 * H })).rule, "over_front_wait");
  assert.equal(decide(base({ bid: 3, spend72h: 60, purchases72h: 3, frontUsd: 19 })).rule, "over_front_at_floor");
});
test("freno duro: gana aun «sin gastar»; con menos de 3 compras no actúa", () => {
  assert.equal(decide(starving({ spend72h: 60, purchases72h: 3, frontUsd: 19 })).rule, "over_front");
  assert.equal(decide(base({ spend72h: 60, purchases72h: 2, spend7d: 60, purchases7d: 2, frontUsd: 19, spendSinceChange: 10 })).rule, "too_few");
  assert.equal(decide(base({ frontUsd: 22.4 })).rule, "on_target"); // CPA 10 < 22,40
});

// ------------------------------------------------------------------ gasta sin compras

test("gasta sin compras: más de 2 × objetivo desde el último cambio (24 h o más) → baja 10 %", () => {
  const nos = (o) => base({ purchases24h: 0, spend72h: 30, purchases72h: 0, spend7d: 30, purchases7d: 0, purchasesSinceChange: 0, ...o });
  const d = decide(nos({ spendSinceChange: 21, hoursSinceChange: 30 }));
  assert.equal(d.action, "lower"); assert.equal(d.newBid, 11.7); assert.equal(d.rule, "no_sales");
  assert.equal(decide(nos({ spendSinceChange: 21, hoursSinceChange: 20 })).action, "hold"); // < 24 h
  assert.equal(decide(nos({ spendSinceChange: 20, hoursSinceChange: 30 })).action, "hold"); // justo 2 ×
});

// ------------------------------------------------------------------ escalera

test("escalera: la puja nunca se mueve; solo se apaga si el CPA 3 días pasa el precio del front", () => {
  const rung = (o) => base({ ladder: true, bid: 13.5, frontUsd: 27, ...o });
  const off = decide(rung({ spend72h: 100, purchases72h: 3 })); // CPA 33,33 > 27
  assert.equal(off.action, "pause"); assert.equal(off.rule, "ladder_over_front");
  assert.equal(decide(rung({ spend72h: 60, purchases72h: 3 })).action, "hold");          // CPA 20
  assert.equal(decide(rung({ spend72h: 100, purchases72h: 2 })).action, "hold");         // 2 compras
  assert.equal(decide(rung({ spend3h: 0, purchases24h: 0 })).action, "hold");            // sin gastar: no sube
  assert.equal(decide(rung({ bid: 30, max: 18.9 })).action, "hold");                     // ni baja al tope
  assert.equal(decide(rung({ active: false, spend72h: 100, purchases72h: 3 })).action, "hold");
});

// ------------------------------------------------------------------ a mano y otros

test("cambiada a mano: la detecta y la deja 24 h", () => {
  const d = decide(starving({ bid: 12, lastSetBid: 13 }));
  assert.equal(d.action, "hold"); assert.equal(d.state, "a_mano");
  assert.equal(d.manualUntil, NOW + 24 * H);
  const still = decide(starving({ bid: 12, lastSetBid: 13, manualUntil: NOW + 3 * H }));
  assert.equal(still.action, "hold"); assert.equal(still.state, "a_mano");
  // Vencidas las 24 h: toma la puja de Meta como propia y vuelve a decidir.
  const back = decide(starving({ bid: 12, lastSetBid: 13, manualUntil: NOW - 1 }));
  assert.equal(back.adopt, true); assert.equal(back.action, "raise"); assert.equal(back.newBid, 13.2);
});
test("lo que puso el propio piloto no cuenta como cambio a mano", () => {
  assert.notEqual(decide(base({ bid: 13, lastSetBid: 13 })).state, "a_mano");
});
test("pausada o en revisión: no se toca", () => {
  const d = decide(starving({ active: false }));
  assert.equal(d.action, "hold"); assert.equal(d.state, "pausado");
});
test("nunca baja del piso", () => {
  const d = decide(base({ bid: 3.2, spend72h: 200, purchases72h: 10 }));
  assert.equal(d.action, "lower"); assert.equal(d.newBid, 3);
  const at = decide(base({ bid: 3, spend72h: 200, purchases72h: 10 }));
  assert.equal(at.action, "hold"); assert.equal(at.state, "en_piso");
});
test("stepBid: siempre múltiplos de 0,05, distinto del actual y dentro de ±15 %", () => {
  for (const bid of [0.5, 1, 3.33, 9.5, 13, 21.95]) {
    for (const f of [0.5, 0.9, 1.05, 1.1, 2]) {
      const v = stepBid(bid, bid * f, 0.3, 22.5);
      if (v == null) continue;
      assert.ok(Math.abs(v * 20 - Math.round(v * 20)) < 1e-9, `${v} no es múltiplo de 0,05`);
      assert.notEqual(v, bid);
      assert.ok(v <= bid * 1.15 + 0.05 && v >= bid * 0.85 - 0.05, `${bid} → ${v} pasa de ±15 %`);
      assert.ok(v <= 22.5 && v >= 0.3);
    }
  }
});

// ------------------------------------------------------------------ «CPA caro» (a 100 % del precio)

test("CPA caro (a): CPA de 24 h más caro que el front, con 2 compras o más", () => {
  const a = cpaAlert({ front: 27, spend24h: 62.4, purchases24h: 2, spend72h: 80, purchases72h: 5 });
  assert.equal(a.rule, "cpa_24h"); assert.equal(a.body, "CPA 24 h 31,20 > precio 27,00 USD");
  assert.equal(cpaAlert({ front: 27, spend24h: 54, purchases24h: 2, spend72h: 80, purchases72h: 5 }), null); // justo 27: no
});
test("CPA caro (a): con 1 sola compra avisa recién al gastar 2 × el front", () => {
  // Physique FR 07/10: 1 venta a 23,15 con precio 22,43 avisó a la mañana; al rato iba 3 ventas a 11.
  assert.equal(cpaAlert({ front: 22.43, spend24h: 23.15, purchases24h: 1, spend72h: 23.15, purchases72h: 1 }), null);
  const a = cpaAlert({ front: 22.43, spend24h: 45, purchases24h: 1, spend72h: 45, purchases72h: 1 });
  assert.equal(a.rule, "cpa_24h"); assert.equal(a.body, "CPA 24 h 45,00 > precio 22,43 USD");
});
test("CPA caro (b): gastó 2 × el precio del front en 24 h sin ventas", () => {
  const a = cpaAlert({ front: 27, spend24h: 54, purchases24h: 0, spend72h: 54, purchases72h: 0 });
  assert.equal(a.rule, "spend_no_sales"); assert.equal(a.body, "gastó 54,00 USD sin ventas en 24 h");
  assert.equal(cpaAlert({ front: 27, spend24h: 53.9, purchases24h: 0, spend72h: 53.9, purchases72h: 0 }), null);
  assert.equal(cpaAlert({ front: 27, spend24h: 30, purchases24h: 0, spend72h: 30, purchases72h: 0 }), null); // 1 × el precio: todavía no
});
test("CPA caro (c): CPA de 3 días (3+ compras) más caro que el front", () => {
  const a = cpaAlert({ front: 22.35, spend24h: 10, purchases24h: 1, spend72h: 100, purchases72h: 4 });
  assert.equal(a.rule, "cpa_3d"); assert.equal(a.body, "CPA 3 días 25,00 > precio 22,35 USD");
  assert.equal(cpaAlert({ front: 22.35, spend24h: 10, purchases24h: 1, spend72h: 50, purchases72h: 2 }), null);
});
test("CPA caro: sin oferta vinculada (sin precio) no avisa", () => {
  assert.equal(cpaAlert({ front: null, spend24h: 500, purchases24h: 0, spend72h: 900, purchases72h: 0 }), null);
});
