import { redirect } from "next/navigation";

export default async function Configuracion({ params }: { params: Promise<{ offer: string }> }) {
  const { offer } = await params;
  redirect(`/admin/o/${offer}/configuracion/general`);
}
