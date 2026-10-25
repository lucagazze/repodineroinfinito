import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendTest } from "@/lib/mkt/send";
import type { Locale, Version } from "@/lib/mkt/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Cuántos borradores como máximo por corrida: un tope para que nunca sea una ráfaga. */
const TOPE = 3;

type Fila = { id: string; name: string; versions: Partial<Record<Locale, Version>> | null; updated_at: string };

/**
 * La prueba automática, los domingos después de refrescar la carta (pg_cron
 * «prueba-semanal», con el CRON_SECRET): manda cada idioma de los borradores
 * recién tocados a la casilla de TEST_EMAIL y a nadie más, así el respaldo
 * queda en el buzón del dueño antes de que apriete «Enviar».
 *
 * Lo que este cron NO hace: enviar la campaña. `sendTest` está clavado a
 * TEST_TO (send.ts) y los borradores siguen en «draft»; la cola de verdad
 * sólo la llena `confirmSend`, que es el botón del panel. Un cron no puede
 * sacar una campaña a los suscriptores ni por error ni a propósito.
 *
 * Manda una sola vez por borrador por día (mira las pruebas ya enviadas en
 * mkt_sends), así correrlo más seguido no llena el buzón. Con `?id=<uuid>`
 * fuerza uno puntual y se saltea ese freno, que es lo que querés cuando lo
 * disparás a mano.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const a = process.env.TEST_EMAIL;
  if (!a) {
    return NextResponse.json({ error: "Falta TEST_EMAIL: sin casilla de prueba no mando nada" }, { status: 500 });
  }

  const uno = new URL(req.url).searchParams.get("id");
  let q = db.from("mkt_campaigns").select("id,name,versions,updated_at").eq("status", "draft");
  // A mano: el que te interese. Automático: sólo lo tocado en la última semana,
  // para no probar borradores viejos que nadie va a mandar.
  q = uno ? q.eq("id", uno) : q.gte("updated_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const borradores = (data ?? []) as Fila[];

  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  const detalle: Record<string, unknown>[] = [];
  let mandadas = 0;

  for (const c of borradores) {
    const idiomas = Object.entries(c.versions ?? {})
      .filter(([, v]) => v?.subject && v.blocks?.length)
      .map(([l]) => l);
    if (!idiomas.length) {
      detalle.push({ campaña: c.name, saltada: "no tiene ninguna versión con asunto y contenido" });
      continue;
    }
    if (mandadas >= TOPE) {
      detalle.push({ campaña: c.name, saltada: `tope de ${TOPE} por corrida: queda para la próxima` });
      continue;
    }
    if (!uno) {
      const { count } = await db.from("mkt_sends").select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id).eq("is_test", true).eq("status", "sent").gte("sent_at", hoy.toISOString());
      if (count) {
        detalle.push({ campaña: c.name, saltada: `hoy ya salió la prueba (${count})` });
        continue;
      }
    }
    try {
      const r = await sendTest(c.id);
      mandadas++;
      detalle.push({
        campaña: c.name,
        idiomas: r.map((x) => ({ idioma: x.locale, ok: x.ok, asunto: x.subject ?? null, error: x.error ?? null, avisos: x.notes ?? [] })),
      });
    } catch (e) {
      // Una campaña que falla no frena a las demás: el error queda en la respuesta del cron.
      detalle.push({ campaña: c.name, error: (e as Error).message });
    }
  }

  return NextResponse.json({ a, borradores: borradores.length, mandadas, detalle });
}
