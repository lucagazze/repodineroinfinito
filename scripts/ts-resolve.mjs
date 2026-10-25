/**
 * Resolver para correr los módulos de src/lib fuera de Next: el repo importa
 * sin extensión ("../db") y con el alias "@/", que ESM no resuelve solo.
 * Uso: node --experimental-strip-types --import ./scripts/ts-resolve.mjs <script>
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);
// src/lib arrastra next/cache por los imports de checkout-data; la vista previa
// no ejecuta esos caminos, asi que se resuelve a un stub.
const STUBS = { "next/cache": new URL("./next-cache-stub.mjs", import.meta.url).href };

registerHooks({
  resolve(spec, ctx, next) {
    let s = spec;
    if (STUBS[s]) return next(STUBS[s], ctx);
    if (s.startsWith("@/")) s = new URL(s.slice(2), SRC).href;

    const relative = s.startsWith(".") || s.startsWith("file:");
    if (relative && !/\.[a-z]+$/i.test(s)) {
      const base = s.startsWith("file:") ? new URL(s) : new URL(s, ctx.parentURL);
      const p = fileURLToPath(base);
      for (const cand of [`${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) {
        if (existsSync(cand)) return next(pathToFileURL(cand).href, ctx);
      }
    }
    return next(s, ctx);
  },
});
