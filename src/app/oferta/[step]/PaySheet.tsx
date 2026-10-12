"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { T, money, type Locale } from "@/lib/i18n";
import { stripeFor, type SheetData } from "./useOffer";

/**
 * Hoja de pago de una oferta post-compra: aparece cuando el medio que dejó
 * guardado no se puede cobrar con 1 clic (o no dejó ninguno). Apple Pay /
 * Google Pay / Link / Amazon Pay arriba, el resto (tarjeta…) abajo, y un
 * botón «Pagar X». El PaymentIntent lo creó el servidor con el importe de la
 * oferta; acá solo se confirma. Las redirecciones vuelven a la misma oferta.
 *
 * Se espera al comprador: no se cierra tocando afuera. Cerrarla (× o «No,
 * gracias») es un no a la oferta y sigue al próximo paso. Pagada, muestra
 * «Agregado a tu pedido ✓» hasta que la oferta avanza.
 */

export const PAY_COPY: Record<Locale, {
  title: string; secure: string; noThanks: string; failed: string; processing: string; tryOther: string; added: string; savedFailed: string; pending: string;
}> = {
  en: {
    title: "Complete your purchase", secure: "Secure payment · charged once", noThanks: "No thanks", processing: "Processing payment…",
    failed: "The payment didn't go through.", tryOther: "Try another payment method", added: "Added to your order",
    savedFailed: "We couldn't charge your saved payment method. Choose how you want to pay:",
    pending: "Your payment is still being processed. If it goes through, it arrives in your email.",
  },
  es: {
    title: "Completá tu compra", secure: "Pago seguro · un solo cobro", noThanks: "No, gracias", processing: "Procesando el pago…",
    failed: "El pago no se pudo completar.", tryOther: "Probar otro medio de pago", added: "Agregado a tu pedido",
    savedFailed: "No pudimos cobrar con el medio de pago que usaste. Elegí cómo pagar:",
    pending: "Tu pago todavía se está procesando. Si se completa, te llega por email.",
  },
  it: {
    title: "Completa l'acquisto", secure: "Pagamento sicuro · un solo addebito", noThanks: "No, grazie", processing: "Elaborazione del pagamento…",
    failed: "Il pagamento non è andato a buon fine.", tryOther: "Prova un altro metodo di pagamento", added: "Aggiunto al tuo ordine",
    savedFailed: "Non siamo riusciti ad addebitare il metodo di pagamento che hai usato. Scegli come pagare:",
    pending: "Il pagamento è ancora in elaborazione. Se va a buon fine, lo ricevi via email.",
  },
  "pt-BR": {
    title: "Conclua sua compra", secure: "Pagamento seguro · cobrança única", noThanks: "Não, obrigado", processing: "Processando o pagamento…",
    failed: "O pagamento não foi concluído.", tryOther: "Tentar outra forma de pagamento", added: "Adicionado ao seu pedido",
    savedFailed: "Não conseguimos cobrar no meio de pagamento que você usou. Escolha como pagar:",
    pending: "Seu pagamento ainda está sendo processado. Se for concluído, chega no seu email.",
  },
  fr: {
    title: "Finalise ton achat", secure: "Paiement sécurisé · un seul prélèvement", noThanks: "Non merci", processing: "Paiement en cours…",
    failed: "Le paiement n'a pas abouti.", tryOther: "Essayer un autre moyen de paiement", added: "Ajouté à ta commande",
    savedFailed: "Nous n'avons pas pu débiter le moyen de paiement que tu as utilisé. Choisis comment payer :",
    pending: "Ton paiement est encore en cours de traitement. S'il aboutit, tu le reçois par e-mail.",
  },
  de: {
    title: "Kauf abschließen", secure: "Sichere Zahlung · einmalige Abbuchung", noThanks: "Nein danke", processing: "Zahlung wird verarbeitet…",
    failed: "Die Zahlung hat nicht geklappt.", tryOther: "Andere Zahlungsart wählen", added: "Zu deiner Bestellung hinzugefügt",
    savedFailed: "Wir konnten deine gespeicherte Zahlungsart nicht belasten. Wähle, wie du zahlen möchtest:",
    pending: "Deine Zahlung wird noch verarbeitet. Wenn sie durchgeht, kommt alles per E-Mail.",
  },
};

const CSS = `
.psh-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;animation:psh-f .18s ease-out}
.psh{position:relative;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;background:#fff;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:psh-u .22s ease-out;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a}
@media(min-width:640px){.psh-bg{align-items:center}.psh{border-radius:18px}}
.psh-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.psh-h div{flex:1;min-width:0}
.psh-t{margin:0;font-size:17px;font-weight:800;line-height:1.25}
.psh-p{margin:3px 0 0;font-size:13.5px;color:#475569;line-height:1.35}
.psh-p b{color:#0f172a}
.psh-x{flex:none;width:34px;height:34px;border:0;border-radius:50%;background:#f1f5f9;color:#334155;font-size:20px;line-height:1;cursor:pointer}
.psh-note{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:13px;line-height:1.45}
.psh-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:#64748b;font-size:12.5px}
.psh-or:before,.psh-or:after{content:"";flex:1;height:1px;background:#e2e8f0}
.psh-pay{width:100%;margin-top:16px;padding:15px;border:0;border-radius:10px;background:#16a34a;color:#fff;font:800 16px/1.2 inherit;cursor:pointer}
.psh-pay[disabled]{opacity:.7;cursor:wait}
.psh-err{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b42318;font-size:13px;line-height:1.45}
.psh-err button{display:block;margin-top:6px;padding:0;border:0;background:none;color:#1d4ed8;font:700 13px/1.4 inherit;text-decoration:underline;cursor:pointer}
.psh-sec{margin:10px 0 0;text-align:center;color:#64748b;font-size:12px}
.psh-no{display:block;margin:12px auto 0;padding:6px 10px;border:0;background:none;color:#64748b;font:500 13.5px/1.3 inherit;text-decoration:underline;cursor:pointer}
.psh-sk{height:120px;border-radius:10px;background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200% 100%;animation:psh-s 1.2s infinite}
.psh-ok{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#fff;border-radius:inherit;font-size:18px;font-weight:800;color:#067647;text-align:center;padding:24px}
.psh-ok i{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:#dcfce7;font-style:normal;font-size:34px}
@keyframes psh-f{from{opacity:0}}@keyframes psh-u{from{transform:translateY(30px);opacity:.4}}@keyframes psh-s{to{background-position:-200% 0}}
`;
const STYLE = { __html: CSS };

export type PaySheetProps = {
  data: SheetData;
  publishableKey: string;
  locale: Locale;
  productName: string;
  buyer: { email: string | null; name: string | null; country: string | null };
  /** Ya cobrado: muestra «Agregado a tu pedido ✓» mientras la oferta avanza. */
  done: boolean;
  returnUrl: () => string;
  /** Cerrar sin pagar = «No, gracias»: sigue al próximo paso. */
  onDecline: () => void;
  onPaid: (pi: string) => Promise<void> | void;
  onError: (code: string) => void;
};

export function PaySheet(p: PaySheetProps) {
  const c = PAY_COPY[p.locale] ?? PAY_COPY.en;
  const amount = money(p.data.amount, p.data.currency, p.locale);

  // Sin esto el fondo sigue scrolleando debajo de la hoja en el teléfono.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="psh-bg">
      <style dangerouslySetInnerHTML={STYLE} />
      <div className="psh" role="dialog" aria-modal="true" aria-label={c.title}>
        {p.done && <div className="psh-ok" role="status"><i>✓</i>{c.added}</div>}
        <div className="psh-h">
          <div>
            <p className="psh-t">{c.title}</p>
            <p className="psh-p">{p.productName ? <>{p.productName} · </> : null}<b>{amount}</b></p>
          </div>
          <button type="button" className="psh-x" aria-label={c.noThanks} onClick={p.onDecline}>×</button>
        </div>
        {p.data.savedFailed && <p className="psh-note">{c.savedFailed}</p>}
        <Elements
          key={p.data.clientSecret}
          stripe={stripeFor(p.publishableKey)}
          options={{
            clientSecret: p.data.clientSecret,
            locale: p.locale,
            appearance: {
              theme: "stripe",
              variables: { colorPrimary: "#16a34a", borderRadius: "8px", fontSizeBase: "15px", colorText: "#0f172a" },
              rules: { ".Input": { boxShadow: "none" }, ".Tab": { boxShadow: "none" } },
            },
          }}
        >
          <SheetForm {...p} amount={amount} copy={c} />
        </Elements>
        <button type="button" className="psh-no" onClick={p.onDecline}>{c.noThanks}</button>
      </div>
    </div>
  );
}

function SheetForm(p: PaySheetProps & { amount: string; copy: (typeof PAY_COPY)[Locale] }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [express, setExpress] = useState(false);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const t = T[p.locale] ?? T.en;

  async function confirm() {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setMsg(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: p.returnUrl(),
        payment_method_data: {
          billing_details: {
            email: p.buyer.email ?? undefined,
            // El formulario no pide dirección: va el país del pedido (Stripe exige mandarla si no la pide).
            address: { country: p.buyer.country || "US", postal_code: "", state: "", city: "", line1: "", line2: "" },
          },
        },
      },
    });
    if (!error && paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      // Sigue «Procesando el pago…» hasta que el servidor lo confirma y la oferta avanza.
      await p.onPaid(paymentIntent.id);
      return;
    }
    p.onError(error?.decline_code ?? error?.code ?? error?.type ?? paymentIntent?.status ?? "unknown");
    // El texto real de Stripe (ya en el idioma del comprador).
    setMsg(error?.message ?? p.copy.failed);
    setBusy(false);
  }

  function tryOther() {
    setMsg(null);
    try { elements?.getElement("payment")?.collapse(); } catch { /* sin acordeón */ }
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div ref={box}>
      <ExpressCheckoutElement
        options={{ buttonHeight: 48, layout: { maxColumns: 1, maxRows: 2, overflow: "auto" }, buttonType: { applePay: "buy", googlePay: "buy" } }}
        onReady={({ availablePaymentMethods }) => setExpress(!!availablePaymentMethods)}
        onConfirm={() => confirm()}
      />
      {express && <div className="psh-or">{t.ckOrPayOther}</div>}
      {!ready && <div className="psh-sk" />}
      <PaymentElement
        onReady={() => setReady(true)}
        options={{
          layout: { type: "accordion", radios: "always", spacedAccordionItems: false, defaultCollapsed: false },
          fields: { billingDetails: { email: "never", address: "never" } },
          // Apple Pay, Google Pay y Link van arriba como botones rápidos.
          wallets: { applePay: "never", googlePay: "never", link: "never" },
          terms: { card: "never" },
        }}
      />
      <button type="button" className="psh-pay" disabled={busy || !stripe || !ready} aria-busy={busy} onClick={confirm}>
        {busy ? p.copy.processing : t.ckPay(p.amount)}
      </button>
      {msg && (
        <div className="psh-err" role="alert">
          {msg}
          <button type="button" onClick={tryOther}>{p.copy.tryOther}</button>
        </div>
      )}
      <p className="psh-sec">🔒 {p.copy.secure}</p>
    </div>
  );
}
