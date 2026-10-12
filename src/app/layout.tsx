// Sin marca por defecto: cada página (checkout, catálogo, post-compra, panel)
// pone su propio título e ícono. Esto es solo lo que queda si alguna no lo hace.
export const metadata = {
  title: "Secure checkout",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
