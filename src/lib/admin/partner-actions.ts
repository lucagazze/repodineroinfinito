"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, adminEmails } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/partner";
import { newPartnerToken } from "@/lib/partner-scope";

/** «Socios» del panel: crear, asignar ofertas, cambiar contraseña, pausar y borrar. Solo el administrador. */
const mailOf = (f: FormData) => String(f.get("email") ?? "").trim().toLowerCase();
const done = () => revalidatePath("/admin/socios");

export async function createPartner(f: FormData) {
  await requireAdmin();
  const email = mailOf(f), name = String(f.get("name") ?? "").trim(), pw = String(f.get("password") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new Error("Email inválido");
  if (adminEmails().includes(email)) throw new Error("Ese email es de un administrador");
  if (pw.length < 8) throw new Error("La contraseña necesita al menos 8 caracteres");
  const { error } = await db.from("partners").insert({ email, name, password_hash: hashPassword(pw) });
  if (error) throw new Error(error.code === "23505" ? "Ya existe un socio con ese email" : error.message);
  done();
}

export async function setPartnerOffers(f: FormData) {
  await requireAdmin();
  const ids = f.getAll("offer").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  await db.from("partners").update({ offer_ids: ids }).eq("email", mailOf(f));
  done();
}

export async function setPartnerPassword(f: FormData) {
  await requireAdmin();
  const pw = String(f.get("password") ?? "");
  if (pw.length < 8) throw new Error("La contraseña necesita al menos 8 caracteres");
  await db.from("partners").update({ password_hash: hashPassword(pw) }).eq("email", mailOf(f));
  done();
}

export async function setPartnerActive(f: FormData) {
  await requireAdmin();
  await db.from("partners").update({ active: f.get("active") === "1" }).eq("email", mailOf(f));
  done();
}

export async function deletePartner(f: FormData) {
  await requireAdmin();
  await db.from("partners").delete().eq("email", mailOf(f));
  done();
}

/** «Token para su IA»: uno nuevo (el anterior deja de andar). Se muestra una sola vez; se guarda solo el hash. */
export async function rotatePartnerToken(email: string): Promise<{ token: string } | { error: string }> {
  await requireAdmin();
  const t = newPartnerToken();
  const { error } = await db.from("partners").update({ mcp_token_hash: t.hash, mcp_token_hint: t.hint }).eq("email", email.trim().toLowerCase());
  if (error) return { error: error.message };
  done();
  return { token: t.token };
}

export async function revokePartnerToken(f: FormData) {
  await requireAdmin();
  await db.from("partners").update({ mcp_token_hash: null, mcp_token_hint: null }).eq("email", mailOf(f));
  done();
}
