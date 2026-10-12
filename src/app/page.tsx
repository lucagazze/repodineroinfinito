import { redirect } from "next/navigation";
import { headers } from "next/headers";

// La raíz no vende nada: los compradores entran directo a /c/[tienda]/[embudo].
// En el dominio de la app (vercel.app, localhost) va al panel; en un dominio
// público muestra el catálogo de la tienda, que es
// lo que ve quien escribe la dirección a mano (y Stripe cuando la revisa).
export default async function Home() {
  const host = ((await headers()).get("host") ?? "").toLowerCase();
  // El panel vive en PANEL_HOST (si está configurado) o en el dominio de Vercel.
  const panel = (process.env.PANEL_HOST || "").toLowerCase();
  if ((panel && host === panel) || host.endsWith(".vercel.app") || host.startsWith("localhost") || host.startsWith("127.0.0.1")) redirect("/admin");
  // La marca principal muestra su catálogo (PUBLIC_HOME_STORE).
  if (!process.env.PUBLIC_HOME_STORE) redirect("/admin");
  redirect(`/catalogo/${process.env.PUBLIC_HOME_STORE}`);
}
