import type { Metadata } from "next";
import { pageCtx, type PageProps } from "@/app/catalogo/_ui/ctx";
import { Shell, LegalDoc } from "@/app/catalogo/_ui/shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const c = await pageCtx(props, "/terms");
  return c.meta(`${c.t.ui.docs.terms} · ${c.brand}`, `${c.t.ui.docs.terms} — ${c.brand}. ${c.t.ui.cards.terms.body}`);
}

export default async function TermsPage(props: PageProps) {
  const c = await pageCtx(props, "/terms");
  return (
    <Shell c={c}>
      <LegalDoc c={c} doc="terms" />
    </Shell>
  );
}
