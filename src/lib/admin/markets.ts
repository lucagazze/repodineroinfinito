/**
 * Banderas de los mercados. market_label es texto libre («EE. UU.»,
 * «EE. UU. + Reino Unido», «Italia»): se reconocen los países conocidos por
 * nombre y se devuelven sus códigos para flagcdn.com. Sin coincidencias, el
 * panel muestra un globo.
 */

const COUNTRIES: [RegExp, string][] = [
  [/\bee\.?\s*uu\.?|estados unidos|\busa?\b|united states/i, "us"],
  [/reino unido|\buk\b|united kingdom|gran breta/i, "gb"],
  [/italia|italy/i, "it"],
  [/francia|france/i, "fr"],
  [/alemania|germany|deutschland/i, "de"],
  [/españa|espana|spain/i, "es"],
  [/australia/i, "au"],
  [/canad[aá]/i, "ca"],
  [/portugal/i, "pt"],
  [/brasil|brazil/i, "br"],
  [/m[eé]xico/i, "mx"],
  [/argentina/i, "ar"],
  [/irlanda|ireland/i, "ie"],
  [/nueva zelanda|new zealand/i, "nz"],
];

export function marketFlags(label: string | null | undefined): string[] {
  if (!label) return [];
  const parts = label.split(/[+,/·]|\by\b/i).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const hit = COUNTRIES.find(([re]) => re.test(p));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}
