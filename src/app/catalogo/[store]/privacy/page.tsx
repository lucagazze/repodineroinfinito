import type { Metadata } from "next";
import { pageCtx, type PageProps } from "@/app/catalogo/_ui/ctx";
import { Shell, LegalDoc } from "@/app/catalogo/_ui/shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const c = await pageCtx(props, "/privacy");
  return c.meta(`${c.t.ui.docs.privacy} · ${c.brand}`, `${c.t.ui.docs.privacy} — ${c.brand}. ${c.t.ui.cards.privacy.body}`);
}

export default async function PrivacyPage(props: PageProps) {
  const c = await pageCtx(props, "/privacy");
  return (
    <Shell c={c}>
      <LegalDoc c={c} doc="privacy" />
    </Shell>
  );
}
