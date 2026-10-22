import { db } from "@/lib/db";
import { Shell, Card } from "@/components/ui";
import { leerBaja, type Suscriptor } from "@/lib/suscripcion";
import { PanelSuscripcion } from "./PanelSuscripcion";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * La pagina de la suscripcion: lo que abre el link de cada mail.
 *
 * POR QUE NO PIDE NADA
 *   El token esta firmado con HMAC y no caduca: quien tiene el link es quien
 *   recibio el mail. Pedirle contrasena a alguien que quiere darse de baja es
 *   como se consigue una queja de spam -- y una queja cuesta mucho mas que el
 *   suscriptor que se intentaba retener. En Estados Unidos y en el Reino Unido,
 *   ademas, la baja en un clic es obligatoria.
 *
 * El token identifica UNA suscripcion, no una cuenta: no deja ver nada de
 * nadie mas, y lo unico que puede hacer es cancelar la propia.
 */

const COLS =
  "id,store_id,email,name,status,founder,amount,currency,payments_count,paid_total," +
  "started_at,current_period_end,last_payment_at,failed_count,whop_membership_id";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = leerBaja(token);

  if (!id) {
    return (
      <Shell><Card>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-.01em" }}>This link isn&rsquo;t valid</h1>
        <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.6, color: "#6b7280" }}>
          It may have been copied incompletely. Open the link straight from your
          email, or just reply to any of our emails and we&rsquo;ll sort it out.
        </p>
      </Card></Shell>
    );
  }

  const { data } = await db.from("subscriptions").select(COLS).eq("id", id).maybeSingle();
  const sub = (data as unknown as (Suscriptor & { store_id: string }) | null) ?? null;

  if (!sub) {
    return (
      <Shell><Card>
        <h1 style={{ margin: 0, fontSize: 22 }}>We can&rsquo;t find that subscription</h1>
        <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.6, color: "#6b7280" }}>
          Reply to any of our emails and we&rsquo;ll take care of it.
        </p>
      </Card></Shell>
    );
  }

  const { data: tienda } = await db
    .from("stores").select("display_name,name,support_email")
    .eq("id", sub.store_id).maybeSingle();

  return (
    <Shell>
      <PanelSuscripcion
        token={token}
        sub={{
          status: sub.status, email: sub.email, founder: sub.founder,
          amount: sub.amount == null ? null : Number(sub.amount),
          currency: sub.currency, payments: sub.payments_count,
          paid: Number(sub.paid_total) || 0,
          since: sub.started_at, until: sub.current_period_end,
          failed: sub.failed_count,
        }}
        store={{
          name: (tienda?.display_name as string | null) || (tienda?.name as string) || "",
          support: (tienda?.support_email as string) || "",
        }}
      />
    </Shell>
  );
}
