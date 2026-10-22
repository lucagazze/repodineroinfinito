"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

/**
 * Lo que ve y puede hacer un suscriptor con su propia suscripcion.
 *
 * La baja es de DOS pasos, no uno: el primero es un boton discreto al pie, el
 * segundo confirma. No es friccion para retener -- es para que nadie se dé de
 * baja sin querer desde el dedo gordo en un telefono. Una baja accidental que
 * el suscriptor no nota es peor que una baja: se entera cuando no le llega la
 * edicion, y para entonces ya piensa que el servicio falla.
 *
 * Y se dice CLARO que conserva el acceso hasta el final del periodo pagado.
 * Esconderlo hace que la gente cancele tarde, no que cancele menos.
 */

const NAVY = "#0A1024";
const GOLD = "#8a6f2e";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

type Sub = {
  status: string; email: string; founder: boolean;
  amount: number | null; currency: string;
  payments: number; paid: number;
  since: string; until: string | null; failed: number;
};

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

const plata = (n: number, cur: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: (cur || "usd").toUpperCase(), maximumFractionDigits: 0 }).format(n);

export function PanelSuscripcion({ token, sub, store }: {
  token: string; sub: Sub; store: { name: string; support: string };
}) {
  const [paso, setPaso] = useState<"ver" | "confirmar" | "yendo" | "listo" | "error">("ver");
  const [hasta, setHasta] = useState<string | null>(sub.until);
  const [error, setError] = useState("");

  const activa = sub.status === "active" || sub.status === "past_due";
  const cancelada = sub.status === "canceled";

  async function cancelar() {
    setPaso("yendo");
    try {
      const r = await fetch("/api/suscripcion/baja", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = (await r.json()) as { ok?: boolean; hasta?: string | null; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || `error ${r.status}`);
      setHasta(j.hasta ?? sub.until);
      setPaso("listo");
    } catch (e) {
      setError((e as Error).message);
      setPaso("error");
    }
  }

  if (paso === "listo" || (cancelada && paso === "ver")) {
    const f = fecha(hasta);
    return (
      <Card>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED }}>
          {store.name}
        </p>
        <h1 style={{ margin: "10px 0 0", fontSize: 26, fontFamily: "Georgia, serif", letterSpacing: "-.01em" }}>
          Your subscription is cancelled
        </h1>
        <p style={{ margin: "14px 0 0", fontSize: 15.5, lineHeight: 1.65 }}>
          You won&rsquo;t be charged again.
        </p>
        {f && (
          <p style={{ margin: "10px 0 0", fontSize: 15.5, lineHeight: 1.65 }}>
            You already paid through <strong>{f}</strong>, so editions keep arriving until then.
          </p>
        )}
        <p style={{ margin: "22px 0 0", paddingTop: 18, borderTop: `1px solid ${LINE}`, fontSize: 13.5, lineHeight: 1.6, color: MUTED }}>
          The book stays yours. If something was wrong with the subscription, write to{" "}
          <a href={`mailto:${store.support}`} style={{ color: MUTED }}>{store.support}</a> — it gets read.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: GOLD }}>
        {store.name}
      </p>
      <h1 style={{ margin: "10px 0 0", fontSize: 26, fontFamily: "Georgia, serif", letterSpacing: "-.01em" }}>
        Your subscription
      </h1>

      <div style={{ margin: "22px 0 0", border: `1px solid ${LINE}`, borderRadius: 12, overflow: "hidden" }}>
        {[
          ["Email", sub.email],
          ["Status", sub.status === "past_due" ? "Payment failed — access continues" : "Active"],
          ["Price", sub.amount == null ? "—" : `${plata(sub.amount, sub.currency)} / month${sub.founder ? " · founder rate, locked" : ""}`],
          ["Member since", fecha(sub.since) ?? "—"],
          ["Paid so far", `${plata(sub.paid, sub.currency)} · ${sub.payments} ${sub.payments === 1 ? "payment" : "payments"}`],
          ["Renews", fecha(sub.until) ?? "—"],
        ].map(([k, v], i) => (
          <div key={k} style={{
            display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 15px",
            borderTop: i ? `1px solid ${LINE}` : undefined, fontSize: 14.5,
          }}>
            <span style={{ color: MUTED }}>{k}</span>
            <span style={{ textAlign: "right", fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>

      {sub.status === "past_due" && (
        <div style={{ margin: "18px 0 0", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 16px" }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#92400e" }}>Your card was declined</p>
          <p style={{ margin: "5px 0 0", fontSize: 14, lineHeight: 1.6, color: "#78350f" }}>
            Nothing is cut off yet. Update your card and the next attempt goes through.
          </p>
          <a href="https://whop.com/orders" style={{
            display: "inline-block", marginTop: 12, padding: "10px 20px", borderRadius: 999,
            background: "#92400e", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none",
          }}>Update my card</a>
        </div>
      )}

      {activa && paso === "ver" && (
        <p style={{ margin: "24px 0 0", paddingTop: 18, borderTop: `1px solid ${LINE}`, fontSize: 13.5, color: MUTED }}>
          <button onClick={() => setPaso("confirmar")} style={{
            background: "none", border: "none", padding: 0, font: "inherit",
            color: MUTED, textDecoration: "underline", cursor: "pointer",
          }}>Cancel my subscription</button>
        </p>
      )}

      {paso === "confirmar" && (
        <div style={{ margin: "24px 0 0", paddingTop: 20, borderTop: `1px solid ${LINE}` }}>
          <p style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Cancel your subscription?</p>
          <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.6, color: MUTED }}>
            No more charges. {fecha(sub.until) ? <>You keep every edition through <strong>{fecha(sub.until)}</strong> — you already paid for it.</> : "You keep access through the period you already paid for."}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={cancelar} style={{
              padding: "12px 24px", borderRadius: 999, border: "none", background: "#b91c1c",
              color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer",
            }}>Yes, cancel it</button>
            <button onClick={() => setPaso("ver")} style={{
              padding: "12px 24px", borderRadius: 999, border: `1px solid ${LINE}`,
              background: "#fff", color: NAVY, fontSize: 14.5, fontWeight: 700, cursor: "pointer",
            }}>Keep it</button>
          </div>
        </div>
      )}

      {paso === "yendo" && (
        <p style={{ margin: "24px 0 0", fontSize: 14.5, color: MUTED }}>Cancelling&hellip;</p>
      )}

      {paso === "error" && (
        <div style={{ margin: "24px 0 0", paddingTop: 18, borderTop: `1px solid ${LINE}` }}>
          <p style={{ margin: 0, fontSize: 14.5, color: "#b91c1c" }}>
            That didn&rsquo;t go through: {error}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: MUTED }}>
            Write to <a href={`mailto:${store.support}`} style={{ color: MUTED }}>{store.support}</a> and
            it gets cancelled by hand — you won&rsquo;t be charged again either way.
          </p>
        </div>
      )}
    </Card>
  );
}
