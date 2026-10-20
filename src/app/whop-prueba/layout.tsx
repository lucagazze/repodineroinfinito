import { notFound } from "next/navigation";

// Sin esto Next intenta prerenderizarla y el notFound() salta en pleno build.
export const dynamic = "force-dynamic";

/**
 * El banco de pruebas de Whop solo existe en desarrollo. En produccion esta
 * ruta es un 404 como cualquier otra que no existe.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
