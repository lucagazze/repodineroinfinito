import { Inter } from "next/font/google";

/** La tipografía de las landings de las ofertas (Inter 400–800), servida por la app. latin-ext para el polaco. */
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--bib-inter", display: "swap" });

export const bibFonts = inter.variable;
