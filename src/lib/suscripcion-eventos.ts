import { db, STORE_COLS, type Store } from "@/lib/db";
import { sendMail, senderOf } from "@/lib/email";
import { publicOrigin } from "@/lib/public-url";
import { firmarBaja, type FalloSub, type ProductoSuscripcion } from "@/lib/suscripcion";

export {
  membresiaWhop, registrarCobroSuscripcion, registrarFalloSuscripcion,
} from "@/lib/suscripcion";

/**
 * Los mails de la suscripcion.
 *
 * Aparte de suscripcion.ts a proposito: ahi esta la logica del cobro, que la
 * usan tambien el cron y los scripts, y no tiene por que arrastrar el modulo
 * de correo entero (plantillas, seguimiento, control de links).
 *
 * Los tres mails que una suscripcion necesita y una venta no:
 *   bienvenida  una vez, cuando entra
 *   rechazo     cuando se le cae la tarjeta -- el que mas plata salva
 *   baja        confirmacion de que no se le cobra mas
 *
 * Todos llevan el link de baja en un clic. No es una cortesia: en Estados
 * Unidos y en el Reino Unido es obligatorio, y un mail de cobro sin salida
 * visible termina en una queja de spam, que cuesta mucho mas que el
 * suscriptor que se queria retener.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const INK = "#171717";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const NAVY = "#0A1024";
const GOLD = "#8a6f2e";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function tienda(storeId: string): Promise<Store | null> {
  const { data } = await db.from("stores").select(STORE_COLS).eq("id", storeId).maybeSingle();
  return (data as unknown as Store | null) ?? null;
}

/** Donde vive la pagina de la suscripcion. Sin dominio publico no se manda nada con link. */
function origen(s: Store) {
  return publicOrigin(s.domain) ?? publicOrigin(process.env.PUBLIC_ORIGIN) ?? null;
}

function envoltorio(s: Store, cuerpo: string, bajaUrl: string | null) {
  const legal = s.legal_name || s.display_name || s.name;
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f7f9">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">

<tr><td align="center" style="padding:0 0 18px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${GOLD}">
${esc(s.display_name || s.name)}
</td></tr>

<tr><td bgcolor="#ffffff" style="border-radius:14px;padding:30px 34px;border:1px solid ${LINE}">
${cuerpo}
</td></tr>

<tr><td align="center" style="padding:18px 16px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:#9ca3af">
${esc(legal)} &middot; ${esc(s.support_email)}<br>
${bajaUrl ? `<a href="${esc(bajaUrl)}" style="color:#9ca3af;text-decoration:underline">Manage or cancel your subscription</a>` : ""}
</td></tr>

</table></td></tr></table>
</body></html>`;
}

function boton(href: string, label: string, color = NAVY) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${color}" style="border-radius:999px">
<a href="${esc(href)}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${esc(label)}</a>
</td></tr></table>`;
}

const p = (txt: string, extra = "") =>
  `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK};${extra}">${txt}</p>`;

// -------------------------------------------------------------- bienvenida

export async function avisarAlta(storeId: string, a: {
  id: string; email: string; name?: string | null;
  producto: ProductoSuscripcion; importe: number; currency: string; fundador: boolean;
}) {
  const s = await tienda(storeId);
  if (!s) return { skipped: true as const };
  const base = origen(s);
  const baja = base ? `${base}/suscripcion/${firmarBaja(a.id)}` : null;
  const nombre = a.producto.short_name || a.producto.name;
  const precio = `$${a.importe.toFixed(0)}`;

  const cuerpo = [
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">You're in</p>`,
    `<p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.25;color:${INK}">${esc(nombre)}</p>`,
    p(`The book taught you to read the screen. From now on it gets read <strong>for</strong> you — every week.`),
    p(`Your first edition arrives this Sunday. Every edition carries the same four sections, in the same order, so you always know where to look.`),
    a.fundador
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fdf8ec" style="border-radius:10px;margin:4px 0 18px">
<tr><td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:#6b5618">
<strong>Founder rate: ${esc(precio)}/month, locked.</strong><br>You bought the book before this opened. That price doesn't move as long as you stay.
</td></tr></table>`
      : p(`<strong>${esc(precio)} per month.</strong> Cancel in one click, any time.`),
    baja ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:6px 0 0">${boton(baja, "Manage my subscription")}</td></tr></table>` : "",
    `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED}">No forecasts. Every figure with its source. Always one test you can run yourself.</p>`,
  ].join("\n");

  return sendMail({
    store: s, to: a.email, toName: a.name ?? null,
    subject: `You're in — ${nombre} starts Sunday`,
    html: envoltorio(s, cuerpo, baja),
    tag: "suscripcion-alta", kind: "subscription",
    headers: baja ? { "List-Unsubscribe": `<${baja}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
  });
}

// --------------------------------------------------------- tarjeta rechazada

/**
 * El mail que mas plata salva.
 *
 * Una tarjeta vencida no es una baja: casi siempre es alguien que no se
 * entero. Whop reintenta varios dias, pero el unico que puede arreglarlo es el
 * suscriptor, y para eso tiene que saber que paso.
 *
 * Se manda UNA vez por episodio de mora: `dunning_sent_at` se limpia solo
 * cuando un cobro entra bien (sub_cobro), asi que un segundo rechazo del mismo
 * episodio no vuelve a escribir. Tres mails por una tarjeta es como se pierde
 * a alguien que iba a pagar.
 */
export async function avisarTarjetaRechazada(
  storeId: string, r: FalloSub & { producto?: ProductoSuscripcion },
) {
  if (r.sin_suscripcion || r.repetido || r.avisado) return { skipped: true as const };
  const id = typeof r.id === "string" ? r.id : null;
  const email = typeof r.email === "string" ? r.email : null;
  if (!id || !email) return { skipped: true as const };

  const s = await tienda(storeId);
  if (!s) return { skipped: true as const };
  const base = origen(s);
  const baja = base ? `${base}/suscripcion/${firmarBaja(id)}` : null;
  // El sitio de Whop es donde el suscriptor cambia la tarjeta: la app no la
  // toca nunca, asi que el boton tiene que llevarlo alla.
  const arreglar = "https://whop.com/orders";
  const nombre = r.producto?.short_name || r.producto?.name || "your subscription";

  const cuerpo = [
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#b45309">Payment didn't go through</p>`,
    `<p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:${INK}">Your card was declined</p>`,
    p(`We couldn't charge your card for <strong>${esc(nombre)}</strong>. Nine times out of ten it's an expired card, not a decision.`),
    p(`<strong>You still have access.</strong> Nothing is cut off while we retry — but if it keeps failing, it will be.`),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:6px 0 18px">${boton(arreglar, "Update my card")}</td></tr></table>`,
    `<p style="margin:0 0 0;padding-top:18px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED}">Would rather stop? ${baja ? `<a href="${esc(baja)}" style="color:${MUTED}">Cancel in one click</a> — no reply needed.` : `Just reply to this email.`}</p>`,
  ].join("\n");

  const res = await sendMail({
    store: s, to: email,
    subject: `Your card was declined — ${nombre}`,
    html: envoltorio(s, cuerpo, baja),
    tag: "suscripcion-rechazo", kind: "subscription",
    headers: baja ? { "List-Unsubscribe": `<${baja}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
  });
  // Se marca DESPUES de que salio: si el mail falla, el proximo rechazo
  // vuelve a intentarlo en vez de dar por avisado a alguien que no lo esta.
  if (!("skipped" in res)) {
    await db.from("subscriptions").update({ dunning_sent_at: new Date().toISOString() }).eq("id", id);
    await db.from("subscription_events").insert({
      subscription_id: id, store_id: storeId, email, kind: "dunning_mail",
      detail: `aviso de tarjeta rechazada (intento ${Number(r.fallos) || 1})`,
    });
  }
  return res;
}

// -------------------------------------------------------------------- baja

export async function avisarBaja(storeId: string, a: {
  id: string; email: string; hasta: string | null; producto?: ProductoSuscripcion | null;
}) {
  const s = await tienda(storeId);
  if (!s) return { skipped: true as const };
  const nombre = a.producto?.short_name || a.producto?.name || "your subscription";
  const fecha = a.hasta
    ? new Date(a.hasta).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const cuerpo = [
    `<p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:${INK}">Your subscription is cancelled</p>`,
    p(`You won't be charged again for <strong>${esc(nombre)}</strong>.`),
    fecha
      ? p(`You already paid through <strong>${esc(fecha)}</strong>, so editions keep arriving until then. Nothing to do.`)
      : p(`Access ends with the period you've already paid for.`),
    p(`The book is yours for good — that doesn't change.`),
    `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED}">If something was wrong with it, reply and tell me. I read every one.</p>`,
  ].join("\n");

  return sendMail({
    store: s, to: a.email,
    subject: `Cancelled — ${nombre}`,
    html: envoltorio(s, cuerpo, null),
    tag: "suscripcion-baja", kind: "subscription",
  });
}
