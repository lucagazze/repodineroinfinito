"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ className }: { className: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id="password" name="password" type={show ? "text" : "password"} placeholder="••••••••" autoComplete="current-password" required
        className={`${className} pr-11`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 transition-all hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
