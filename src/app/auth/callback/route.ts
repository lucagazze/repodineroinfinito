import { NextRequest, NextResponse } from "next/server";
import { loginWithEmail } from "@/lib/auth";

export const runtime = "nodejs";

/** Vuelta de Google: canjea el código por el usuario y abre la sesión si su email está habilitado. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const verifier = req.cookies.get("cp_pkce")?.value;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const fail = (e: string) => NextResponse.redirect(new URL(`/entrar?e=${e}`, req.url));
  if (!code || !verifier || !url || !key) return fail("3");

  const r = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return fail("3");
  const j = (await r.json()) as { user?: { email?: string } };
  const email = j.user?.email;
  if (!email || (await loginWithEmail(email)) !== "ok") return fail("4");

  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.delete("cp_pkce");
  return res;
}
