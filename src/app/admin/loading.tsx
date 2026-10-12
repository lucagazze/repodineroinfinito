import { SkPage, SkShell } from "@/components/admin/Skeleton";

/** Mientras carga el menú (entrar al panel, cambiar de tienda): menú y página en gris. */
export default function Loading() {
  return <SkShell><SkPage variant="inicio" /></SkShell>;
}
