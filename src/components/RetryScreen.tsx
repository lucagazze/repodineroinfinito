"use client";

import { useEffect, useState } from "react";

/**
 * Pantalla de respaldo cuando una página del comprador (checkout, oferta,
 * gracias) falla al armarse (la base no responde, un error inesperado): nunca
 * una página en blanco ni un 500. Reintenta sola unas veces y siempre deja una
 * salida. En el idioma del navegador.
 */

type Kind = "checkout" | "oferta" | "gracias";
/** auto = según la dirección (global-error): /oferta, /gracias o el checkout. */
type KindArg = Kind | "auto";

const TXT: Record<string, Record<Kind | "retry" | "retrying" | "downloads", string>> = {
  en: {
    checkout: "We're having a brief problem loading the checkout. Nothing has been charged.",
    oferta: "Your payment is confirmed and your files are on their way by email.",
    gracias: "Your payment is confirmed. Your files arrive by email in a few minutes.",
    retry: "Try again", retrying: "Retrying in a few seconds…", downloads: "Go to my downloads",
  },
  es: {
    checkout: "Tenemos un problema momentáneo para cargar el pago. No se cobró nada.",
    oferta: "Tu pago está confirmado y tus archivos ya van por email.",
    gracias: "Tu pago está confirmado. Tus archivos te llegan por email en unos minutos.",
    retry: "Reintentar", retrying: "Reintentando en unos segundos…", downloads: "Ir a mis descargas",
  },
  it: {
    checkout: "Abbiamo un problema momentaneo a caricare il pagamento. Non è stato addebitato nulla.",
    oferta: "Il pagamento è confermato e i tuoi file stanno arrivando via email.",
    gracias: "Il pagamento è confermato. I tuoi file arrivano via email in pochi minuti.",
    retry: "Riprova", retrying: "Riprovo tra qualche secondo…", downloads: "Vai ai tuoi download",
  },
  fr: {
    checkout: "Nous avons un petit problème pour charger le paiement. Rien n'a été débité.",
    oferta: "Ton paiement est confirmé et tes fichiers arrivent par e-mail.",
    gracias: "Ton paiement est confirmé. Tes fichiers arrivent par e-mail dans quelques minutes.",
    retry: "Réessayer", retrying: "Nouvel essai dans quelques secondes…", downloads: "Aller à mes téléchargements",
  },
  de: {
    checkout: "Beim Laden der Zahlung gibt es gerade ein kurzes Problem. Es wurde nichts abgebucht.",
    oferta: "Deine Zahlung ist bestätigt, deine Dateien kommen per E-Mail.",
    gracias: "Deine Zahlung ist bestätigt. Deine Dateien kommen in wenigen Minuten per E-Mail.",
    retry: "Erneut versuchen", retrying: "Neuer Versuch in ein paar Sekunden…", downloads: "Zu meinen Downloads",
  },
  pt: {
    checkout: "Estamos com um problema momentâneo para carregar o pagamento. Nada foi cobrado.",
    oferta: "Seu pagamento está confirmado e seus arquivos chegam por email.",
    gracias: "Seu pagamento está confirmado. Seus arquivos chegam por email em poucos minutos.",
    retry: "Tentar de novo", retrying: "Tentando de novo em alguns segundos…", downloads: "Ir para meus downloads",
  },
};

const MAX_AUTO = 3;

export default function RetryScreen({ kind: kindArg, error }: { kind: KindArg; error?: Error & { digest?: string } }) {
  const [lang, setLang] = useState("en");
  const [kind, setKind] = useState<Kind>(kindArg === "auto" ? "checkout" : kindArg);
  const [auto, setAuto] = useState(false);
  const [downloads, setDownloads] = useState<string | null>(null);

  useEffect(() => {
    const l = (document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase();
    setLang(TXT[l] ? l : "en");
    const k: Kind = kindArg !== "auto" ? kindArg : /^\/oferta/.test(window.location.pathname) ? "oferta" : /^\/gracias/.test(window.location.pathname) ? "gracias" : "checkout";
    setKind(k);
    console.error("[retry-screen]", k, error?.digest ?? "", error?.message ?? "");
    // Después de un pago, la salida es la página de descargas del pedido.
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("session_id") ?? q.get("payment_intent");
    if (k === "oferta" && ref) setDownloads(`/gracias?session_id=${encodeURIComponent(ref)}&done=1`);
    // Reintento automático (con tope por página, para no quedar en un bucle).
    const key = `retry:${window.location.pathname}`;
    let n = 0;
    try { n = Number(sessionStorage.getItem(key) ?? 0); } catch { /* sin storage */ }
    if (n < MAX_AUTO) {
      setAuto(true);
      const t = setTimeout(() => {
        try { sessionStorage.setItem(key, String(n + 1)); } catch { /* sin storage */ }
        window.location.reload();
      }, 3000 + n * 3000);
      return () => clearTimeout(t);
    }
  }, [kindArg, error]);

  const t = TXT[lang] ?? TXT.en;
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f8fafc", fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", color: "#0f172a" }}>
      <div style={{ maxWidth: 440, width: "100%", background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 10px 30px rgba(15,23,42,.08)", textAlign: "center" }}>
        <div aria-hidden style={{ fontSize: 34, marginBottom: 8 }}>{kind === "checkout" ? "⏳" : "✓"}</div>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, fontWeight: 600 }}>{t[kind]}</p>
        {auto && <p style={{ margin: "10px 0 0", fontSize: 13, color: "#64748b" }}>{t.retrying}</p>}
        <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={() => window.location.reload()}
            style={{ padding: "13px 16px", border: 0, borderRadius: 10, background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            {t.retry}
          </button>
          {downloads && <a href={downloads} style={{ color: "#1d4ed8", fontWeight: 600, fontSize: 14 }}>{t.downloads}</a>}
        </div>
      </div>
    </main>
  );
}
