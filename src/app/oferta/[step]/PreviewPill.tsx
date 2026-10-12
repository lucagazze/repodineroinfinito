/**
 * Marca de vista previa: una franja fina arriba de todo, fuera de la página,
 * así no tapa nada de lo que ve el comprador (una píldora flotante quedaba
 * encima del "pago confirmado"). Se va al hacer scroll.
 */
export function PreviewPill({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      role="note"
      style={{
        padding: "5px 12px", background: "#f7cf49", color: "#101828", textAlign: "center",
        font: "800 11px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif", letterSpacing: ".08em",
        textTransform: "uppercase",
      }}
    >
      {label}{detail ? ` · ${detail}` : ""}
    </div>
  );
}
