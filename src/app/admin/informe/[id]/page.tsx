import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { activityReport, type ReportEvent } from "@/lib/admin/activity-report";
import PrintBar from "./PrintBar";

export const dynamic = "force-dynamic";

/**
 * Informe de actividad de un pedido, en inglés y listo para «Guardar como PDF»: la evidencia para
 * adjuntar en una disputa de Stripe (como el de referencia). Hoja blanca propia, también en el
 * panel oscuro; al imprimir solo sale la hoja.
 */
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : "—");

function Sec({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rp-sec">
      <h2>{n}. {title}</h2>
      {children}
    </section>
  );
}
function KV({ rows }: { rows: [string, ReactNode][] }) {
  return <table className="rp-kv"><tbody>{rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>;
}
function Events({ list, cols }: { list: ReportEvent[]; cols: ("kind" | "ip" | "place" | "client" | "detail")[] }) {
  const H = { kind: "Event", ip: "IP", place: "Location", client: "Device / client", detail: "Detail" };
  return (
    <table className="rp-tb">
      <thead><tr><th>Date and time</th>{cols.map((c) => <th key={c}>{H[c]}</th>)}</tr></thead>
      <tbody>{list.map((e, i) => <tr key={i}><td className="nw">{when(e.at)}</td>{cols.map((c) => <td key={c} className={c === "ip" ? "sm" : c === "detail" ? "sm wrap" : ""}>{e[c] || "—"}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default async function Informe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await activityReport(id);
  if (!r) notFound();
  let n = 0;
  return (
    <div className="rp-wrap">
      <style>{CSS}</style>
      <PrintBar file={`activity-report-order-${r.ref.replace("#", "")}`} />
      <article className="rp">
        <header className="rp-top"><span>Order activity report · {r.ref} · {r.seller.store}</span><span>Times in UTC · Generated {when(r.generatedAt)}</span></header>
        <h1>Order activity report {r.ref}</h1>
        <p className="rp-lead">Evidence document prepared at the seller&apos;s request. All data comes from the automatic records of the store&apos;s checkout platform and from the payment processor (Stripe), and is presented without modification.</p>

        <div className="rp-two">
          <div><h3>Seller</h3><KV rows={[["Store", r.seller.store], ["Website", r.seller.website], ["Legal name", r.seller.legalName], ["Address", r.seller.address], ["Support email", r.seller.supportEmail], ["Card statement descriptor", r.seller.descriptor]]} /></div>
          <div><h3>Buyer</h3><KV rows={[["Email", r.buyer.email], ["Name", r.buyer.name], ["Phone", r.buyer.phone], ["Location by IP", r.buyer.location]]} /></div>
        </div>

        <Sec n={++n} title="Order details">
          <KV rows={[["Order number", r.ref], ["Date and time", when(r.order.at)], ["Status", r.order.status], ["Total charged", <b key="t">{r.order.total}</b>], ["Checkout", r.order.funnel]]} />
        </Sec>

        <Sec n={++n} title="How the buyer reached the payment">
          <KV rows={[
            ["Checkout page where the buyer paid", r.path.checkoutUrl && <a key="c" href={r.path.checkoutUrl} className="rp-a">{r.path.checkoutUrl}</a>],
            ["Store checkout address", r.path.publicCheckout && r.path.publicCheckout !== r.path.checkoutUrl ? <a key="p" href={r.path.publicCheckout} className="rp-a">{r.path.publicCheckout}</a> : null],
            ["Checkout opened at", r.path.openedAt ? when(r.path.openedAt) : null],
            ["Product page (landing) visited", r.path.landing && <a key="l" href={r.path.landing} className="rp-a">{r.path.landing}</a>],
            ["Arrived from", r.path.referrer && <span key="r" className="sm">{r.path.referrer}</span>],
            ["Traffic source", r.path.source],
            ["Campaign", r.path.campaign],
            ["Ad", r.path.ad],
            ["All tracking parameters", Object.keys(r.path.utm).length ? <span key="u" className="sm">{Object.entries(r.path.utm).map(([k, v]) => `${k}=${v}`).join(" · ")}</span> : null],
          ]} />
        </Sec>

        <Sec n={++n} title="Products and amounts">
          <table className="rp-tb"><thead><tr><th>Product</th><th>Type</th><th>Date and time</th><th>Amount</th></tr></thead>
            <tbody>{r.items.map((i, k) => <tr key={k}><td>{i.name}</td><td>{i.type}</td><td className="nw">{when(i.at)}</td><td className="nw">{i.amount}</td></tr>)}</tbody></table>
        </Sec>

        <Sec n={++n} title="Payments (Stripe)">
          {r.payments.length ? r.payments.map((p) => (
            <div key={p.pi} className="rp-pay">
              <KV rows={[
                ["Charge", `${p.amount} · ${when(p.at)} · ${p.product}`], ["Status", `${p.status}${p.disputed ? " · DISPUTED" : ""}${p.refunded ? " · refunded" : ""}`],
                ["Payment method", [p.method, p.card, p.wallet && `wallet: ${p.wallet}`].filter(Boolean).join(" · ")], ["Card issuing country", p.cardCountry],
                ["CVC check", p.cvc], ["Address check", [p.address, p.postal && `postal code: ${p.postal}`].filter(Boolean).join(" · ") || null], ["3D Secure", p.threeDS],
                ["Risk evaluation", p.risk], ["Network response", p.network], ["Billing name", p.billingName], ["Billing email", p.billingEmail], ["Billing country", p.billingCountry],
                ["Identifiers", <span key="i" className="sm">{p.pi}{p.charge ? ` · ${p.charge}` : ""}</span>],
              ]} />
            </div>
          )) : <p className="rp-muted">The payment details could not be read from Stripe.</p>}
        </Sec>

        <Sec n={++n} title="Technical purchase data">
          <KV rows={[["IP address", r.technical.ip], ["Location by IP", r.technical.location], ["Browser and device", r.technical.device], ["Full user-agent", r.technical.ua && <span className="sm">{r.technical.ua}</span>], ["Checkout page", r.technical.page && <span className="sm">{r.technical.page}</span>], ["Meta attribution cookies", r.technical.metaCookies ? "Yes" : "No"]]} />
        </Sec>

        <Sec n={++n} title="Content delivery and email tracking">
          {r.mails.length ? r.mails.map((m, k) => (
            <div key={k} className="rp-mail">
              <KV rows={[["Email", m.kind], ["Recipient", m.to], ["Subject", m.subject], ["Sent on", `${when(m.sentAt)} · ${m.status}`]]} />
              {m.events.length ? <Events list={m.events} cols={["kind", "ip", "client", "detail"]} /> : <p className="rp-muted">No opens or clicks recorded for this email.</p>}
            </div>
          )) : <p className="rp-muted">No emails recorded.</p>}
          <p className="rp-note">Opens are recorded when the email&apos;s images load (some providers load them through a proxy, shown as such); clicks are recorded at the moment the recipient opens the link, with the IP address and device of that connection.</p>
        </Sec>

        {r.downloads.length > 0 && (
          <Sec n={++n} title="Content downloads"><Events list={r.downloads} cols={["detail", "ip"]} /></Sec>
        )}

        <Sec n={++n} title="Browsing before the purchase">
          {r.browsing.length ? <><p>The same browser (persistent visitor identifier) recorded {r.browsing.length} page view{r.browsing.length > 1 ? "s" : ""} in the 72 hours before the purchase.</p><Events list={r.browsing} cols={["kind", "place", "client", "detail"]} /></>
            : <p className="rp-muted">No page views recorded for this browser in the previous 72 hours.</p>}
        </Sec>

        <Sec n={++n} title="Post-purchase offers">
          {r.offers.length ? <Events list={r.offers} cols={["kind", "detail"]} /> : <p className="rp-muted">No post-purchase offers recorded.</p>}
        </Sec>

        <Sec n={++n} title="Other orders by the same person">
          {r.others.length ? (
            <table className="rp-tb"><thead><tr><th>Order</th><th>Date and time</th><th>Status</th><th>Products</th><th>Total</th><th>Linked by</th><th>Disputed</th></tr></thead>
              <tbody>{r.others.map((o) => <tr key={o.ref}><td className="nw">{o.ref}</td><td className="nw">{when(o.at)}</td><td>{o.status}</td><td>{o.products}</td><td className="nw">{o.total}</td><td className="sm wrap">{o.match.join(", ")}</td><td>{o.disputed == null ? "—" : o.disputed ? "Yes" : "No"}</td></tr>)}</tbody></table>
          ) : <p className="rp-muted">No other orders with the same email or IP address.</p>}
        </Sec>

        {r.checks.length > 0 && (
          <Sec n={++n} title="Evidence consistency">
            <div className="rp-box"><ul>{r.checks.map((c, k) => <li key={k}>{c}</li>)}</ul><p>These matches indicate that the person who made the payment is the person who received and used the purchased content.</p></div>
          </Sec>
        )}

        <Sec n={++n} title="Conclusion">
          <p>Based on the platform&apos;s automatic records, regarding order {r.ref} placed on {when(r.order.at)} by {r.buyer.email ?? "the buyer"}, the following facts are documented:</p>
          <ol>{r.facts.map((f, k) => <li key={k}>{f}</li>)}</ol>
          <p>The facts above were recorded automatically by the platform at the time they occurred, cannot be edited by the seller, and are presented without modification.</p>
        </Sec>
        <footer className="rp-foot">{r.seller.store} · {r.seller.website} · Report generated on {when(r.generatedAt)}</footer>
      </article>
    </div>
  );
}

const CSS = `
.rp-wrap{background:#e9e9ee;min-height:100vh;padding:24px 12px 60px}
.rp{background:#fff;color:#1d1d1f;max-width:820px;margin:0 auto;padding:40px 44px;font:13px/1.55 Inter,system-ui,sans-serif;box-shadow:0 2px 20px rgba(0,0,0,.12);border-radius:6px}
.rp h1{font-size:24px;font-weight:800;margin:14px 0 4px;color:#111}
.rp h2{font-size:15px;font-weight:700;margin:0 0 8px;padding-bottom:5px;border-bottom:1.5px solid #222;color:#111}
.rp h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#666;margin:0 0 6px}
.rp-top{display:flex;justify-content:space-between;gap:12px;font-size:10.5px;color:#777;flex-wrap:wrap}
.rp-lead{color:#555;margin:0 0 18px}
.rp-two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}
.rp-sec{margin:20px 0;break-inside:auto}
.rp-kv{width:100%;border-collapse:collapse}
.rp-kv th{width:34%;text-align:left;font-weight:400;color:#666;padding:3px 10px 3px 0;vertical-align:top}
.rp-kv td{padding:3px 0;vertical-align:top;word-break:break-word}
.rp-tb{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px}
.rp-tb th{background:#f3f3f5;text-align:left;font-weight:600;padding:6px 8px}
.rp-tb td{border-bottom:1px solid #eee;padding:6px 8px;vertical-align:top;word-break:break-word}
.rp-tb tr{break-inside:avoid}
.rp .nw{white-space:nowrap}.rp .sm{font-size:11px;color:#555;word-break:break-all}.rp .sm.wrap{word-break:normal;overflow-wrap:anywhere}.rp p,.rp li,.rp td{overflow-wrap:anywhere}
.rp-pay,.rp-mail{border:1px solid #eee;border-radius:6px;padding:10px 12px;margin:8px 0;break-inside:avoid}
.rp-a{color:#4b2bb8;word-break:break-all}.rp-muted{color:#888;font-style:italic}.rp-note{font-size:11px;color:#777}
.rp-box{border:1px solid #222;padding:10px 14px}
.rp ol,.rp ul{padding-left:20px;margin:6px 0}.rp li{margin:3px 0}
.rp-foot{margin-top:28px;font-size:10.5px;color:#888;border-top:1px solid #eee;padding-top:8px}
@media (max-width:640px){.rp{padding:22px 16px}.rp-two{grid-template-columns:1fr}.rp-tb{display:block;overflow-x:auto}}
@media print{@page{size:A4;margin:14mm}
  body,html,.ad-root{background:#fff!important}
  body *{visibility:hidden}.rp,.rp *{visibility:visible}
  .rp-wrap{padding:0;background:#fff}.rp{position:absolute;left:0;top:0;box-shadow:none;max-width:none;padding:0;border-radius:0}
  .rp-print{display:none!important}}
`;
