import type { CSSProperties, ReactNode } from "react";

/** Piezas compartidas por las pantallas públicas. */

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f2f2f7",
        color: "#1d1d1f",
        fontFamily: "-apple-system, 'Segoe UI', Inter, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      {children}
    </main>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 560,
        width: "100%",
        background: "#fff",
        borderRadius: 18,
        padding: "34px 30px",
        boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.06)",
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  href,
  onClick,
  color = "#1d1d1f",
  variant = "solid",
  children,
  disabled,
}: {
  href?: string;
  onClick?: () => void;
  color?: string;
  variant?: "solid" | "ghost";
  children: ReactNode;
  disabled?: boolean;
}) {
  const style: CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "center",
    padding: "15px 24px",
    borderRadius: 11,
    fontWeight: 650,
    fontSize: 16,
    textDecoration: "none",
    cursor: disabled ? "default" : "pointer",
    border: variant === "ghost" ? "1px solid #d8d8de" : "none",
    background: variant === "ghost" ? "transparent" : color,
    color: variant === "ghost" ? "#6e6e73" : "#fff",
    opacity: disabled ? 0.6 : 1,
  };
  return href ? (
    <a href={href} style={style}>
      {children}
    </a>
  ) : (
    <button onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

export function Muted({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <p style={{ color: "#8a8a8f", fontSize: 14, lineHeight: 1.6, margin: "6px 0 0", ...style }}>
      {children}
    </p>
  );
}
