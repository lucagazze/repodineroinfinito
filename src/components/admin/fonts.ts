import { Inter, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";

/**
 * Las tres tipografías del panel, declaradas una sola vez (panel y login las
 * comparten) y en versión variable: un archivo por familia en vez de uno por
 * peso. Inter para el panel, Plus Jakarta Sans para el login, Space Grotesk
 * para la marca.
 */
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
export const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

export const fontVars = `${inter.variable} ${jakarta.variable} ${grotesk.variable}`;
