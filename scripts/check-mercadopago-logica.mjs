// Prueba sin red: las dos funciones de mercadopago.ts que deciden plata.
//   node --experimental-strip-types scripts/check-mercadopago-logica.mjs
// Sale con codigo 1 si algun caso falla.
//
//   frecuenciaDe    cada cuanto se le cobra al suscriptor
//   clasificarPago  si un cobro entro o se rechazo
//
// Las dos tienen que fallar RUIDOSAMENTE ante algo que no entienden, no
// aproximar ni suponer. Eso es lo que se prueba aca.
import { frecuenciaDe, clasificarPago, montoDe } from "../src/lib/mercadopago.ts";

let fallos = 0;
const ok = (bien, texto) => {
  if (!bien) fallos++;
  console.log(`  ${bien ? "bien  " : "FALLO "} ${texto}`);
};

// ----------------------------------------------------------- la frecuencia
console.log("frecuenciaDe");
for (const [dias, esperado] of [
  [7, { frequency: 7, frequency_type: "days" }],
  [14, { frequency: 14, frequency_type: "days" }],
  // 30 dias van como UN MES, no como 30 dias: doce ciclos de 30 son 360, asi
  // que con `days` se cobraria 12,17 veces al año.
  [30, { frequency: 1, frequency_type: "months" }],
  [31, { frequency: 1, frequency_type: "months" }],
  [90, { frequency: 3, frequency_type: "months" }],
  [365, { frequency: 12, frequency_type: "months" }],
]) {
  const r = frecuenciaDe(dias);
  ok(r.frequency === esperado.frequency && r.frequency_type === esperado.frequency_type,
     `${dias} dias -> ${r.frequency} ${r.frequency_type}`);
}

// Lo importante: lo que no sabe expresar TIRA, no aproxima.
for (const dias of [1, 45, 60, 180, 0, -5]) {
  let tiro = false;
  try { frecuenciaDe(dias); } catch { tiro = true; }
  ok(tiro, `${dias} dias -> tira en vez de aproximar`);
}

// ------------------------------------------------------- clasificar el pago
console.log("\nclasificarPago");
const casos = [
  // El payment.status anidado manda sobre el status de la factura: una factura
  // puede decir «processed» con el pago rechazado.
  [{ status: "processed", payment: { status: "approved" } }, "cobrado", "factura processed + pago approved"],
  [{ status: "processed", payment: { status: "rejected" } }, "rechazado", "factura processed + pago RECHAZADO"],
  [{ status: "processed", payment: { status: "refunded" } }, "rechazado", "pago devuelto"],
  [{ status: "processed", payment: { status: "charged_back" } }, "rechazado", "contracargo"],
  [{ status: "processed", payment: { status: "in_process" } }, "desconocido", "pago en proceso: no se interpreta"],

  // Sin payment anidado se cae al status de la factura.
  [{ status: "approved" }, "cobrado", "solo status: approved"],
  [{ status: "processed" }, "cobrado", "solo status: processed"],
  [{ status: "rejected" }, "rechazado", "solo status: rejected"],
  [{ status: "recycling" }, "rechazado", "solo status: recycling"],

  // Lo que no se reconoce NO se interpreta. Es el caso que importa: adivinar
  // aca regala acceso o deja a alguien que pago sin lo que compro.
  [{ status: "scheduled" }, "desconocido", "status que no esta en la lista"],
  [{ status: "" }, "desconocido", "status vacio"],
  [{}, "desconocido", "sin status ninguno"],
  [{ status: "APPROVED" }, "cobrado", "mayusculas: no cambia la respuesta"],
];
for (const [pago, esperado, texto] of casos) {
  const r = clasificarPago(pago);
  ok(r === esperado, `${texto} -> ${r}`);
}

// ------------------------------------------------------------- el importe
console.log("\nmontoDe");
for (const [pago, esperado, texto] of [
  [{ transaction_amount: 9 }, 9, "entero"],
  [{ transaction_amount: 9.5 }, 9.5, "con decimales"],
  [{ transaction_amount: 0 }, null, "cero no es un cobro"],
  [{ transaction_amount: -9 }, null, "negativo"],
  [{ transaction_amount: null }, null, "nulo"],
  [{}, null, "ausente"],
  [{ transaction_amount: "9" }, 9, "como cadena"],
  [{ transaction_amount: "hola" }, null, "cadena no numerica"],
]) {
  const r = montoDe(pago);
  ok(r === esperado, `${texto} -> ${r}`);
}

console.log(fallos === 0 ? "\nTodo bien." : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
