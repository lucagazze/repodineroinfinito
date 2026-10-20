/** Whop toma colores CON NOMBRE de su paleta, no hexadecimales. */
export type Acento =
  | "ruby" | "blue" | "red" | "yellow" | "green" | "gray" | "tomato" | "crimson" | "pink"
  | "plum" | "purple" | "violet" | "iris" | "cyan" | "teal" | "jade" | "grass" | "brown"
  | "orange" | "indigo" | "sky" | "mint" | "amber" | "lime" | "lemon" | "magenta" | "gold" | "bronze";

/**
 * El color de marca es un hexadecimal y el acento de Whop es un nombre de su
 * paleta: hay que traducir. Se elige por tono y luminosidad, asi el formulario
 * no desentona con el boton de pagar de la tienda.
 */
export function acentoDe(hex: string): Acento {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "blue";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const lum = (max + min) / 2;

  // Gris por SATURACION, no por la diferencia cruda: un azul marino muy oscuro
  // tiene poca diferencia entre canales y aun asi es azul, mientras que un gris
  // medio tiene esa misma diferencia y no tiene tono que respetar.
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lum - 1));
  if (sat < 0.15) return "gray";

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;

  const oscuro = max < 0.6;
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 62) return oscuro ? "bronze" : "gold";   // el dorado de la marca cae aca
  if (h < 95) return "lime";
  if (h < 150) return "green";                      // el verde ejecutivo cae aca
  if (h < 175) return "teal";
  if (h < 195) return "cyan";
  if (h < 210) return oscuro ? "blue" : "sky";
  if (h < 258) return oscuro ? "indigo" : "blue";   // el navy de la marca cae aca
  if (h < 290) return "violet";
  if (h < 320) return "purple";
  return "pink";
}
