/**
 * El mercado de Sudáfrica: ZAR para ZA, y un precio en rands por producto.
 *
 * LA REGLA DE REDONDEO, y por qué importa. Cada precio se lleva al .99
 * siguiente que quede IGUAL O POR ENCIMA del equivalente en dólares. Nunca por
 * debajo: con las libras ya se cometió el error de truncar en vez de redondear
 * hacia arriba y se cargaron precios más baratos de lo previsto, sin que nada
 * avisara. Aquí cada fila se comprueba contra el equivalente antes de escribir.
 *
 * NO se aplica descuento por país. Rebajar sin datos es adivinar: el test de
 * los primeros 50 USD existe para medir si el mercado convierte a precio de
 * paridad. Si no convierte, bajar el precio es la siguiente hipótesis, no la
 * primera.
 *
 * Es idempotente.
 */
import { db } from "@/lib/db";
import { getRates } from "@/lib/fx";

const PH = "97879900-b4b5-4ae5-880a-32deb872967c";
const rates: Record<string, number> = await getRates() as never;
const TASA = rates.ZAR;
if (!TASA) throw new Error("la app no tiene tipo de cambio para el rand");

/** El .99 más bajo que NO queda por debajo del equivalente en dólares. */
function enRands(usd: number) {
  const eq = usd * TASA;
  let v = Math.floor(eq / 10) * 10 + 9.99;   // el .99 de esa decena
  while (v < eq) v += 10;                    // si quedó corto, la siguiente
  return Math.round(v * 100) / 100;
}

// ------------------------------------------------------------- el mercado
const { data: ya } = await db.from("markets").select("id,countries,currency")
  .eq("store_id", PH).eq("currency", "ZAR").maybeSingle();
if (ya) {
  console.log(`  el mercado ZAR ya existía (${ya.id})`);
} else {
  const { data, error } = await db.from("markets").insert({
    store_id: PH, name: "Sudáfrica", currency: "ZAR", countries: ["ZA"], is_default: false,
  }).select("id").single();
  if (error) throw new Error(`mercado: ${error.message}`);
  console.log(`  mercado creado: Sudáfrica · ZAR · [ZA]  ${data!.id}`);
}

// ------------------------------------------------------------- los precios
const { data: prods } = await db.from("products")
  .select("id,slug,product_prices(currency,amount,compare_at)").eq("store_id", PH).order("slug");

let puestos = 0, saltados = 0;
const mal: string[] = [];
for (const p of prods ?? []) {
  const precios = (p as never as { product_prices: { currency: string; amount: number; compare_at: number | null }[] }).product_prices;
  const usd = precios.find((x) => x.currency === "USD");
  if (!usd || !Number(usd.amount)) { saltados++; continue; }

  const zar = enRands(Number(usd.amount));
  const cmp = usd.compare_at ? enRands(Number(usd.compare_at)) : null;

  // La comprobación que evita repetir el error de las libras.
  const eq = Number(usd.amount) * TASA;
  if (zar < eq) { mal.push(`${p.slug}: R${zar} < R${eq.toFixed(2)}`); continue; }

  const existente = precios.find((x) => x.currency === "ZAR");
  const fila = { product_id: p.id, currency: "ZAR", amount: zar, compare_at: cmp };
  const { error } = existente
    ? await db.from("product_prices").update(fila).eq("product_id", p.id).eq("currency", "ZAR")
    : await db.from("product_prices").insert(fila);
  if (error) throw new Error(`${p.slug}: ${error.message}`);
  puestos++;
  console.log(`  ${p.slug.padEnd(24)} USD ${String(usd.amount).padStart(6)}  ->  R ${zar.toFixed(2).padStart(8)}` +
              `${cmp ? `  (antes R ${cmp.toFixed(2)})` : ""}`);
}

console.log(`\n  ${puestos} precios cargados · ${saltados} salteados (gratuitos o sin USD)`);
if (mal.length) {
  console.log(`  *** ${mal.length} QUEDARON POR DEBAJO DEL EQUIVALENTE ***`);
  for (const m of mal) console.log(`      ${m}`);
} else {
  console.log(`  ninguno quedó por debajo del equivalente en dólares (1 USD = ${TASA} ZAR)`);
}
