import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** «Pujas» ahora es una sección del Piloto Meta Ads (los links y push viejos siguen andando). */
export default function Pujas() {
  redirect("/admin/piloto");
}
