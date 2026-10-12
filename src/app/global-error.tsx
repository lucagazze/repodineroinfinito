"use client";

import RetryScreen from "@/components/RetryScreen";

/** Último respaldo: si falla hasta el layout, una pantalla con reintento (nunca una página en blanco). */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <RetryScreen kind="auto" error={error} />
      </body>
    </html>
  );
}
