import { redirect } from "next/navigation";
import { adminEmails, isLoggedIn, login } from "@/lib/auth";
import { currentPartner, isPartnerEmail, partnerLogin } from "@/lib/partner";
import { ADMIN_ICONS, Logo, LogoMark } from "@/components/admin/Logo";
import { ThemeSync } from "@/components/admin/Theme";
import { THEME_SCRIPT } from "@/components/admin/theme-script";
import PasswordInput from "@/components/admin/PasswordInput";
import { fontVars } from "@/components/admin/fonts";
import "@/components/admin/admin.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panel", robots: { index: false }, icons: ADMIN_ICONS };
/** El panel es siempre oscuro: la barra del navegador del celular, también. */
export const viewport = { themeColor: "#060606", colorScheme: "dark" as const };


const ERRORS: Record<string, string> = {
  "2": "Demasiados intentos. Probá en 15 minutos.",
  "3": "No se pudo entrar con Google. Probá de nuevo o usá email y contraseña.",
  "4": "Esa cuenta de Google no tiene acceso a este panel.",
};

const input =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3.5 text-[13px] font-semibold text-zinc-900 outline-none transition-all duration-200 " +
  "placeholder:text-zinc-400 focus:border-emerald-500/80 focus:ring-4 focus:ring-emerald-500/10 " +
  "dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500";
const label = "text-[9.5px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

/** Login: usuario (email de ADMIN_EMAILS) y contraseña, o Google. */
export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  if (await isLoggedIn()) redirect("/admin");
  if (await currentPartner()) redirect("/socio");
  const { e } = await searchParams;

  async function submit(form: FormData) {
    "use server";
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    // Un socio (migración 066) entra a su propio panel, nunca al de administración.
    if (email && !adminEmails().includes(email) && (await isPartnerEmail(email))) {
      const p = await partnerLogin(email, String(form.get("password") ?? ""));
      redirect(p === "ok" ? "/socio" : p === "locked" ? "/entrar?e=2" : "/entrar?e=1");
    }
    const r = await login(String(form.get("password") ?? ""), String(form.get("email") ?? ""));
    redirect(r === "ok" ? "/admin" : r === "locked" ? "/entrar?e=2" : "/entrar?e=1");
  }

  return (
    <div className={`ad-root dark ${fontVars}`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ThemeSync />
      <div className="relative flex min-h-[100dvh] flex-col bg-[#f8f9fa] font-jakarta dark:bg-[#060606]">
        <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200/40 bg-[#f8f9fa]/85 backdrop-blur-md dark:border-white/[0.04] dark:bg-[#060606]/85">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:h-[68px] md:px-6">
            <Logo compact />
          </div>
        </header>

        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-24">
          <div className="w-full max-w-[360px]">
            <div className="mb-6 flex flex-col items-center text-center">
              {/* El logo grande, con un halo violeta detrás. */}
              <div className="relative mb-5 flex h-24 w-24 items-center justify-center">
                <span aria-hidden className="absolute inset-0 rounded-full bg-violet-600/30 blur-2xl" />
                <LogoMark size={88} className="relative" />
              </div>
              <h1 className="text-[22px] font-black tracking-tight text-zinc-900 dark:text-white">Iniciar sesión</h1>
              <p className="mt-1.5 text-[12.5px] font-semibold text-zinc-500 dark:text-zinc-400">Panel de control</p>
            </div>

            <div className="rounded-3xl border border-zinc-200/60 bg-white/90 p-6 shadow-[0_20px_40px_rgba(0,0,0,0.03)] backdrop-blur-md dark:border-white/[0.07] dark:bg-[#0f0f0f]/80 dark:shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
              <a href="/auth/google"
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-300 bg-white text-[13px] font-bold text-zinc-800 transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continuar con Google
              </a>

              <div className="my-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />o<span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <form action={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className={label}>Email</label>
                  <input id="email" name="email" type="email" placeholder="tu@email.com" autoComplete="username" autoFocus required className={input} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="password" className={label}>Contraseña</label>
                  <PasswordInput className={input} />
                </div>
                <button className="flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-[11px] font-black uppercase tracking-wider text-white transition-all duration-200 hover:scale-[1.01] hover:bg-zinc-800 active:scale-[0.99] dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100">
                  Ingresar
                </button>
                {e && (
                  <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-center text-[12px] font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
                    {ERRORS[e] ?? "Email o contraseña incorrectos"}
                  </p>
                )}
              </form>
            </div>

            <p className="mt-6 text-center text-[11.5px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-600">Solo para cuentas autorizadas.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
