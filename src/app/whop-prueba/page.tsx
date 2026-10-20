"use client";

import { useState } from "react";
import { loadWhop } from "@whop/elements";
import { WhopElements, Payments, PaymentElement } from "@whop/elements-react";

/**
 * Banco de pruebas del elemento de Whop, lo mas pelado posible.
 *
 * Existe para separar dos causas cuando el formulario no carga: si ACA tampoco
 * carga, el problema es del entorno o de la cuenta; si aca carga, el problema
 * esta en como lo monta el checkout. Sin esto habria que adivinar.
 *
 * No se enlaza desde ningun lado y no cobra nada. Y NO EXISTE EN PRODUCCION:
 * una pagina de diagnostico publicada es una puerta abierta y basura en el
 * sitio. El layout de abajo la convierte en 404 fuera de desarrollo.
 */
const whop = loadWhop();

export default function Prueba() {
  const [estado, setEstado] = useState<string[]>([]);
  const anotar = (s: string) => setEstado((v) => [...v, `${v.length + 1}. ${s}`]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 560 }}>
      <h1 style={{ fontSize: 18 }}>Banco de pruebas — elemento de Whop</h1>
      <WhopElements elements={whop} onLoadError={(e) => anotar(`SDK no cargo: ${e.message}`)}>
        <Payments
          accountId="biz_nFCs9HXHHv3PLw"
          currency="usd"
          amount={3700}
          onLoadingChange={(l) => anotar(`cargando = ${l}`)}
        >
          <PaymentElement
            onReady={() => anotar("onReady del elemento")}
            onError={(e) => anotar(`error del elemento: ${e.code ?? ""} ${e.message}`)}
          />
        </Payments>
      </WhopElements>
      <pre style={{ background: "#f4f4f5", padding: 12, marginTop: 16, fontSize: 12 }}>
        {estado.length ? estado.join("\n") : "(sin eventos todavia)"}
      </pre>
    </div>
  );
}
