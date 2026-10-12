"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { mergeSettings } from "@/lib/checkout-settings";
import { invalidateCheckouts } from "@/lib/checkout-data";
import { recoverCart } from "@/lib/cart-recovery";
import type { ActionResult } from "./types";

/**
 * Carritos › Ajustes de un checkout: recuperación prendida o no, minutos de
 * espera, % de descuento y horas de validez. Va a funnels.settings.recovery
 * (lo lee el cron y el checkout). Empieza con requireAdmin(): una server
 * action se puede llamar por POST directo.
 */
export async function saveRecoveryAction(funnelId: string, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { data: f } = await db.from("funnels").select("settings,stores(slug)").eq("id", funnelId).maybeSingle();
    if (!f) return { error: "No existe ese checkout." };
    const num = (k: string) => Number(String(fd.get(k) ?? "").replace(",", "."));
    const next = mergeSettings(f.settings, {
      recovery: { enabled: fd.get("enabled") === "on", delayMinutes: num("delayMinutes"), discountPercent: num("discountPercent"), validHours: num("validHours") },
    });
    const { error } = await db.from("funnels").update({ settings: next }).eq("id", funnelId);
    if (error) return { error: error.message };
    const slug = (f.stores as unknown as { slug: string } | null)?.slug;
    invalidateCheckouts(slug);
    revalidatePath("/admin", "layout");
    const r = next.recovery;
    return { ok: r.enabled ? `Prendida: ${r.discountPercent} % por ${r.validHours} h, a los ${r.delayMinutes} min` : "Apagada en este checkout" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Mandar ya el mail a un carrito (sin esperar los minutos de inactividad). */
export async function sendCartNowAction(cartId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await recoverCart(cartId, { force: true });
    revalidatePath("/admin", "layout");
    if ("sent" in r) return { ok: `Enviado a ${r.to} (${r.source === "ai" ? "IA" : "texto de respaldo"})` };
    return { error: `No se mandó: ${"skipped" in r ? r.skipped : "?"}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
