/** Sin imports de servidor: lo usa también el selector (cliente). */
export type Source = "meta" | "real";
// v2: ahora arranca en lo REAL; la preferencia vieja (que solía decir Meta) no se arrastra.
export const SOURCE_COOKIE = "ad-source-v2";
