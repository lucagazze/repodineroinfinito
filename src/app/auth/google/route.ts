import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

/**
 * "Continuar con Google" por Supabase Auth, con PKCE: el verificador queda en
 * una cookie httpOnly y el callback lo canjea por la sesión. Sin supabase-js
 * en el navegador: el panel no expone ninguna llave.
 */
export async function GET(req: NextRequest) {
  const url = process.env.SUPABASE_URL;
  if (!url) return NextResponse.redirect(new URL("/entrar?e=3", req.url));
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const back = new URL("/auth/callback", req.url).toString();
  const to = new URL(`${url}/auth/v1/authorize`);
  to.searchParams.set("provider", "google");
  to.searchParams.set("redirect_to", back);
  to.searchParams.set("code_challenge", challenge);
  to.searchParams.set("code_challenge_method", "s256");
  const res = NextResponse.redirect(to);
  res.cookies.set("cp_pkce", verifier, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth", maxAge: 600,
  });
  return res;
}
