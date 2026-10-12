/**
 * Tailwind solo para el panel y el login . El checkout y
 * el catálogo públicos no importan admin.css: no reciben el reset de Tailwind.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: "class",
  content: [
    "./src/app/admin/**/*.{ts,tsx}",
    "./src/app/entrar/**/*.{ts,tsx}",
    "./src/components/admin/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        jakarta: ["var(--font-jakarta)", "Plus Jakarta Sans", "Inter", "-apple-system", "sans-serif"],
        display: ["var(--font-grotesk)", "Space Grotesk", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
