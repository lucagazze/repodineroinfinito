"use client";

import { useEffect, useState } from "react";
import { loadWhop } from "@whop/elements";
import { WhopElements, Payments, PaymentElement, BrandingElement } from "@whop/elements-react";

/**
 * Banco de pruebas del elemento de Whop, con REGISTRO del dialogo entre la
 * pagina y los iframes.
 *
 * El oyente se instala ANTES de loadWhop(): el saludo entre ventanas ocurre en
 * los primeros milisegundos y un listener puesto despues no lo ve. Esa es la
 * razon por la que los intentos anteriores no mostraban nada.
 *
 * No se enlaza desde ningun lado, no cobra nada y NO EXISTE EN PRODUCCION.
 */

type Msg = { t: number; dir: "<-" | "->"; o: string; d: string };
const REG: Msg[] = [];
const t0 = Date.now();

if (typeof window !== "undefined" && !(window as unknown as Record<string, unknown>).__whopSpy) {
  (window as unknown as Record<string, unknown>).__whopSpy = true;
  // Entrante
  window.addEventListener("message", (e) => {
    REG.push({ t: Date.now() - t0, dir: "<-", o: String(e.origin),
               d: (typeof e.data === "string" ? e.data : JSON.stringify(e.data) || "").slice(0, 200) });
  }, true);
  // Saliente: se envuelve postMessage para ver tambien lo que mandamos nosotros.
  const orig = window.Window.prototype.postMessage;
  window.Window.prototype.postMessage = function (this: Window, ...args: unknown[]) {
    const [data, target] = args as [unknown, string];
    REG.push({ t: Date.now() - t0, dir: "->", o: String(target ?? "*"),
               d: (typeof data === "string" ? data : JSON.stringify(data) || "").slice(0, 200) });
    return (orig as unknown as (...a: unknown[]) => void).apply(this, args as never);
  } as typeof window.postMessage;
}

const whop = loadWhop();

export default function Prueba() {
  const [ev, setEv] = useState<string[]>([]);
  const [, tick] = useState(0);
  const anota = (s: string) => setEv((v) => [...v, `${((Date.now() - t0) / 1000).toFixed(2)}s  ${s}`]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 600); return () => clearInterval(i); }, []);

  return (
    <div style={{ padding: 20, fontFamily: "ui-monospace, monospace", maxWidth: 900, background: "#fff", color: "#111", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 17 }}>Banco de pruebas — elemento de Whop</h1>
      <div style={{ border: "1px solid #ddd", padding: 10, margin: "12px 0" }}>
        <WhopElements elements={whop} onLoadError={(e) => anota(`SDK NO CARGO: ${e.message}`)}>
          <Payments accountId="biz_nFCs9HXHHv3PLw" currency="usd" amount={3700}
                    onLoadingChange={(l) => anota(`cargando = ${l}`)}>
            <PaymentElement onReady={() => anota("onReady")}
                            onError={(e) => anota(`ERROR del elemento: ${e.code ?? ""} ${e.message}`)} />
            <BrandingElement />
          </Payments>
        </WhopElements>
      </div>

      <h2 style={{ fontSize: 14 }}>Eventos del SDK</h2>
      <pre style={{ background: "#f4f4f5", padding: 10, fontSize: 12, whiteSpace: "pre-wrap" }}>
        {ev.length ? ev.join("\n") : "(ninguno)"}
      </pre>

      <h2 style={{ fontSize: 14 }}>Dialogo entre ventanas ({REG.length})</h2>
      <pre style={{ background: "#f4f4f5", padding: 10, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>
        {REG.map((m, i) => `${String(m.t).padStart(5)}ms ${m.dir} ${m.o}\n        ${m.d}`).join("\n") || "(nada)"}
      </pre>
    </div>
  );
}
