// Pruebas del Piloto Meta Ads (guardia de CBO, ganadores y la BID CAP nueva), con casos inventados. Correr:
//   node --experimental-strip-types --test scripts/test-autopilot.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/lib/bid-pilot/rules.ts");
const { guardVerdict, pickPauses, winnerVerdict, bidCapName, marketOf, offerOf, targetFor, bidCapTargeting, needsDsa, bidCapCreative, checkBuilt, CBO, BID_CAP, MANUAL_PLACEMENTS } = R;

const H = 3600_000;
const NOW = Date.parse("2026-10-07T12:17:00Z");
/** Una CBO activa que corrió los 3 días, gastó 312 y vendió 256 (ROAS 0,82). */
const g = (over = {}) => ({
  now: NOW, status: "ACTIVE", bidStrategy: CBO, campaignBudget: true, optedOut: false, lastAutoPauseAt: null,
  daySpend: [100, 110, 102], revenue: 256, source: "real", ...over,
});

test("guardia: ROAS < 1 con 150+ gastados en 3 días corridos → apagar", () => {
  const v = guardVerdict(g());
  assert.equal(v.action, "pause");
  assert.equal(v.rule, "roas_low");
  assert.equal(v.spend, 312);
  assert.ok(Math.abs(v.roas - 256 / 312) < 1e-9);
  assert.match(v.reason, /ROAS 3 días 0,82 \(ventas reales\) con 312 USD/);
});
test("guardia: ROAS justo 1 → se queda", () => {
  assert.equal(guardVerdict(g({ revenue: 312 })).action, "keep");
});
test("guardia: gastó menos de 150 → se queda", () => {
  const v = guardVerdict(g({ daySpend: [40, 50, 59.99], revenue: 0 }));
  assert.equal(v.action, "keep"); assert.equal(v.rule, "low_spend");
});
test("guardia: exactamente 150 con ROAS bajo → apagar", () => {
  assert.equal(guardVerdict(g({ daySpend: [50, 50, 50], revenue: 10 })).action, "pause");
});
test("guardia: no corrió los 3 días → se queda aunque pierda", () => {
  const v = guardVerdict(g({ daySpend: [0, 200, 200], revenue: 0 }));
  assert.equal(v.action, "keep"); assert.equal(v.rule, "too_new"); assert.equal(v.daysRun, 2);
});
test("guardia: nunca toca una BID CAP", () => {
  const v = guardVerdict(g({ bidStrategy: BID_CAP, revenue: 0 }));
  assert.equal(v.action, "skip"); assert.equal(v.rule, "bid_cap");
});
test("guardia: sin presupuesto de campaña (ABO) o con otra estrategia → no es CBO", () => {
  assert.equal(guardVerdict(g({ campaignBudget: false, revenue: 0 })).rule, "not_cbo");
  assert.equal(guardVerdict(g({ bidStrategy: "COST_CAP", revenue: 0 })).rule, "not_cbo");
  assert.equal(guardVerdict(g({ bidStrategy: null, revenue: 0 })).rule, "not_cbo");
});
test("guardia: pausada o excluida a mano → no la toca", () => {
  assert.equal(guardVerdict(g({ status: "PAUSED", revenue: 0 })).rule, "inactive");
  assert.equal(guardVerdict(g({ optedOut: true, revenue: 0 })).rule, "opted_out");
});
test("guardia: la apagó la guardia y el dueño la prendió → 72 h sin tocarla; después sí", () => {
  const v = guardVerdict(g({ lastAutoPauseAt: NOW - 30 * H, revenue: 0 }));
  assert.equal(v.action, "skip"); assert.equal(v.rule, "reactivated"); assert.match(v.reason, /42 h/);
  assert.equal(guardVerdict(g({ lastAutoPauseAt: NOW - 73 * H, revenue: 0 })).action, "pause");
});
test("guardia: con valor de Meta lo dice", () => {
  assert.match(guardVerdict(g({ source: "meta", revenue: 400 })).reason, /valor de Meta/);
});

test("a lo sumo 3 por pasada: primero las que más pierden; el resto al aviso", () => {
  const list = [
    { id: "a", spend: 200, revenue: 150 }, // pierde 50
    { id: "b", spend: 500, revenue: 100 }, // 400
    { id: "c", spend: 160, revenue: 0 },   // 160
    { id: "d", spend: 300, revenue: 250 }, // 50 (gastó más que a)
    { id: "e", spend: 151, revenue: 140 }, // 11
  ];
  const { pause, over } = pickPauses(list);
  assert.deepEqual(pause.map((x) => x.id), ["b", "c", "d"]);
  assert.deepEqual(over.map((x) => x.id), ["a", "e"]);
  assert.deepEqual(pickPauses(list.slice(0, 2)).over, []);
});

const days = (n, spend, buys) => Array.from({ length: 7 }, (_, i) => (i >= 7 - n ? { spend, purchases: buys } : { spend: 0, purchases: 0 }));
const w = (over = {}) => ({ adActive: true, campaignActiveCbo: true, days: days(4, 18.6, 3), target: 10, proposed: false, ...over });

test("ganador: 12 compras, CPA 6,20, 4 días → propone", () => {
  const v = winnerVerdict(w()); // 74,4 / 12
  assert.equal(v.qualifies, true);
  assert.equal(v.purchases, 12);
  assert.ok(Math.abs(v.cpa - 6.2) < 1e-9);
  assert.equal(v.daysRun, 4);
});
test("ganador: menos de 10 compras → no", () => {
  const v = winnerVerdict(w({ days: days(3, 10, 3) }));
  assert.equal(v.qualifies, false); assert.equal(v.rule, "few_sales");
});
test("ganador: CPA arriba del objetivo → no; justo en el objetivo → sí", () => {
  assert.equal(winnerVerdict(w({ days: days(5, 25, 2) })).rule, "expensive"); // CPA 12,5
  assert.equal(winnerVerdict(w({ days: days(5, 20, 2) })).qualifies, true);   // CPA 10
});
test("ganador: USA usa objetivo 15", () => {
  assert.equal(targetFor("USA | CBO | My Offer"), 15);
  assert.equal(targetFor("Italia | CBO | Fisica"), 10);
  assert.equal(winnerVerdict(w({ days: days(5, 28, 2), target: targetFor("USA | CBO | X") })).qualifies, true); // CPA 14
});
test("ganador: corrió menos de 3 días → no", () => {
  assert.equal(winnerVerdict(w({ days: days(2, 60, 6) })).rule, "too_new");
});
test("ganador: si su posteo ya corre en una BID CAP, no se propone", () => {
  const v = winnerVerdict(w({ inBidCap: "BID CAP - Italia - Odontoiatria" }));
  assert.equal(v.qualifies, false); assert.equal(v.rule, "in_bid_cap"); assert.match(v.reason, /BID CAP - Italia - Odontoiatria/);
});
test("ganador: una sola vez, solo en CBO activa y anuncio activo", () => {
  assert.equal(winnerVerdict(w({ proposed: true })).rule, "proposed");
  assert.equal(winnerVerdict(w({ campaignActiveCbo: false })).rule, "not_cbo");
  assert.equal(winnerVerdict(w({ adActive: false })).rule, "inactive");
});

test("tope = 70 % del precio del front en USD, redondeado hacia abajo a 0,05", () => {
  assert.equal(R.CEILING_FACTOR, 0.7);
  assert.equal(R.ceilingFromFront(27), 18.9);                 // Oferta USA
  assert.equal(R.ceilingFromFront(22.4), 15.65);              // EUR 19,90 ≈ 22,40 USD → 15,68 → 15,65
  assert.equal(R.ceilingFromFront(22.4, 0.8), 17.9);          // con otro porcentaje
  assert.equal(R.ceilingFromFront(27, 1), 27);
});
test("escalera: 50 / 60 / 70 % (y sigue al porcentaje del tope)", () => {
  assert.deepEqual(R.ladderPcts(), [0.5, 0.6, 0.7]);
  assert.deepEqual(R.ladderPcts(0.8), [0.6, 0.7, 0.8]);
});
test("landing: el link viejo (/curso) reconoce la landing con idioma (/it/curso); otro idioma no", () => {
  const keys = R.landingKeys("https://www.tumarca.com/it/curso");
  assert.ok(keys.includes(R.linkKey("https://www.tumarca.com/curso?utm_source=x")));
  assert.ok(keys.includes(R.linkKey("https://tumarca.com/it/curso/")));
  assert.ok(!keys.includes(R.linkKey("https://www.tumarca.com/fr/curso")));
  assert.ok(!keys.includes(R.linkKey("https://www.tumarca.com/")));
  assert.ok(R.landingKeys("https://www.otramarca.com/us/course").includes(R.linkKey("https://www.otramarca.com/course")));
  assert.deepEqual(R.landingKeys("https://www.otramarca.com/curso-uk"), ["otramarca.com/curso-uk"]);
});
test("nombre: BID CAP - Mercado - Oferta - anuncio", () => {
  assert.equal(bidCapName("Italia | CBO | Mi Oferta", "01 Anuncio A"), "BID CAP - Italia - Mi Oferta - 01 Anuncio A");
  assert.equal(bidCapName("USA | CBO | My Offer", "02 Problem solution"), "BID CAP - USA - My Offer - 02 Problem solution");
  assert.equal(marketOf("WW | CBO | Curso"), "WW");
  assert.equal(offerOf("Italia | CBO | 1-1-1 | Mi oferta"), "1-1-1 Mi oferta");
  assert.equal(bidCapName("CBO | 1", "X"), "BID CAP - 1 - X");
});

test("público: sin Advantage+, FB+IG manual, excluye compradores (sin repetir)", () => {
  const src = {
    age_min: 18, age_max: 65, user_age_unknown: false, age_range: [18, 65],
    geo_locations: { countries: ["US"], location_types: ["home"] },
    targeting_automation: { advantage_audience: 1 },
    excluded_custom_audiences: [{ id: "111", name: "Compradores Salud (180d)" }],
  };
  const t = bidCapTargeting(src, [{ id: "111" }, { id: "222", name: "Otro" }]);
  assert.deepEqual(t.targeting_automation, { advantage_audience: 0 });
  assert.deepEqual(t.excluded_custom_audiences, [{ id: "111" }, { id: "222" }]);
  assert.deepEqual(t.publisher_platforms, MANUAL_PLACEMENTS.publisher_platforms);
  assert.deepEqual(t.instagram_positions, MANUAL_PLACEMENTS.instagram_positions);
  assert.equal("user_age_unknown" in t, false);
  assert.equal("age_range" in t, false);
  assert.deepEqual(t.geo_locations, src.geo_locations);
  assert.deepEqual(src.targeting_automation, { advantage_audience: 1 }, "no modifica el original");
});
test("público: deja las ubicaciones FB/IG del ganador y saca Audience Network", () => {
  const t = bidCapTargeting({ publisher_platforms: ["facebook", "instagram", "audience_network"], facebook_positions: ["feed"], audience_network_positions: ["classic"] }, []);
  assert.deepEqual(t.publisher_platforms, ["facebook", "instagram"]);
  assert.deepEqual(t.facebook_positions, ["feed"]);
  assert.equal("audience_network_positions" in t, false);
});
test("DSA: Europa o sin países la necesita; USA no", () => {
  assert.equal(needsDsa({ geo_locations: { countries: ["IT"] } }), true);
  assert.equal(needsDsa({ geo_locations: { countries: ["US", "GB"] } }), false);
  assert.equal(needsDsa({ geo_locations: { regions: [{ key: "1" }] } }), true);
  // Regiones y ciudades de USA (como «USA | CBO | Mi Oferta»): no.
  assert.equal(needsDsa({ geo_locations: { cities: [{ key: "2490299", country: "US" }], regions: [{ key: "3847", country: "US" }] } }), false);
  assert.equal(needsDsa({ geo_locations: { regions: [{ key: "1", country: "IT" }] } }), true);
  assert.equal(needsDsa({ geo_locations: { country_groups: ["worldwide"] } }), true);
});
test("creativo: el mismo posteo, solo comentarios relevantes + mejorar CTA", () => {
  const c = bidCapCreative({ effective_object_story_id: "123_456", instagram_user_id: "178", url_tags: "utm_source=meta", contextual_multi_ads: { enroll_status: "OPT_OUT" } }, "01 X · BID CAP");
  assert.equal(c.object_story_id, "123_456");
  assert.equal(c.instagram_user_id, "178");
  assert.equal(c.url_tags, "utm_source=meta");
  assert.deepEqual(c.contextual_multi_ads, { enroll_status: "OPT_OUT" });
  assert.deepEqual(Object.keys(c.degrees_of_freedom_spec.creative_features_spec).sort(), ["enhance_cta", "inline_comment"]);
  assert.throws(() => bidCapCreative({}, "x"));
});

const good = {
  campaign: { bid_strategy: BID_CAP, daily_budget: "30000", objective: "OUTCOME_SALES", status: "PAUSED" },
  adset: { bid_amount: 1000, status: "PAUSED", promoted_object: { pixel_id: "p1" }, targeting: { excluded_custom_audiences: [{ id: "111", name: "C" }], targeting_automation: { advantage_audience: 0 }, publisher_platforms: ["facebook", "instagram"] } },
  ad: { status: "PAUSED", effective_status: "CAMPAIGN_PAUSED", creative: { id: "cr1" }, issues_info: [] },
};
const want = { bidCents: 1000, budgetCents: 30000, pixelId: "p1", exclude: ["111"], creativeId: "cr1" };
test("verificación: lo que quedó bien no da problemas", () => {
  assert.deepEqual(checkBuilt(good, want), []);
});
test("verificación: detecta puja, presupuesto, exclusión, Advantage+, ubicaciones y anuncio con problemas", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.campaign.daily_budget = "20000";
  bad.adset.bid_amount = 1430;
  bad.adset.targeting.excluded_custom_audiences = [];
  bad.adset.targeting.targeting_automation.advantage_audience = 1;
  bad.adset.targeting.publisher_platforms = ["facebook", "audience_network"];
  bad.ad.effective_status = "WITH_ISSUES";
  const p = checkBuilt(bad, want);
  assert.equal(p.length, 6, p.join(" | "));
  assert.deepEqual(checkBuilt({ campaign: null, adset: null, ad: null }, want).length, 3);
});
